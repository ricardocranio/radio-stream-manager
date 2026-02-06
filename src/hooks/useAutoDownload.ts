import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore, MissingSong, DownloadHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { withRetry, createError, ErrorCodes } from '@/lib/errorHandler';
import { markSongAsDownloaded } from '@/lib/libraryVerificationCache';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// Constants
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

const PRIORITY_STATION_BOOST = 100; // Priority boost for prioritized stations (higher than any ranking position)

// Queue for auto-download with priority
interface DownloadQueueItem {
  song: MissingSong;
  retryCount: number;
  priority: number; // Higher = more important (ranking position + station boost)
}

export function useAutoDownload() {
  const { 
    missingSongs, 
    deezerConfig, 
    updateMissingSong,
    addDownloadHistory,
  } = useRadioStore();
  
  const { setQueueLength, setIsProcessing, resetCounter } = useAutoDownloadStore();
  
  const downloadQueueRef = useRef<DownloadQueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const processedSongsRef = useRef<Set<string>>(new Set());
  const lastCheckRef = useRef<string[]>([]);
  const lastResetCounterRef = useRef(0);

  // Watch for reset signal and clear internal refs
  useEffect(() => {
    if (resetCounter > lastResetCounterRef.current) {
      console.log('[AUTO-DL] Reset signal received, clearing queue and refs');
      downloadQueueRef.current = [];
      processedSongsRef.current.clear();
      lastCheckRef.current = [];
      isProcessingRef.current = false;
      lastResetCounterRef.current = resetCounter;
    }
  }, [resetCounter]);

  // Download a single song
  const downloadSong = useCallback(async (song: MissingSong): Promise<boolean> => {
    if (!isElectron || !window.electronAPI?.downloadFromDeezer) {
      console.log('[AUTO-DL] Skipping - not in Electron');
      return false;
    }

    const state = useRadioStore.getState();
    if (!state.deezerConfig.enabled || !state.deezerConfig.arl) {
      console.log('[AUTO-DL] Skipping - Deezer not configured');
      return false;
    }

    console.log(`[AUTO-DL] Downloading: ${song.artist} - ${song.title}`);
    updateMissingSong(song.id, { status: 'downloading' });

    const startTime = Date.now();

    try {
      const result = await window.electronAPI.downloadFromDeezer({
        artist: song.artist,
        title: song.title,
        arl: state.deezerConfig.arl,
        outputFolder: state.deezerConfig.downloadFolder,
        quality: state.deezerConfig.quality,
        stationName: song.station, // Pass station for subfolder organization
      });

      const duration = Date.now() - startTime;

      if (result?.success) {
        // Handle both downloaded and skipped (already exists) cases
        if (result.skipped) {
          console.log(`[AUTO-DL] Skipped (already exists): ${song.artist} - ${song.title} in ${result.existingStation || 'main folder'}`);
        }
        updateMissingSong(song.id, { status: 'downloaded' });
        
        // Update library cache to prevent future re-checks
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
        addDownloadHistory(historyEntry);

        // Notification removed as per user request - downloads are silent now

        console.log(`[AUTO-DL] Success: ${song.artist} - ${song.title}`);
        return true;
      } else {
        throw new Error(result?.error || 'Download failed');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      updateMissingSong(song.id, { status: 'error' });
      
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
      addDownloadHistory(historyEntry);

      console.error(`[AUTO-DL] Failed: ${song.artist} - ${song.title}`, error);
      return false;
    }
  }, [updateMissingSong, addDownloadHistory]);

  // Process the download queue
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || downloadQueueRef.current.length === 0) {
      return;
    }

    const state = useRadioStore.getState();
    if (!state.deezerConfig.autoDownload || !state.deezerConfig.enabled) {
      return;
    }

    isProcessingRef.current = true;
    setIsProcessing(true);

    while (downloadQueueRef.current.length > 0) {
      // Check if autoDownload is still enabled
      const currentState = useRadioStore.getState();
      if (!currentState.deezerConfig.autoDownload) {
        console.log('[AUTO-DL] Auto-download disabled, stopping queue');
        break;
      }

      // Sort queue by priority (higher first) before each iteration
      downloadQueueRef.current.sort((a, b) => b.priority - a.priority);

      const item = downloadQueueRef.current.shift();
      setQueueLength(downloadQueueRef.current.length);
      if (!item) break;

      const success = await downloadSong(item.song);
      
      if (!success && item.retryCount < 2) {
        // Re-add to queue for retry (max 2 retries), keep same priority
        downloadQueueRef.current.push({
          song: item.song,
          retryCount: item.retryCount + 1,
          priority: item.priority,
        });
        setQueueLength(downloadQueueRef.current.length);
      }

      // Wait between downloads based on config (default 1 minute, converted to ms)
      const intervalMs = (currentState.deezerConfig.autoDownloadIntervalMinutes || 1) * 60 * 1000;
      console.log(`[AUTO-DL] Waiting ${currentState.deezerConfig.autoDownloadIntervalMinutes || 1} minute(s) before next download`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    isProcessingRef.current = false;
    setIsProcessing(false);
  }, [downloadSong, setQueueLength, setIsProcessing]);

  // Watch for new missing songs
  useEffect(() => {
    if (!deezerConfig.autoDownload || !deezerConfig.enabled || !deezerConfig.arl) {
      return;
    }

    // Get ranking songs for priority calculation
    const { rankingSongs, stations: allStations } = useRadioStore.getState();
    const rankingMap = new Map<string, number>();
    rankingSongs.forEach((song, index) => {
      const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
      rankingMap.set(key, 50 - index); // Higher priority for top ranking positions
    });

    // Build set of station names with prioritized downloads
    const priorityStationNames = new Set(
      allStations
        .filter(s => s.prioritizeDownloads)
        .map(s => s.name.toLowerCase())
    );

    // Get current missing song IDs
    const currentIds = missingSongs
      .filter(s => s.status === 'missing')
      .map(s => s.id);
    
    // Find new songs that weren't in the last check
    const newSongs = missingSongs.filter(
      song => 
        song.status === 'missing' && 
        !lastCheckRef.current.includes(song.id) &&
        !processedSongsRef.current.has(song.id)
    );

    // Add new songs to queue with ranking + station priority
    for (const song of newSongs) {
      const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
      let priority = rankingMap.get(key) || 0; // 0 for non-ranking songs
      
      // Boost priority for stations marked with "Priorizar Downloads"
      const isPriorityStation = priorityStationNames.has(song.station?.toLowerCase() || '');
      
      if (isPriorityStation) {
        priority += PRIORITY_STATION_BOOST;
        console.log(`[AUTO-DL] 📂 Prioridade ALTA (cache ${song.station}): ${song.artist} - ${song.title}`);
      } else if (priority > 0) {
        console.log(`[AUTO-DL] 🎯 Ranking song #${51 - priority}: ${song.artist} - ${song.title}`);
      } else {
        console.log(`[AUTO-DL] New missing song: ${song.artist} - ${song.title}`);
      }
      
      processedSongsRef.current.add(song.id);
      downloadQueueRef.current.push({
        song,
        retryCount: 0,
        priority,
      });
    }
    
    // Update queue length in store
    setQueueLength(downloadQueueRef.current.length);

    // Update last check
    lastCheckRef.current = currentIds;

    // Start processing if not already
    if (downloadQueueRef.current.length > 0 && !isProcessingRef.current) {
      processQueue();
    }
  }, [missingSongs, deezerConfig.autoDownload, deezerConfig.enabled, deezerConfig.arl, processQueue, setQueueLength]);
}
