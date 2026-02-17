/**
 * Global Download Service Hook
 * 
 * Manages the auto-download queue for missing songs.
 * Extracted from GlobalServicesContext for modularity.
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
}

const PRIORITY_STATION_BOOST = 100;

export interface DownloadServiceState {
  queueLength: number;
  isProcessing: boolean;
}

export function useGlobalDownloadService() {
  const downloadQueueRef = useRef<DownloadQueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const processedSongsRef = useRef<Set<string>>(new Set());
  const downloadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastLogTimeRef = useRef<number>(0);

  const [state, setState] = useState<DownloadServiceState>({
    queueLength: 0,
    isProcessing: false,
  });

  const downloadSong = useCallback(async (song: MissingSong): Promise<boolean> => {
    if (!isElectron || !window.electronAPI?.downloadFromDeezer) {
      return false;
    }

    const storeState = useRadioStore.getState();
    if (!storeState.deezerConfig.enabled || !storeState.deezerConfig.arl) {
      return false;
    }

    console.log(`[DL-SVC] 🎵 Downloading: ${song.artist} - ${song.title}`);
    useRadioStore.getState().updateMissingSong(song.id, { status: 'downloading' });

    const startTime = Date.now();

    try {
      const result = await window.electronAPI.downloadFromDeezer({
        artist: song.artist,
        title: song.title,
        arl: storeState.deezerConfig.arl,
        outputFolder: storeState.deezerConfig.downloadFolder,
        quality: storeState.deezerConfig.quality,
      });

      const duration = Date.now() - startTime;

      if (result?.success) {
        if (result.skipped) {
          console.log(`[DL-SVC] ⏭️ Skipped (exists): ${song.artist} - ${song.title} in ${result.existingStation || 'main'}`);
        }
        useRadioStore.getState().updateMissingSong(song.id, { status: 'downloaded' });
        
        markSongAsDownloaded(song.artist, song.title, result.output);
        
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

        console.log(`[DL-SVC] ✅ Downloaded: ${song.artist} - ${song.title}`);
        return true;
      } else {
        throw new Error(result?.error || 'Download failed');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
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

      console.error(`[DL-SVC] ❌ Failed: ${song.artist} - ${song.title}`, error);
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

      // Sort by priority before each pick
      downloadQueueRef.current.sort((a, b) => b.priority - a.priority);

      const item = downloadQueueRef.current.shift();
      setState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
      useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
      if (!item) break;

      const success = await downloadSong(item.song);
      
      if (!success && item.retryCount < 2) {
        downloadQueueRef.current.push({
          song: item.song,
          retryCount: item.retryCount + 1,
          priority: item.priority,
        });
        setState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
        useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
      }

      // Small delay between downloads (5 seconds)
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    isProcessingRef.current = false;
    setState(prev => ({ ...prev, isProcessing: false }));
    useAutoDownloadStore.getState().setIsProcessing(false);
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

    // Only log every 10 minutes OR when there are new songs
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
      // Build ranking and priority maps
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
        
        const isPriorityStation = priorityStationNames.has(song.station?.toLowerCase() || '');
        if (isPriorityStation) {
          priority += PRIORITY_STATION_BOOST;
          console.log(`[DL-SVC] 📂 Prioridade ALTA (${song.station}): ${song.artist} - ${song.title}`);
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

  // Watch for reset signal
  useEffect(() => {
    const unsubscribe = useAutoDownloadStore.subscribe((s, prev) => {
      if (s.resetCounter > prev.resetCounter) {
        console.log('[DL-SVC] 🔄 Reset signal');
        downloadQueueRef.current = [];
        processedSongsRef.current.clear();
        isProcessingRef.current = false;
        setState({ queueLength: 0, isProcessing: false });
      }
    });
    return () => unsubscribe();
  }, []);

  /** Start the download check interval. Returns cleanup function. */
  const start = useCallback(() => {
    // Download check every 100 seconds
    downloadIntervalRef.current = setInterval(() => {
      const { isRunning } = useRadioStore.getState();
      if (isRunning) {
        checkNewMissingSongs();
      }
    }, 100000);
    
    // Initial check
    const { isRunning } = useRadioStore.getState();
    if (isRunning) {
      checkNewMissingSongs();
    }

    return () => {
      if (downloadIntervalRef.current) clearInterval(downloadIntervalRef.current);
    };
  }, [checkNewMissingSongs]);

  return {
    state,
    checkNewMissingSongs,
    processedSongsRef,
    downloadQueueRef,
    start,
  };
}
