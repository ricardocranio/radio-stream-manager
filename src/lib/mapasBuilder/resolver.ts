/**
 * Mapas Code Resolver
 * 
 * Resolves each code in a template line to an actual filename
 * or literal command string.
 */

import type { MapaCodeConfig, MapaTemplateLine, MapaResolvedLine, MapasConfig } from './types';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// Vinheta pools per folder (no-repeat within a session)
const vinhetaPools: Map<string, string[]> = new Map();
const vinhetaUsed: Map<string, Set<string>> = new Map();

// Music pools per genre/station (no-repeat)
const musicPools: Map<string, string[]> = new Map();
const musicUsed: Map<string, Set<string>> = new Map();

// GLOBAL music dedup — tracks ALL music files used across ALL codes in a single build
const globalMusicUsed: Set<string> = new Set();

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get next file from a pool without repetition.
 */
function getNextFromPool(poolKey: string, files: string[]): string | null {
  if (files.length === 0) return null;

  let pool = vinhetaPools.get(poolKey);
  if (!pool || pool.length === 0) {
    pool = shuffleArray(files);
    vinhetaPools.set(poolKey, pool);
    vinhetaUsed.set(poolKey, new Set());
  }

  const next = pool.pop()!;
  vinhetaUsed.get(poolKey)?.add(next);
  return next;
}

/**
 * Get next music file from pool with GLOBAL dedup.
 * Ensures no song repeats across different music codes in the same build.
 */
function getNextMusic(poolKey: string, files: string[]): string | null {
  if (files.length === 0) return null;

  let pool = musicPools.get(poolKey);
  if (!pool || pool.length === 0) {
    // Reshuffle but exclude globally used songs first
    const available = files.filter(f => !globalMusicUsed.has(f.toLowerCase()));
    pool = shuffleArray(available.length > 0 ? available : files);
    musicPools.set(poolKey, pool);
    musicUsed.set(poolKey, new Set());
  }

  // Try to find a song not yet used globally
  let next: string | null = null;
  const tried: string[] = [];
  
  while (pool.length > 0) {
    const candidate = pool.pop()!;
    if (!globalMusicUsed.has(candidate.toLowerCase())) {
      next = candidate;
      break;
    }
    tried.push(candidate);
  }
  
  // If all remaining were globally used, accept the last tried one
  if (!next && tried.length > 0) {
    next = tried[tried.length - 1];
    console.warn(`[MAPAS] ⚠️ Pool ${poolKey} exausto — reutilizando: ${next}`);
  }
  
  // Put back untried candidates
  if (tried.length > 0 && pool.length > 0) {
    // Don't put back - they were already globally used
  }

  if (next) {
    globalMusicUsed.add(next.toLowerCase());
    musicUsed.get(poolKey)?.add(next);
  }
  
  return next;
}

/**
 * Load files from a folder via IPC.
 */
async function loadFolderFiles(folder: string): Promise<string[]> {
  if (!isElectron || !window.electronAPI?.listFolderFiles) return [];
  
  try {
    const result = await window.electronAPI.listFolderFiles({
      folder,
      extension: '.mp3',
    });
    if (result.success && result.files) {
      return result.files.map(f => f.name);
    }
  } catch (err) {
    console.warn(`[MAPAS] Erro ao listar ${folder}:`, err);
  }
  return [];
}

/**
 * Load songs from station captures (via scraped_songs DB).
 * If stationName is empty/undefined, loads from ALL stations.
 */
async function loadMonitoredSongs(
  stationName: string | undefined,
  musicFolders: string[]
): Promise<string[]> {
  if (!isElectron || !window.electronAPI?.checkSongExists) return [];
  
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    let query = supabase
      .from('scraped_songs')
      .select('artist, title, station_name')
      .order('scraped_at', { ascending: false })
      .limit(300);
    
    if (stationName) {
      query = query.eq('station_name', stationName);
    }
    
    const { data } = await query;
    if (!data || data.length === 0) return [];
    
    // Deduplicate by artist+title
    const seen = new Set<string>();
    const unique = data.filter(s => {
      const key = `${s.artist.toLowerCase()}|${s.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    // Check which exist in library
    const found: string[] = [];
    for (const song of unique) {
      try {
        const result = await window.electronAPI!.checkSongExists({
          artist: song.artist,
          title: song.title,
          musicFolders,
        });
        if (result.exists && result.filename) {
          found.push(result.filename);
        }
      } catch { /* skip */ }
      if (found.length >= 80) break;
    }
    
    console.log(`[MAPAS] 📡 ${found.length}/${unique.length} músicas reais encontradas${stationName ? ` de ${stationName}` : ' (todas)'}`);
    return found;
  } catch (err) {
    console.warn(`[MAPAS] Erro ao carregar monitoramento:`, err);
    return [];
  }
}

/**
 * Load songs from DB (ai_genre) + library check, with genre/decade filters.
 * This uses REAL monitored data from scraped_songs, not just local ID3.
 */
async function loadMonitoredGenreSongs(
  genreFilter: string[],
  musicFolders: string[],
  decadeFilter?: string,
  stationName?: string
): Promise<string[]> {
  if (!isElectron || !window.electronAPI?.checkSongExists) return [];
  
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    
    // Query scraped songs with ai_genre filter
    let query = supabase
      .from('scraped_songs')
      .select('artist, title, ai_genre, year')
      .order('scraped_at', { ascending: false })
      .limit(500);
    
    if (stationName) {
      query = query.eq('station_name', stationName);
    }
    
    const { data } = await query;
    if (!data || data.length === 0) return [];
    
    // Parse decade range
    let yearStart = 0, yearEnd = 9999;
    if (decadeFilter) {
      const decadeMap: Record<string, [number, number]> = {
        '80s': [1980, 1989], '90s': [1990, 1999], '2000s': [2000, 2009],
        '2010s': [2010, 2019], '2020s': [2020, 2029],
      };
      const range = decadeMap[decadeFilter];
      if (range) { yearStart = range[0]; yearEnd = range[1]; }
    }
    
    const genreUpper = genreFilter.map(g => g.toUpperCase());
    
    // Filter by genre and decade
    const filtered = data.filter(s => {
      // Genre check via ai_genre field
      if (genreUpper.length > 0) {
        if (!s.ai_genre) return false;
        const songGenre = s.ai_genre.toUpperCase();
        if (!genreUpper.some(g => songGenre.includes(g))) return false;
      }
      // Decade check
      if (decadeFilter && s.year) {
        const y = parseInt(s.year, 10);
        if (isNaN(y) || y < yearStart || y > yearEnd) return false;
      }
      return true;
    });
    
    // Deduplicate
    const seen = new Set<string>();
    const unique = filtered.filter(s => {
      const key = `${s.artist.toLowerCase()}|${s.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    // Check which exist in library
    const found: string[] = [];
    for (const song of unique) {
      try {
        const result = await window.electronAPI!.checkSongExists({
          artist: song.artist,
          title: song.title,
          musicFolders,
        });
        if (result.exists && result.filename) {
          found.push(result.filename);
        }
      } catch { /* skip */ }
      if (found.length >= 60) break;
    }
    
    console.log(`[MAPAS] 🎵📡 ${found.length} músicas reais gênero ${genreUpper.join(',')}${decadeFilter ? ` (${decadeFilter})` : ''}`);
    return found;
  } catch (err) {
    console.warn(`[MAPAS] Erro ao carregar gênero monitorado:`, err);
    return [];
  }
}

/**
 * Load songs filtered by genre from library metadata.
 */
async function loadGenreSongs(
  genreFilter: string[],
  musicFolders: string[],
  decadeFilter?: string
): Promise<string[]> {
  if (!isElectron || !window.electronAPI?.scanLibraryMetadata) return [];
  
  // Parse decade to year range
  let yearStart = 0, yearEnd = 9999;
  if (decadeFilter) {
    const decadeMap: Record<string, [number, number]> = {
      '80s': [1980, 1989], '90s': [1990, 1999], '2000s': [2000, 2009],
      '2010s': [2010, 2019], '2020s': [2020, 2029],
    };
    const range = decadeMap[decadeFilter];
    if (range) { yearStart = range[0]; yearEnd = range[1]; }
  }

  try {
    const result = await window.electronAPI.scanLibraryMetadata({ musicFolders });
    if (!result.success || !result.songs) return [];
    
    const genreUpper = genreFilter.map(g => g.toUpperCase());
    const filtered = result.songs.filter((s: any) => {
      // Genre check
      if (genreUpper.length > 0) {
        if (!s.genre) return false;
        const songGenre = s.genre.toUpperCase();
        if (!genreUpper.some((g: string) => songGenre.includes(g))) return false;
      }
      // Decade check
      if (decadeFilter && s.year) {
        const y = parseInt(s.year, 10);
        if (isNaN(y) || y < yearStart || y > yearEnd) return false;
      }
      return true;
    });
    
    return filtered.map(s => s.filename);
  } catch (err) {
    console.warn(`[MAPAS] Erro ao carregar gênero ${genreFilter}:`, err);
    return [];
  }
}

/**
 * Resolve a single code to a filename or literal string.
 */
async function resolveCode(
  code: string,
  config: MapasConfig,
  musicFolders: string[],
  cache: Map<string, string[]>
): Promise<string> {
  const codeUpper = code.toUpperCase();
  const codeLower = code.toLowerCase();
  
  // Find config for this code
  const codeConfig = config.codeConfigs.find(
    c => c.code.toLowerCase() === codeLower || c.code.toUpperCase() === codeUpper
  );
  
  if (!codeConfig) {
    // Unknown code — write literally
    return code;
  }
  
  switch (codeConfig.type) {
    case 'literal':
      return code;
      
    case 'vinheta': {
      const folder = codeConfig.vinhetaFolder || config.vhtEntradaFolder;
      const cacheKey = `vht:${folder}`;
      
      if (!cache.has(cacheKey)) {
        const files = await loadFolderFiles(folder);
        cache.set(cacheKey, files);
        console.log(`[MAPAS] 📂 ${files.length} vinhetas em ${folder}`);
      }
      
      const files = cache.get(cacheKey)!;
      const next = getNextFromPool(cacheKey, files);
      return next ? `"${next}"` : code;
    }

    case 'comercial': {
      // Comercial uses a fixed file chosen by user, not random
      if (codeConfig.fixedFile) {
        return `"${codeConfig.fixedFile}"`;
      }
      return code;
    }
      
    case 'monitored': {
      const station = codeConfig.stationSource || 'Disney FM';
      const cacheKey = `mon:${station}`;
      
      if (!cache.has(cacheKey)) {
        const songs = await loadMonitoredSongs(station, musicFolders);
        cache.set(cacheKey, songs);
        console.log(`[MAPAS] 📡 ${songs.length} músicas de ${station}`);
      }
      
      const files = cache.get(cacheKey)!;
      const next = getNextMusic(cacheKey, files);
      return next ? `"${next}"` : code;
    }
      
    case 'genre': {
      const genres = codeConfig.genreFilter || [];
      const decade = codeConfig.decadeFilter;
      const stationKey = codeConfig.stationSource ? `:${codeConfig.stationSource}` : '';
      const decadeKey = decade ? `:${decade}` : '';
      const cacheKey = `genre:${genres.join(',')}${stationKey}${decadeKey}`;
      
      if (!cache.has(cacheKey)) {
        // PRIMARY: Use real monitored songs from DB (ai_genre + year)
        let songs = await loadMonitoredGenreSongs(genres, musicFolders, decade, codeConfig.stationSource);
        
        // FALLBACK: If DB yields too few, supplement with local ID3 scan
        if (songs.length < 10) {
          console.log(`[MAPAS] ⚠️ Apenas ${songs.length} do monitoramento, complementando com ID3 local...`);
          const localSongs = await loadGenreSongs(genres, musicFolders, decade);
          const existing = new Set(songs.map(f => f.toLowerCase()));
          const extra = localSongs.filter(f => !existing.has(f.toLowerCase()));
          songs = [...songs, ...extra];
        }
        
        cache.set(cacheKey, songs);
        console.log(`[MAPAS] 🎵 ${songs.length} músicas total gênero ${genres.join(',')}${decadeKey}${stationKey}`);
      }
      
      const files = cache.get(cacheKey)!;
      const next = getNextMusic(cacheKey, files);
      return next ? `"${next}"` : code;
    }
      
    default:
      return code;
  }
}

/**
 * Resolve all codes in a template line.
 */
export async function resolveTemplateLine(
  line: MapaTemplateLine,
  config: MapasConfig,
  musicFolders: string[],
  cache: Map<string, string[]>
): Promise<MapaResolvedLine> {
  const items: string[] = [];
  
  for (const code of line.codes) {
    const resolved = await resolveCode(code, config, musicFolders, cache);
    items.push(resolved);
  }
  
  return { time: line.time, items };
}

/**
 * Format a resolved line for output file.
 * Format: "HH:MM item1,item2,item3"
 */
export function formatResolvedLine(line: MapaResolvedLine): string {
  return `${line.time} ${line.items.join(',')}`;
}

/**
 * Reset all pools for a fresh build.
 */
export function resetMapasPools(): void {
  vinhetaPools.clear();
  vinhetaUsed.clear();
  musicPools.clear();
  musicUsed.clear();
  globalMusicUsed.clear();
  console.log('[MAPAS] 🔄 Pools resetados (incluindo dedup global)');
}

/**
 * Seed the global music exclusion set with filenames from the grade builder.
 * This prevents mapa songs from repeating grade songs in the same time slot.
 */
export function seedGradeExclusions(gradeFilenames: string[]): void {
  for (const fn of gradeFilenames) {
    globalMusicUsed.add(fn.toLowerCase());
  }
  if (gradeFilenames.length > 0) {
    console.log(`[MAPAS] 🚫 Anti-repetição cross-grade: ${gradeFilenames.length} músicas da grade excluídas`);
  }
}
