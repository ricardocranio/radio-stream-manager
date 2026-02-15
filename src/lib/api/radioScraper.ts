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
  source?: string;
  scrapedAt?: string;
}

export interface StationConfig {
  name: string;
  scrapeUrl: string;
  aliases?: string[]; // Alternative names for matching
}

// Known radio station URLs for scraping - Brazilian FM stations
// URLs based on MyTuner Radio format (from Python monitor script)
// Format: https://mytuner-radio.com/pt/radio/STATION-NAME-ID/
export const knownStations: Record<string, StationConfig> = {
  'BH FM': {
    name: 'BH FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-bh-fm-ao-vivo-402270/',
    aliases: ['BH', 'BHFM', 'Rádio BH FM', 'BH FM 102.1'],
  },
  'Band FM': {
    name: 'Band FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/band-fm-sao-paulo-485671/',
    aliases: ['Band', 'BandFM', 'Rádio Band', 'Band FM SP'],
  },
  'Clube FM': {
    name: 'Clube FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/clube-fm-brasilia-469802/',
    aliases: ['Clube', 'ClubeFM', 'Rádio Clube'],
  },
  'Show FM 101.1': {
    name: 'Show FM 101.1',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/show-fm-oliveira-504298/',
    aliases: ['Show FM', 'ShowFM', 'Show 101.1'],
  },
  'Jovem Pan': {
    name: 'Jovem Pan',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-jovem-pan-fm-sao-paulo-485604/',
    aliases: ['JP', 'Jovem Pan FM', 'Pan'],
  },
  'Jovem Pan Florianópolis': {
    name: 'Jovem Pan Florianópolis',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/jovem-pan-fm-florianopolis-421197/',
    aliases: ['JP Floripa', 'Jovem Pan Floripa', 'Pan Florianópolis'],
  },
  'Mix FM': {
    name: 'Mix FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/mix-fm-sao-paulo-485616/',
    aliases: ['Mix', 'MixFM', 'Rádio Mix'],
  },
  'Transamérica': {
    name: 'Transamérica',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-transamerica-sao-paulo-485686/',
    aliases: ['Transamerica', 'Trans', 'Rádio Transamérica'],
  },
  'Nativa FM': {
    name: 'Nativa FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/nativa-fm-sao-paulo-485623/',
    aliases: ['Nativa', 'NativaFM'],
  },
  'Metropolitana FM': {
    name: 'Metropolitana FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-metropolitana-fm-485613/',
    aliases: ['Metropolitana', 'Metro FM'],
  },
  'Alpha FM': {
    name: 'Alpha FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/alpha-fm-sao-paulo-485598/',
    aliases: ['Alpha', 'AlphaFM'],
  },
  'Antena 1': {
    name: 'Antena 1',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/antena-1-sao-paulo-485599/',
    aliases: ['Antena1', 'Antena Um'],
  },
  '89 FM': {
    name: '89 FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/89-fm-a-radio-rock-485596/',
    aliases: ['89FM', 'A Rádio Rock', 'Radio Rock'],
  },
  'Kiss FM': {
    name: 'Kiss FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/kiss-fm-sao-paulo-485610/',
    aliases: ['Kiss', 'KissFM'],
  },
  'Tupi FM': {
    name: 'Tupi FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/super-radio-tupi-485684/',
    aliases: ['Tupi', 'Super Tupi'],
  },
  'Globo FM': {
    name: 'Globo FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/globo-fm-rio-de-janeiro-469709/',
    aliases: ['Globo', 'GloboFM', 'Radio Globo'],
  },
};

/**
 * Find matching station config by name (exact or alias match)
 */
export function findStationConfig(stationName: string): StationConfig | undefined {
  // Normalize the input name
  const normalizedName = stationName.trim().toLowerCase();
  
  // Try exact match first
  if (knownStations[stationName]) {
    return knownStations[stationName];
  }
  
  // Try case-insensitive match
  for (const [key, config] of Object.entries(knownStations)) {
    if (key.toLowerCase() === normalizedName) {
      return config;
    }
    
    // Try alias match
    if (config.aliases) {
      for (const alias of config.aliases) {
        if (alias.toLowerCase() === normalizedName) {
          return config;
        }
      }
    }
  }
  
  // Try partial match (station name contains or is contained in known names)
  for (const [key, config] of Object.entries(knownStations)) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes(normalizedName) || normalizedName.includes(keyLower)) {
      return config;
    }
  }
  
  return undefined;
}

/**
 * Sync local stations with known stations database
 * Returns stations with updated scrapeUrls where matches are found
 */
export function syncStationsWithKnown(
  localStations: { id: string; name: string; scrapeUrl?: string }[]
): { 
  synced: { id: string; name: string; scrapeUrl: string; matched: boolean }[];
  unmatched: string[];
  newUrls: number;
} {
  const synced: { id: string; name: string; scrapeUrl: string; matched: boolean }[] = [];
  const unmatched: string[] = [];
  let newUrls = 0;
  
  for (const station of localStations) {
    const config = findStationConfig(station.name);
    
    if (config) {
      const hadUrl = !!station.scrapeUrl;
      const isNewUrl = !hadUrl || station.scrapeUrl !== config.scrapeUrl;
      
      if (isNewUrl && !hadUrl) {
        newUrls++;
      }
      
      synced.push({
        id: station.id,
        name: station.name,
        scrapeUrl: config.scrapeUrl,
        matched: true,
      });
    } else if (station.scrapeUrl) {
      // Keep existing URL if no match found
      synced.push({
        id: station.id,
        name: station.name,
        scrapeUrl: station.scrapeUrl,
        matched: false,
      });
    } else {
      unmatched.push(station.name);
    }
  }
  
  return { synced, unmatched, newUrls };
}

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
