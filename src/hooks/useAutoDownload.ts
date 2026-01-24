import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore, MissingSong, DownloadHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { withRetry, createError, ErrorCodes } from '@/lib/errorHandler';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// Check if running in Service Mode (localhost with Electron backend)
const isServiceMode = () => {
  // Service mode = accessing via localhost but Electron is running in background
  const isLocalhost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  return isLocalhost && !isElectron;
};

// Download via HTTP API (for service mode)
async function downloadViaAPI(params: {
  artist: string;
  title: string;
  arl: string;
  outputFolder: string;
  outputFolder2?: string;
  quality: string;
}): Promise<{ success: boolean; error?: string; track?: any }> {
  try {
    // Use current origin (localhost:PORT) for API call
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `HTTP ${response.status}` };
    }
    
    return await response.json();
  } catch (error) {
    console.error('[AUTO-DL-API] Fetch error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Erro de conexão' };
  }
}

// Check if Electron backend is available (for service mode)
async function checkElectronBackend(): Promise<boolean> {
  try {
    const response = await fetch('/api/health', { method: 'GET' });
    if (response.ok) {
      const data = await response.json();
      return data.electron === true;
    }
    return false;
  } catch {
    return false;
  }
}

// Constants
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

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
  
  const { setQueueLength, setIsProcessing, resetCounter } = useAutoDownloadStore();
  
  const downloadQueueRef = useRef<DownloadQueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const processedSongsRef = useRef<Set<string>>(new Set());
  const lastCheckRef = useRef<string[]>([]);
  const lastResetCounterRef = useRef(0);
  const electronBackendAvailableRef = useRef<boolean | null>(null);

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

  // Check for Electron backend availability on mount (for service mode)
  useEffect(() => {
    if (isServiceMode()) {
      checkElectronBackend().then(available => {
        electronBackendAvailableRef.current = available;
        console.log(`[AUTO-DL] Service mode detected, Electron backend: ${available ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
      });
    }
  }, []);

  // Download a single song
  const downloadSong = useCallback(async (song: MissingSong): Promise<boolean> => {
    const canUseElectronDirect = isElectron && window.electronAPI?.downloadFromDeezer;
    const canUseServiceMode = isServiceMode() && electronBackendAvailableRef.current;
    
    if (!canUseElectronDirect && !canUseServiceMode) {
      console.log('[AUTO-DL] ❌ Skipping - not in Electron environment and no service mode backend');
      return false;
    }

    const state = useRadioStore.getState();
    if (!state.deezerConfig.enabled) {
      console.log('[AUTO-DL] ❌ Skipping - Deezer not enabled in config');
      return false;
    }
    if (!state.deezerConfig.arl) {
      console.log('[AUTO-DL] ❌ Skipping - No ARL token configured');
      return false;
    }
    if (!state.deezerConfig.downloadFolder) {
      console.log('[AUTO-DL] ❌ Skipping - No download folder configured');
      return false;
    }

    console.log(`[AUTO-DL] Downloading: ${song.artist} - ${song.title} (mode: ${canUseElectronDirect ? 'IPC' : 'API'})`);
    updateMissingSong(song.id, { status: 'downloading' });

    const startTime = Date.now();

    try {
      const downloadParams = {
        artist: song.artist,
        title: song.title,
        arl: state.deezerConfig.arl,
        outputFolder: state.deezerConfig.downloadFolder,
        outputFolder2: state.deezerConfig.downloadFolder2 || undefined,
        quality: state.deezerConfig.quality,
      };
      
      // Use IPC if in Electron, otherwise use HTTP API (service mode)
      let result;
      if (canUseElectronDirect) {
        result = await window.electronAPI.downloadFromDeezer(downloadParams);
      } else {
        result = await downloadViaAPI(downloadParams);
      }

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
    if (isProcessingRef.current) {
      console.log('[AUTO-DL] ⏳ Already processing queue, skipping');
      return;
    }
    
    if (downloadQueueRef.current.length === 0) {
      console.log('[AUTO-DL] 📭 Queue is empty, nothing to process');
      return;
    }

    const state = useRadioStore.getState();
    if (!state.deezerConfig.autoDownload) {
      console.log('[AUTO-DL] ⏸️ Auto-download is disabled');
      return;
    }
    if (!state.deezerConfig.enabled) {
      console.log('[AUTO-DL] ⏸️ Deezer integration is disabled');
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
    const inServiceMode = isServiceMode();
    const canDownload = isElectron || (inServiceMode && electronBackendAvailableRef.current);
    
    // Log current config status for debugging
    console.log('[AUTO-DL] 📊 Config status:', {
      autoDownload: deezerConfig.autoDownload,
      enabled: deezerConfig.enabled,
      hasArl: !!deezerConfig.arl,
      hasDownloadFolder: !!deezerConfig.downloadFolder,
      missingSongsCount: missingSongs.filter(s => s.status === 'missing').length,
      isElectron,
      isServiceMode: inServiceMode,
      electronBackendAvailable: electronBackendAvailableRef.current,
      canDownload,
    });

    if (!canDownload) {
      console.log('[AUTO-DL] ⏸️ Cannot download - no Electron or service mode backend');
      return;
    }
    if (!deezerConfig.autoDownload) {
      console.log('[AUTO-DL] ⏸️ Auto-download is OFF');
      return;
    }
    if (!deezerConfig.enabled) {
      console.log('[AUTO-DL] ⏸️ Deezer integration is OFF');
      return;
    }
    if (!deezerConfig.arl) {
      console.log('[AUTO-DL] ⚠️ No ARL token configured - go to Settings → Deezer');
      return;
    }
    if (!deezerConfig.downloadFolder) {
      console.log('[AUTO-DL] ⚠️ No download folder configured - go to Settings → Deezer');
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

    if (newSongs.length > 0) {
      console.log(`[AUTO-DL] 🎵 Found ${newSongs.length} new missing song(s) to download`);
    }

    // Add new songs to queue
    for (const song of newSongs) {
      console.log(`[AUTO-DL] ➕ Queuing: ${song.artist} - ${song.title}`);
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
      console.log(`[AUTO-DL] 🚀 Starting queue processing (${downloadQueueRef.current.length} items)`);
      processQueue();
    }
  }, [missingSongs, deezerConfig.autoDownload, deezerConfig.enabled, deezerConfig.arl, deezerConfig.downloadFolder, processQueue, setQueueLength]);
}
