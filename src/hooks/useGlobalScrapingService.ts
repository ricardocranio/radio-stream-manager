/**
 * Global Scraping Service Hook
 * 
 * Manages automatic radio station scraping.
 * Extracted from GlobalServicesContext for modularity.
 */

import { useRef, useCallback, useState } from 'react';
import { useRadioStore, MissingSong } from '@/store/radioStore';
import { radioScraperApi } from '@/lib/api/radioScraper';
import { checkSongInLibrary } from '@/hooks/useCheckMusicLibrary';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// Auto-recovery: track consecutive failures per station
const stationFailureMap = new Map<string, { count: number; pausedUntil: number }>();
const MAX_CONSECUTIVE_FAILURES = 3;
const PAUSE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export interface ScrapeStats {
  lastScrape: Date | null;
  successCount: number;
  errorCount: number;
  totalSongs: number;
  isRunning: boolean;
  currentStation: string | null;
  failedStations: string[];
  pausedStations: string[];
}

export function useGlobalScrapingService(
  processedSongsRef: React.MutableRefObject<Set<string>>,
  downloadQueueRef: React.MutableRefObject<{ song: MissingSong; retryCount: number }[]>,
) {
  const scrapeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [scrapeStats, setScrapeStats] = useState<ScrapeStats>({
    lastScrape: null,
    successCount: 0,
    errorCount: 0,
    totalSongs: 0,
    isRunning: false,
    currentStation: null,
    failedStations: [],
    pausedStations: [],
  });

  const scrapeStation = useCallback(async (stationName: string, scrapeUrl: string, streamUrl?: string) => {
    setScrapeStats(prev => ({ ...prev, currentStation: stationName }));
    
    try {
      const result = await radioScraperApi.scrapeStation(stationName, scrapeUrl, { streamUrl });
      
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
      console.error(`[SCRAPE-SVC] Error scraping ${stationName}:`, error);
      return { success: false, stationName, scrapeUrl, error: String(error) };
    }
  }, []);

  const scrapeAllStations = useCallback(async (_forceRefresh = false) => {
    const { reportServiceHeartbeat: rsh } = await import('@/hooks/useServiceWatchdog');
    rsh('scraping');
    const { stations, addCapturedSong, addMissingSong, missingSongs, config } = useRadioStore.getState();
    const now = Date.now();
    
    // Auto-recovery: filter out paused stations and unpause expired ones
    const pausedStationNames: string[] = [];
    for (const [name, info] of stationFailureMap.entries()) {
      if (info.pausedUntil > now) {
        pausedStationNames.push(name);
      } else if (info.pausedUntil > 0 && info.pausedUntil <= now) {
        // Unpause: reset failure count, give another chance
        console.log(`[SCRAPE-SVC] 🔄 Auto-recovery: ${name} retomando após pausa`);
        stationFailureMap.set(name, { count: 0, pausedUntil: 0 });
      }
    }

    const enabledStations = stations.filter(s => 
      s.enabled && s.scrapeUrl && !pausedStationNames.includes(s.name)
    );
    
    if (enabledStations.length === 0) {
      console.log('[SCRAPE-SVC] No enabled stations (or all paused)');
      return { successCount: 0, errorCount: 0, newSongsCount: 0, missingCount: 0 };
    }

    if (pausedStationNames.length > 0) {
      console.log(`[SCRAPE-SVC] ⏸️ ${pausedStationNames.length} emissoras pausadas por falhas: ${pausedStationNames.join(', ')}`);
    }

    console.log(`[SCRAPE-SVC] 📡 Scraping ${enabledStations.length} stations...`);
    
    setScrapeStats(prev => ({
      ...prev,
      isRunning: true,
      lastScrape: new Date(),
      failedStations: [],
      pausedStations: pausedStationNames,
    }));

    let successCount = 0;
    let errorCount = 0;
    let newSongsCount = 0;
    let missingCount = 0;
    const failedStations: string[] = [];

    const isSongAlreadyMissing = (artist: string, title: string): boolean => {
      const normalizedArtist = artist.toLowerCase().trim();
      const normalizedTitle = title.toLowerCase().trim();
      const currentMissing = useRadioStore.getState().missingSongs;
      return currentMissing.some(
        s => s.artist.toLowerCase().trim() === normalizedArtist && 
             s.title.toLowerCase().trim() === normalizedTitle
      );
    };
    
    const isSongAlreadyProcessedForStation = (artist: string, title: string, stationName: string): boolean => {
      const key = `${stationName.toLowerCase().trim()}|${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`;
      return processedSongsRef.current.has(key);
    };
    
    const isSongContentAlreadyQueued = (artist: string, title: string): boolean => {
      const normalizedArtist = artist.toLowerCase().trim();
      const normalizedTitle = title.toLowerCase().trim();
      return downloadQueueRef.current.some(
        item => item.song.artist.toLowerCase().trim() === normalizedArtist &&
                item.song.title.toLowerCase().trim() === normalizedTitle
      );
    };

    const processSong = async (
      songTitle: string,
      songArtist: string,
      stationName: string,
      stationStyle: string,
      scrapeUrl: string,
      timestamp: Date = new Date()
    ) => {
      const alreadyProcessedForStation = isSongAlreadyProcessedForStation(songArtist, songTitle, stationName);
      if (alreadyProcessedForStation) {
        return { isNew: false, isMissing: false };
      }
      
      const processKey = `${stationName.toLowerCase().trim()}|${songArtist.toLowerCase().trim()}|${songTitle.toLowerCase().trim()}`;
      processedSongsRef.current.add(processKey);
      
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
          console.error('[SCRAPE-SVC] Library check failed:', error);
        }
      }

      const songId = `${stationName}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      addCapturedSong({
        id: songId,
        title: songTitle,
        artist: songArtist,
        station: stationName,
        timestamp,
        status: existsInLibrary ? 'found' : 'missing',
        source: scrapeUrl,
      });
      
      // Ranking is now fed exclusively by the Grade Builder (songs actually used in programming)
      
      const alreadyMissing = isSongAlreadyMissing(songArtist, songTitle);
      const alreadyQueued = isSongContentAlreadyQueued(songArtist, songTitle);
      
      if (!existsInLibrary && !alreadyMissing && !alreadyQueued && isElectron) {
        console.log(`[SCRAPE-SVC] 📥 Faltando: ${songArtist} - ${songTitle} (${stationName})`);
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
          
          // Auto-recovery: reset failure count on success
          if (stationFailureMap.has(stationName)) {
            stationFailureMap.set(stationName, { count: 0, pausedUntil: 0 });
          }
          
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
            
            // Auto-recovery: track consecutive failures
            const current = stationFailureMap.get(stationName) || { count: 0, pausedUntil: 0 };
            current.count++;
            if (current.count >= MAX_CONSECUTIVE_FAILURES) {
              current.pausedUntil = Date.now() + PAUSE_DURATION_MS;
              console.warn(`[SCRAPE-SVC] ⚠️ ${stationName}: ${current.count} falhas consecutivas → pausada por 30min`);
            }
            stationFailureMap.set(stationName, current);
          }
        }
      }

      if (i + batchSize < enabledStations.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const currentPausedStations = Array.from(stationFailureMap.entries())
      .filter(([_, info]) => info.pausedUntil > Date.now())
      .map(([name]) => name);

    setScrapeStats(prev => ({
      ...prev,
      isRunning: false,
      currentStation: null,
      successCount: prev.successCount + successCount,
      errorCount: prev.errorCount + errorCount,
      totalSongs: prev.totalSongs + newSongsCount,
      failedStations,
      pausedStations: currentPausedStations,
    }));

    if (successCount > 0 || errorCount > 0) {
      const missingInfo = missingCount > 0 ? ` | ${missingCount} faltando` : '';
      console.log(`[SCRAPE-SVC] 📡 Complete: ${successCount}✓ ${errorCount}✗ ${newSongsCount} songs${missingInfo}`);
    }

    return { successCount, errorCount, newSongsCount, missingCount };
  }, [scrapeStation, processedSongsRef, downloadQueueRef]);

  /** Start the scraping interval. Returns cleanup function. */
  const start = useCallback(() => {
    const scrapeAllRef = { current: scrapeAllStations };

    // Scraping every 15 minutes
    scrapeIntervalRef.current = setInterval(() => {
      const currentState = useRadioStore.getState();
      if (!currentState.isRunning) return;
      const hasStations = currentState.stations.some(s => s.enabled && s.scrapeUrl);
      if (hasStations) {
        scrapeAllRef.current();
      }
    }, 15 * 60 * 1000);

    // Initial scrape
    const state = useRadioStore.getState();
    const hasStations = state.stations.some(s => s.enabled && s.scrapeUrl);
    if (state.isRunning && hasStations) {
      scrapeAllStations();
    }

    return () => {
      if (scrapeIntervalRef.current) clearInterval(scrapeIntervalRef.current);
    };
  }, [scrapeAllStations]);

  return {
    stats: scrapeStats,
    scrapeAllStations,
    isRunning: scrapeStats.isRunning,
    start,
  };
}
