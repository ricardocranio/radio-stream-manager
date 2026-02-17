/**
 * Global Services Context
 * 
 * Thin orchestrator that composes all background service hooks.
 * Each service is independently managed in its own hook for modularity.
 * 
 * Services:
 * - Auto Grade Builder (via useAutoGradeBuilder)
 * - Auto Scraping (via useGlobalScrapingService)
 * - Auto Download (via useGlobalDownloadService)
 * - Captured Songs Download (via useCapturedDownloadService)
 * - Voz do Brasil (via useVozBrasilService)
 * - Background Cache Cleanup (via useBackgroundCacheCleanup)
 */

import React, { createContext, useContext, useEffect, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { useAutoGradeBuilder } from '@/hooks/useAutoGradeBuilder';
import { useBackgroundCacheCleanup } from '@/hooks/useBackgroundCacheCleanup';
import { useGlobalDownloadService, DownloadServiceState } from '@/hooks/useGlobalDownloadService';
import { useGlobalScrapingService, ScrapeStats } from '@/hooks/useGlobalScrapingService';
import { useCapturedDownloadService } from '@/hooks/useCapturedDownloadService';
import { useVozBrasilService } from '@/hooks/useVozBrasilService';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// The gradeBuilder object returned by useAutoGradeBuilder
type GradeBuilderType = ReturnType<typeof useAutoGradeBuilder>;

interface GlobalServicesContextType {
  gradeBuilder: GradeBuilderType;
  scraping: {
    stats: ScrapeStats;
    scrapeAllStations: (forceRefresh?: boolean) => Promise<{ successCount: number; errorCount: number; newSongsCount: number }>;
    isRunning: boolean;
  };
  downloads: DownloadServiceState;
}

const GlobalServicesContext = createContext<GlobalServicesContextType | null>(null);

let isGlobalServicesRunning = false;

export function GlobalServicesProvider({ children }: { children: React.ReactNode }) {
  const isInitializedRef = useRef(false);

  // ============= COMPOSE HOOKS =============
  const gradeBuilder = useAutoGradeBuilder();
  useBackgroundCacheCleanup();
  
  const downloadService = useGlobalDownloadService();
  const scrapingService = useGlobalScrapingService(
    downloadService.processedSongsRef,
    downloadService.downloadQueueRef,
  );
  const capturedDownloadService = useCapturedDownloadService();
  const vozBrasilService = useVozBrasilService();

  // ============= INITIALIZATION (runs once) =============
  useEffect(() => {
    if (isGlobalServicesRunning || isInitializedRef.current) {
      console.log('[GLOBAL-SVC] Already running, skipping');
      return;
    }

    isGlobalServicesRunning = true;
    isInitializedRef.current = true;
    
    const state = useRadioStore.getState();
    const { deezerConfig, stations, config } = state;
    const enabledStations = stations.filter(s => s.enabled && s.scrapeUrl).length;
    
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     🚀 SISTEMA AUTOMATIZADO - INICIANDO TODOS OS SERVIÇOS    ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║ 📡 Scraping:      ${enabledStations > 0 ? `✅ ATIVO (${enabledStations} emissoras) - 15 min` : '⚠️ Sem emissoras'}`.padEnd(65) + '║');
    console.log(`║ 🎵 Grade Builder: ✅ ATIVO (${gradeBuilder.minutesBeforeBlock || 10} min antes de cada bloco)`.padEnd(65) + '║');
    console.log(`║ 📥 Downloads:     ${deezerConfig.autoDownload ? '✅ IMEDIATO (5s entre cada)' : '⏸️ MANUAL (ativar em Config)'}`.padEnd(65) + '║');
    console.log(`║ 💾 Banco Musical: ${config.musicFolders?.length > 0 ? `✅ ${config.musicFolders.length} pastas` : '⚠️ Configurar pastas'}`.padEnd(65) + '║');
    console.log(`║ 📊 Stats:         ✅ ATIVO - refresh 10 min`.padEnd(65) + '║');
    console.log(`║ 🔄 Sync Cloud:    ✅ ATIVO (Realtime)`.padEnd(65) + '║');
    console.log(`║ 🕐 Reset Diário:  ✅ ATIVO (20:00)`.padEnd(65) + '║');
    console.log(`║ 📻 Voz do Brasil: ✅ ATIVO (Seg-Sex 20:35)`.padEnd(65) + '║');
    console.log(`║ 📥 Capturadas DL: ✅ AUTOMÁTICO (2 min polling)`.padEnd(65) + '║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    // Start all services
    const cleanupDownload = downloadService.start();
    const cleanupCapturedDl = capturedDownloadService.start();
    const cleanupScraping = scrapingService.start();
    const cleanupVozBrasil = vozBrasilService.start();

    console.log('[GLOBAL-SVC] ✅ Todos os serviços iniciados!');

    return () => {
      console.log('[GLOBAL-SVC] 🛑 Parando todos os serviços');
      cleanupDownload();
      cleanupCapturedDl();
      cleanupScraping();
      cleanupVozBrasil();
      isGlobalServicesRunning = false;
      isInitializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run ONCE on mount

  const contextValue: GlobalServicesContextType = {
    gradeBuilder,
    scraping: {
      stats: scrapingService.stats,
      scrapeAllStations: scrapingService.scrapeAllStations,
      isRunning: scrapingService.isRunning,
    },
    downloads: downloadService.state,
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
