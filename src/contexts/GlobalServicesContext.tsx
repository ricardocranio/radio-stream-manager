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
        stationName: song.station, // Pass station for subfolder organization
      });

      const duration = Date.now() - startTime;

      if (result?.success) {
        // Handle both downloaded and skipped (already exists) cases
        if (result.skipped) {
          console.log(`[GLOBAL-SVC] ⏭️ Skipped (already exists): ${song.artist} - ${song.title} in ${result.existingStation || 'main folder'}`);
        }
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
    const { stations, addCapturedSong, addOrUpdateRankingSong, addMissingSong, missingSongs, config } = useRadioStore.getState();
    const enabledStations = stations.filter(s => s.enabled && s.scrapeUrl);
    
    if (enabledStations.length === 0) {
      console.log('[GLOBAL-SVC] No enabled stations with scrape URLs');
      return { successCount: 0, errorCount: 0, newSongsCount: 0, missingCount: 0 };
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
    let missingCount = 0;
    const failedStations: string[] = [];

    // Helper to check if song is already in missing list
    const isSongAlreadyMissing = (artist: string, title: string): boolean => {
      const normalizedArtist = artist.toLowerCase().trim();
      const normalizedTitle = title.toLowerCase().trim();
      return missingSongs.some(
        s => s.artist.toLowerCase().trim() === normalizedArtist && 
             s.title.toLowerCase().trim() === normalizedTitle
      );
    };

    // Helper to process a single song (check library, add to missing if needed)
    const processSong = async (
      songTitle: string,
      songArtist: string,
      stationName: string,
      stationStyle: string,
      scrapeUrl: string,
      timestamp: Date = new Date()
    ) => {
      // Skip if already in missing list
      const alreadyMissing = isSongAlreadyMissing(songArtist, songTitle);
      
      // Check if song exists in library (only in Electron)
      let existsInLibrary = false;
      if (isElectron && config.musicFolders?.length > 0) {
        try {
          const result = await checkSongInLibrary(
            songArtist,
            songTitle,
            config.musicFolders,
            config.similarityThreshold || 0.75
          );
          existsInLibrary = result.exists;
        } catch (error) {
          // If check fails, assume not in library to trigger download
          console.error('[GLOBAL-SVC] Library check failed:', error);
        }
      }

      const songId = `${stationName}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Add to captured songs
      addCapturedSong({
        id: songId,
        title: songTitle,
        artist: songArtist,
        station: stationName,
        timestamp,
        status: existsInLibrary ? 'found' : 'missing',
        source: scrapeUrl,
      });
      
      // Update ranking
      addOrUpdateRankingSong(songTitle, songArtist, stationStyle);
      
      // If missing and not already in list, add to missing songs for download
      if (!existsInLibrary && !alreadyMissing && isElectron) {
        addMissingSong({
          id: songId,
          title: songTitle,
          artist: songArtist,
          station: stationName,
          timestamp: new Date(),
          status: 'missing',
        });
        return { isNew: true, isMissing: true };
      }
      
      return { isNew: true, isMissing: false };
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
          
          // Process now playing song
          if (nowPlaying) {
            const { isMissing } = await processSong(
              nowPlaying.title,
              nowPlaying.artist,
              stationName,
              stationStyle,
              scrapeUrl
            );
            newSongsCount++;
            if (isMissing) missingCount++;
          }

          // Process recent songs (limit to 3)
          for (const song of (recentSongs || []).slice(0, 3)) {
            const { isMissing } = await processSong(
              song.title,
              song.artist,
              stationName,
              stationStyle,
              scrapeUrl,
              new Date(song.timestamp)
            );
            newSongsCount++;
            if (isMissing) missingCount++;
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
      const missingInfo = missingCount > 0 ? ` | ${missingCount} faltando` : '';
      console.log(`[GLOBAL-SVC] 📡 Scrape complete: ${successCount}✓ ${errorCount}✗ ${newSongsCount} songs${missingInfo}`);
    }

    return { successCount, errorCount, newSongsCount, missingCount };
  }, [scrapeStation]);

  // ============= VOZ DO BRASIL SERVICE =============
  
  // Cleanup old files before downloading new one
  const cleanupOldVozBrasil = useCallback(async (folder: string): Promise<void> => {
    if (!isElectron || !window.electronAPI?.cleanupVozBrasil) {
      return;
    }
    
    try {
      console.log('[VOZ-SVC] 🗑️ Limpando arquivos antigos...');
      const result = await window.electronAPI.cleanupVozBrasil({
        folder,
        maxAgeDays: 1, // Delete files older than 1 day to ensure only today's file remains
      });
      
      if (result.success && result.deletedCount && result.deletedCount > 0) {
        console.log(`[VOZ-SVC] 🗑️ Removidos ${result.deletedCount} arquivo(s) antigo(s)`);
      }
    } catch (error) {
      console.log('[VOZ-SVC] ⚠️ Erro na limpeza (continuando):', error);
    }
  }, []);
  
  const downloadVozBrasil = useCallback(async (): Promise<boolean> => {
    if (!isElectron || !window.electronAPI?.downloadVozBrasil) {
      console.log('[VOZ-SVC] ⚠️ Electron API não disponível');
      return false;
    }

    // Get config from localStorage with proper defaults
    let config = {
      enabled: true,
      downloadFolder: 'C:\\Playlist\\A Voz do Brasil',
    };
    
    try {
      const savedConfig = localStorage.getItem('vozBrasilConfig');
      if (savedConfig) {
        config = { ...config, ...JSON.parse(savedConfig) };
      }
    } catch (e) {
      console.log('[VOZ-SVC] Usando config padrão');
    }

    if (!config.enabled) {
      console.log('[VOZ-SVC] ⚠️ Voz do Brasil desabilitada nas configurações');
      return false;
    }

    // Clean up old files first
    await cleanupOldVozBrasil(config.downloadFolder);

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
  }, [cleanupOldVozBrasil]);

  const scheduleVozBrasil = useCallback(() => {
    if (!isElectron || !window.electronAPI?.downloadVozBrasil) {
      console.log('[VOZ-SVC] ⚠️ Electron API não disponível para agendamento');
      return;
    }

    // Get config from localStorage with proper defaults
    let config = {
      enabled: true,
      scheduleTime: '20:35',
      downloadFolder: 'C:\\Playlist\\A Voz do Brasil',
    };
    
    try {
      const savedConfig = localStorage.getItem('vozBrasilConfig');
      if (savedConfig) {
        config = { ...config, ...JSON.parse(savedConfig) };
      }
    } catch (e) {
      console.log('[VOZ-SVC] Erro ao ler config, usando padrões');
    }

    if (!config.enabled) {
      console.log('[VOZ-SVC] Agendamento desabilitado nas configurações');
      return;
    }

    const isWeekday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;
    
    const getNextDownloadTime = () => {
      const now = new Date();
      const timeParts = (config.scheduleTime || '20:35').split(':');
      const scheduleHour = parseInt(timeParts[0], 10) || 20;
      const scheduleMinute = parseInt(timeParts[1], 10) || 35;
      
      const nextDl = new Date(now);
      nextDl.setHours(scheduleHour, scheduleMinute, 0, 0);
      
      // If time has passed or it's weekend, move to next weekday
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
      vozBrasilSchedulerRef.current = null;
    }

    // Schedule the download - handle both short and long timeouts
    // For very long waits (>12h), use a recurring check every hour instead
    const maxTimeout = 12 * 60 * 60 * 1000; // 12 hours
    
    if (msUntilDownload <= 0) {
      // Already past the scheduled time - check if we should download now (weekday)
      if (isWeekday(now)) {
        console.log('[VOZ-SVC] 📻 Horário já passou, verificando se deve baixar agora...');
        // Only download if within 30 minutes of scheduled time
        const timeParts = (config.scheduleTime || '20:35').split(':');
        const scheduleHour = parseInt(timeParts[0], 10) || 20;
        const scheduleMinute = parseInt(timeParts[1], 10) || 35;
        const scheduledToday = new Date(now);
        scheduledToday.setHours(scheduleHour, scheduleMinute, 0, 0);
        const msSinceSchedule = now.getTime() - scheduledToday.getTime();
        
        if (msSinceSchedule >= 0 && msSinceSchedule <= 30 * 60 * 1000) {
          console.log('[VOZ-SVC] 📻 Dentro da janela de 30 min, executando download...');
          downloadVozBrasil();
        }
      }
      // Schedule for next occurrence
      setTimeout(scheduleVozBrasil, 60000);
      return;
    }
    
    if (msUntilDownload > maxTimeout) {
      // Very long wait - reschedule check in 1 hour
      console.log('[VOZ-SVC] ⏰ Agendamento distante, verificando novamente em 1 hora');
      vozBrasilSchedulerRef.current = setTimeout(scheduleVozBrasil, 60 * 60 * 1000);
      return;
    }

    // Schedule the actual download
    vozBrasilSchedulerRef.current = setTimeout(async () => {
      console.log('[VOZ-SVC] ⏰ Horário de download atingido!');
      
      // Re-check config in case it changed
      let currentConfig = { enabled: true };
      try {
        const saved = localStorage.getItem('vozBrasilConfig');
        if (saved) currentConfig = JSON.parse(saved);
      } catch (e) { /* use default */ }
      
      const currentDay = new Date().getDay();
      
      if (currentConfig.enabled && currentDay >= 1 && currentDay <= 5) {
        console.log('[VOZ-SVC] 📻 Executando download automático...');
        const success = await downloadVozBrasil();
        if (success) {
          console.log('[VOZ-SVC] ✅ Download da Voz do Brasil concluído!');
        } else {
          console.log('[VOZ-SVC] ⚠️ Download falhou, tentará novamente no próximo horário');
        }
      } else {
        console.log('[VOZ-SVC] Download pulado (fim de semana ou desabilitado)');
      }
      
      // Schedule next download after a brief delay
      setTimeout(scheduleVozBrasil, 60000);
    }, msUntilDownload);
    
    console.log(`[VOZ-SVC] ✅ Agendamento configurado com sucesso`);
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

    // 0. Initialize station folders (create subfolder for each enabled station)
    if (isElectron && deezerConfig.downloadFolder && enabledStations > 0) {
      const stationNames = stations.filter(s => s.enabled).map(s => s.name);
      window.electronAPI?.ensureStationFolders?.({
        baseFolder: deezerConfig.downloadFolder,
        stations: stationNames,
      }).then(result => {
        if (result?.success && result.created.length > 0) {
          console.log(`[GLOBAL-SVC] 📁 Criadas ${result.created.length} pastas de estações`);
        }
      }).catch(err => {
        console.error('[GLOBAL-SVC] Erro ao criar pastas de estações:', err);
      });
    }

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
