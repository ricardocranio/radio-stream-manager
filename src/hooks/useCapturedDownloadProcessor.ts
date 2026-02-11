/**
 * Persistent processor for captured songs batch download.
 * Must be mounted in GlobalServicesContext (never unmounts).
 */
import { useEffect, useRef } from 'react';
import { useCapturedDownloadStore } from '@/store/capturedDownloadStore';
import { useRadioStore } from '@/store/radioStore';
import { checkSongInLibrary } from '@/hooks/useCheckMusicLibrary';
import { useToast } from '@/hooks/use-toast';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

export function useCapturedDownloadProcessor() {
  const { toast } = useToast();
  const processingRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;

    const unsubscribe = useCapturedDownloadStore.subscribe((state, prev) => {
      // Trigger when queue becomes non-empty and processing starts
      if (state.isProcessing && state.queue.length > 0 && !processingRef.current) {
        processQueue();
      }
    });

    // Also check on mount in case there's a pending queue
    const state = useCapturedDownloadStore.getState();
    if (state.isProcessing && state.queue.length > 0) {
      processQueue();
    }

    return () => unsubscribe();
  }, []);

  async function processQueue() {
    if (processingRef.current) return;
    processingRef.current = true;

    const store = useCapturedDownloadStore.getState();
    const { deezerConfig, config, addDownloadHistory } = useRadioStore.getState();

    if (!deezerConfig.enabled || !deezerConfig.arl) {
      toast({
        title: 'Deezer não configurado',
        description: 'Configure o ARL do Deezer nas Configurações.',
        variant: 'destructive',
      });
      useCapturedDownloadStore.getState().finish();
      processingRef.current = false;
      return;
    }

    const queue = [...store.queue];
    const mode = store.mode;
    let successCount = 0;
    let existsCount = 0;
    let errorCount = 0;

    for (let i = 0; i < queue.length; i++) {
      // Check if cancelled
      const currentState = useCapturedDownloadStore.getState();
      if (!currentState.isProcessing) {
        console.log('[CAPTURED-DL] Cancelled by user');
        break;
      }

      const song = queue[i];
      useCapturedDownloadStore.getState().advance();

      // Check if already exists in library
      if (config.musicFolders?.length > 0) {
        try {
          const existsResult = await checkSongInLibrary(
            song.artist,
            song.title,
            config.musicFolders,
            config.similarityThreshold || 0.75
          );
          if (existsResult.exists) {
            useCapturedDownloadStore.getState().markProcessed(song.id, 'exists');
            existsCount++;
            continue;
          }
        } catch {
          // Continue with download if check fails
        }
      }

      const startTime = Date.now();

      try {
        const result = await window.electronAPI?.downloadFromDeezer({
          artist: song.artist,
          title: song.title,
          arl: deezerConfig.arl,
          outputFolder: deezerConfig.downloadFolder,
          quality: deezerConfig.quality,
          stationName: song.stationName,
        });

        const duration = Date.now() - startTime;

        if (result?.success) {
          useCapturedDownloadStore.getState().markProcessed(song.id, 'success');
          successCount++;
          addDownloadHistory({
            id: crypto.randomUUID(),
            songId: song.id,
            title: song.title,
            artist: song.artist,
            timestamp: new Date(),
            status: 'success',
            duration,
          });
        } else {
          throw new Error(result?.error || 'Falha');
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        useCapturedDownloadStore.getState().markProcessed(song.id, 'error');
        errorCount++;
        addDownloadHistory({
          id: crypto.randomUUID(),
          songId: song.id,
          title: song.title,
          artist: song.artist,
          timestamp: new Date(),
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Erro',
          duration,
        });
      }

      // Delay between downloads
      const delayMs = mode === 'auto' ? 120000 : 5000;
      
      // Wait with cancellation check
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, delayMs);
        const checkCancel = setInterval(() => {
          if (!useCapturedDownloadStore.getState().isProcessing) {
            clearTimeout(timer);
            clearInterval(checkCancel);
            resolve();
          }
        }, 1000);
        // Clean up interval when timer fires
        setTimeout(() => clearInterval(checkCancel), delayMs + 100);
      });
    }

    useCapturedDownloadStore.getState().finish();
    processingRef.current = false;

    if (successCount + existsCount + errorCount > 0) {
      const msg = `✅ ${successCount} baixadas | ⏭️ ${existsCount} já existiam | ❌ ${errorCount} erros`;
      toast({
        title: '📥 Download em lote concluído!',
        description: msg,
      });

      // Native OS notification (Electron only, non-blocking)
      try {
        if (isElectron && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Download em lote concluído!', { body: msg });
        }
      } catch {
        // Silently ignore if not supported
      }
    }
  }
}
