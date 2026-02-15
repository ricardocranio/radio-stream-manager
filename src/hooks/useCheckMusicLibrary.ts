import { useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { useSimilarityLogStore } from '@/store/similarityLogStore';
import { 
  getCachedVerification, 
  setCachedVerification, 
  markSongAsDownloaded 
} from '@/lib/libraryVerificationCache';

interface CheckResult {
  exists: boolean;
  path?: string;
  filename?: string;
  baseName?: string;
  similarity?: number;
  cached?: boolean;
}

/**
 * Remove common suffixes like (Ao Vivo), (Live), (Acústico), [Remix], etc.
 * This allows matching "Song (Ao Vivo)" with "Song" in the library
 */
function normalizeTitle(title: string): string {
  return title
    // Remove parenthetical suffixes
    .replace(/\s*\((?:ao\s*vivo|live|acustico|acústico|acoustic|remix|remaster(?:ed)?|radio\s*edit|single\s*version|album\s*version|explicit|clean|feat\.?[^)]*|ft\.?[^)]*)\)/gi, '')
    // Remove bracketed suffixes
    .replace(/\s*\[(?:ao\s*vivo|live|acustico|acústico|acoustic|remix|remaster(?:ed)?|radio\s*edit|single\s*version|album\s*version|explicit|clean|feat\.?[^]]*|ft\.?[^]]*)\]/gi, '')
    // Clean up extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize artist name for comparison
 */
function normalizeArtist(artist: string): string {
  return artist
    // Remove featuring indicators at the end
    .replace(/\s*(?:feat\.?|ft\.?|featuring|part\.?|c\/|&|,)\s*.+$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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
   * 
   * IMPORTANT: Normalizes titles to remove (Ao Vivo), (Live), etc. before matching
   * This prevents duplicate downloads when library has base version
   */
  const checkSongExists = useCallback(async (artist: string, title: string): Promise<CheckResult> => {
    const threshold = config.similarityThreshold ?? 0.75;
    
    // If similarity threshold is disabled (0), treat all songs as found
    if (threshold === 0) {
      return { exists: true, path: `${artist} - ${title}.mp3`, similarity: 1.0 };
    }
    
    // Normalize to match base versions (e.g., "Song (Ao Vivo)" -> "Song")
    const normalizedArtist = normalizeArtist(artist);
    const normalizedTitle = normalizeTitle(title);
    
    // Use Electron API if available - IMPORTANT: use findSongMatch for similarity
    if (window.electronAPI?.findSongMatch) {
      try {
        // First try with normalized title (removes Ao Vivo, Live, etc.)
        let result = await window.electronAPI.findSongMatch({
          artist: normalizedArtist,
          title: normalizedTitle,
          musicFolders: config.musicFolders,
          threshold,
        } as any);
        
        // If no match with normalized, try original (in case library has the live version)
        if (!result.exists && (normalizedTitle !== title || normalizedArtist !== artist)) {
          const originalResult = await window.electronAPI.findSongMatch({
            artist,
            title,
            musicFolders: config.musicFolders,
            threshold,
          } as any);
          
          if (originalResult.exists) {
            result = originalResult;
          }
        }
        
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
        // Try normalized first, then original
        let result = await window.electronAPI.checkSongExists({
          artist: normalizedArtist,
          title: normalizedTitle,
          musicFolders: config.musicFolders,
        });
        
        if (!result.exists && (normalizedTitle !== title || normalizedArtist !== artist)) {
          result = await window.electronAPI.checkSongExists({
            artist,
            title,
            musicFolders: config.musicFolders,
          });
        }
        
        return result;
      } catch (error) {
        console.error('Error checking song in library:', error);
        return { exists: false };
      }
    }

    // Fallback for web: simulate check (always returns false in web mode)
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
 * Includes normalization to match base versions (removes Ao Vivo, Live, etc.)
 * @param threshold - Similarity threshold (0.5 to 0.95), defaults to 0.75
 */
export async function checkSongInLibrary(
  artist: string,
  title: string,
  musicFolders: string[],
  threshold: number = 0.75
): Promise<CheckResult> {
  // If threshold is 0 (disabled), skip verification entirely
  if (threshold === 0) {
    return { exists: true, filename: `${artist} - ${title}.mp3`, similarity: 1.0 };
  }

  // Check cache first
  const cached = getCachedVerification(artist, title);
  if (cached !== null) {
    return { 
      exists: cached.exists, 
      filename: cached.matchedFile, 
      similarity: cached.similarity,
      cached: true,
    };
  }

  // Normalize to match base versions
  const normalizedArtist = normalizeArtist(artist);
  const normalizedTitle = normalizeTitle(title);
  
  // Prefer findSongMatch for similarity matching
  if (window.electronAPI?.findSongMatch) {
    try {
      // First try normalized
      let result = await window.electronAPI.findSongMatch({
        artist: normalizedArtist,
        title: normalizedTitle,
        musicFolders,
        threshold,
      } as any);
      
      // If no match, try original
      if (!result.exists && (normalizedTitle !== title || normalizedArtist !== artist)) {
        const originalResult = await window.electronAPI.findSongMatch({
          artist,
          title,
          musicFolders,
          threshold,
        } as any);
        
        if (originalResult.exists) {
          result = originalResult;
        }
      }
      
      // Cache the result
      setCachedVerification(artist, title, {
        exists: result.exists,
        matchedFile: result.filename,
        similarity: result.similarity,
      });
      
      // Only log misses to reduce console spam - matches are silent
      if (!result.exists && result.similarity && result.similarity > 0.5) {
        const thresholdPercent = Math.round(threshold * 100);
        const similarityPercent = Math.round((result.similarity || 0) * 100);
        console.log(`[LIBRARY] ❌ ${artist} - ${title} (${similarityPercent}% < ${thresholdPercent}%)`);
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
      // Try normalized first
      let result = await window.electronAPI.checkSongExists({
        artist: normalizedArtist,
        title: normalizedTitle,
        musicFolders,
      });
      
      // If no match, try original
      if (!result.exists && (normalizedTitle !== title || normalizedArtist !== artist)) {
        result = await window.electronAPI.checkSongExists({
          artist,
          title,
          musicFolders,
        });
      }
      
      // Cache the result
      setCachedVerification(artist, title, {
        exists: result.exists,
        matchedFile: result.filename,
        similarity: result.similarity,
      });
      
      return result;
    } catch (error) {
      console.error('Error checking song:', error);
      return { exists: false };
    }
  }

  // Web mode: always returns false (don't cache - no library access)
  return { exists: false };
}

// Re-export cache functions for external use
export { markSongAsDownloaded, getCachedVerification } from '@/lib/libraryVerificationCache';
