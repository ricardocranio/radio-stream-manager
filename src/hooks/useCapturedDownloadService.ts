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

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

const POLL_INTERVAL = 120_000; // 2 minutes
const DOWNLOAD_DELAY = 15_000; // 15s between downloads

// Map ID3 genre text to normalized genre
const ID3_GENRE_MAP: Record<string, string> = {
  pop: 'POP', rock: 'ROCK', sertanejo: 'SERTANEJO', 'sertanejo universitário': 'SERTANEJO',
  pagode: 'PAGODE', mpb: 'MPB', 'hip-hop': 'RAP/HIP-HOP', 'hip hop': 'RAP/HIP-HOP',
  rap: 'RAP/HIP-HOP', electronic: 'ELETRONICA', dance: 'ELETRONICA', edm: 'ELETRONICA',
  funk: 'FUNK', 'funk carioca': 'FUNK', gospel: 'GOSPEL', forró: 'FORRO', forro: 'FORRO',
  reggaeton: 'REGGAETON', 'r&b': 'R&B', rnb: 'R&B', country: 'COUNTRY', jazz: 'JAZZ',
  classical: 'CLASSICA', indie: 'INDIE', metal: 'METAL', 'heavy metal': 'METAL',
  reggae: 'REGGAE', latin: 'LATINA', latina: 'LATINA', soul: 'R&B', blues: 'MPB',
  'bossa nova': 'MPB', samba: 'PAGODE', axé: 'FORRO', axe: 'FORRO',
};

function normalizeId3Genre(raw: string): string {
  const lower = raw.toLowerCase().replace(/[()]/g, '').trim();
  // Check numeric ID3v1 genre codes
  const num = parseInt(lower);
  if (!isNaN(num)) {
    const id3v1Genres: Record<number, string> = {
      0: 'MPB', 1: 'ROCK', 2: 'POP', 3: 'ELETRONICA', 13: 'POP', 14: 'R&B',
      15: 'RAP/HIP-HOP', 17: 'ROCK', 18: 'ELETRONICA', 32: 'CLASSICA',
      52: 'ELETRONICA', 59: 'REGGAE', 62: 'POP', 80: 'COUNTRY', 85: 'RAP/HIP-HOP',
    };
    return id3v1Genres[num] || 'OUTRO';
  }
  return ID3_GENRE_MAP[lower] || 'OUTRO';
}

function genreToEnergy(genre: string): string {
  const map: Record<string, string> = {
    SERTANEJO: 'MEDIUM', PAGODE: 'MEDIUM', POP: 'HIGH', ELETRONICA: 'VERY_HIGH',
    MPB: 'LOW', ROCK: 'HIGH', FUNK: 'VERY_HIGH', GOSPEL: 'MEDIUM', FORRO: 'HIGH',
    'RAP/HIP-HOP': 'HIGH', REGGAETON: 'HIGH', 'R&B': 'MEDIUM', COUNTRY: 'MEDIUM',
    JAZZ: 'LOW', CLASSICA: 'LOW', INDIE: 'MEDIUM', METAL: 'VERY_HIGH',
    REGGAE: 'LOW', LATINA: 'HIGH', OUTRO: 'MEDIUM',
  };
  return map[genre] || 'MEDIUM';
}

interface CapturedQueueItem {
  id: string;
  artist: string;
  title: string;
  station_name: string;
}

export function useCapturedDownloadService() {
  const processedRef = useRef<Set<string>>(new Set());
  const isProcessingRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const downloadOne = useCallback(async (song: CapturedQueueItem): Promise<'success' | 'exists' | 'error'> => {
    const { deezerConfig, config, addDownloadHistory } = useRadioStore.getState();

    // Check library first
    if (config.musicFolders?.length > 0) {
      try {
        const result = await checkSongInLibrary(
          song.artist,
          song.title,
          config.musicFolders,
          config.similarityThreshold || 0.75
        );
        if (result.exists) {
          return 'exists';
        }
      } catch {
        // continue
      }
    }

    if (!isElectron || !window.electronAPI?.downloadFromDeezer) return 'error';

    const startTime = Date.now();
    try {
      const result = await window.electronAPI.downloadFromDeezer({
        artist: song.artist,
        title: song.title,
        arl: deezerConfig.arl,
        outputFolder: deezerConfig.downloadFolder,
        quality: deezerConfig.quality,
      });

      const duration = Date.now() - startTime;

      if (result?.success) {
        markSongAsDownloaded(song.artist, song.title, result.output);

        // Read ID3 genre from downloaded file and update DB
        try {
          const { config } = useRadioStore.getState();
          const verifiedFile = result.verifiedFile || `${song.artist} - ${song.title}.mp3`;
          const id3Result = await window.electronAPI?.readId3Genre?.({
            filePath: verifiedFile,
            musicFolders: config.musicFolders,
          });
          if (id3Result?.success && id3Result.genre) {
            const normalizedGenre = normalizeId3Genre(id3Result.genre);
            await supabase
              .from('scraped_songs')
              .update({ ai_genre: normalizedGenre, ai_energy: genreToEnergy(normalizedGenre) })
              .eq('id', song.id);
            console.log(`[CAP-DL] 🏷️ ID3 genre: ${id3Result.genre} → ${normalizedGenre}`);
          }
        } catch (e) {
          // Non-critical — don't fail the download
          console.warn('[CAP-DL] ID3 genre read failed:', e);
        }

        const entry: DownloadHistoryEntry = {
          id: crypto.randomUUID(),
          songId: song.id,
          title: song.title,
          artist: song.artist,
          timestamp: new Date(),
          status: 'success',
          duration,
        };
        addDownloadHistory(entry);
        console.log(`[CAP-DL] ✅ ${song.artist} - ${song.title}`);
        return 'success';
      }
      throw new Error(result?.error || 'Download failed');
    } catch (error) {
      const duration = Date.now() - startTime;
      const entry: DownloadHistoryEntry = {
        id: crypto.randomUUID(),
        songId: song.id,
        title: song.title,
        artist: song.artist,
        timestamp: new Date(),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
        duration,
      };
      addDownloadHistory(entry);
      console.error(`[CAP-DL] ❌ ${song.artist} - ${song.title}`, error);
      return 'error';
    }
  }, []);

  const processQueue = useCallback(async (queue: CapturedQueueItem[]) => {
    if (isProcessingRef.current || queue.length === 0) return;

    isProcessingRef.current = true;
    const store = useCapturedDownloadStore.getState();
    store.setIsProcessing(true);
    store.setQueueLength(queue.length);

    for (let i = 0; i < queue.length; i++) {
      const { isRunning, deezerConfig } = useRadioStore.getState();
      if (!isRunning || !deezerConfig.enabled || !deezerConfig.autoDownload) break;

      const song = queue[i];
      useCapturedDownloadStore.getState().setQueueLength(queue.length - i);

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
        useCapturedDownloadStore.getState().incrementError();
      }

      // Yield to event loop every 3 iterations
      if (i % 3 === 2) {
        await new Promise(r => setTimeout(r, 0));
      }

      // Delay between downloads
      if (i < queue.length - 1) {
        await new Promise(r => setTimeout(r, DOWNLOAD_DELAY));
      }
    }

    isProcessingRef.current = false;
    useCapturedDownloadStore.getState().setIsProcessing(false);
    useCapturedDownloadStore.getState().setQueueLength(0);
  }, [downloadOne]);

  // === ARL HEALTH CHECK (forced before each batch) ===
  const checkArlBeforeBatch = useCallback(async (): Promise<boolean> => {
    const { deezerConfig } = useRadioStore.getState();
    if (!deezerConfig.enabled || !deezerConfig.arl) return false;

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !supabaseKey) return true; // skip check if no env

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
      if (data?.valid !== true) {
        console.warn('[CAP-DL] ⚠️ ARL INVÁLIDA! Downloads pausados.');
        return false;
      }
      console.log('[CAP-DL] ✅ ARL válida, prosseguindo com downloads.');
      return true;
    } catch (err) {
      console.warn('[CAP-DL] ⚠️ Falha ao validar ARL, prosseguindo mesmo assim:', err);
      return true; // allow on network error to avoid blocking
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

      // Deduplicate by artist+title and filter blocked songs
      const blockedList = (useRadioStore.getState().config.blockedSongs || []).map(s => s.toLowerCase().trim());
      const blockedExact = new Set<string>(blockedList.filter(s => !s.endsWith(' - *')));
      const blockedWildcardArtists = blockedList
        .filter(s => s.endsWith(' - *'))
        .map(s => s.replace(/ - \*$/, ''));
      
      const isBlocked = (artist: string, title: string): boolean => {
        const key = `${artist.trim()} - ${title.trim()}`.toLowerCase();
        if (blockedExact.has(key)) return true;
        const artistLower = artist.trim().toLowerCase();
        const titleLower = title.trim().toLowerCase();
        if (blockedWildcardArtists.some(blocked => artistLower === blocked || artistLower.includes(blocked))) return true;
        // Also check forbiddenWords
        const forbiddenLower = (useRadioStore.getState().config.forbiddenWords || []).map(w => w.toLowerCase().trim()).filter(Boolean);
        if (forbiddenLower.some(word => artistLower.includes(word) || titleLower.includes(word))) return true;
        return false;
      };
      
      const seen = new Set<string>();
      const unique: CapturedQueueItem[] = [];
      for (const song of data) {
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        if (seen.has(key) || processedRef.current.has(key)) continue;
        if (isBlocked(song.artist, song.title)) continue;
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
