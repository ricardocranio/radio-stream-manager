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
 * Get next music file from pool.
 */
function getNextMusic(poolKey: string, files: string[]): string | null {
  if (files.length === 0) return null;

  let pool = musicPools.get(poolKey);
  if (!pool || pool.length === 0) {
    pool = shuffleArray(files);
    musicPools.set(poolKey, pool);
    musicUsed.set(poolKey, new Set());
  }

  const next = pool.pop()!;
  musicUsed.get(poolKey)?.add(next);
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
 * Load songs from a station's captures (via scraped_songs DB).
 */
async function loadMonitoredSongs(
  stationName: string,
  musicFolders: string[]
): Promise<string[]> {
  if (!isElectron || !window.electronAPI?.checkSongExists) return [];
  
  // Import supabase to query
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data } = await supabase
      .from('scraped_songs')
      .select('artist, title')
      .eq('station_name', stationName)
      .order('scraped_at', { ascending: false })
      .limit(200);
    
    if (!data || data.length === 0) return [];
    
    // Check which exist in library
    const found: string[] = [];
    for (const song of data) {
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
      if (found.length >= 50) break; // enough
    }
    
    return found;
  } catch (err) {
    console.warn(`[MAPAS] Erro ao carregar monitoramento ${stationName}:`, err);
    return [];
  }
}

/**
 * Load songs filtered by genre from library metadata.
 */
async function loadGenreSongs(
  genreFilter: string[],
  musicFolders: string[]
): Promise<string[]> {
  if (!isElectron || !window.electronAPI?.scanLibraryMetadata) return [];
  
  try {
    const result = await window.electronAPI.scanLibraryMetadata({ musicFolders });
    if (!result.success || !result.songs) return [];
    
    const genreUpper = genreFilter.map(g => g.toUpperCase());
    const filtered = result.songs.filter(s => {
      if (!s.genre) return false;
      const songGenre = s.genre.toUpperCase();
      return genreUpper.some(g => songGenre.includes(g));
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
      
    case 'vinheta':
    case 'comercial': {
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
      const cacheKey = `genre:${genres.join(',')}`;
      
      if (!cache.has(cacheKey)) {
        const songs = await loadGenreSongs(genres, musicFolders);
        cache.set(cacheKey, songs);
        console.log(`[MAPAS] 🎵 ${songs.length} músicas gênero ${genres.join(',')}`);
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
  console.log('[MAPAS] 🔄 Pools resetados');
}
