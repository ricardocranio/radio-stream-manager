import { supabase } from '@/integrations/supabase/client';

export interface ScrapedSong {
  title: string;
  artist: string;
  timestamp: string;
}

export interface RadioScrapeResult {
  success: boolean;
  stationName: string;
  nowPlaying?: ScrapedSong;
  recentSongs?: ScrapedSong[];
  error?: string;
}

export interface StationConfig {
  name: string;
  scrapeUrl: string;
}

// Known radio station URLs for scraping
export const knownStations: Record<string, StationConfig> = {
  'BH FM': {
    name: 'BH FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-bh-fm-ao-vivo-402270/',
  },
  'Band FM': {
    name: 'Band FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/band-fm-sao-paulo-485671/',
  },
  'Clube FM': {
    name: 'Clube FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/clube-fm-brasilia-469802/',
  },
  'Jovem Pan': {
    name: 'Jovem Pan',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/jovem-pan-fm-442891/',
  },
  'Mix FM': {
    name: 'Mix FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/mix-fm-sao-paulo-418264/',
  },
};

export const radioScraperApi = {
  /**
   * Scrape a single radio station
   */
  async scrapeStation(stationName: string, customUrl?: string): Promise<RadioScrapeResult> {
    const station = knownStations[stationName];
    const scrapeUrl = customUrl || station?.scrapeUrl;

    if (!scrapeUrl) {
      return {
        success: false,
        stationName,
        error: `No scrape URL configured for station: ${stationName}`,
      };
    }

    try {
      const { data, error } = await supabase.functions.invoke('scrape-radio', {
        body: { 
          stationUrl: scrapeUrl,
          stationName,
        },
      });

      if (error) {
        console.error('Error scraping station:', error);
        return {
          success: false,
          stationName,
          error: error.message,
        };
      }

      return data as RadioScrapeResult;
    } catch (error) {
      console.error('Error calling scrape function:', error);
      return {
        success: false,
        stationName,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Scrape multiple radio stations
   */
  async scrapeMultipleStations(stationNames: string[]): Promise<RadioScrapeResult[]> {
    const results = await Promise.allSettled(
      stationNames.map(name => this.scrapeStation(name))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        success: false,
        stationName: stationNames[index],
        error: result.reason?.message || 'Unknown error',
      };
    });
  },

  /**
   * Get list of available stations for scraping
   */
  getAvailableStations(): string[] {
    return Object.keys(knownStations);
  },
};
