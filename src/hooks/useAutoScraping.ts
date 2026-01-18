import { useEffect, useRef, useCallback, useState } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { radioScraperApi } from '@/lib/api/radioScraper';
import { useToast } from '@/hooks/use-toast';

export interface AutoScrapingConfig {
  enabled: boolean;
  intervalMinutes: number;
  batchSize: number;
  retryFailedStations: boolean;
}

export interface ScrapeStats {
  lastScrape: Date | null;
  successCount: number;
  errorCount: number;
  totalSongs: number;
  isRunning: boolean;
  currentStation: string | null;
  failedStations: string[];
}

const DEFAULT_CONFIG: AutoScrapingConfig = {
  enabled: false,
  intervalMinutes: 3,
  batchSize: 3,
  retryFailedStations: true,
};

export function useAutoScraping() {
  const { stations, addCapturedSong, config } = useRadioStore();
  const { toast } = useToast();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [scrapeConfig, setScrapeConfig] = useState<AutoScrapingConfig>(DEFAULT_CONFIG);
  const [stats, setStats] = useState<ScrapeStats>({
    lastScrape: null,
    successCount: 0,
    errorCount: 0,
    totalSongs: 0,
    isRunning: false,
    currentStation: null,
    failedStations: [],
  });

  const scrapeStation = useCallback(async (stationName: string, scrapeUrl: string) => {
    setStats(prev => ({ ...prev, currentStation: stationName }));
    
    try {
      const result = await radioScraperApi.scrapeStation(stationName, scrapeUrl);
      
      if (result.success && result.nowPlaying) {
        return {
          success: true,
          stationName,
          nowPlaying: result.nowPlaying,
          recentSongs: result.recentSongs || [],
        };
      }
      
      return { success: false, stationName, error: result.error };
    } catch (error) {
      console.error(`[AutoScraping] Error scraping ${stationName}:`, error);
      return { success: false, stationName, error: String(error) };
    }
  }, []);

  const scrapeAllStations = useCallback(async (forceRefresh = false) => {
    const enabledStations = stations.filter(s => s.enabled && s.scrapeUrl);
    
    if (enabledStations.length === 0) {
      console.log('[AutoScraping] No enabled stations with scrape URLs');
      return { successCount: 0, errorCount: 0, newSongsCount: 0 };
    }

    console.log(`[AutoScraping] Starting scrape of ${enabledStations.length} stations...`);
    
    setStats(prev => ({
      ...prev,
      isRunning: true,
      lastScrape: new Date(),
      failedStations: [],
    }));

    let successCount = 0;
    let errorCount = 0;
    let newSongsCount = 0;
    const failedStations: string[] = [];

    // Process stations in batches for better performance
    const batchSize = scrapeConfig.batchSize;
    for (let i = 0; i < enabledStations.length; i += batchSize) {
      const batch = enabledStations.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(station => scrapeStation(station.name, station.scrapeUrl))
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.success) {
          successCount++;
          const { stationName, nowPlaying, recentSongs } = result.value;
          
          // Add now playing song
          if (nowPlaying) {
            addCapturedSong({
              id: `${stationName}-${Date.now()}`,
              title: nowPlaying.title,
              artist: nowPlaying.artist,
              station: stationName,
              timestamp: new Date(),
              status: 'found',
            });
            newSongsCount++;
          }

          // Add recent songs (limit to 3)
          for (const song of (recentSongs || []).slice(0, 3)) {
            addCapturedSong({
              id: `${stationName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              title: song.title,
              artist: song.artist,
              station: stationName,
              timestamp: new Date(song.timestamp),
              status: 'found',
            });
            newSongsCount++;
          }
        } else {
          errorCount++;
          const stationName = result.status === 'fulfilled' 
            ? result.value.stationName 
            : batch[batchResults.indexOf(result)]?.name;
          if (stationName) {
            failedStations.push(stationName);
          }
        }
      }

      // Small delay between batches
      if (i + batchSize < enabledStations.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Retry failed stations if enabled
    if (scrapeConfig.retryFailedStations && failedStations.length > 0) {
      console.log(`[AutoScraping] Retrying ${failedStations.length} failed stations...`);
      
      for (const stationName of failedStations) {
        const station = enabledStations.find(s => s.name === stationName);
        if (station) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
          const retryResult = await scrapeStation(station.name, station.scrapeUrl);
          
          if (retryResult.success && retryResult.nowPlaying) {
            successCount++;
            errorCount--;
            
            addCapturedSong({
              id: `${station.name}-${Date.now()}-retry`,
              title: retryResult.nowPlaying.title,
              artist: retryResult.nowPlaying.artist,
              station: station.name,
              timestamp: new Date(),
              status: 'found',
            });
            newSongsCount++;
            
            // Remove from failed list
            const idx = failedStations.indexOf(stationName);
            if (idx > -1) failedStations.splice(idx, 1);
          }
        }
      }
    }

    setStats(prev => ({
      ...prev,
      isRunning: false,
      currentStation: null,
      successCount: prev.successCount + successCount,
      errorCount: prev.errorCount + errorCount,
      totalSongs: prev.totalSongs + newSongsCount,
      failedStations,
    }));

    console.log(`[AutoScraping] Complete: ${successCount} success, ${errorCount} errors, ${newSongsCount} songs captured`);

    // Show notification
    if (newSongsCount > 0) {
      toast({
        title: '🎵 Músicas Atualizadas',
        description: `${newSongsCount} músicas de ${successCount} emissoras.${errorCount > 0 ? ` (${errorCount} falhas)` : ''}`,
      });
    } else if (errorCount > 0 && successCount === 0) {
      toast({
        title: '⚠️ Falha no Scraping',
        description: `Não foi possível atualizar as emissoras. Tente novamente.`,
        variant: 'destructive',
      });
    }

    return { successCount, errorCount, newSongsCount };
  }, [stations, addCapturedSong, toast, scrapeStation, scrapeConfig]);

  const startAutoScraping = useCallback((intervalMinutes: number = 3) => {
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    setScrapeConfig(prev => ({ ...prev, enabled: true, intervalMinutes }));
    console.log(`[AutoScraping] Starting auto-scraping every ${intervalMinutes} minutes`);

    // Run immediately
    scrapeAllStations();

    // Set up interval
    intervalRef.current = setInterval(() => {
      scrapeAllStations();
    }, intervalMinutes * 60 * 1000);
  }, [scrapeAllStations]);

  const stopAutoScraping = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setScrapeConfig(prev => ({ ...prev, enabled: false }));
    setStats(prev => ({ ...prev, isRunning: false, currentStation: null }));
    console.log('[AutoScraping] Stopped auto-scraping');
  }, []);

  const updateConfig = useCallback((newConfig: Partial<AutoScrapingConfig>) => {
    setScrapeConfig(prev => {
      const updated = { ...prev, ...newConfig };
      
      // Restart interval if it's running and interval changed
      if (prev.enabled && newConfig.intervalMinutes && newConfig.intervalMinutes !== prev.intervalMinutes) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = setInterval(() => {
          scrapeAllStations();
        }, updated.intervalMinutes * 60 * 1000);
      }
      
      return updated;
    });
  }, [scrapeAllStations]);

  const resetStats = useCallback(() => {
    setStats({
      lastScrape: null,
      successCount: 0,
      errorCount: 0,
      totalSongs: 0,
      isRunning: false,
      currentStation: null,
      failedStations: [],
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    scrapeAllStations,
    scrapeStation,
    startAutoScraping,
    stopAutoScraping,
    updateConfig,
    resetStats,
    config: scrapeConfig,
    stats,
    isRunning: stats.isRunning,
  };
}
