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

const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRIES_BEFORE_COOLDOWN = 3;
const ARL_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export interface DownloadServiceState {
  queueLength: number;
  isProcessing: boolean;
}

export function useGlobalDownloadService() {
  const downloadQueueRef = useRef<DownloadQueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const processedSongsRef = useRef<Set<string>>(new Set());
  const downloadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const arlCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
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

    // Check ARL validity
    if (!useAutoDownloadStore.getState().arlValid) {
      console.warn(`[DL-SVC] ⏸️ ARL inválida, pulando: ${song.artist} - ${song.title}`);
      return false;
    }

    const quality = fallbackQuality ? 'MP3_128' : storeState.deezerConfig.quality;
    if (fallbackQuality) {
      console.log(`[DL-SVC] 🔄 Fallback 128kbps: ${song.artist} - ${song.title}`);
    } else {
      console.log(`[DL-SVC] 🎵 Downloading (${quality}): ${song.artist} - ${song.title}`);
    }

    useRadioStore.getState().updateMissingSong(song.id, { status: 'downloading' });
    useAutoDownloadStore.getState().setActiveDownload({
      artist: song.artist,
      title: song.title,
      startedAt: Date.now(),
    });

    const startTime = Date.now();

    try {
      const result = await window.electronAPI.downloadFromDeezer({
        artist: song.artist,
        title: song.title,
        arl: storeState.deezerConfig.arl,
        outputFolder: storeState.deezerConfig.downloadFolder,
        quality,
      });

      const duration = Date.now() - startTime;
      useAutoDownloadStore.getState().setActiveDownload(null);

      if (result?.success) {
        if (result.skipped) {
          console.log(`[DL-SVC] ⏭️ Skipped (exists): ${song.artist} - ${song.title}`);
        } else if ((result as any).verifiedFile) {
          console.log(`[DL-SVC] ✅ Verificado: ${song.artist} - ${song.title} → ${(result as any).verifiedFile}`);
        } else {
          console.log(`[DL-SVC] ✅ Downloaded: ${song.artist} - ${song.title}`);
        }
        
        useRadioStore.getState().updateMissingSong(song.id, { status: 'downloaded' });
        markSongAsDownloaded(song.artist, song.title, result.output);
        
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

      // Find first item not in cooldown
      const now = Date.now();
      let itemIndex = -1;
      for (let i = 0; i < downloadQueueRef.current.length; i++) {
        const item = downloadQueueRef.current[i];
        const failKey = `${item.song.artist.toLowerCase().trim()}|${item.song.title.toLowerCase().trim()}`;
        const tracker = failureTracker.current.get(failKey);
        
        if (tracker && tracker.count >= MAX_RETRIES_BEFORE_COOLDOWN) {
          const elapsed = now - tracker.lastFail;
          if (elapsed < COOLDOWN_MS) {
            continue; // Still in cooldown
          }
          // Cooldown expired — reset and allow retry
          console.log(`[DL-SVC] ⏰ Cooldown expirado: ${item.song.artist} - ${item.song.title}, tentando novamente...`);
          tracker.count = 0;
        }
        itemIndex = i;
        break;
      }

      if (itemIndex === -1) {
        // All items in cooldown
        console.log(`[DL-SVC] 😴 Todos os ${downloadQueueRef.current.length} itens em cooldown (10 min). Aguardando...`);
        break;
      }

      const item = downloadQueueRef.current.splice(itemIndex, 1)[0];
      setState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
      useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);

      let success = await downloadSong(item.song, item.fallbackQuality);

      // === QUALITY FALLBACK: try 128kbps if 320 failed ===
      if (!success && !item.fallbackQuality && useRadioStore.getState().deezerConfig.quality !== 'MP3_128') {
        console.log(`[DL-SVC] 🔄 Tentando fallback 128kbps: ${item.song.artist} - ${item.song.title}`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5s before retry
        success = await downloadSong(item.song, true);
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
        // Track consecutive failures
        const failKey = `${item.song.artist.toLowerCase().trim()}|${item.song.title.toLowerCase().trim()}`;
        const tracker = failureTracker.current.get(failKey) || { count: 0, lastFail: 0 };
        tracker.count++;
        tracker.lastFail = Date.now();
        failureTracker.current.set(failKey, tracker);

        if (tracker.count >= MAX_RETRIES_BEFORE_COOLDOWN) {
          console.warn(`[DL-SVC] 🕐 ${item.song.artist} - ${item.song.title} falhou ${tracker.count}x. Cooldown de 10 min.`);
          // Reset status to 'missing' so it can be retried after cooldown
          useRadioStore.getState().updateMissingSong(item.song.id, { status: 'missing' });
          // Re-add to queue for retry after cooldown
          downloadQueueRef.current.push({
            song: item.song,
            retryCount: item.retryCount + 1,
            priority: item.priority,
            fallbackQuality: false,
          });
        } else if (item.retryCount < 2) {
          downloadQueueRef.current.push({
            song: item.song,
            retryCount: item.retryCount + 1,
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

  /** Start the download check interval + ARL health check. Returns cleanup function. */
  const start = useCallback(() => {
    // Download check every 100 seconds
    downloadIntervalRef.current = setInterval(() => {
      const { isRunning } = useRadioStore.getState();
      if (isRunning) {
        checkNewMissingSongs();
      }
    }, 100000);
    
    // ARL health check every 30 minutes
    arlCheckIntervalRef.current = setInterval(() => {
      checkArlHealth();
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
