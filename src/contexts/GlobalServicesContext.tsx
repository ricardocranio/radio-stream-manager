/**
 * Global Services Context
 * 
 * Este contexto centraliza TODOS os serviços que devem rodar
 * CONTINUAMENTE desde o boot da aplicação, independente da navegação.
 * 
 * Serviços incluídos:
 * - Auto Grade Builder (montagem de grades) - via useAutoGradeBuilder hook
 * - Auto Scraping (captura de músicas)
 * - Auto Download (download de músicas faltantes)
 * - Sincronização de dados
 */

import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import { useRadioStore, MissingSong, DownloadHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { radioScraperApi } from '@/lib/api/radioScraper';
import { useAutoGradeBuilder } from '@/hooks/useAutoGradeBuilder';
import { checkSongInLibrary } from '@/hooks/useCheckMusicLibrary';
import { cleanAndValidateSong } from '@/lib/cleanSongMetadata';
import { isElectron, isServiceMode, checkElectronBackend, downloadViaAPI, onBackendReconnect, resetReconnectState, getBackendAvailable } from '@/lib/serviceMode';
import { logSystemError } from '@/store/gradeLogStore';

// ============= TYPES =============

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

// The gradeBuilder object returned by useAutoGradeBuilder
type GradeBuilderType = ReturnType<typeof useAutoGradeBuilder>;

interface GlobalServicesContextType {
  // Grade Builder - directly from the hook
  gradeBuilder: GradeBuilderType;
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
    backendConnected: boolean;
    songsVerified: number;
  };
}

const GlobalServicesContext = createContext<GlobalServicesContextType | null>(null);

// Singleton flags
let isGlobalServicesRunning = false;

export function GlobalServicesProvider({ children }: { children: React.ReactNode }) {
  // ============= GLOBAL GRADE BUILDER - RUNS FROM BOOT =============
  // This hook contains its own intervals and runs continuously in background
  const gradeBuilder = useAutoGradeBuilder();
  
  // ============= REFS =============
  // Download
  const downloadQueueRef = useRef<DownloadQueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const processedSongsRef = useRef<Set<string>>(new Set());
  const downloadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Scraping
  const scrapeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const isInitializedRef = useRef(false);

  // ============= STATE =============
  const [scrapeStats, setScrapeStats] = useState<ScrapeStats>({
    lastScrape: null,
    successCount: 0,
    errorCount: 0,
    totalSongs: 0,
    isRunning: false,
    currentStation: null,
    failedStations: [],
  });

  // Initialize with current cache value if available
  const [downloadState, setDownloadState] = useState(() => {
    // Calculate initial backend status synchronously
    let initialBackendStatus = false;
    
    // If native Electron, always connected
    if (isElectron && typeof window !== 'undefined' && window.electronAPI) {
      initialBackendStatus = true;
    } else {
      // Use cached value from serviceMode if available
      const cached = getBackendAvailable();
      initialBackendStatus = cached === true;
    }
    
    return {
      queueLength: 0,
      isProcessing: false,
      backendConnected: initialBackendStatus,
      songsVerified: 0,
    };
  });

  // ============= DOWNLOAD SERVICE =============
  const electronBackendRef = useRef<boolean | null>(getBackendAvailable());
  const songsVerifiedRef = useRef<number>(0);
  
  // Check backend availability on mount for Service Mode
  useEffect(() => {
    // Check Electron direct
    if (isElectron && window.electronAPI) {
      setDownloadState(prev => ({ ...prev, backendConnected: true }));
      electronBackendRef.current = true;
      console.log('[GLOBAL-SVC] Native Electron detected - backend connected');
      return;
    }
    
    // In Service Mode, check backend availability immediately and periodically
    if (isServiceMode()) {
      console.log('[GLOBAL-SVC] Service Mode detected - checking backend availability...');
      
      // Track if this is the first notification (to avoid "reconnected" log on initial check)
      let isFirstNotification = true;
      
      // Subscribe to auto-reconnect events - this will also notify immediately if status is known
      const unsubscribe = onBackendReconnect((connected) => {
        const previousStatus = electronBackendRef.current;
        electronBackendRef.current = connected;
        setDownloadState(prev => ({ ...prev, backendConnected: connected }));
        
        // Only log status changes, not the initial notification
        if (!isFirstNotification && previousStatus !== connected) {
          if (connected) {
            logSystemError('SYSTEM', 'info', 'Backend reconectado automaticamente', 
              'Conexão com o Electron foi restaurada.');
            console.log('[GLOBAL-SVC] 🔄 Backend auto-reconnected!');
          } else {
            logSystemError('SYSTEM', 'warning', 'Backend desconectado - tentando reconectar...', 
              'O sistema tentará reconectar automaticamente.');
            console.log('[GLOBAL-SVC] ⚠️ Backend disconnected, auto-reconnect started');
          }
        }
        
        isFirstNotification = false;
      });
      
      // Also do an explicit check in case cache isn't populated yet
      checkElectronBackend().then(available => {
        electronBackendRef.current = available;
        setDownloadState(prev => ({ ...prev, backendConnected: available }));
        console.log(`[GLOBAL-SVC] Service mode backend: ${available ? '✅ CONNECTED' : '❌ NOT AVAILABLE'}`);
        
        if (!available) {
          logSystemError('SYSTEM', 'warning', 'Backend não disponível ao iniciar', 
            'O sistema tentará reconectar automaticamente.');
        }
      });
      
      // Re-check periodically in case backend becomes available later
      const intervalId = setInterval(() => {
        checkElectronBackend().then(available => {
          if (available !== electronBackendRef.current) {
            electronBackendRef.current = available;
            setDownloadState(prev => ({ ...prev, backendConnected: available }));
            console.log(`[GLOBAL-SVC] Service mode backend status changed: ${available ? '✅ CONNECTED' : '❌ DISCONNECTED'}`);
          }
        });
      }, 15000); // Check every 15 seconds
      
      return () => {
        clearInterval(intervalId);
        unsubscribe();
      };
    }
    
    // Neither Electron nor Service Mode - likely Lovable preview
    console.log('[GLOBAL-SVC] Web-only mode detected (no local backend)');
  }, []);
  
  const downloadSong = useCallback(async (song: MissingSong): Promise<boolean> => {
    const canUseElectronDirect = isElectron && window.electronAPI?.downloadFromDeezer;
    
    // For service mode, check backend availability dynamically
    let canUseServiceMode = false;
    
    if (isServiceMode()) {
      // If backend confirmed connected, use it
      if (electronBackendRef.current === true) {
        canUseServiceMode = true;
      } else {
        // Otherwise, do a fresh check (handles both null and false cases)
        const available = await checkElectronBackend();
        electronBackendRef.current = available;
        setDownloadState(prev => ({ ...prev, backendConnected: available }));
        canUseServiceMode = available;
        console.log(`[GLOBAL-SVC] On-demand backend check: ${available ? 'CONNECTED' : 'NOT AVAILABLE'}`);
      }
    }
    
    if (!canUseElectronDirect && !canUseServiceMode) {
      console.log('[GLOBAL-SVC] ❌ Skipping download - no backend available');
      return false;
    }

    const state = useRadioStore.getState();
    if (!state.deezerConfig.enabled || !state.deezerConfig.arl) {
      return false;
    }

    console.log(`[GLOBAL-SVC] 🎵 Downloading: ${song.artist} - ${song.title} (mode: ${canUseElectronDirect ? 'IPC' : 'API'})`);
    useRadioStore.getState().updateMissingSong(song.id, { status: 'downloading' });

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

      // Small delay between downloads to avoid overwhelming the API (5 seconds)
      // Previously waited the full interval - now downloads are IMMEDIATE
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    isProcessingRef.current = false;
    setDownloadState(prev => ({ ...prev, isProcessing: false }));
    useAutoDownloadStore.getState().setIsProcessing(false);
  }, [downloadSong]);

  // Throttle logging to avoid spam
  const lastLogTimeRef = useRef<number>(0);
  
  const checkNewMissingSongs = useCallback(() => {
    const state = useRadioStore.getState();
    const { deezerConfig, missingSongs } = state;

    // Count songs with 'missing' status (verified as not in music library)
    const pendingMissing = missingSongs.filter(s => s.status === 'missing');
    const newToQueue = pendingMissing.filter(s => !processedSongsRef.current.has(s.id));

    // Throttled status log - only log every 60 seconds to reduce spam
    const now = Date.now();
    const shouldLog = now - lastLogTimeRef.current > 60000;
    
    if (shouldLog && pendingMissing.length > 0) {
      lastLogTimeRef.current = now;
      console.log(`[GLOBAL-SVC] 📊 Status: ${pendingMissing.length} músicas faltando | ${newToQueue.length} novas`);
    }

    // Check if auto-download is configured - silent if no new songs
    if (!deezerConfig.autoDownload || !deezerConfig.enabled || !deezerConfig.arl) {
      return;
    }

    // Only process if there are NEW songs to add
    if (newToQueue.length === 0) {
      return;
    }

    // Add new songs to queue (only songs verified as missing from music library)
    for (const song of newToQueue) {
      processedSongsRef.current.add(song.id);
      downloadQueueRef.current.push({ song, retryCount: 0 });
    }
    
    // Update queue length in state and store
    console.log(`[GLOBAL-SVC] 📥 +${newToQueue.length} músicas adicionadas à fila`);
    setDownloadState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
    useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
    
    // IMMEDIATELY start processing - don't wait for next interval
    if (!isProcessingRef.current) {
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

  const scrapeAllStations = useCallback(async (_forceRefresh = false) => {
    const { stations, addCapturedSong, addOrUpdateRankingSong, addMissingSong, missingSongs, config } = useRadioStore.getState();
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
    
    // Helper to check if song is already in missing list
    const isSongAlreadyMissing = (artist: string, title: string) => {
      const normalizedArtist = artist.toLowerCase().trim();
      const normalizedTitle = title.toLowerCase().trim();
      return missingSongs.some(s => 
        s.artist.toLowerCase().trim() === normalizedArtist && 
        s.title.toLowerCase().trim() === normalizedTitle
      );
    };
    
    // Helper to process a captured song with library check
    const processCapturedSong = async (
      songData: { title: string; artist: string; timestamp?: string },
      stationName: string,
      stationStyle: string,
      scrapeUrl: string
    ) => {
      // CRITICAL: Clean and validate song data before processing
      const cleanedSong = cleanAndValidateSong(songData.artist, songData.title);
      
      // Skip invalid entries (addresses, station info, etc.)
      if (!cleanedSong) {
        console.log(`[GLOBAL-SVC] ⚠️ Dados inválidos ignorados: "${songData.artist} - ${songData.title}"`);
        return false;
      }
      
      const { artist, title } = cleanedSong;
      const songId = `${stationName}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      
      // Check if song exists in music library
      const libraryCheck = await checkSongInLibrary(
        artist, 
        title, 
        config.musicFolders || [],
        config.similarityThreshold || 0.75
      );
      
      // If verification failed (no backend), don't add to missing list
      // This prevents flooding the missing list when backend is unavailable
      if (libraryCheck.verificationFailed) {
        console.log(`[GLOBAL-SVC] ⚠️ Verificação não disponível para: ${artist} - ${title} (backend offline)`);
        // Still add to captured songs but with 'unknown' status
        addCapturedSong({
          id: songId,
          title: title,
          artist: artist,
          station: stationName,
          timestamp: songData.timestamp ? new Date(songData.timestamp) : new Date(),
          status: 'unknown', // Mark as unknown, not missing
          source: scrapeUrl,
        });
        // Update ranking even if we can't verify library
        addOrUpdateRankingSong(title, artist, stationStyle);
        return true;
      }
      
      // Increment verified counter only for actual verifications
      songsVerifiedRef.current++;
      setDownloadState(prev => ({ ...prev, songsVerified: songsVerifiedRef.current }));
      
      const existsInLibrary = libraryCheck.exists;
      const songStatus = existsInLibrary ? 'found' : 'missing';
      
      // Add to captured songs with CLEANED data
      addCapturedSong({
        id: songId,
        title: title,
        artist: artist,
        station: stationName,
        timestamp: songData.timestamp ? new Date(songData.timestamp) : new Date(),
        status: songStatus,
        source: scrapeUrl,
      });
      
      // Update ranking with cleaned data
      addOrUpdateRankingSong(title, artist, stationStyle);
      
      // If not in library AND not already in missing list, add to missing
      if (!existsInLibrary && !isSongAlreadyMissing(artist, title)) {
        addMissingSong({
          id: `missing-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          title: title,
          artist: artist,
          station: stationName,
          timestamp: new Date(),
          status: 'missing',
          dna: stationStyle,
        });
        console.log(`[GLOBAL-SVC] 📥 Nova música faltando: ${artist} - ${title}`);
      }
      
      return true;
    };

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
          
          // Process nowPlaying with library check
          if (nowPlaying) {
            await processCapturedSong(nowPlaying, stationName, stationStyle, scrapeUrl);
            newSongsCount++;
          }

          // Process recent songs with library check
          for (const song of (recentSongs || []).slice(0, 3)) {
            await processCapturedSong(song, stationName, stationStyle, scrapeUrl);
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

  // ============= INITIALIZATION =============
  useEffect(() => {
    if (isGlobalServicesRunning || isInitializedRef.current) {
      console.log('[GLOBAL-SVC] Already running, skipping initialization');
      return;
    }

    isGlobalServicesRunning = true;
    isInitializedRef.current = true;
    
    // Get current config state
    const state = useRadioStore.getState();
    const { deezerConfig, stations, config } = state;
    const enabledStations = stations.filter(s => s.enabled && s.scrapeUrl).length;
    
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     🚀 SISTEMA AUTOMATIZADO - INICIANDO TODOS OS SERVIÇOS    ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║ 📡 Scraping:      ${enabledStations > 0 ? `✅ ATIVO (${enabledStations} emissoras) - 5 min` : '⚠️ Sem emissoras'}`.padEnd(65) + '║');
    console.log(`║ 🎵 Grade Builder: ✅ ATIVO (${gradeBuilder.minutesBeforeBlock || 10} min antes de cada bloco)`.padEnd(65) + '║');
    console.log(`║ 📥 Downloads:     ${deezerConfig.autoDownload ? '✅ IMEDIATO (5s entre cada)' : '⏸️ MANUAL (ativar em Config)'}`.padEnd(65) + '║');
    console.log(`║ 💾 Banco Musical: ${config.musicFolders?.length > 0 ? `✅ ${config.musicFolders.length} pastas` : '⚠️ Configurar pastas'}`.padEnd(65) + '║');
    console.log(`║ 📊 Stats:         ✅ ATIVO - refresh 10 min`.padEnd(65) + '║');
    console.log(`║ 🔄 Sync Cloud:    ✅ ATIVO (Realtime)`.padEnd(65) + '║');
    console.log(`║ 🕐 Reset Diário:  ✅ ATIVO (20:00)`.padEnd(65) + '║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    // PROACTIVE: Initialize realtime channel early to prevent "degraded" status
    import('@/lib/realtimeManager').then(({ realtimeManager }) => {
      realtimeManager.subscribe('scraped_songs', 'global_services_init', () => {
        // This callback will receive realtime inserts - just log for debugging
        console.log('[GLOBAL-SVC] 🔔 Realtime insert received');
      });
      console.log('[GLOBAL-SVC] 🔄 Realtime channel initialized');
    }).catch(err => {
      console.warn('[GLOBAL-SVC] Failed to initialize realtime:', err);
    });

    // 1. Download check every 30 seconds (was 10s - reduced for performance)
    downloadIntervalRef.current = setInterval(() => {
      checkNewMissingSongs();
    }, 30000);
    checkNewMissingSongs(); // Initial check immediately

    // 2. Scraping every 5 minutes (was 3 min - optimized for performance)
    scrapeIntervalRef.current = setInterval(() => {
      const currentState = useRadioStore.getState();
      const hasEnabledStations = currentState.stations.some(s => s.enabled && s.scrapeUrl);
      if (hasEnabledStations) {
        scrapeAllStations();
      }
    }, 5 * 60 * 1000);

    // Initial scrape
    if (enabledStations > 0) {
      scrapeAllStations();
    }

    // NOTE: Grade builder runs its own intervals via useAutoGradeBuilder hook

    console.log('[GLOBAL-SVC] ✅ Todos os serviços automáticos iniciados com sucesso!');
    console.log('[GLOBAL-SVC] 💡 Sistema funcionando em segundo plano - nenhuma intervenção necessária');

    return () => {
      console.log('[GLOBAL-SVC] 🛑 Parando todos os serviços globais');
      if (downloadIntervalRef.current) clearInterval(downloadIntervalRef.current);
      if (scrapeIntervalRef.current) clearInterval(scrapeIntervalRef.current);
      isGlobalServicesRunning = false;
      isInitializedRef.current = false;
    };
  }, [checkNewMissingSongs, scrapeAllStations]);

  // Watch for reset signal
  useEffect(() => {
    const unsubscribe = useAutoDownloadStore.subscribe((state, prevState) => {
      if (state.resetCounter > prevState.resetCounter) {
        console.log('[GLOBAL-SVC] 🔄 Reset signal received, clearing queue and refs');
        downloadQueueRef.current = [];
        processedSongsRef.current.clear();
        isProcessingRef.current = false;
        songsVerifiedRef.current = 0;
        setDownloadState(prev => ({ ...prev, queueLength: 0, isProcessing: false, songsVerified: 0 }));
      }
    });

    return () => unsubscribe();
  }, []);

  const contextValue: GlobalServicesContextType = {
    gradeBuilder,
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

// Default values for when context is not available (defensive programming)
const defaultGradeBuilderValues = {
  isBuilding: false,
  currentProgress: { processed: 0, total: 0, currentArtist: '', currentTitle: '' },
  lastBuildResult: null,
  lastSaveTime: null,
  minutesBeforeBlock: 10,
  setMinutesBeforeBlock: () => {},
  buildCurrentBlock: async () => ({}),
  isEnabled: true,
  setIsEnabled: () => {},
};

const defaultContextValue: GlobalServicesContextType = {
  gradeBuilder: defaultGradeBuilderValues as any,
  scraping: {
    stats: {
      lastScrape: null,
      successCount: 0,
      errorCount: 0,
      totalSongs: 0,
      isRunning: false,
      currentStation: null,
      failedStations: [],
    },
    scrapeAllStations: async () => ({ successCount: 0, errorCount: 0, newSongsCount: 0 }),
    isRunning: false,
  },
  downloads: {
    queueLength: 0,
    isProcessing: false,
    backendConnected: false,
    songsVerified: 0,
  },
};

export function useGlobalServices() {
  const context = useContext(GlobalServicesContext);
  // Return default values if context is not available (defensive - prevents app crash)
  if (!context) {
    console.warn('[useGlobalServices] Context not available, using defaults');
    return defaultContextValue;
  }
  return context;
}
