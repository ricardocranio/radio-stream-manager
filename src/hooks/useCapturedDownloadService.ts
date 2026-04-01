/**
 * Background service for automatic download of captured songs.
 * Runs independently of the CapturedSongsView — downloads continue
 * even when the user navigates to other tabs.
 * 
 * Polls scraped_songs from Supabase every 2 minutes,
 * checks against music library, and downloads missing songs via Deezer.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useRadioStore, DownloadHistoryEntry } from '@/store/radioStore';
import { useCapturedDownloadStore } from '@/store/capturedDownloadStore';
import { supabase } from '@/integrations/supabase/client';
import { checkSongInLibrary } from '@/hooks/useCheckMusicLibrary';
import { markSongAsDownloaded } from '@/lib/libraryVerificationCache';
import { subHours } from 'date-fns';
import { acquireDownloadLock, releaseDownloadLock } from '@/lib/downloadMutex';
import { isStationAllowedForDownload } from '@/lib/allowedDownloadStations';
import { buildBlockedEngine } from '@/lib/blockedSongsEngine';
import { recordBlockedEvent } from '@/components/dashboard/BlockedSongsCard';
import { isVinhetaOrJingle } from '@/lib/vinhetaFilter';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

const POLL_INTERVAL = 120_000; // 2 minutes
const DOWNLOAD_DELAY = 15_000; // 15s between downloads
const MAX_RETRIES = 3; // After 3 failures, skip permanently

// Shared ID3 genre utilities
import { normalizeId3Genre, genreToEnergy, routeFileByGenre } from '@/lib/id3GenreUtils';

interface CapturedQueueItem {
  id: string;
  artist: string;
  title: string;
  station_name: string;
  retryCount?: number;
}

export function useCapturedDownloadService() {
  const processedRef = useRef<Set<string>>(new Set());
  const isProcessingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const downloadOne = useCallback(async (song: CapturedQueueItem): Promise<'success' | 'exists' | 'error'> => {
    const { deezerConfig, config, addDownloadHistory, songAliases } = useRadioStore.getState();

    // 🚫 Block check BEFORE any operation (using centralized engine)
    const blockedEngine = buildBlockedEngine(
      config.blockedSongs ?? [],
      config.forbiddenWords ?? [],
      songAliases ?? []
    );
    if (blockedEngine.isBlocked(song.artist, song.title)) {
      console.log(`[CAP-DL] 🚫 Bloqueada, não será baixada: ${song.artist} - ${song.title}`);
      recordBlockedEvent({ artist: song.artist, title: song.title, rule: 'exact', source: 'captured-download' });
      return 'exists'; // treat as "exists" to skip without error
    }

    // Skip vinhetas/jingles
    if (isVinhetaOrJingle(song.artist, song.title)) {
      console.log(`[CAP-DL] 🚫 Vinheta/jingle bloqueada: ${song.artist} - ${song.title}`);
      return 'exists';
    }

    // === Apply alias correction: use "Para" (correct) name, block "De" (wrong) ===
    let dlArtist = song.artist;
    let dlTitle = song.title;
    if (songAliases?.length) {
      for (const alias of songAliases) {
        if (song.artist.trim().toLowerCase() === alias.fromArtist.toLowerCase().trim() &&
            song.title.trim().toLowerCase() === alias.fromTitle.toLowerCase().trim()) {
          console.log(`[CAP-DL] 🔄 Alias: "${song.artist} - ${song.title}" → "${alias.toArtist} - ${alias.toTitle}"`);
          dlArtist = alias.toArtist;
          dlTitle = alias.toTitle;
          break;
        }
      }
    }

    // Also check if alias-resolved name is blocked
    if ((dlArtist !== song.artist || dlTitle !== song.title) &&
        blockedEngine.isBlocked(dlArtist, dlTitle)) {
      console.log(`[CAP-DL] 🚫 Bloqueada (via alias "${dlArtist} - ${dlTitle}"): ${song.artist} - ${song.title}`);
      recordBlockedEvent({ artist: song.artist, title: song.title, rule: 'alias', source: 'captured-download' });
      return 'exists';
    }

    // Check library first (using corrected name)
    if (config.musicFolders?.length > 0) {
      try {
        const result = await checkSongInLibrary(
          dlArtist,
          dlTitle,
          config.musicFolders,
          config.similarityThreshold || 0.75
        );
        if (result.exists) {
          return 'exists';
        }
        // Also check original name (file might exist under old name)
        if (dlArtist !== song.artist || dlTitle !== song.title) {
          const origResult = await checkSongInLibrary(
            song.artist,
            song.title,
            config.musicFolders,
            config.similarityThreshold || 0.75
          );
          if (origResult.exists) {
            return 'exists';
          }
        }
      } catch {
        // continue
      }
    }

    if (!isElectron || !window.electronAPI?.downloadFromDeezer) return 'error';

    // Block if ARL is invalid
    const autoStore = (await import('@/store/autoDownloadStore')).useAutoDownloadStore;
    if (!autoStore.getState().arlValid) {
      console.warn(`[CAP-DL] ⏸️ ARL inválida, pulando: ${song.artist} - ${song.title}`);
      return 'error';
    }

    const startTime = Date.now();
    try {
      const result = await window.electronAPI.downloadFromDeezer({
        artist: dlArtist,
        title: dlTitle,
        arl: deezerConfig.arl,
        outputFolder: deezerConfig.downloadFolder,
        quality: deezerConfig.quality,
      });

      const duration = Date.now() - startTime;

      if (result?.success) {
        markSongAsDownloaded(dlArtist, dlTitle, result.verifiedFile);

        // Read ID3 genre from downloaded file and update DB
        let downloadedGenre: string | null = null;
        try {
          const { config } = useRadioStore.getState();
          const verifiedFile = result.verifiedFile || `${dlArtist} - ${dlTitle}.mp3`;
          const id3Result = await window.electronAPI?.readId3Genre?.({
            filePath: verifiedFile,
            musicFolders: config.musicFolders,
          }) as { success: boolean; genre?: string | null; artist?: string | null; title?: string | null; year?: string | null; error?: string } | undefined;
          if (id3Result?.success) {
            const updatePayload: Record<string, string> = {};
            if (id3Result.genre) {
              const normalizedGenre = normalizeId3Genre(id3Result.genre);
              downloadedGenre = normalizedGenre;
              updatePayload.ai_genre = normalizedGenre;
              updatePayload.ai_energy = genreToEnergy(normalizedGenre);
              console.log(`[CAP-DL] 🏷️ ID3 genre: ${id3Result.genre} → ${normalizedGenre}`);
            }
            if (id3Result.year) {
              updatePayload.year = id3Result.year;
              console.log(`[CAP-DL] 📅 ID3 year: ${id3Result.year}`);
            }
            if (Object.keys(updatePayload).length > 0) {
              await supabase
                .from('scraped_songs')
                .update(updatePayload)
                .eq('id', song.id);
            }
          }
        } catch (e) {
          // Non-critical — don't fail the download
          console.warn('[CAP-DL] ID3 genre read failed:', e);
        }

        // === Genre-based folder routing (passes pre-read genre directly) ===
        const isVozDoBrasil = dlTitle?.toLowerCase().includes('voz do brasil') || 
                              dlArtist?.toLowerCase().includes('voz do brasil');
        if (!isVozDoBrasil && deezerConfig.genreRoutingEnabled) {
          const fileForRoute = result.verifiedFile || `${dlArtist} - ${dlTitle}.mp3`;
          await routeFileByGenre(fileForRoute, deezerConfig.downloadFolder, config.musicFolders || [], '[CAP-DL]', downloadedGenre);
        }

        const entry: DownloadHistoryEntry = {
          id: crypto.randomUUID(),
          songId: song.id,
          title: dlTitle,
          artist: dlArtist,
          timestamp: new Date(),
          status: 'success',
          duration,
        };
        addDownloadHistory(entry);
        console.log(`[CAP-DL] ✅ ${dlArtist} - ${dlTitle}`);
        return 'success';
      }
      throw new Error(result?.error || 'Download failed');
    } catch (error) {
      const duration = Date.now() - startTime;
      const entry: DownloadHistoryEntry = {
        id: crypto.randomUUID(),
        songId: song.id,
        title: dlTitle,
        artist: dlArtist,
        timestamp: new Date(),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
        duration,
      };
      addDownloadHistory(entry);
      console.error(`[CAP-DL] ❌ ${dlArtist} - ${dlTitle}`, error);
      return 'error';
    }
  }, []);

  const processQueue = useCallback(async (queue: CapturedQueueItem[]) => {
    if (isProcessingRef.current || queue.length === 0) return;

    isProcessingRef.current = true;
    const store = useCapturedDownloadStore.getState();
    store.setIsProcessing(true);
    store.setQueueLength(queue.length);

    // Use a mutable queue so failed items go to the end
    const mutableQueue = [...queue.map(s => ({ ...s, retryCount: s.retryCount ?? 0 }))];
    
    while (mutableQueue.length > 0) {
      const { isRunning, deezerConfig } = useRadioStore.getState();
      if (!isRunning || !deezerConfig.enabled || !deezerConfig.autoDownload) break;

      const song = mutableQueue.shift()!;
      useCapturedDownloadStore.getState().setQueueLength(mutableQueue.length + 1);

      // Acquire global mutex — wait for any grade download to finish first
      await acquireDownloadLock(0); // priority 0 = lowest (grade gets 500+)
      let result: 'success' | 'exists' | 'error';
      try {
        result = await downloadOne(song);
      } finally {
        releaseDownloadLock();
      }
      
      if (result === 'success') {
        useCapturedDownloadStore.getState().incrementProcessed();
      } else if (result === 'exists') {
        useCapturedDownloadStore.getState().incrementExists();
      } else {
        // Error — retry up to MAX_RETRIES, send to end of queue
        const newRetry = (song.retryCount ?? 0) + 1;
        if (newRetry < MAX_RETRIES) {
          console.log(`[CAP-DL] 🔄 ${song.artist} - ${song.title} falhou (tentativa ${newRetry}/${MAX_RETRIES}). Vai para o fim da fila.`);
          mutableQueue.push({ ...song, retryCount: newRetry });
        } else {
          console.warn(`[CAP-DL] 🗑️ ${song.artist} - ${song.title} falhou ${newRetry}x. Removida definitivamente.`);
          useCapturedDownloadStore.getState().incrementError();
        }
      }

      // Yield to event loop every 3 iterations
      if (mutableQueue.length % 3 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }

      // Delay between downloads
      if (mutableQueue.length > 0) {
        await new Promise(r => setTimeout(r, DOWNLOAD_DELAY));
      }
    }

    isProcessingRef.current = false;
    useCapturedDownloadStore.getState().setIsProcessing(false);
    useCapturedDownloadStore.getState().setQueueLength(0);
  }, [downloadOne]);

  // === ARL HEALTH CHECK (cached — avoid redundant calls) ===
  const arlCacheRef = useRef<{ valid: boolean; checkedAt: number }>({ valid: true, checkedAt: 0 });
  const ARL_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  const checkArlBeforeBatch = useCallback(async (): Promise<boolean> => {
    // Return cached result if recent
    if (Date.now() - arlCacheRef.current.checkedAt < ARL_CACHE_TTL) {
      return arlCacheRef.current.valid;
    }

    const { deezerConfig } = useRadioStore.getState();
    if (!deezerConfig.enabled || !deezerConfig.arl) return false;

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !supabaseKey) return true;

      const resp = await fetch(`${supabaseUrl}/functions/v1/validate-deezer-arl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({ arl: deezerConfig.arl }),
      });

      const data = await resp.json();
      const valid = data?.valid !== false;
      arlCacheRef.current = { valid, checkedAt: Date.now() };
      
      if (!valid) {
        console.warn('[CAP-DL] ⚠️ ARL INVÁLIDA! Downloads pausados.');
      }
      return valid;
    } catch (err) {
      console.warn('[CAP-DL] ⚠️ Falha ao validar ARL, prosseguindo:', err);
      arlCacheRef.current = { valid: true, checkedAt: Date.now() };
      return true;
    }
  }, []);

  const checkAndDownload = useCallback(async () => {
    const { isRunning, deezerConfig } = useRadioStore.getState();
    if (!isRunning || !deezerConfig.enabled || !deezerConfig.arl || !deezerConfig.autoDownload) return;
    if (isProcessingRef.current) return;

    // Force ARL validation before processing
    const arlValid = await checkArlBeforeBatch();
    if (!arlValid) return;

    try {
      // Fetch last 24h of captured songs
      const threshold = subHours(new Date(), 24).toISOString();
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('id, artist, title, station_name')
        .gte('scraped_at', threshold)
        .order('scraped_at', { ascending: false })
        .limit(500);

      if (error || !data) return;

      // Build centralized blocked engine (O(1) lookups with full normalization + alias support)
      const storeState = useRadioStore.getState();
      const blockedEngine = buildBlockedEngine(
        storeState.config.blockedSongs ?? [],
        storeState.config.forbiddenWords ?? [],
        storeState.songAliases ?? []
      );
      
      const seen = new Set<string>();
      const unique: CapturedQueueItem[] = [];
      for (const song of data) {
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        if (seen.has(key) || processedRef.current.has(key)) continue;
        if (blockedEngine.isBlocked(song.artist, song.title)) {
          console.log(`[CAP-DL] 🚫 Bloqueada na fila: ${song.artist} - ${song.title}`);
          recordBlockedEvent({ artist: song.artist, title: song.title, rule: 'exact', source: 'captured-download' });
          continue;
        }
        // === STATION FILTER: only download from sequence/priority stations ===
        if (!isStationAllowedForDownload(song.station_name)) continue;
        seen.add(key);
        unique.push(song);
      }

      if (unique.length === 0) return;

      // Mark as processed so we don't re-queue
      unique.forEach(s => {
        const key = `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
        processedRef.current.add(key);
      });

      // Cap processed set
      if (processedRef.current.size > 500) {
        const entries = [...processedRef.current];
        processedRef.current = new Set(entries.slice(entries.length - 250));
      }

      console.log(`[CAP-DL] 🎵 ${unique.length} novas capturadas para verificar/baixar`);
      await processQueue(unique);
    } catch (err) {
      console.error('[CAP-DL] Erro ao buscar capturadas:', err);
    }
  }, [processQueue, checkArlBeforeBatch]);

  const start = useCallback(() => {
    // Initial check after 30s (let other services start first)
    const initialTimeout = setTimeout(() => {
      checkAndDownload();
    }, 30_000);

    intervalRef.current = setInterval(checkAndDownload, POLL_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkAndDownload]);

  // Reset on daily reset
  useEffect(() => {
    const unsub = useRadioStore.subscribe((s, prev) => {
      // When capturedSongs are cleared, reset our processed set
      if (s.capturedSongs.length === 0 && prev.capturedSongs.length > 0) {
        processedRef.current.clear();
        useCapturedDownloadStore.getState().resetStats();
        console.log('[CAP-DL] 🔄 Reset (daily cleanup)');
      }
    });
    return () => unsub();
  }, []);

  return { start, checkAndDownload };
}
