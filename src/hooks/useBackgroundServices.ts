/**
 * Background Services Manager
 * 
 * Este hook centraliza todos os serviços de background que devem rodar
 * CONTINUAMENTE, independente da navegação entre abas.
 * 
 * Inclui:
 * - Auto-download de músicas faltantes
 * - Montagem automática de grades
 * - Sincronização de dados
 * - Health checks
 */

import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore, MissingSong, DownloadHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

interface DownloadQueueItem {
  song: MissingSong;
  retryCount: number;
}

// Singleton para garantir que apenas uma instância roda
let isBackgroundServiceRunning = false;

export function useBackgroundServices() {
  const downloadQueueRef = useRef<DownloadQueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const processedSongsRef = useRef<Set<string>>(new Set());
  const lastCheckRef = useRef<string[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);

  // Função para processar um download
  const downloadSong = useCallback(async (song: MissingSong): Promise<boolean> => {
    if (!isElectron || !window.electronAPI?.downloadFromDeezer) {
      console.log('[BG-SERVICE] Skipping download - not in Electron');
      return false;
    }

    const state = useRadioStore.getState();
    if (!state.deezerConfig.enabled || !state.deezerConfig.arl) {
      console.log('[BG-SERVICE] Skipping download - Deezer not configured');
      return false;
    }

    console.log(`[BG-SERVICE] 🎵 Downloading: ${song.artist} - ${song.title}`);
    useRadioStore.getState().updateMissingSong(song.id, { status: 'downloading' });

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
        useRadioStore.getState().updateMissingSong(song.id, { status: 'downloaded' });
        
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

        // Notification removed as per user request - downloads are silent now

        console.log(`[BG-SERVICE] ✅ Success: ${song.artist} - ${song.title}`);
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

      console.error(`[BG-SERVICE] ❌ Failed: ${song.artist} - ${song.title}`, error);
      return false;
    }
  }, []);

  // Processar a fila de downloads
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || downloadQueueRef.current.length === 0) {
      return;
    }

    const state = useRadioStore.getState();
    if (!state.deezerConfig.autoDownload || !state.deezerConfig.enabled) {
      return;
    }

    isProcessingRef.current = true;
    useAutoDownloadStore.getState().setIsProcessing(true);

    while (downloadQueueRef.current.length > 0) {
      // Check if autoDownload is still enabled
      const currentState = useRadioStore.getState();
      if (!currentState.deezerConfig.autoDownload) {
        console.log('[BG-SERVICE] Auto-download disabled, stopping queue');
        break;
      }

      const item = downloadQueueRef.current.shift();
      useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
      if (!item) break;

      const success = await downloadSong(item.song);
      
      if (!success && item.retryCount < 2) {
        // Re-add to queue for retry (max 2 retries)
        downloadQueueRef.current.push({
          song: item.song,
          retryCount: item.retryCount + 1,
        });
        useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
      }

      // Wait between downloads based on config (0.5 to 30 minutes, converted to ms)
      const intervalMinutes = currentState.deezerConfig.autoDownloadIntervalMinutes || 1;
      const intervalMs = intervalMinutes * 60 * 1000;
      console.log(`[BG-SERVICE] ⏳ Waiting ${intervalMinutes < 1 ? `${Math.round(intervalMinutes * 60)}s` : `${intervalMinutes} min`} before next download`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    isProcessingRef.current = false;
    useAutoDownloadStore.getState().setIsProcessing(false);
  }, [downloadSong]);

  // Verificar novas músicas faltantes
  const checkNewMissingSongs = useCallback(() => {
    const state = useRadioStore.getState();
    const { deezerConfig, missingSongs } = state;

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
      console.log(`[BG-SERVICE] 📥 New missing song detected: ${song.artist} - ${song.title}`);
      processedSongsRef.current.add(song.id);
      downloadQueueRef.current.push({
        song,
        retryCount: 0,
      });
    }
    
    // Update queue length in store
    useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);

    // Update last check
    lastCheckRef.current = currentIds;

    // Start processing if not already
    if (downloadQueueRef.current.length > 0 && !isProcessingRef.current) {
      processQueue();
    }
  }, [processQueue]);

  // Watch for reset signal
  useEffect(() => {
    const { resetCounter } = useAutoDownloadStore.getState();
    
    const unsubscribe = useAutoDownloadStore.subscribe((state, prevState) => {
      if (state.resetCounter > prevState.resetCounter) {
        console.log('[BG-SERVICE] 🔄 Reset signal received, clearing queue and refs');
        downloadQueueRef.current = [];
        processedSongsRef.current.clear();
        lastCheckRef.current = [];
        isProcessingRef.current = false;
      }
    });

    return () => unsubscribe();
  }, []);

  // Main background service loop - runs independently of component lifecycle
  useEffect(() => {
    // Prevent multiple instances
    if (isBackgroundServiceRunning || isInitializedRef.current) {
      console.log('[BG-SERVICE] Already running, skipping initialization');
      return;
    }

    isBackgroundServiceRunning = true;
    isInitializedRef.current = true;
    console.log('[BG-SERVICE] 🚀 Starting background services...');

    // Check for new songs every 10 seconds (independent of tab navigation)
    intervalRef.current = setInterval(() => {
      checkNewMissingSongs();
    }, 10000);

    // Initial check
    checkNewMissingSongs();

    return () => {
      console.log('[BG-SERVICE] 🛑 Stopping background services');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      isBackgroundServiceRunning = false;
      isInitializedRef.current = false;
    };
  }, [checkNewMissingSongs]);

  return {
    queueLength: downloadQueueRef.current.length,
    isProcessing: isProcessingRef.current,
  };
}
