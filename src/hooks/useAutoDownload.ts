import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore, MissingSong, DownloadHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// Queue for auto-download
interface DownloadQueueItem {
  song: MissingSong;
  retryCount: number;
}

export function useAutoDownload() {
  const { 
    missingSongs, 
    deezerConfig, 
    updateMissingSong,
    addDownloadHistory,
  } = useRadioStore();
  
  const { setQueueLength, setIsProcessing } = useAutoDownloadStore();
  
  const downloadQueueRef = useRef<DownloadQueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const processedSongsRef = useRef<Set<string>>(new Set());
  const lastCheckRef = useRef<string[]>([]);

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
      });

      const duration = Date.now() - startTime;

      if (result?.success) {
        updateMissingSong(song.id, { status: 'downloaded' });
        
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

        // Show notification
        if (window.electronAPI?.showNotification) {
          window.electronAPI.showNotification(
            '✅ Download Automático',
            `${song.artist} - ${song.title}`
          );
        }

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

      const item = downloadQueueRef.current.shift();
      setQueueLength(downloadQueueRef.current.length);
      if (!item) break;

      const success = await downloadSong(item.song);
      
      if (!success && item.retryCount < 2) {
        // Re-add to queue for retry (max 2 retries)
        downloadQueueRef.current.push({
          song: item.song,
          retryCount: item.retryCount + 1,
        });
        setQueueLength(downloadQueueRef.current.length);
      }

      // Wait between downloads based on config (default 20 minutes, converted to ms)
      const intervalMs = (currentState.deezerConfig.autoDownloadIntervalMinutes || 20) * 60 * 1000;
      console.log(`[AUTO-DL] Waiting ${currentState.deezerConfig.autoDownloadIntervalMinutes || 20} minutes before next download`);
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

    // Add new songs to queue
    for (const song of newSongs) {
      console.log(`[AUTO-DL] New missing song detected: ${song.artist} - ${song.title}`);
      processedSongsRef.current.add(song.id);
      downloadQueueRef.current.push({
        song,
        retryCount: 0,
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
