/**
 * Library Verification Cache
 * 
 * Caches results of song library verification to avoid redundant checks.
 * Cache expires after 5 minutes to account for new downloads.
 */

interface CacheEntry {
  exists: boolean;
  matchedFile?: string;
  similarity?: number;
  timestamp: number;
}

const CACHE_TTL = 3 * 60 * 1000; // 3 minutes
const cache = new Map<string, CacheEntry>();

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
  
  // Limit cache size to prevent memory bloat (500 entries max)
  if (cache.size > 500) {
    // Remove oldest 100 entries using insertion order (Map iterates in insertion order)
    let removed = 0;
    for (const key of cache.keys()) {
      if (removed >= 100) break;
      cache.delete(key);
      removed++;
    }
  }
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
  console.log('[CACHE] Library verification cache cleared');
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

/**
 * Mark a song as downloaded (update cache to exists=true)
 */
export function markSongAsDownloaded(artist: string, title: string, filename?: string): void {
  const key = generateKey(artist, title);
  cache.set(key, {
    exists: true,
    matchedFile: filename,
    similarity: 1.0,
    timestamp: Date.now(),
  });
}

/**
 * Export cache size for monitoring
 */
export function getVerificationCacheSize(): number {
  return cache.size;
}
