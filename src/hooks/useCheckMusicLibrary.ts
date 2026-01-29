import { useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { useSimilarityLogStore } from '@/store/similarityLogStore';

interface CheckResult {
  exists: boolean;
  path?: string;
  filename?: string;
  baseName?: string;
  similarity?: number;
}

/**
 * Hook to check if a song exists in the local music library
 * Uses Electron IPC with SIMILARITY matching (configurable threshold) when available
 * Falls back to simulation for web
 */
export function useCheckMusicLibrary() {
  const config = useRadioStore((state) => state.config);
  const addSimilarityLog = useSimilarityLogStore((state) => state.addLog);

  /**
   * Check song using SIMILARITY matching with configurable threshold
   * Uses find-song-match which applies Levenshtein distance comparison
   */
  const checkSongExists = useCallback(async (artist: string, title: string): Promise<CheckResult> => {
    const threshold = config.similarityThreshold || 0.75;
    
    // Use Electron API if available - IMPORTANT: use findSongMatch for similarity
    if (window.electronAPI?.findSongMatch) {
      try {
        const result = await window.electronAPI.findSongMatch({
          artist,
          title,
          musicFolders: config.musicFolders,
          threshold,
        } as any); // Type assertion to bypass potential stale types
        
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
          // Found a potential match but below threshold
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
          // No match found at all
          addSimilarityLog({
            artist,
            title,
            similarity: 0,
            threshold,
            accepted: false,
            reason: 'no_match',
          });
        }
        
        return result;
      } catch (error) {
        console.error('Error checking song in library:', error);
        addSimilarityLog({
          artist,
          title,
          similarity: 0,
          threshold,
          accepted: false,
          reason: 'error',
        });
        return { exists: false };
      }
    }
    
    // Fallback: try checkSongExists if findSongMatch not available
    if (window.electronAPI?.checkSongExists) {
      try {
        const result = await window.electronAPI.checkSongExists({
          artist,
          title,
          musicFolders: config.musicFolders,
        });
        return result;
      } catch (error) {
        console.error('Error checking song in library:', error);
        return { exists: false };
      }
    }

    // Fallback for web: simulate check (always returns false in web mode)
    console.log(`[WEB] Would check: ${artist} - ${title} in ${config.musicFolders.join(', ')}`);
    return { exists: false };
  }, [config.musicFolders, config.similarityThreshold, addSimilarityLog]);

  const checkMultipleSongs = useCallback(async (
    songs: Array<{ artist: string; title: string }>
  ): Promise<Map<string, CheckResult>> => {
    const results = new Map<string, CheckResult>();

    for (const song of songs) {
      const key = `${song.artist.toLowerCase().trim()}-${song.title.toLowerCase().trim()}`;
      const result = await checkSongExists(song.artist, song.title);
      results.set(key, result);
    }

    return results;
  }, [checkSongExists]);

  return { checkSongExists, checkMultipleSongs };
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
  // Prefer findSongMatch for similarity matching
  if (window.electronAPI?.findSongMatch) {
    try {
      const result = await window.electronAPI.findSongMatch({
        artist,
        title,
        musicFolders,
        threshold,
      } as any); // Type assertion to bypass potential stale types
      
      const thresholdPercent = Math.round(threshold * 100);
      const similarityPercent = Math.round((result.similarity || 0) * 100);
      
      if (result.exists) {
        console.log(`[LIBRARY] ✅ Match: ${artist} - ${title} → ${result.filename} (${similarityPercent}% ≥ ${thresholdPercent}%)`);
      } else if (result.similarity && result.similarity > 0) {
        console.log(`[LIBRARY] ❌ Below threshold: ${artist} - ${title} → ${result.filename} (${similarityPercent}% < ${thresholdPercent}%)`);
      } else {
        console.log(`[LIBRARY] ⚠️ No match: ${artist} - ${title}`);
      }
      
      return result;
    } catch (error) {
      console.error('Error finding match:', error);
      return { exists: false };
    }
  }
  
  // Fallback to exact match
  if (window.electronAPI?.checkSongExists) {
    try {
      return await window.electronAPI.checkSongExists({
        artist,
        title,
        musicFolders,
      });
    } catch (error) {
      console.error('Error checking song:', error);
      return { exists: false };
    }
  }

  // Web mode: always returns false
  return { exists: false };
}