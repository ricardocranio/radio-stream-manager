/**
 * Global Download Service Hook
 * 
 * Manages the auto-download queue for missing songs.
 * Features: progressive cooldown retry, quality fallback, real-time progress, ARL health check.
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import { useRadioStore, MissingSong, DownloadHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { markSongAsDownloaded } from '@/lib/libraryVerificationCache';
import { acquireDownloadLock, releaseDownloadLock } from '@/lib/downloadMutex';

// Shared ID3 genre utilities
import { normalizeId3Genre as normalizeId3GenreForDl, genreToEnergy as genreToEnergyForDl, routeFileByGenre } from '@/lib/id3GenreUtils';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

interface DownloadQueueItem {
  song: MissingSong;
  retryCount: number;
  priority: number;
  lastFailedAt?: number;
  consecutiveFailures?: number;
  fallbackQuality?: boolean; // true = try 128 instead of 320
}

const PRIORITY_GRADE_BOOST = 500;
const PRIORITY_SEQUENCE_BOOST = 200;
const PRIORITY_STATION_BOOST = 100;

const MAX_RETRIES = 3; // After 3 failures, remove from queue permanently
const ARL_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export interface DownloadServiceState {
  queueLength: number;
  isProcessing: boolean;
}

export function useGlobalDownloadService() {
  const downloadQueueRef = useRef<DownloadQueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const processedSongsRef = useRef<Set<string>>(new Set());
  const downloadIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arlCheckIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLogTimeRef = useRef<number>(0);
  const failureTracker = useRef<Map<string, { count: number; lastFail: number }>>(new Map());

  const [state, setState] = useState<DownloadServiceState>({
    queueLength: 0,
    isProcessing: false,
  });

  // === ARL HEALTH CHECK ===
  const checkArlHealth = useCallback(async () => {
    if (!isElectron) return;
    const { deezerConfig } = useRadioStore.getState();
    if (!deezerConfig.enabled || !deezerConfig.arl) return;

    try {
      // Use the validate-deezer-arl edge function
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !supabaseKey) return;

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
      const valid = data?.valid === true;
      useAutoDownloadStore.getState().setArlStatus(valid);

      if (!valid) {
        console.warn('[DL-SVC] ⚠️ ARL INVÁLIDA! Downloads serão pausados até uma nova ARL ser configurada.');
      } else {
        console.log(`[DL-SVC] ✅ ARL válida — Usuário: ${data.name || 'OK'}`);
      }
    } catch (err) {
      console.warn('[DL-SVC] ARL check failed (network?):', (err as Error).message);
      // Don't mark as invalid on network errors — keep last known state
    }
  }, []);

  // === DOWNLOAD WITH QUALITY FALLBACK ===
  const downloadSong = useCallback(async (song: MissingSong, fallbackQuality?: boolean): Promise<boolean> => {
    if (!isElectron || !window.electronAPI?.downloadFromDeezer) {
      return false;
    }

    const storeState = useRadioStore.getState();
    if (!storeState.deezerConfig.enabled || !storeState.deezerConfig.arl) {
      return false;
    }

    // Apply song aliases (corrections) before download
    let dlArtist = song.artist;
    let dlTitle = song.title;
    const aliases = storeState.songAliases || [];
    for (const alias of aliases) {
      if (
        dlArtist.toLowerCase().trim() === alias.fromArtist.toLowerCase().trim() &&
        dlTitle.toLowerCase().trim() === alias.fromTitle.toLowerCase().trim()
      ) {
        console.log(`[DL-SVC] 🔄 Alias aplicado: "${dlArtist} - ${dlTitle}" → "${alias.toArtist} - ${alias.toTitle}"`);
        dlArtist = alias.toArtist;
        dlTitle = alias.toTitle;
        break;
      }
    }

    // Block check before downloading
    const { blockedSongs = [], forbiddenWords = [] } = storeState.config;
    const artistL = dlArtist.trim().toLowerCase();
    const titleL = dlTitle.trim().toLowerCase();
    const songKey = `${artistL} - ${titleL}`;
    const blockedList = blockedSongs.map(s => s.toLowerCase().trim());
    const blockedExact = new Set(blockedList.filter(s => !s.endsWith(' - *')));
    const blockedWild = blockedList.filter(s => s.endsWith(' - *')).map(s => s.replace(/ - \*$/, ''));
    const forbiddenLower = forbiddenWords.map(w => w.toLowerCase().trim()).filter(Boolean);
    if (
      blockedExact.has(songKey) ||
      blockedWild.some(b => artistL === b || artistL.includes(b)) ||
      forbiddenLower.some(w => artistL.includes(w) || titleL.includes(w))
    ) {
      console.log(`[DL-SVC] 🚫 Bloqueada, não será baixada: ${dlArtist} - ${dlTitle}`);
      useRadioStore.getState().removeMissingSong(song.id);
      return false;
    }

    // Check ARL validity
    if (!useAutoDownloadStore.getState().arlValid) {
      console.warn(`[DL-SVC] ⏸️ ARL inválida, pulando: ${dlArtist} - ${dlTitle}`);
      return false;
    }

    const quality = fallbackQuality ? 'MP3_128' : storeState.deezerConfig.quality;
    if (fallbackQuality) {
      console.log(`[DL-SVC] 🔄 Fallback 128kbps: ${dlArtist} - ${dlTitle}`);
    } else {
      console.log(`[DL-SVC] 🎵 Downloading (${quality}): ${dlArtist} - ${dlTitle}`);
    }

    useRadioStore.getState().updateMissingSong(song.id, { status: 'downloading' });
    useAutoDownloadStore.getState().setActiveDownload({
      artist: dlArtist,
      title: dlTitle,
      startedAt: Date.now(),
    });

    const startTime = Date.now();

    try {
      const result = await window.electronAPI.downloadFromDeezer({
        artist: dlArtist,
        title: dlTitle,
        arl: storeState.deezerConfig.arl,
        outputFolder: storeState.deezerConfig.downloadFolder,
        quality,
      });

      const duration = Date.now() - startTime;
      useAutoDownloadStore.getState().setActiveDownload(null);

      if (result?.success) {
        if (result.skipped) {
          console.log(`[DL-SVC] ⏭️ Skipped (exists): ${song.artist} - ${song.title}`);
          useAutoDownloadStore.getState().incrementDailyStat('skipped');
        } else if ((result as any).verifiedFile) {
          console.log(`[DL-SVC] ✅ Verificado: ${song.artist} - ${song.title} → ${(result as any).verifiedFile}`);
        } else {
          console.log(`[DL-SVC] ✅ Downloaded: ${song.artist} - ${song.title}`);
        }
        
        useRadioStore.getState().updateMissingSong(song.id, { status: 'downloaded' });
        markSongAsDownloaded(song.artist, song.title, result.verifiedFile);

        // === Enrich ID3 metadata (BPM + Genre) after download ===
        try {
          const { config } = useRadioStore.getState();
          const verifiedFile = (result as any).verifiedFile || `${song.artist} - ${song.title}.mp3`;
          if (isElectron && window.electronAPI?.readId3Genre) {
            const id3Result = await window.electronAPI.readId3Genre({
              filePath: verifiedFile,
              musicFolders: config.musicFolders,
            });
            if (id3Result?.success) {
              const updates: Record<string, string> = {};
              if (id3Result.genre) {
                const normalizedGenre = normalizeId3GenreForDl(id3Result.genre);
                updates.ai_genre = normalizedGenre;
                updates.ai_energy = genreToEnergyForDl(normalizedGenre);
                console.log(`[DL-SVC] 🏷️ ID3 genre: ${id3Result.genre} → ${normalizedGenre}`);
              }
              if ((id3Result as any).year) {
                updates.year = String((id3Result as any).year);
                console.log(`[DL-SVC] 📅 ID3 year: ${(id3Result as any).year}`);
              }
              if ((id3Result as any).bpm) {
                const bpmNum = parseInt(String((id3Result as any).bpm), 10);
                if (bpmNum > 0 && bpmNum < 300) {
                  console.log(`[DL-SVC] 🥁 ID3 BPM: ${bpmNum}`);
                  try {
                    const { updateBpmCacheEntry } = await import('@/lib/bpmCacheBridge');
                    updateBpmCacheEntry(song.artist, song.title, bpmNum);
                  } catch { /* non-critical */ }
                }
              }
              if (Object.keys(updates).length > 0) {
                const { supabase } = await import('@/integrations/supabase/client');
                await supabase
                  .from('scraped_songs')
                  .update(updates)
                  .eq('artist', song.artist)
                  .eq('title', song.title);
              }
            }
          }
        } catch (e) {
          console.warn('[DL-SVC] ID3 enrichment failed (non-critical):', e);
        }

        // === Genre-based folder routing (uses shared utility, no duplicate ID3 read) ===
        const isVozDoBrasil = song.title?.toLowerCase().includes('voz do brasil') || 
                              song.artist?.toLowerCase().includes('voz do brasil');
        if (!isVozDoBrasil) {
          const { deezerConfig: dlConfig } = useRadioStore.getState();
          if (dlConfig.genreRoutingEnabled) {
            const fileForRoute = (result as any).verifiedFile || `${song.artist} - ${song.title}.mp3`;
            await routeFileByGenre(fileForRoute, dlConfig.downloadFolder, storeState.config.musicFolders || [], '[DL-SVC]');
          }
        }
        
        // Clear failure tracker on success
        const failKey = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        failureTracker.current.delete(failKey);

        const historyEntry: DownloadHistoryEntry = {
          id: crypto.randomUUID(),
          songId: song.id,
          title: song.title,
          artist: song.artist,
          timestamp: new Date(),
          status: 'success',
          duration,
        };
        useRadioStore.getState().addDownloadHistory(historyEntry);
        useAutoDownloadStore.getState().incrementDailyStat('downloaded');
        return true;
      } else {
        const errorMsg = result?.error || 'Download failed';
        console.error(`[DL-SVC] ❌ Failed: ${song.artist} - ${song.title} — ${errorMsg}`);
        
        // Check if ARL is the problem
        if (errorMsg.includes('ARL') || errorMsg.includes('arl') || errorMsg.includes('login')) {
          useAutoDownloadStore.getState().setArlStatus(false);
        }

        useRadioStore.getState().updateMissingSong(song.id, { status: 'error' });
        
        const historyEntry: DownloadHistoryEntry = {
          id: crypto.randomUUID(),
          songId: song.id,
          title: song.title,
          artist: song.artist,
          timestamp: new Date(),
          status: 'error',
          errorMessage: errorMsg,
          duration,
        };
        useRadioStore.getState().addDownloadHistory(historyEntry);
        useAutoDownloadStore.getState().incrementDailyStat('failed');
        return false;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      useAutoDownloadStore.getState().setActiveDownload(null);
      useRadioStore.getState().updateMissingSong(song.id, { status: 'error' });
      
      const historyEntry: DownloadHistoryEntry = {
        id: crypto.randomUUID(),
        songId: song.id,
        title: song.title,
        artist: song.artist,
        timestamp: new Date(),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
        duration,
      };
      useRadioStore.getState().addDownloadHistory(historyEntry);

      console.error(`[DL-SVC] ❌ Exception: ${song.artist} - ${song.title}`, error);
      return false;
    }
  }, []);

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || downloadQueueRef.current.length === 0) {
      return;
    }
    // Heartbeat for watchdog
    import('@/hooks/useServiceWatchdog').then(m => m.reportServiceHeartbeat('downloads')).catch(() => {});

    const storeState = useRadioStore.getState();
    if (!storeState.isRunning || !storeState.deezerConfig.autoDownload || !storeState.deezerConfig.enabled) {
      return;
    }

    isProcessingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));
    useAutoDownloadStore.getState().setIsProcessing(true);

    while (downloadQueueRef.current.length > 0) {
      const currentState = useRadioStore.getState();
      
      if (!currentState.isRunning) {
        console.log('[DL-SVC] ⏸️ Sistema pausado, aguardando...');
        break;
      }
      
      if (!currentState.deezerConfig.autoDownload) {
        console.log('[DL-SVC] Auto-download disabled, stopping');
        break;
      }

      // Check ARL validity before each download
      if (!useAutoDownloadStore.getState().arlValid) {
        console.warn('[DL-SVC] ⏸️ ARL inválida. Fila pausada.');
        break;
      }

      // Sort by priority before each pick
      downloadQueueRef.current.sort((a, b) => b.priority - a.priority);

      // Find first item that hasn't exceeded max retries
      const now = Date.now();
      let itemIndex = -1;
      for (let i = 0; i < downloadQueueRef.current.length; i++) {
        const item = downloadQueueRef.current[i];
        if (item.retryCount >= MAX_RETRIES) {
          continue; // Will be cleaned up below
        }
        itemIndex = i;
        break;
      }

      // Clean up items that exceeded max retries
      const before = downloadQueueRef.current.length;
      downloadQueueRef.current = downloadQueueRef.current.filter(item => {
        if (item.retryCount >= MAX_RETRIES) {
          console.log(`[DL-SVC] 🗑️ Removida após ${MAX_RETRIES} falhas: ${item.song.artist} - ${item.song.title}`);
          useRadioStore.getState().removeMissingSong(item.song.id);
          const failKey = `${item.song.artist.toLowerCase().trim()}|${item.song.title.toLowerCase().trim()}`;
          failureTracker.current.delete(failKey);
          return false;
        }
        return true;
      });
      if (downloadQueueRef.current.length !== before) {
        setState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
        useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
      }

      if (itemIndex === -1 || downloadQueueRef.current.length === 0) {
        break;
      }
      // Recalculate index after cleanup
      itemIndex = Math.min(itemIndex, downloadQueueRef.current.length - 1);

      const item = downloadQueueRef.current.splice(itemIndex, 1)[0];
      setState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
      useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);

      // Acquire global mutex — wait for any other download to finish
      const lockPriority = item.priority;
      await acquireDownloadLock(lockPriority);

      let success: boolean;
      try {
        success = await downloadSong(item.song, item.fallbackQuality);

        // === QUALITY FALLBACK: try 128kbps if 320 failed ===
        if (!success && !item.fallbackQuality && useRadioStore.getState().deezerConfig.quality !== 'MP3_128') {
          console.log(`[DL-SVC] 🔄 Tentando fallback 128kbps: ${item.song.artist} - ${item.song.title}`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          success = await downloadSong(item.song, true);
        }
      } finally {
        releaseDownloadLock();
      }

      if (success) {
        // Remove duplicates
        const artistLower = item.song.artist.toLowerCase().trim();
        const titleLower = item.song.title.toLowerCase().trim();
        const before = downloadQueueRef.current.length;
        downloadQueueRef.current = downloadQueueRef.current.filter(
          q => !(q.song.artist.toLowerCase().trim() === artistLower && q.song.title.toLowerCase().trim() === titleLower)
        );
        const removed = before - downloadQueueRef.current.length;
        if (removed > 0) {
          console.log(`[DL-SVC] 🧹 Removidas ${removed} duplicatas: ${item.song.artist} - ${item.song.title}`);
          setState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
          useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
        }
      }
      
      if (!success) {
        // Increment retry count and send to end of queue
        const newRetryCount = item.retryCount + 1;
        
        if (newRetryCount >= MAX_RETRIES) {
          // 3 failures — remove permanently
          console.warn(`[DL-SVC] 🗑️ ${item.song.artist} - ${item.song.title} falhou ${newRetryCount}x. Removida definitivamente.`);
          useRadioStore.getState().removeMissingSong(item.song.id);
          const failKey = `${item.song.artist.toLowerCase().trim()}|${item.song.title.toLowerCase().trim()}`;
          failureTracker.current.delete(failKey);
        } else {
          // Send to END of queue for retry
          console.log(`[DL-SVC] 🔄 ${item.song.artist} - ${item.song.title} falhou (tentativa ${newRetryCount}/${MAX_RETRIES}). Vai para o fim da fila.`);
          useRadioStore.getState().updateMissingSong(item.song.id, { status: 'missing' });
          downloadQueueRef.current.push({
            song: item.song,
            retryCount: newRetryCount,
            priority: item.priority,
          });
        }
        
        setState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
        useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
      }

      // 15 seconds delay between downloads
      await new Promise(resolve => setTimeout(resolve, 15000));
    }

    isProcessingRef.current = false;
    setState(prev => ({ ...prev, isProcessing: false }));
    useAutoDownloadStore.getState().setIsProcessing(false);
    useAutoDownloadStore.getState().setActiveDownload(null);
  }, [downloadSong]);

  const checkNewMissingSongs = useCallback(() => {
    const storeState = useRadioStore.getState();
    const { deezerConfig, missingSongs, rankingSongs, stations: allStations } = storeState;

    const pendingMissing = missingSongs.filter(s => s.status === 'missing');
    
    const getDownloadKey = (song: typeof missingSongs[0]) => 
      `dl|${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
    
    const newToQueue = pendingMissing.filter(s => {
      const downloadKey = getDownloadKey(s);
      const inQueue = downloadQueueRef.current.some(
        item => item.song.artist.toLowerCase().trim() === s.artist.toLowerCase().trim() &&
                item.song.title.toLowerCase().trim() === s.title.toLowerCase().trim()
      );
      const alreadyDownloaded = processedSongsRef.current.has(downloadKey);
      return !inQueue && !alreadyDownloaded;
    });

    const now = Date.now();
    const shouldLog = (now - lastLogTimeRef.current > 600000) || (newToQueue.length > 0);
    
    if (shouldLog && pendingMissing.length > 0 && newToQueue.length > 0) {
      console.log(`[DL-SVC] 🎵 Fila: ${pendingMissing.length} faltando | ${newToQueue.length} novas`);
      lastLogTimeRef.current = now;
    }

    if (!deezerConfig.autoDownload || !deezerConfig.enabled || !deezerConfig.arl) {
      return;
    }

    if (newToQueue.length > 0) {
      const rankingMap = new Map<string, number>();
      rankingSongs.forEach((song, index) => {
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        rankingMap.set(key, 50 - index);
      });

      const priorityStationNames = new Set(
        allStations
          .filter(s => s.prioritizeDownloads)
          .map(s => s.name.toLowerCase())
      );

      for (const song of newToQueue) {
        const downloadKey = getDownloadKey(song);
        processedSongsRef.current.add(downloadKey);
        
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        let priority = rankingMap.get(key) || 0;
        
        if (song.urgency === 'grade') {
          priority += PRIORITY_GRADE_BOOST;
          console.log(`[DL-SVC] 🚨 Prioridade URGENTE (Grade): ${song.artist} - ${song.title}`);
        } else if (song.urgency === 'sequence') {
          priority += PRIORITY_SEQUENCE_BOOST;
          console.log(`[DL-SVC] ⚡ Prioridade ALTA (Sequência): ${song.artist} - ${song.title}`);
        }
        
        const isPriorityStation = priorityStationNames.has(song.station?.toLowerCase() || '');
        if (isPriorityStation) {
          priority += PRIORITY_STATION_BOOST;
        }

        downloadQueueRef.current.push({ song, retryCount: 0, priority });
      }
      
      // Cap processedSongs to prevent memory leak
      if (processedSongsRef.current.size > 2000) {
        const entries = [...processedSongsRef.current];
        processedSongsRef.current = new Set(entries.slice(entries.length - 1000));
        console.log('[DL-SVC] 🧹 processedSongs trimmed to 1000');
      }

      console.log(`[DL-SVC] 📥 +${newToQueue.length} na fila (total: ${downloadQueueRef.current.length})`);
      setState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
      useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
      
      if (!isProcessingRef.current) {
        processQueue();
      }
    }
  }, [processQueue]);

  // Watch for reset signal AND react immediately to new missing songs
  useEffect(() => {
    const unsubReset = useAutoDownloadStore.subscribe((s, prev) => {
      if (s.resetCounter > prev.resetCounter) {
        console.log('[DL-SVC] 🔄 Reset signal');
        downloadQueueRef.current = [];
        processedSongsRef.current.clear();
        failureTracker.current.clear();
        isProcessingRef.current = false;
        setState({ queueLength: 0, isProcessing: false });
      }
    });

    let prevMissingIds = new Set(useRadioStore.getState().missingSongs.map(s => s.id));
    const unsubMissing = useRadioStore.subscribe((state) => {
      const currentIds = new Set(state.missingSongs.map(s => s.id));
      if (currentIds.size > prevMissingIds.size) {
        const newSongs = state.missingSongs.filter(s => !prevMissingIds.has(s.id));
        const hasUrgent = newSongs.some(s => s.status === 'missing' && s.urgency === 'grade');
        
        if (hasUrgent) {
          console.log(`[DL-SVC] 🚨 ${newSongs.filter(s => s.urgency === 'grade').length} novas músicas urgentes!`);
        }
        
        if (newSongs.length > 0) {
          setTimeout(() => checkNewMissingSongs(), 100);
        }
      }
      prevMissingIds = currentIds;
    });

    return () => {
      unsubReset();
      unsubMissing();
    };
  }, [checkNewMissingSongs]);

  /** Start the download check interval + ARL health check + temp recovery. Returns cleanup function. */
  const start = useCallback(() => {
    // Recover orphaned temp files on startup
    if (isElectron && (window.electronAPI as any)?.recoverTempFiles) {
      const { deezerConfig } = useRadioStore.getState();
      if (deezerConfig.downloadFolder) {
        (window.electronAPI as any).recoverTempFiles({ baseFolder: deezerConfig.downloadFolder })
          .then((result: any) => {
            if (result?.recovered > 0) {
              console.log(`[DL-SVC] 🔄 Recuperados ${result.recovered} arquivo(s) da pasta _temp`);
              useAutoDownloadStore.getState().setTempRetryCount(result.recovered);
            }
          })
          .catch((err: any) => console.warn('[DL-SVC] Temp recovery failed:', err));
      }
    }

    // Download check every 100 seconds
    downloadIntervalRef.current = setInterval(() => {
      const { isRunning } = useRadioStore.getState();
      if (isRunning) {
        checkNewMissingSongs();
      }
    }, 100000);
    
    // ARL health check every 15 minutes (single interval, no duplicate watchdog)
    arlCheckIntervalRef.current = setInterval(() => {
      const { deezerConfig } = useRadioStore.getState();
      if (deezerConfig.enabled && deezerConfig.arl) {
        checkArlHealth();
      }
    }, ARL_CHECK_INTERVAL_MS);

    // Initial checks
    const { isRunning } = useRadioStore.getState();
    if (isRunning) {
      checkNewMissingSongs();
    }
    checkArlHealth();

    return () => {
      if (downloadIntervalRef.current) clearInterval(downloadIntervalRef.current);
      if (arlCheckIntervalRef.current) clearInterval(arlCheckIntervalRef.current);
    };
  }, [checkNewMissingSongs, checkArlHealth]);

  return {
    state,
    checkNewMissingSongs,
    processedSongsRef,
    downloadQueueRef,
    start,
  };
}
