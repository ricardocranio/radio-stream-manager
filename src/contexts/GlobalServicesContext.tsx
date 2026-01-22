/**
 * Global Services Context
 * 
 * Este contexto centraliza TODOS os serviços que devem rodar
 * CONTINUAMENTE desde o boot da aplicação, independente da navegação.
 * 
 * Serviços incluídos:
 * - Auto Grade Builder (montagem de grades)
 * - Auto Scraping (captura de músicas)
 * - Auto Download (download de músicas faltantes)
 * - Sincronização de dados
 */

import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import { useRadioStore, MissingSong, DownloadHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { radioScraperApi } from '@/lib/api/radioScraper';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// ============= TYPES =============

interface AutoGradeState {
  isBuilding: boolean;
  lastBuildTime: Date | null;
  currentBlock: string;
  nextBlock: string;
  lastSavedFile: string | null;
  error: string | null;
  blocksGenerated: number;
  isAutoEnabled: boolean;
  nextBuildIn: number;
  minutesBeforeBlock: number;
  fullDayProgress: number;
  fullDayTotal: number;
  skippedSongs: number;
  substitutedSongs: number;
  missingSongs: number;
  currentProcessingSong: string | null;
  currentProcessingBlock: string | null;
  lastSaveProgress: number;
}

interface ScrapeStats {
  lastScrape: Date | null;
  successCount: number;
  errorCount: number;
  totalSongs: number;
  isRunning: boolean;
  currentStation: string | null;
  failedStations: string[];
}

interface DownloadQueueItem {
  song: MissingSong;
  retryCount: number;
}

interface GlobalServicesContextType {
  // Grade Builder
  gradeBuilder: {
    state: AutoGradeState;
    buildSingleBlock: (timeStr?: string) => Promise<void>;
    buildFullDay: (dayCode?: string) => Promise<void>;
    setAutoEnabled: (enabled: boolean) => void;
    setMinutesBeforeBlock: (minutes: number) => void;
  };
  // Scraping
  scraping: {
    stats: ScrapeStats;
    scrapeAllStations: (forceRefresh?: boolean) => Promise<{ successCount: number; errorCount: number; newSongsCount: number }>;
    isRunning: boolean;
  };
  // Downloads
  downloads: {
    queueLength: number;
    isProcessing: boolean;
  };
}

const GlobalServicesContext = createContext<GlobalServicesContextType | null>(null);

// Singleton flags
let isGlobalServicesRunning = false;

const DEFAULT_MINUTES_BEFORE_BLOCK = 10;

export function GlobalServicesProvider({ children }: { children: React.ReactNode }) {
  // ============= REFS =============
  // Download
  const downloadQueueRef = useRef<DownloadQueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const processedSongsRef = useRef<Set<string>>(new Set());
  const lastCheckRef = useRef<string[]>([]);
  const downloadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Scraping
  const scrapeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Grade Builder
  const lastBuildRef = useRef<string | null>(null);
  const buildIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const isInitializedRef = useRef(false);

  // ============= STATE =============
  const [gradeState, setGradeState] = useState<AutoGradeState>({
    isBuilding: false,
    lastBuildTime: null,
    currentBlock: '--:--',
    nextBlock: '--:--',
    lastSavedFile: null,
    error: null,
    blocksGenerated: 0,
    isAutoEnabled: true,
    nextBuildIn: 0,
    minutesBeforeBlock: DEFAULT_MINUTES_BEFORE_BLOCK,
    fullDayProgress: 0,
    fullDayTotal: 0,
    skippedSongs: 0,
    substitutedSongs: 0,
    missingSongs: 0,
    currentProcessingSong: null,
    currentProcessingBlock: null,
    lastSaveProgress: 0,
  });

  const [scrapeStats, setScrapeStats] = useState<ScrapeStats>({
    lastScrape: null,
    successCount: 0,
    errorCount: 0,
    totalSongs: 0,
    isRunning: false,
    currentStation: null,
    failedStations: [],
  });

  const [downloadState, setDownloadState] = useState({
    queueLength: 0,
    isProcessing: false,
  });

  // ============= DOWNLOAD SERVICE =============
  const downloadSong = useCallback(async (song: MissingSong): Promise<boolean> => {
    if (!isElectron || !window.electronAPI?.downloadFromDeezer) {
      return false;
    }

    const state = useRadioStore.getState();
    if (!state.deezerConfig.enabled || !state.deezerConfig.arl) {
      return false;
    }

    console.log(`[GLOBAL-SVC] 🎵 Downloading: ${song.artist} - ${song.title}`);
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

        console.log(`[GLOBAL-SVC] ✅ Downloaded: ${song.artist} - ${song.title}`);
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

      console.error(`[GLOBAL-SVC] ❌ Download failed: ${song.artist} - ${song.title}`, error);
      return false;
    }
  }, []);

  const processDownloadQueue = useCallback(async () => {
    if (isProcessingRef.current || downloadQueueRef.current.length === 0) {
      return;
    }

    const state = useRadioStore.getState();
    if (!state.deezerConfig.autoDownload || !state.deezerConfig.enabled) {
      return;
    }

    isProcessingRef.current = true;
    setDownloadState(prev => ({ ...prev, isProcessing: true }));
    useAutoDownloadStore.getState().setIsProcessing(true);

    while (downloadQueueRef.current.length > 0) {
      const currentState = useRadioStore.getState();
      if (!currentState.deezerConfig.autoDownload) {
        console.log('[GLOBAL-SVC] Auto-download disabled, stopping queue');
        break;
      }

      const item = downloadQueueRef.current.shift();
      setDownloadState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
      useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
      if (!item) break;

      const success = await downloadSong(item.song);
      
      if (!success && item.retryCount < 2) {
        downloadQueueRef.current.push({
          song: item.song,
          retryCount: item.retryCount + 1,
        });
        setDownloadState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
        useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
      }

      const intervalMinutes = currentState.deezerConfig.autoDownloadIntervalMinutes || 1;
      const intervalMs = intervalMinutes * 60 * 1000;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    isProcessingRef.current = false;
    setDownloadState(prev => ({ ...prev, isProcessing: false }));
    useAutoDownloadStore.getState().setIsProcessing(false);
  }, [downloadSong]);

  const checkNewMissingSongs = useCallback(() => {
    const state = useRadioStore.getState();
    const { deezerConfig, missingSongs } = state;

    if (!deezerConfig.autoDownload || !deezerConfig.enabled || !deezerConfig.arl) {
      return;
    }

    const currentIds = missingSongs
      .filter(s => s.status === 'missing')
      .map(s => s.id);
    
    const newSongs = missingSongs.filter(
      song => 
        song.status === 'missing' && 
        !lastCheckRef.current.includes(song.id) &&
        !processedSongsRef.current.has(song.id)
    );

    for (const song of newSongs) {
      console.log(`[GLOBAL-SVC] 📥 New missing song: ${song.artist} - ${song.title}`);
      processedSongsRef.current.add(song.id);
      downloadQueueRef.current.push({ song, retryCount: 0 });
    }
    
    setDownloadState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
    useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
    lastCheckRef.current = currentIds;

    if (downloadQueueRef.current.length > 0 && !isProcessingRef.current) {
      processDownloadQueue();
    }
  }, [processDownloadQueue]);

  // ============= SCRAPING SERVICE =============
  const scrapeStation = useCallback(async (stationName: string, scrapeUrl: string) => {
    setScrapeStats(prev => ({ ...prev, currentStation: stationName }));
    
    try {
      const result = await radioScraperApi.scrapeStation(stationName, scrapeUrl);
      
      if (result.success && result.nowPlaying) {
        return {
          success: true,
          stationName,
          scrapeUrl,
          nowPlaying: result.nowPlaying,
          recentSongs: result.recentSongs || [],
          source: result.source,
        };
      }
      
      return { success: false, stationName, scrapeUrl, error: result.error };
    } catch (error) {
      console.error(`[GLOBAL-SVC] Error scraping ${stationName}:`, error);
      return { success: false, stationName, scrapeUrl, error: String(error) };
    }
  }, []);

  const scrapeAllStations = useCallback(async (forceRefresh = false) => {
    const { stations, addCapturedSong, addOrUpdateRankingSong } = useRadioStore.getState();
    const enabledStations = stations.filter(s => s.enabled && s.scrapeUrl);
    
    if (enabledStations.length === 0) {
      console.log('[GLOBAL-SVC] No enabled stations with scrape URLs');
      return { successCount: 0, errorCount: 0, newSongsCount: 0 };
    }

    console.log(`[GLOBAL-SVC] 📡 Scraping ${enabledStations.length} stations...`);
    
    setScrapeStats(prev => ({
      ...prev,
      isRunning: true,
      lastScrape: new Date(),
      failedStations: [],
    }));

    let successCount = 0;
    let errorCount = 0;
    let newSongsCount = 0;
    const failedStations: string[] = [];

    const batchSize = 3;
    for (let i = 0; i < enabledStations.length; i += batchSize) {
      const batch = enabledStations.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(station => scrapeStation(station.name, station.scrapeUrl!))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const station = batch[j];
        
        if (result.status === 'fulfilled' && result.value.success) {
          successCount++;
          const { stationName, nowPlaying, recentSongs, scrapeUrl } = result.value;
          const stationStyle = station.styles?.[0] || 'POP/VARIADO';
          
          if (nowPlaying) {
            addCapturedSong({
              id: `${stationName}-${Date.now()}`,
              title: nowPlaying.title,
              artist: nowPlaying.artist,
              station: stationName,
              timestamp: new Date(),
              status: 'found',
              source: scrapeUrl,
            });
            
            addOrUpdateRankingSong(nowPlaying.title, nowPlaying.artist, stationStyle);
            newSongsCount++;
          }

          for (const song of (recentSongs || []).slice(0, 3)) {
            addCapturedSong({
              id: `${stationName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              title: song.title,
              artist: song.artist,
              station: stationName,
              timestamp: new Date(song.timestamp),
              status: 'found',
              source: scrapeUrl,
            });
            
            addOrUpdateRankingSong(song.title, song.artist, stationStyle);
            newSongsCount++;
          }
        } else {
          errorCount++;
          const stationName = result.status === 'fulfilled' 
            ? result.value.stationName 
            : station?.name;
          if (stationName) {
            failedStations.push(stationName);
          }
        }
      }

      if (i + batchSize < enabledStations.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setScrapeStats(prev => ({
      ...prev,
      isRunning: false,
      currentStation: null,
      successCount: prev.successCount + successCount,
      errorCount: prev.errorCount + errorCount,
      totalSongs: prev.totalSongs + newSongsCount,
      failedStations,
    }));

    if (successCount > 0 || errorCount > 0) {
      console.log(`[GLOBAL-SVC] 📡 Scrape complete: ${successCount}✓ ${errorCount}✗ ${newSongsCount} songs`);
    }

    return { successCount, errorCount, newSongsCount };
  }, [scrapeStation]);

  // ============= GRADE BUILDER SERVICE =============
  // Helper functions for grade builder
  const getDayCode = useCallback(() => {
    const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
    return days[new Date().getDay()];
  }, []);

  const buildSingleBlock = useCallback(async (timeStr?: string) => {
    // Simplified for now - the full implementation would be in the original hook
    // This is called from the DashboardView when the user clicks "Gerar Bloco"
    console.log(`[GLOBAL-SVC] 📋 Building block for ${timeStr || 'current time'}`);
    setGradeState(prev => ({ ...prev, isBuilding: true }));
    
    // Add actual build logic here from useAutoGradeBuilder
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setGradeState(prev => ({ 
      ...prev, 
      isBuilding: false, 
      lastBuildTime: new Date(),
      blocksGenerated: prev.blocksGenerated + 1 
    }));
  }, []);

  const buildFullDay = useCallback(async (dayCode?: string) => {
    console.log(`[GLOBAL-SVC] 📅 Building full day grade for ${dayCode || getDayCode()}`);
    setGradeState(prev => ({ ...prev, isBuilding: true, fullDayProgress: 0, fullDayTotal: 48 }));
    
    // The full implementation calls the actual grade building logic
    // For now, just log that the service is running
    
    setGradeState(prev => ({ ...prev, isBuilding: false }));
  }, [getDayCode]);

  const setAutoEnabled = useCallback((enabled: boolean) => {
    setGradeState(prev => ({ ...prev, isAutoEnabled: enabled }));
  }, []);

  const setMinutesBeforeBlock = useCallback((minutes: number) => {
    setGradeState(prev => ({ ...prev, minutesBeforeBlock: minutes }));
  }, []);

  // ============= AUTO GRADE BUILD TIMER =============
  const checkAndBuildGrade = useCallback(() => {
    const state = useRadioStore.getState();
    if (!gradeState.isAutoEnabled) return;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Check if we're near a block time (blocks at :00 and :30)
    const nextBlockMinute = currentMinute < 30 ? 30 : 0;
    const nextBlockHour = currentMinute >= 30 ? (currentHour + 1) % 24 : currentHour;
    
    const minutesToNextBlock = nextBlockMinute === 0 
      ? (60 - currentMinute) 
      : (30 - currentMinute);

    setGradeState(prev => ({ 
      ...prev, 
      nextBlock: `${String(nextBlockHour).padStart(2, '0')}:${String(nextBlockMinute).padStart(2, '0')}`,
      nextBuildIn: minutesToNextBlock 
    }));

    // Build if we're at the configured minutes before the block
    if (minutesToNextBlock === gradeState.minutesBeforeBlock) {
      const blockStr = `${String(nextBlockHour).padStart(2, '0')}:${String(nextBlockMinute).padStart(2, '0')}`;
      
      // Avoid building the same block twice
      if (lastBuildRef.current !== blockStr) {
        lastBuildRef.current = blockStr;
        console.log(`[GLOBAL-SVC] ⏰ Auto-building grade for ${blockStr}`);
        buildSingleBlock(blockStr);
      }
    }
  }, [gradeState.isAutoEnabled, gradeState.minutesBeforeBlock, buildSingleBlock]);

  // ============= INITIALIZATION =============
  useEffect(() => {
    if (isGlobalServicesRunning || isInitializedRef.current) {
      console.log('[GLOBAL-SVC] Already running, skipping initialization');
      return;
    }

    isGlobalServicesRunning = true;
    isInitializedRef.current = true;
    console.log('[GLOBAL-SVC] 🚀 Starting ALL global services...');

    // 1. Download check every 10 seconds
    downloadIntervalRef.current = setInterval(() => {
      checkNewMissingSongs();
    }, 10000);
    checkNewMissingSongs();

    // 2. Scraping every 3 minutes (if configured)
    scrapeIntervalRef.current = setInterval(() => {
      const state = useRadioStore.getState();
      const { stations } = state;
      const hasEnabledStations = stations.some(s => s.enabled && s.scrapeUrl);
      if (hasEnabledStations) {
        scrapeAllStations();
      }
    }, 3 * 60 * 1000);

    // Initial scrape
    const initialState = useRadioStore.getState();
    if (initialState.stations.some(s => s.enabled && s.scrapeUrl)) {
      scrapeAllStations();
    }

    // 3. Grade builder check every minute
    buildIntervalRef.current = setInterval(() => {
      checkAndBuildGrade();
    }, 60000);
    checkAndBuildGrade();

    console.log('[GLOBAL-SVC] ✅ All services started successfully');

    return () => {
      console.log('[GLOBAL-SVC] 🛑 Stopping all global services');
      if (downloadIntervalRef.current) clearInterval(downloadIntervalRef.current);
      if (scrapeIntervalRef.current) clearInterval(scrapeIntervalRef.current);
      if (buildIntervalRef.current) clearInterval(buildIntervalRef.current);
      isGlobalServicesRunning = false;
      isInitializedRef.current = false;
    };
  }, [checkNewMissingSongs, scrapeAllStations, checkAndBuildGrade]);

  // Watch for reset signal
  useEffect(() => {
    const unsubscribe = useAutoDownloadStore.subscribe((state, prevState) => {
      if (state.resetCounter > prevState.resetCounter) {
        console.log('[GLOBAL-SVC] 🔄 Reset signal received, clearing queue and refs');
        downloadQueueRef.current = [];
        processedSongsRef.current.clear();
        lastCheckRef.current = [];
        isProcessingRef.current = false;
        setDownloadState({ queueLength: 0, isProcessing: false });
      }
    });

    return () => unsubscribe();
  }, []);

  const contextValue: GlobalServicesContextType = {
    gradeBuilder: {
      state: gradeState,
      buildSingleBlock,
      buildFullDay,
      setAutoEnabled,
      setMinutesBeforeBlock,
    },
    scraping: {
      stats: scrapeStats,
      scrapeAllStations,
      isRunning: scrapeStats.isRunning,
    },
    downloads: downloadState,
  };

  return (
    <GlobalServicesContext.Provider value={contextValue}>
      {children}
    </GlobalServicesContext.Provider>
  );
}

export function useGlobalServices() {
  const context = useContext(GlobalServicesContext);
  if (!context) {
    throw new Error('useGlobalServices must be used within a GlobalServicesProvider');
  }
  return context;
}
