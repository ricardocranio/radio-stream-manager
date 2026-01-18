import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { radioScraperApi } from '@/lib/api/radioScraper';
import { useToast } from '@/hooks/use-toast';

export interface AutoScrapingConfig {
  enabled: boolean;
  intervalMinutes: number;
}

export function useAutoScraping() {
  const { stations, addCapturedSong, config } = useRadioStore();
  const { toast } = useToast();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrapeRef = useRef<Date | null>(null);

  const scrapeAllStations = useCallback(async () => {
    const enabledStations = stations.filter(s => s.enabled && s.scrapeUrl);
    
    if (enabledStations.length === 0) {
      console.log('[AutoScraping] No enabled stations with scrape URLs');
      return;
    }

    console.log(`[AutoScraping] Starting scrape of ${enabledStations.length} stations...`);
    lastScrapeRef.current = new Date();

    let successCount = 0;
    let errorCount = 0;
    let newSongsCount = 0;

    for (const station of enabledStations) {
      try {
        const result = await radioScraperApi.scrapeStation(station.name, station.scrapeUrl);
        
        if (result.success && result.nowPlaying) {
          successCount++;
          
          // Add now playing song to captured songs
          addCapturedSong({
            id: `${station.id}-${Date.now()}`,
            title: result.nowPlaying.title,
            artist: result.nowPlaying.artist,
            station: station.name,
            timestamp: new Date(),
            status: 'found',
          });
          newSongsCount++;

          // Add recent songs if available
          if (result.recentSongs) {
            for (const song of result.recentSongs.slice(0, 3)) {
              addCapturedSong({
                id: `${station.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: song.title,
                artist: song.artist,
                station: station.name,
                timestamp: new Date(song.timestamp),
                status: 'found',
              });
              newSongsCount++;
            }
          }
        } else {
          errorCount++;
          console.warn(`[AutoScraping] Failed to scrape ${station.name}:`, result.error);
        }
      } catch (error) {
        errorCount++;
        console.error(`[AutoScraping] Error scraping ${station.name}:`, error);
      }

      // Small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`[AutoScraping] Complete: ${successCount} success, ${errorCount} errors, ${newSongsCount} songs captured`);

    // Show notification if there were new songs
    if (newSongsCount > 0) {
      toast({
        title: '🎵 Músicas Atualizadas',
        description: `${newSongsCount} músicas capturadas de ${successCount} emissoras.`,
      });
    }

    return { successCount, errorCount, newSongsCount };
  }, [stations, addCapturedSong, toast]);

  const startAutoScraping = useCallback((intervalMinutes: number = 5) => {
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

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
      console.log('[AutoScraping] Stopped auto-scraping');
    }
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
    startAutoScraping,
    stopAutoScraping,
    lastScrape: lastScrapeRef.current,
    isRunning: !!intervalRef.current,
  };
}
