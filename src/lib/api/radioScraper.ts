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

// Known radio station URLs for scraping - Brazilian FM stations
export const knownStations: Record<string, StationConfig> = {
  // Sertanejo / Pop
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
  // Additional stations
  'Nativa FM': {
    name: 'Nativa FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/nativa-fm-sao-paulo-430620/',
  },
  'Antena 1': {
    name: 'Antena 1',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/antena-1-sao-paulo-473422/',
  },
  'Transamérica': {
    name: 'Transamérica',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/transamerica-fm-sao-paulo-417829/',
  },
  'Alpha FM': {
    name: 'Alpha FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/alpha-fm-474152/',
  },
  'Tupi FM': {
    name: 'Tupi FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/super-radio-tupi-fm-473456/',
  },
  'Metropolitana FM': {
    name: 'Metropolitana FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/metropolitana-fm-464018/',
  },
  'Rede Aleluia': {
    name: 'Rede Aleluia',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/rede-aleluia-sp-491168/',
  },
  '89 FM': {
    name: '89 FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-89-fm-414866/',
  },
  'Cidade FM': {
    name: 'Cidade FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-cidade-fm-sp-491166/',
  },
  'Disney FM': {
    name: 'Disney FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-disney-brasil-411034/',
  },
  'Kiss FM': {
    name: 'Kiss FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/kiss-fm-sao-paulo-431802/',
  },
  'Nova Brasil FM': {
    name: 'Nova Brasil FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/nova-brasil-fm-sao-paulo-429012/',
  },
  'RPC FM': {
    name: 'RPC FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/rpc-fm-curitiba-403074/',
  },
  'Energia 97 FM': {
    name: 'Energia 97 FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/energia-97-fm-463764/',
  },
  'CBN': {
    name: 'CBN',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-cbn-sao-paulo-429010/',
  },
  'Globo FM Rio': {
    name: 'Globo FM Rio',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-globo-fm-rio-418426/',
  },
  'Oi FM': {
    name: 'Oi FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/oi-fm-rio-459800/',
  },
  'Itatiaia FM': {
    name: 'Itatiaia FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-itatiaia-fm-414870/',
  },
  'Joven Pan Pop': {
    name: 'Jovem Pan Pop',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/jovem-pan-pop-498044/',
  },
  'Joven Pan Rock': {
    name: 'Jovem Pan Rock',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/jovem-pan-rock-498046/',
  },
  'Show FM 101.1': {
    name: 'Show FM 101.1',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/show-fm-oliveira-504298/',
  },
};

export interface ScrapeOptions {
  forceRefresh?: boolean;
  timeout?: number;
}

export const radioScraperApi = {
  /**
   * Scrape a single radio station with retry and fallback support
   */
  async scrapeStation(
    stationName: string, 
    customUrl?: string, 
    options: ScrapeOptions = {}
  ): Promise<RadioScrapeResult> {
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
      console.log(`[RadioScraper] Scraping ${stationName}...`);
      
      const { data, error } = await supabase.functions.invoke('scrape-radio', {
        body: { 
          stationUrl: scrapeUrl,
          stationName,
          forceRefresh: options.forceRefresh || false,
        },
      });

      if (error) {
        console.error(`[RadioScraper] Error scraping ${stationName}:`, error);
        return {
          success: false,
          stationName,
          error: error.message,
        };
      }

      const result = data as RadioScrapeResult;
      
      if (result.success && result.nowPlaying) {
        console.log(`[RadioScraper] ✓ ${stationName}: ${result.nowPlaying.artist} - ${result.nowPlaying.title}`);
      } else {
        console.warn(`[RadioScraper] ✗ ${stationName}: No song data`);
      }

      return result;
    } catch (error) {
      console.error(`[RadioScraper] Exception scraping ${stationName}:`, error);
      return {
        success: false,
        stationName,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Scrape multiple radio stations in parallel batches
   */
  async scrapeMultipleStations(
    stationNames: string[], 
    options: ScrapeOptions & { batchSize?: number } = {}
  ): Promise<RadioScrapeResult[]> {
    const batchSize = options.batchSize || 3;
    const allResults: RadioScrapeResult[] = [];

    for (let i = 0; i < stationNames.length; i += batchSize) {
      const batch = stationNames.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(name => this.scrapeStation(name, undefined, options))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        if (result.status === 'fulfilled') {
          allResults.push(result.value);
        } else {
          allResults.push({
            success: false,
            stationName: batch[j],
            error: result.reason?.message || 'Unknown error',
          });
        }
      }

      // Small delay between batches
      if (i + batchSize < stationNames.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    return allResults;
  },

  /**
   * Get list of available stations for scraping
   */
  getAvailableStations(): string[] {
    return Object.keys(knownStations);
  },

  /**
   * Check if station has scrape URL configured
   */
  hasStation(stationName: string): boolean {
    return stationName in knownStations;
  },

  /**
   * Get station config
   */
  getStationConfig(stationName: string): StationConfig | undefined {
    return knownStations[stationName];
  },
};
