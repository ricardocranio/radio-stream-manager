/**
 * Global Scraping Service Hook
 * 
 * Manages automatic radio station scraping.
 * Extracted from GlobalServicesContext for modularity.
 */

import { useRef, useCallback, useState } from 'react';
import { useRadioStore, MissingSong, getActiveSequence } from '@/store/radioStore';
import { radioScraperApi } from '@/lib/api/radioScraper';
import { checkSongInLibrary } from '@/hooks/useCheckMusicLibrary';
import { STATION_ID_TO_DB_NAME } from '@/lib/gradeBuilder/constants';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

export interface ScrapeStats {
  lastScrape: Date | null;
  successCount: number;
  errorCount: number;
  totalSongs: number;
  isRunning: boolean;
  currentStation: string | null;
  failedStations: string[];
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
  });

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
      console.error(`[SCRAPE-SVC] Error scraping ${stationName}:`, error);
      return { success: false, stationName, scrapeUrl, error: String(error) };
    }
  }, []);

  const scrapeAllStations = useCallback(async (_forceRefresh = false) => {
    const { stations, addCapturedSong, addOrUpdateRankingSong, addMissingSong, missingSongs, config } = useRadioStore.getState();
    const enabledStations = stations.filter(s => s.enabled && s.scrapeUrl);
    
    if (enabledStations.length === 0) {
      console.log('[SCRAPE-SVC] No enabled stations');
      return { successCount: 0, errorCount: 0, newSongsCount: 0, missingCount: 0 };
    }

    console.log(`[SCRAPE-SVC] 📡 Scraping ${enabledStations.length} stations...`);
    
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
      
      addOrUpdateRankingSong(songTitle, songArtist, stationStyle, stationName);
      
      const alreadyMissing = isSongAlreadyMissing(songArtist, songTitle);
      const alreadyQueued = isSongContentAlreadyQueued(songArtist, songTitle);
      
      if (!existsInLibrary && !alreadyMissing && !alreadyQueued && isElectron) {
        // Only add to Missing if station is in the active sequence
        const activeSeq = getActiveSequence();
        const sequenceStationNames = new Set(
          activeSeq.map(s => STATION_ID_TO_DB_NAME[s.radioSource] || STATION_ID_TO_DB_NAME[s.radioSource.toLowerCase()]).filter(Boolean)
        );
        if (!sequenceStationNames.has(stationName)) {
          return { isNew: true, isMissing: false };
        }
        
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
      console.log(`[SCRAPE-SVC] 📡 Complete: ${successCount}✓ ${errorCount}✗ ${newSongsCount} songs${missingInfo}`);
    }

    return { successCount, errorCount, newSongsCount, missingCount };
  }, [scrapeStation, processedSongsRef, downloadQueueRef]);

  // Ref to track which batch index to scrape next (stagger)
  const staggerIndexRef = useRef(0);

  /**
   * Scrape a staggered mini-batch of stations (2-3 at a time).
   * Called every 2 minutes so all stations rotate within ~6 min.
   */
  const scrapeStaggeredBatch = useCallback(async () => {
    const { stations, isRunning } = useRadioStore.getState();
    if (!isRunning) return;

    const enabledStations = stations.filter(s => s.enabled && s.scrapeUrl);
    if (enabledStations.length === 0) return;

    // Determine batch size so all stations are covered in ~3 cycles (6 min / 2 min)
    const cycles = 3;
    const batchSize = Math.max(2, Math.ceil(enabledStations.length / cycles));
    const startIdx = staggerIndexRef.current % enabledStations.length;
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      batch.push(enabledStations[(startIdx + i) % enabledStations.length]);
    }
    staggerIndexRef.current = (startIdx + batchSize) % enabledStations.length;

    console.log(`[SCRAPE-SVC] 📡 Stagger batch: ${batch.map(s => s.name).join(', ')}`);

    // Reuse the full scraping logic but only for this batch
    const { addCapturedSong, addOrUpdateRankingSong, addMissingSong, config } = useRadioStore.getState();

    const isSongAlreadyProcessedForStation = (artist: string, title: string, stationName: string): boolean => {
      const key = `${stationName.toLowerCase().trim()}|${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`;
      return processedSongsRef.current.has(key);
    };

    const isSongAlreadyMissing = (artist: string, title: string): boolean => {
      const currentMissing = useRadioStore.getState().missingSongs;
      return currentMissing.some(
        s => s.artist.toLowerCase().trim() === artist.toLowerCase().trim() &&
             s.title.toLowerCase().trim() === title.toLowerCase().trim()
      );
    };

    const isSongContentAlreadyQueued = (artist: string, title: string): boolean => {
      return downloadQueueRef.current.some(
        item => item.song.artist.toLowerCase().trim() === artist.toLowerCase().trim() &&
                item.song.title.toLowerCase().trim() === title.toLowerCase().trim()
      );
    };

    const processSong = async (
      songTitle: string, songArtist: string, stationName: string,
      stationStyle: string, scrapeUrl: string, timestamp: Date = new Date()
    ) => {
      if (isSongAlreadyProcessedForStation(songArtist, songTitle, stationName)) {
        return { isNew: false, isMissing: false };
      }
      const processKey = `${stationName.toLowerCase().trim()}|${songArtist.toLowerCase().trim()}|${songTitle.toLowerCase().trim()}`;
      processedSongsRef.current.add(processKey);

      let existsInLibrary = false;
      if (isElectron && config.musicFolders?.length > 0) {
        try {
          const result = await checkSongInLibrary(songArtist, songTitle, config.musicFolders, config.similarityThreshold || 0.75);
          existsInLibrary = result.exists;
        } catch (error) {
          console.error('[SCRAPE-SVC] Library check failed:', error);
        }
      }

      const songId = `${stationName}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      addCapturedSong({ id: songId, title: songTitle, artist: songArtist, station: stationName, timestamp, status: existsInLibrary ? 'found' : 'missing', source: scrapeUrl });
      addOrUpdateRankingSong(songTitle, songArtist, stationStyle, stationName);

      if (!existsInLibrary && !isSongAlreadyMissing(songArtist, songTitle) && !isSongContentAlreadyQueued(songArtist, songTitle) && isElectron) {
        // Only add to Missing if station is in the active sequence
        const activeSeq = getActiveSequence();
        const sequenceStationNames = new Set(
          activeSeq.map(s => STATION_ID_TO_DB_NAME[s.radioSource] || STATION_ID_TO_DB_NAME[s.radioSource.toLowerCase()]).filter(Boolean)
        );
        if (!sequenceStationNames.has(stationName)) {
          return { isNew: true, isMissing: false };
        }
        
        addMissingSong({ id: songId, title: songTitle, artist: songArtist, station: stationName, timestamp: new Date(), status: 'missing' });
        return { isNew: true, isMissing: true };
      }
      return { isNew: true, isMissing: false };
    };

    let successCount = 0;
    let errorCount = 0;

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
        if (nowPlaying) await processSong(nowPlaying.title, nowPlaying.artist, stationName, stationStyle, scrapeUrl);
        for (const song of (recentSongs || []).slice(0, 3)) {
          await processSong(song.title, song.artist, stationName, stationStyle, scrapeUrl, new Date(song.timestamp));
        }
      } else {
        errorCount++;
      }
    }

    if (successCount > 0 || errorCount > 0) {
      console.log(`[SCRAPE-SVC] 📡 Stagger done: ${successCount}✓ ${errorCount}✗`);
    }

    setScrapeStats(prev => ({
      ...prev,
      lastScrape: new Date(),
      successCount: prev.successCount + successCount,
      errorCount: prev.errorCount + errorCount,
    }));
  }, [scrapeStation, processedSongsRef, downloadQueueRef]);

  /** Start the staggered scraping interval. Returns cleanup function. */
  const start = useCallback(() => {
    // Stagger: scrape a mini-batch every 2 minutes
    scrapeIntervalRef.current = setInterval(() => {
      scrapeStaggeredBatch();
    }, 2 * 60 * 1000);

    // Initial full scrape on start
    scrapeAllStations();

    return () => {
      if (scrapeIntervalRef.current) clearInterval(scrapeIntervalRef.current);
    };
  }, [scrapeAllStations, scrapeStaggeredBatch]);

  return {
    stats: scrapeStats,
    scrapeAllStations,
    isRunning: scrapeStats.isRunning,
    start,
  };
}
