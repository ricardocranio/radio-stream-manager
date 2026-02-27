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

  const checkAndDownload = useCallback(async () => {
    const { isRunning, deezerConfig } = useRadioStore.getState();
    if (!isRunning || !deezerConfig.enabled || !deezerConfig.arl || !deezerConfig.autoDownload) return;
    if (isProcessingRef.current) return;

    try {
      // Fetch last 6h of captured songs (freshness priority)
      const threshold = subHours(new Date(), 6).toISOString();
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('id, artist, title, station_name, scraped_at')
        .gte('scraped_at', threshold)
        .order('scraped_at', { ascending: false })
        .limit(200);

      if (error || !data) return;

      // Deduplicate by artist+title and filter blocked songs
      const blockedExact = new Set<string>();
      const blockedArtists = new Set<string>();
      (useRadioStore.getState().config.blockedSongs || []).forEach(s => {
        const lower = s.toLowerCase().trim();
        if (lower.endsWith(' - *')) {
          blockedArtists.add(lower.replace(' - *', ''));
        } else {
          blockedExact.add(lower);
        }
      });
      const isSongBlocked = (artist: string, title: string) => {
        const a = artist.trim().toLowerCase();
        return blockedExact.has(`${a} - ${title.trim().toLowerCase()}`) || blockedArtists.has(a);
      };
      const seen = new Set<string>();
      const unique: CapturedQueueItem[] = [];
      for (const song of data) {
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        if (seen.has(key) || processedRef.current.has(key)) continue;
        // Check blocked list
        if (isSongBlocked(song.artist, song.title)) continue;
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
  }, [processQueue]);

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
