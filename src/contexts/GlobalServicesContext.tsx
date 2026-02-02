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

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

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
  
  // Voz do Brasil
  const vozBrasilSchedulerRef = useRef<NodeJS.Timeout | null>(null);
  
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

      // Small delay between downloads to avoid overwhelming the API (5 seconds)
      // Previously waited the full interval - now downloads are IMMEDIATE
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    isProcessingRef.current = false;
    setDownloadState(prev => ({ ...prev, isProcessing: false }));
    useAutoDownloadStore.getState().setIsProcessing(false);
  }, [downloadSong]);

  // Track last log time to avoid spamming console
  const lastLogTimeRef = useRef<number>(0);
  const lastQueueSizeRef = useRef<number>(0);

  const checkNewMissingSongs = useCallback(() => {
    const state = useRadioStore.getState();
    const { deezerConfig, missingSongs } = state;

    // Count songs with 'missing' status (verified as not in music library)
    const pendingMissing = missingSongs.filter(s => s.status === 'missing');
    const newToQueue = pendingMissing.filter(s => !processedSongsRef.current.has(s.id));

    // Only log every 5 minutes OR when queue size changes significantly
    const now = Date.now();
    const shouldLog = (now - lastLogTimeRef.current > 300000) || 
                      (newToQueue.length > 0) ||
                      (Math.abs(pendingMissing.length - lastQueueSizeRef.current) >= 5);
    
    if (shouldLog && pendingMissing.length > 0) {
      console.log(`[GLOBAL-SVC] 🎵 Fila: ${pendingMissing.length} faltando | ${newToQueue.length} novas`);
      lastLogTimeRef.current = now;
      lastQueueSizeRef.current = pendingMissing.length;
    }

    // Check if auto-download is configured - only log once when there are new songs
    if (!deezerConfig.autoDownload || !deezerConfig.enabled || !deezerConfig.arl) {
      return;
    }

    // Add new songs to queue (only songs verified as missing from music library)
    if (newToQueue.length > 0) {
      for (const song of newToQueue) {
        processedSongsRef.current.add(song.id);
        downloadQueueRef.current.push({ song, retryCount: 0 });
      }
      
      console.log(`[GLOBAL-SVC] 📥 +${newToQueue.length} músicas na fila (total: ${downloadQueueRef.current.length})`);
      setDownloadState(prev => ({ ...prev, queueLength: downloadQueueRef.current.length }));
      useAutoDownloadStore.getState().setQueueLength(downloadQueueRef.current.length);
      
      // IMMEDIATELY start processing - don't wait for next interval
      if (!isProcessingRef.current) {
        processDownloadQueue();
      }
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
              id: `${stationName}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
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

  // ============= VOZ DO BRASIL SERVICE =============
  const downloadVozBrasil = useCallback(async (): Promise<boolean> => {
    if (!isElectron || !window.electronAPI?.downloadVozBrasil) {
      console.log('[VOZ-SVC] ⚠️ Electron API não disponível');
      return false;
    }

    // Get config from localStorage
    const savedConfig = localStorage.getItem('vozBrasilConfig');
    const config = savedConfig ? JSON.parse(savedConfig) : {
      enabled: true,
      downloadFolder: 'C:\\Playlist\\A Voz do Brasil',
    };

    if (!config.enabled) {
      console.log('[VOZ-SVC] ⚠️ Voz do Brasil desabilitada nas configurações');
      return false;
    }

    // Generate URLs with fallback
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    
    const urls = [
      `https://radiogov.ebc.com.br/programas/a-voz-do-brasil-download/${day}-${month}-${year}/@@download/file`,
      `https://radiogov.ebc.com.br/sites/default/files/vozbrasil/${year}/${month}/voz_${day}${month}${year}.mp3`,
      `https://radiogov.ebc.com.br/sites/default/files/vozbrasil/${year}/${month}/vozbrasil_${day}${month}${year}.mp3`,
      `https://conteudo.ebcservicos.com.br/25-streaming-ebc/a-voz-do-brasil/VozDoBrasil_${day}-${month}-${year}.mp3`,
    ];
    
    const filename = `VozDoBrasil_${day}-${month}-${year}.mp3`;

    console.log('[VOZ-SVC] 📻 Iniciando download automático da Voz do Brasil...');
    console.log(`[VOZ-SVC] Tentando ${urls.length} URLs de fallback`);

    // Try each URL until one works
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`[VOZ-SVC] Tentativa ${i + 1}/${urls.length}: ${url}`);
      
      try {
        const result = await window.electronAPI.downloadVozBrasil({
          url,
          outputFolder: config.downloadFolder,
          filename,
        });
        
        if (result.success) {
          console.log(`[VOZ-SVC] ✅ Download concluído com sucesso! Arquivo: ${filename}`);
          return true;
        } else {
          console.log(`[VOZ-SVC] URL ${i + 1} falhou: ${result.error}`);
        }
      } catch (err) {
        console.log(`[VOZ-SVC] URL ${i + 1} erro: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
      }
    }

    console.log('[VOZ-SVC] ❌ Todas as URLs falharam');
    return false;
  }, []);

  const scheduleVozBrasil = useCallback(() => {
    if (!isElectron || !window.electronAPI?.downloadVozBrasil) {
      return;
    }

    // Get config from localStorage
    const savedConfig = localStorage.getItem('vozBrasilConfig');
    const config = savedConfig ? JSON.parse(savedConfig) : {
      enabled: true,
      scheduleTime: '20:35',
    };

    if (!config.enabled) {
      console.log('[VOZ-SVC] Agendamento desabilitado');
      return;
    }

    const isWeekday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;
    
    const getNextDownloadTime = () => {
      const now = new Date();
      const [scheduleHour, scheduleMinute] = (config.scheduleTime || '20:35').split(':').map(Number);
      
      const nextDl = new Date(now);
      nextDl.setHours(scheduleHour, scheduleMinute, 0, 0);
      
      if (nextDl <= now || !isWeekday(nextDl)) {
        nextDl.setDate(nextDl.getDate() + 1);
        while (!isWeekday(nextDl)) {
          nextDl.setDate(nextDl.getDate() + 1);
        }
      }
      
      return nextDl;
    };

    const now = new Date();
    const nextDl = getNextDownloadTime();
    const msUntilDownload = nextDl.getTime() - now.getTime();
    
    console.log(`[VOZ-SVC] 📻 Próximo download agendado para: ${nextDl.toLocaleString('pt-BR')}`);
    console.log(`[VOZ-SVC] ⏰ Tempo restante: ${Math.round(msUntilDownload / 60000)} minutos`);

    // Clear existing scheduler
    if (vozBrasilSchedulerRef.current) {
      clearTimeout(vozBrasilSchedulerRef.current);
    }

    // Schedule the download (only if within 24h)
    if (msUntilDownload > 0 && msUntilDownload < 86400000) {
      vozBrasilSchedulerRef.current = setTimeout(async () => {
        console.log('[VOZ-SVC] ⏰ Horário de download atingido!');
        
        // Check again if it's a weekday and enabled
        const currentDay = new Date().getDay();
        const currentConfig = JSON.parse(localStorage.getItem('vozBrasilConfig') || '{"enabled":true}');
        
        if (currentConfig.enabled && currentDay >= 1 && currentDay <= 5) {
          console.log('[VOZ-SVC] 📻 Executando download automático...');
          await downloadVozBrasil();
        } else {
          console.log('[VOZ-SVC] Download pulado (fim de semana ou desabilitado)');
        }
        
        // Schedule next download after a brief delay
        setTimeout(scheduleVozBrasil, 60000);
      }, msUntilDownload);
    }
  }, [downloadVozBrasil]);

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
    console.log(`║ 📻 Voz do Brasil: ✅ ATIVO (Seg-Sex 20:35)`.padEnd(65) + '║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    // 1. Download check every 30 seconds (was 10s - optimized for less CPU)
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

    // 3. Voz do Brasil scheduled download (Mon-Fri 20:35)
    scheduleVozBrasil();

    console.log('[GLOBAL-SVC] ✅ Todos os serviços automáticos iniciados com sucesso!');
    console.log('[GLOBAL-SVC] 💡 Sistema funcionando em segundo plano - nenhuma intervenção necessária');

    return () => {
      console.log('[GLOBAL-SVC] 🛑 Parando todos os serviços globais');
      if (downloadIntervalRef.current) clearInterval(downloadIntervalRef.current);
      if (scrapeIntervalRef.current) clearInterval(scrapeIntervalRef.current);
      if (vozBrasilSchedulerRef.current) clearTimeout(vozBrasilSchedulerRef.current);
      isGlobalServicesRunning = false;
      isInitializedRef.current = false;
    };
  }, [checkNewMissingSongs, scrapeAllStations, scheduleVozBrasil]);

  // Watch for reset signal
  useEffect(() => {
    const unsubscribe = useAutoDownloadStore.subscribe((state, prevState) => {
      if (state.resetCounter > prevState.resetCounter) {
        console.log('[GLOBAL-SVC] 🔄 Reset signal received, clearing queue and refs');
        downloadQueueRef.current = [];
        processedSongsRef.current.clear();
        isProcessingRef.current = false;
        setDownloadState({ queueLength: 0, isProcessing: false });
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

export function useGlobalServices() {
  const context = useContext(GlobalServicesContext);
  if (!context) {
    throw new Error('useGlobalServices must be used within a GlobalServicesProvider');
  }
  return context;
}
