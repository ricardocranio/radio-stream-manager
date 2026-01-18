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
// This is the source of truth for scrape URLs
export const knownStations: Record<string, StationConfig> = {
  // Sertanejo / Pop
  'BH FM': {
    name: 'BH FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-bh-fm-ao-vivo-402270/',
    aliases: ['BH', 'BHFM', 'Rádio BH FM'],
  },
  'Band FM': {
    name: 'Band FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/band-fm-sao-paulo-485671/',
    aliases: ['Band', 'BandFM', 'Rádio Band'],
  },
  'Clube FM': {
    name: 'Clube FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/clube-fm-brasilia-469802/',
    aliases: ['Clube', 'ClubeFM', 'Rádio Clube'],
  },
  'Jovem Pan': {
    name: 'Jovem Pan',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/jovem-pan-fm-442891/',
    aliases: ['JP', 'Pan', 'Jovem Pan FM'],
  },
  'Mix FM': {
    name: 'Mix FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/mix-fm-sao-paulo-418264/',
    aliases: ['Mix', 'MixFM'],
  },
  'Nativa FM': {
    name: 'Nativa FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/nativa-fm-sao-paulo-430620/',
    aliases: ['Nativa', 'NativaFM'],
  },
  'Antena 1': {
    name: 'Antena 1',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/antena-1-sao-paulo-473422/',
    aliases: ['Antena1', 'Antena Um'],
  },
  'Transamérica': {
    name: 'Transamérica',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/transamerica-fm-sao-paulo-417829/',
    aliases: ['Transamerica', 'TransamericaFM', 'Trans'],
  },
  'Alpha FM': {
    name: 'Alpha FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/alpha-fm-474152/',
    aliases: ['Alpha', 'AlphaFM'],
  },
  'Tupi FM': {
    name: 'Tupi FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/super-radio-tupi-fm-473456/',
    aliases: ['Tupi', 'TupiFM', 'Super Tupi'],
  },
  'Metropolitana FM': {
    name: 'Metropolitana FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/metropolitana-fm-464018/',
    aliases: ['Metropolitana', 'Metro FM'],
  },
  'Rede Aleluia': {
    name: 'Rede Aleluia',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/rede-aleluia-sp-491168/',
    aliases: ['Aleluia', 'Aleluia FM'],
  },
  '89 FM': {
    name: '89 FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-89-fm-414866/',
    aliases: ['89FM', 'A Rádio Rock'],
  },
  'Cidade FM': {
    name: 'Cidade FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-cidade-fm-sp-491166/',
    aliases: ['Cidade', 'CidadeFM'],
  },
  'Disney FM': {
    name: 'Disney FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-disney-brasil-411034/',
    aliases: ['Disney', 'Radio Disney'],
  },
  'Kiss FM': {
    name: 'Kiss FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/kiss-fm-sao-paulo-431802/',
    aliases: ['Kiss', 'KissFM'],
  },
  'Nova Brasil FM': {
    name: 'Nova Brasil FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/nova-brasil-fm-sao-paulo-429012/',
    aliases: ['Nova Brasil', 'NovaBrasil'],
  },
  'RPC FM': {
    name: 'RPC FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/rpc-fm-curitiba-403074/',
    aliases: ['RPC', 'RPCFM'],
  },
  'Energia 97 FM': {
    name: 'Energia 97 FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/energia-97-fm-463764/',
    aliases: ['Energia', 'Energia 97', 'Energia97'],
  },
  'CBN': {
    name: 'CBN',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-cbn-sao-paulo-429010/',
    aliases: ['CBN FM', 'Rádio CBN'],
  },
  'Globo FM Rio': {
    name: 'Globo FM Rio',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-globo-fm-rio-418426/',
    aliases: ['Globo FM', 'GloboFM'],
  },
  'Oi FM': {
    name: 'Oi FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/oi-fm-rio-459800/',
    aliases: ['OiFM', 'Oi'],
  },
  'Itatiaia FM': {
    name: 'Itatiaia FM',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-itatiaia-fm-414870/',
    aliases: ['Itatiaia', 'ItatiaiaFM'],
  },
  'Jovem Pan Pop': {
    name: 'Jovem Pan Pop',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/jovem-pan-pop-498044/',
    aliases: ['JP Pop', 'Pan Pop'],
  },
  'Jovem Pan Rock': {
    name: 'Jovem Pan Rock',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/jovem-pan-rock-498046/',
    aliases: ['JP Rock', 'Pan Rock'],
  },
  'Show FM 101.1': {
    name: 'Show FM 101.1',
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/show-fm-oliveira-504298/',
    aliases: ['Show FM', 'ShowFM', 'Show 101.1'],
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
