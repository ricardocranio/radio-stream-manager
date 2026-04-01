/**
 * Library Verification Cache
 * 
 * Caches results of song library verification to avoid redundant checks.
 * Persists to localStorage so cache survives app reload.
 * Cache expires after 3 minutes to account for new downloads.
 */

interface CacheEntry {
  exists: boolean;
  matchedFile?: string;
  similarity?: number;
  timestamp: number;
  downloaded?: boolean; // true = confirmed download, uses longer TTL
}

const CACHE_TTL = 3 * 60 * 1000; // 3 minutes
const DOWNLOADED_TTL = 60 * 60 * 1000; // 1 hour for confirmed downloads
const STORAGE_KEY = 'pgmr_lib_cache';
const MAX_CACHE_SIZE = 500;
const cache = new Map<string, CacheEntry>();

// Load persisted cache on module init
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const entries: [string, CacheEntry][] = JSON.parse(stored);
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now - entry.timestamp < CACHE_TTL) {
        cache.set(key, entry);
      }
    }
    console.log(`[CACHE] Restored ${cache.size} entries from disk`);
  }
} catch { /* ignore parse errors */ }

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const entries = Array.from(cache.entries()).slice(-MAX_CACHE_SIZE);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch { /* storage full — ignore */ }
  }, 2000); // debounce 2s
}

/**
 * Generate a cache key from artist and title
 */
function generateKey(artist: string, title: string): string {
  return `${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`;
}

/**
 * Get cached verification result
 */
export function getCachedVerification(artist: string, title: string): CacheEntry | null {
  const key = generateKey(artist, title);
  const entry = cache.get(key);
  
  if (!entry) return null;
  
  // Check if expired
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  
  return entry;
}

/**
 * Set cached verification result
 */
export function setCachedVerification(
  artist: string, 
  title: string, 
  result: { exists: boolean; matchedFile?: string; similarity?: number }
): void {
  const key = generateKey(artist, title);
  cache.set(key, {
    ...result,
    timestamp: Date.now(),
  });
  
  // Limit cache size to prevent memory bloat
  if (cache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, 100);
    toRemove.forEach(([k]) => cache.delete(k));
  }
  
  schedulePersist();
}

/**
 * Check if a song exists in cache (quick check without full verification)
 */
export function isSongCached(artist: string, title: string): boolean {
  const entry = getCachedVerification(artist, title);
  return entry !== null;
}

/**
 * Check if a song exists in library (cached result)
 */
export function isSongInLibrary(artist: string, title: string): boolean | null {
  const entry = getCachedVerification(artist, title);
  return entry ? entry.exists : null;
}

/**
 * Clear the entire cache
 */
export function clearVerificationCache(): void {
  cache.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  console.log('[CACHE] Library verification cache cleared');
}

/**
 * Clear cache for a specific song (e.g., after JIT download so recheck goes to disk)
 */
export function clearVerificationForSong(artist: string, title: string): void {
  const key = generateKey(artist, title);
  cache.delete(key);
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; hitRate: string } {
  return {
    size: cache.size,
    hitRate: 'N/A', // Would need to track hits/misses
  };
}

export function markSongAsDownloaded(artist: string, title: string, filename?: string): void {
  const safeFilename =
    typeof filename === 'string' && /\.(mp3|flac|wav|ogg|m4a)$/i.test(filename.trim())
      ? filename.trim()
      : undefined;

  const key = generateKey(artist, title);
  cache.set(key, {
    exists: true,
    matchedFile: safeFilename,
    similarity: 1.0,
    timestamp: Date.now(),
  });
  schedulePersist();
}

/**
 * Export cache size for monitoring
 */
export function getVerificationCacheSize(): number {
  return cache.size;
}
