/**
 * Global Download Service Hook
 * 
 * Manages the auto-download queue for missing songs.
 * Extracted from GlobalServicesContext for modularity.
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import { useRadioStore, MissingSong, DownloadHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useGradeLogStore } from '@/store/gradeLogStore';
import { markSongAsDownloaded } from '@/lib/libraryVerificationCache';
import { STATION_ID_TO_DB_NAME } from '@/lib/gradeBuilder/constants';
import type { ScheduledSequence, SequenceConfig, RadioStation } from '@/types/radio';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

interface DownloadQueueItem {
  song: MissingSong;
  retryCount: number;
  priority: number;
}

const PRIORITY_STATION_BOOST = 100;
const PRIORITY_SEQUENCE_BOOST = 200; // Higher than station boost - sequence stations are critical
const PRIORITY_GRADE_BOOST = 500; // Highest priority — song is selected for the on-air grade
const DELAY_NORMAL_MS = 5000; // 5s between normal downloads
const DELAY_PRIORITY_MS = 2000; // 2s between priority downloads

export interface DownloadServiceState {
  queueLength: number;
  isProcessing: boolean;
}

/**
 * Detect which stations are in the currently active sequence.
 * Returns a Set of lowercase station names for quick lookup.
 */
function getActiveSequenceStationNames(
  scheduledSequences: ScheduledSequence[],
  defaultSequence: SequenceConfig[],
  stations: RadioStation[]
): Set<string> {
  const now = new Date();
  const timeMinutes = now.getHours() * 60 + now.getMinutes();
  const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
  const currentDay = dayMap[now.getDay()];

  // Find active scheduled sequence (same logic as getActiveSequenceForBlock)
  const activeScheduled = scheduledSequences
    .filter(s => s.enabled)
    .filter(s => s.weekDays.length === 0 || s.weekDays.includes(currentDay))
    .filter(s => {
      const startMin = s.startHour * 60 + s.startMinute;
      const endMin = s.endHour * 60 + s.endMinute;
      if (endMin <= startMin) return timeMinutes >= startMin || timeMinutes < endMin;
      return timeMinutes >= startMin && timeMinutes < endMin;
    })
    .sort((a, b) => b.priority - a.priority);

  const activeSequence = activeScheduled.length > 0 ? activeScheduled[0].sequence : defaultSequence;

  // Collect station names from the sequence
  const stationNames = new Set<string>();
  for (const seq of activeSequence) {
    if (seq.radioSource.startsWith('fixo') || seq.radioSource === 'top50' || seq.radioSource === 'random_pop') continue;
    // Resolve via explicit mapping
    const dbName = STATION_ID_TO_DB_NAME[seq.radioSource] || STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()];
    if (dbName) {
      stationNames.add(dbName.toLowerCase());
      continue;
    }
    // Resolve via station config
    const stationConfig = stations.find(s => s.id === seq.radioSource || s.id.toLowerCase() === seq.radioSource.toLowerCase());
    if (stationConfig) {
      stationNames.add(stationConfig.name.toLowerCase());
    }
  }
  return stationNames;
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
        stationName: song.station,
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

        // Signal grade builder to immediately rebuild unlocked blocks
        useAutoDownloadStore.getState().signalGradeRebuild();

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
      } else if (!success && item.retryCount >= 2) {
        // All retries exhausted: remove from missing list and log the error
        useRadioStore.getState().removeMissingSong(item.song.id);
        useGradeLogStore.getState().addSystemError({
          category: 'DOWNLOAD',
          level: 'error',
          message: `Download falhou: ${item.song.artist} - ${item.song.title}`,
          details: `Estação: ${item.song.station || 'N/A'} | Tentativas: ${item.retryCount + 1} | Removido da fila de faltantes`,
        });
        console.log(`[DL-SVC] 🗑️ Removido da fila de faltantes após ${item.retryCount + 1} tentativas: ${item.song.artist} - ${item.song.title}`);
      }

      // Dynamic delay: fastest for grade songs, fast for sequence, normal for others
      const delay = item.priority >= PRIORITY_GRADE_BOOST ? 1000 : item.priority >= PRIORITY_SEQUENCE_BOOST ? DELAY_PRIORITY_MS : DELAY_NORMAL_MS;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    isProcessingRef.current = false;
    setState(prev => ({ ...prev, isProcessing: false }));
    useAutoDownloadStore.getState().setIsProcessing(false);
  }, [downloadSong]);

  const checkNewMissingSongs = useCallback(() => {
    const storeState = useRadioStore.getState();
    const { deezerConfig, missingSongs, rankingSongs, stations: allStations, scheduledSequences, sequence: defaultSequence } = storeState;

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

    // Cap processedSongsRef to prevent unbounded memory growth
    if (processedSongsRef.current.size > 500) {
      const entries = Array.from(processedSongsRef.current);
      processedSongsRef.current = new Set(entries.slice(-250)); // Keep most recent 250
      console.log('[DL-SVC] 🧹 processedSongs trimmed (500 → 250)');
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

      // All stations are prioritized by default
      const priorityStationNames = new Set(
        allStations
          .filter(s => s.enabled)
          .map(s => s.name.toLowerCase())
      );

      // Detect active sequence stations for priority boost
      const sequenceStationNames = getActiveSequenceStationNames(scheduledSequences, defaultSequence, allStations);

      for (const song of newToQueue) {
        const downloadKey = getDownloadKey(song);
        processedSongsRef.current.add(downloadKey);
        
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        let priority = rankingMap.get(key) || 0;
        
        const songStationLower = song.station?.toLowerCase() || '';
        
        // Grade-urgent boost (highest priority — song is in the on-air grade)
        if (song.gradeUrgent) {
          priority += PRIORITY_GRADE_BOOST;
          console.log(`[DL-SVC] 🔴 Prioridade GRADE (${song.station}): ${song.artist} - ${song.title}`);
        }
        // Sequence station boost
        else if (sequenceStationNames.has(songStationLower)) {
          priority += PRIORITY_SEQUENCE_BOOST;
          console.log(`[DL-SVC] 🎯 Prioridade SEQUÊNCIA (${song.station}): ${song.artist} - ${song.title}`);
        }
        // Station-level priority boost
        else if (priorityStationNames.has(songStationLower)) {
          priority += PRIORITY_STATION_BOOST;
          console.log(`[DL-SVC] 📂 Prioridade ESTAÇÃO (${song.station}): ${song.artist} - ${song.title}`);
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

  // Reactive: immediately detect new missing songs (no polling delay)
  useEffect(() => {
    let prevCount = useRadioStore.getState().missingSongs.filter(s => s.status === 'missing').length;
    const unsubscribe = useRadioStore.subscribe((state) => {
      const currentCount = state.missingSongs.filter(s => s.status === 'missing').length;
      if (currentCount > prevCount && state.isRunning) {
        // New missing songs detected - trigger immediate queue check
        console.log(`[DL-SVC] ⚡ Nova faltante detectada (${prevCount} → ${currentCount}), verificação imediata`);
        checkNewMissingSongs();
      }
      prevCount = currentCount;
    });
    return () => unsubscribe();
  }, [checkNewMissingSongs]);

  /** Start the download check interval. Returns cleanup function. */
  const start = useCallback(() => {
    // Download check every 60 seconds (was 30s — reactive subscription handles immediate detection)
    downloadIntervalRef.current = setInterval(() => {
      const { isRunning } = useRadioStore.getState();
      if (isRunning) {
        checkNewMissingSongs();
      }
    }, 60000);
    
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
