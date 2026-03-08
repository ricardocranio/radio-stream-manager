/**
 * Offline Song Cache
 * 
 * Caches scraped songs in localStorage as a fallback when the database
 * is unavailable. Stores the last 24h of data with automatic pruning.
 */

const CACHE_KEY = 'pgmr_offline_songs';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 3000;

interface CachedSong {
  title: string;
  artist: string;
  station_name: string;
  scraped_at: string;
}

interface CacheData {
  updatedAt: string;
  songs: CachedSong[];
}

export function saveOfflineSongCache(songs: CachedSong[]): void {
  try {
    // Keep only recent songs, deduplicated
    const seen = new Set<string>();
    const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
    const filtered: CachedSong[] = [];

    for (const song of songs) {
      if (song.scraped_at < cutoff) continue;
      const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      filtered.push(song);
      if (filtered.length >= MAX_ENTRIES) break;
    }

    const data: CacheData = {
      updatedAt: new Date().toISOString(),
      songs: filtered,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    console.log(`[OFFLINE-CACHE] 💾 ${filtered.length} músicas salvas no cache local`);
  } catch {
    // localStorage full — silently ignore
  }
}

export function loadOfflineSongCache(): CachedSong[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data: CacheData = JSON.parse(raw);

    // Invalidate if older than 24h
    const age = Date.now() - new Date(data.updatedAt).getTime();
    if (age > MAX_AGE_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    console.log(`[OFFLINE-CACHE] 📂 Cache local carregado: ${data.songs.length} músicas (idade: ${Math.round(age / 60000)}min)`);
    return data.songs;
  } catch {
    return null;
  }
}
