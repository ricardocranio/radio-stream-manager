import { useCallback, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { useSimilarityLogStore } from '@/store/similarityLogStore';
import { isElectron, isServiceMode, findSongMatchViaAPI } from '@/lib/serviceMode';

interface CheckResult {
  exists: boolean;
  path?: string;
  filename?: string;
  baseName?: string;
  similarity?: number;
}

// Cache for song checks to avoid repeated network folder access
const songCheckCache = new Map<string, { result: CheckResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

/**
 * Hook to check if a song exists in the local music library
 * Uses Electron IPC with SIMILARITY matching (configurable threshold) when available
 * Includes caching and timeout for network folder optimization
 * Falls back to simulation for web
 */
export function useCheckMusicLibrary() {
  const config = useRadioStore((state) => state.config);
  const addSimilarityLog = useSimilarityLogStore((state) => state.addLog);
  const pendingChecksRef = useRef<Map<string, Promise<CheckResult>>>(new Map());

  /**
   * Check song using SIMILARITY matching with configurable threshold
   * Uses find-song-match which applies Levenshtein distance comparison
   * Optimized with caching for network folders
   */
  const checkSongExists = useCallback(async (artist: string, title: string): Promise<CheckResult> => {
    const threshold = config.similarityThreshold || 0.75;
    const cacheKey = `${artist.toLowerCase().trim()}-${title.toLowerCase().trim()}`;
    
    // Check cache first
    const cached = songCheckCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }
    
    // Check if we already have a pending request for this song
    const pending = pendingChecksRef.current.get(cacheKey);
    if (pending) {
      return pending;
    }
    
    // Create the check promise
    const checkPromise = (async (): Promise<CheckResult> => {
      // Use Electron API if available - IMPORTANT: use findSongMatch for similarity
      if (window.electronAPI?.findSongMatch) {
        try {
          // Add timeout for network folder resilience
          const timeoutMs = 10000; // 10 second timeout per song
          
          const result = await Promise.race([
            window.electronAPI.findSongMatch({
              artist,
              title,
              musicFolders: config.musicFolders,
              threshold,
            } as any),
            new Promise<CheckResult>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), timeoutMs)
            )
          ]);
          
          // Log similarity check result
          if (result.exists && result.similarity !== undefined) {
            addSimilarityLog({
              artist,
              title,
              matchedFilename: result.filename,
              similarity: result.similarity,
              threshold,
              accepted: true,
              reason: 'match_found',
            });
          } else if (result.similarity !== undefined && result.similarity > 0) {
            addSimilarityLog({
              artist,
              title,
              matchedFilename: result.filename,
              similarity: result.similarity,
              threshold,
              accepted: false,
              reason: 'below_threshold',
            });
          } else {
            addSimilarityLog({
              artist,
              title,
              similarity: 0,
              threshold,
              accepted: false,
              reason: 'no_match',
            });
          }
          
          // Cache the result
          songCheckCache.set(cacheKey, { result, timestamp: Date.now() });
          return result;
        } catch (error) {
          // On timeout or error, assume song doesn't exist (will be added to download queue)
          console.warn(`[CHECK] Timeout/error checking: ${artist} - ${title}`);
          addSimilarityLog({
            artist,
            title,
            similarity: 0,
            threshold,
            accepted: false,
            reason: 'error',
          });
          const fallbackResult: CheckResult = { exists: false };
          songCheckCache.set(cacheKey, { result: fallbackResult, timestamp: Date.now() });
          return fallbackResult;
        }
      }
      
      // Fallback: try checkSongExists if findSongMatch not available
      if (window.electronAPI?.checkSongExists) {
        try {
          const result = await Promise.race([
            window.electronAPI.checkSongExists({
              artist,
              title,
              musicFolders: config.musicFolders,
            }),
            new Promise<CheckResult>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 10000)
            )
          ]);
          songCheckCache.set(cacheKey, { result, timestamp: Date.now() });
          return result;
        } catch (error) {
          console.warn(`[CHECK] Timeout/error checking: ${artist} - ${title}`);
          const fallbackResult: CheckResult = { exists: false };
          songCheckCache.set(cacheKey, { result: fallbackResult, timestamp: Date.now() });
          return fallbackResult;
        }
      }

      // Try HTTP API for Service Mode (browser accessing localhost)
      if (isServiceMode() && config.musicFolders.length > 0) {
        try {
          console.log(`[CHECK] Using HTTP API for: ${artist} - ${title}`);
          const result = await findSongMatchViaAPI(artist, title, config.musicFolders, threshold);
          
          // Log similarity check result
          if (result.exists && result.similarity !== undefined) {
            addSimilarityLog({
              artist,
              title,
              matchedFilename: result.filename,
              similarity: result.similarity,
              threshold,
              accepted: true,
              reason: 'match_found',
            });
          } else if (result.similarity !== undefined && result.similarity > 0) {
            addSimilarityLog({
              artist,
              title,
              matchedFilename: result.filename,
              similarity: result.similarity,
              threshold,
              accepted: false,
              reason: 'below_threshold',
            });
          } else {
            addSimilarityLog({
              artist,
              title,
              similarity: 0,
              threshold,
              accepted: false,
              reason: 'no_match',
            });
          }
          
          songCheckCache.set(cacheKey, { result, timestamp: Date.now() });
          return result;
        } catch (httpError) {
          console.warn(`[CHECK] HTTP API error: ${httpError}`);
        }
      }

      // Fallback for web: simulate check (always returns false in web mode)
      console.log(`[WEB] Would check: ${artist} - ${title} in ${config.musicFolders.join(', ')}`);
      return { exists: false };
    })();
    
    // Store pending promise
    pendingChecksRef.current.set(cacheKey, checkPromise);
    
    try {
      const result = await checkPromise;
      return result;
    } finally {
      pendingChecksRef.current.delete(cacheKey);
    }
  }, [config.musicFolders, config.similarityThreshold, addSimilarityLog]);

  const checkMultipleSongs = useCallback(async (
    songs: Array<{ artist: string; title: string }>
  ): Promise<Map<string, CheckResult>> => {
    const results = new Map<string, CheckResult>();

    // Process in smaller batches to avoid overwhelming network folders
    const batchSize = 3;
    for (let i = 0; i < songs.length; i += batchSize) {
      const batch = songs.slice(i, i + batchSize);
      
      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (song) => {
          const key = `${song.artist.toLowerCase().trim()}-${song.title.toLowerCase().trim()}`;
          const result = await checkSongExists(song.artist, song.title);
          return { key, result };
        })
      );
      
      for (const { key, result } of batchResults) {
        results.set(key, result);
      }
      
      // Small delay between batches for network folders
      if (i + batchSize < songs.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }, [checkSongExists]);

  return { checkSongExists, checkMultipleSongs };
}

/**
 * Clear the song check cache
 * Call this when music folders configuration changes
 */
export function clearSongCheckCache() {
  songCheckCache.clear();
}

/**
 * Standalone function to check a song in the library using SIMILARITY
 * @param threshold - Similarity threshold (0.5 to 0.95), defaults to 0.75
 */
export async function checkSongInLibrary(
  artist: string,
  title: string,
  musicFolders: string[],
  threshold: number = 0.75
): Promise<CheckResult> {
  const cacheKey = `${artist.toLowerCase().trim()}-${title.toLowerCase().trim()}`;
  
  // Check cache
  const cached = songCheckCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  
  // Prefer findSongMatch for similarity matching
  if (window.electronAPI?.findSongMatch) {
    try {
      const result = await Promise.race([
        window.electronAPI.findSongMatch({
          artist,
          title,
          musicFolders,
          threshold,
        } as any),
        new Promise<CheckResult>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 10000)
        )
      ]);
      
      const thresholdPercent = Math.round(threshold * 100);
      const similarityPercent = Math.round((result.similarity || 0) * 100);
      
      if (result.exists) {
        console.log(`[LIBRARY] ✅ Match: ${artist} - ${title} → ${result.filename} (${similarityPercent}% ≥ ${thresholdPercent}%)`);
      } else if (result.similarity && result.similarity > 0) {
        console.log(`[LIBRARY] ❌ Below threshold: ${artist} - ${title} → ${result.filename} (${similarityPercent}% < ${thresholdPercent}%)`);
      } else {
        console.log(`[LIBRARY] ⚠️ No match: ${artist} - ${title}`);
      }
      
      songCheckCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch (error) {
      console.warn(`[LIBRARY] Timeout/error finding match: ${artist} - ${title}`);
      const fallbackResult: CheckResult = { exists: false };
      songCheckCache.set(cacheKey, { result: fallbackResult, timestamp: Date.now() });
      return fallbackResult;
    }
  }
  
  // Fallback to exact match
  if (window.electronAPI?.checkSongExists) {
    try {
      const result = await Promise.race([
        window.electronAPI.checkSongExists({
          artist,
          title,
          musicFolders,
        }),
        new Promise<CheckResult>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 10000)
        )
      ]);
      songCheckCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch (error) {
      console.warn(`[LIBRARY] Timeout/error checking song: ${artist} - ${title}`);
      const fallbackResult: CheckResult = { exists: false };
      songCheckCache.set(cacheKey, { result: fallbackResult, timestamp: Date.now() });
      return fallbackResult;
    }
  }

  // Try HTTP API for Service Mode (browser accessing localhost)
  if (isServiceMode() && musicFolders.length > 0) {
    try {
      console.log(`[LIBRARY] Using HTTP API for: ${artist} - ${title}`);
      const result = await findSongMatchViaAPI(artist, title, musicFolders, threshold);
      
      const thresholdPercent = Math.round(threshold * 100);
      const similarityPercent = Math.round((result.similarity || 0) * 100);
      
      if (result.exists) {
        console.log(`[LIBRARY] ✅ Match: ${artist} - ${title} → ${result.filename} (${similarityPercent}% ≥ ${thresholdPercent}%)`);
      } else if (result.similarity && result.similarity > 0) {
        console.log(`[LIBRARY] ❌ Below threshold: ${artist} - ${title} → ${result.filename} (${similarityPercent}% < ${thresholdPercent}%)`);
      } else {
        console.log(`[LIBRARY] ⚠️ No match: ${artist} - ${title}`);
      }
      
      songCheckCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch (httpError) {
      console.warn(`[LIBRARY] HTTP API error: ${httpError}`);
    }
  }

  // Web mode: always returns false
  return { exists: false };
}
