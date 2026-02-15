/**
 * Batch library verification for parallel song checking.
 * 
 * Instead of checking songs one-by-one (sequential), this module
 * checks multiple candidates in parallel using Promise.all with
 * concurrency limiting to avoid overwhelming the Electron IPC.
 */

import { isElectronEnv } from './constants';
import type { LibraryCheckResult } from './types';

const BATCH_CONCURRENCY = 5; // Max parallel Electron IPC calls

/**
 * Check multiple songs in the library in parallel batches.
 * Returns a Map keyed by "artist|title" (lowercase).
 */
export async function batchFindSongsInLibrary(
  songs: Array<{ artist: string; title: string }>,
  musicFolders: string[],
  similarityThreshold?: number
): Promise<Map<string, LibraryCheckResult>> {
  // Web mode OR threshold disabled (0): assume all songs exist (simulation-like behavior)
  if (!isElectronEnv || !window.electronAPI?.findSongMatch || similarityThreshold === 0) {
    return new Proxy(new Map<string, LibraryCheckResult>(), {
      get(target, prop) {
        if (prop === 'get') return () => ({ exists: true } as LibraryCheckResult);
        if (prop === 'has') return () => true;
        if (prop === 'size') return 0;
        return Reflect.get(target, prop);
      }
    });
  }

  const results = new Map<string, LibraryCheckResult>();

  // Deduplicate by key
  const uniqueSongs = new Map<string, { artist: string; title: string }>();
  for (const song of songs) {
    const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
    if (!uniqueSongs.has(key)) {
      uniqueSongs.set(key, song);
    }
  }

  const entries = Array.from(uniqueSongs.entries());

  // Process in batches of BATCH_CONCURRENCY
  for (let i = 0; i < entries.length; i += BATCH_CONCURRENCY) {
    const batch = entries.slice(i, i + BATCH_CONCURRENCY);
    
    const batchResults = await Promise.all(
      batch.map(async ([key, song]) => {
        try {
          const result = await window.electronAPI!.findSongMatch!({
            artist: song.artist,
            title: song.title,
            musicFolders,
          });
          
          const checkResult: LibraryCheckResult = {
            exists: result.exists,
            filename: result.exists && result.baseName ? `${result.baseName}.mp3` : undefined,
          };
          
          return { key, result: checkResult };
        } catch (error) {
          console.error(`[BATCH-LIBRARY] Error checking ${song.artist} - ${song.title}:`, error);
          return { key, result: { exists: true } as LibraryCheckResult }; // On error, assume exists
        }
      })
    );
    
    for (const { key, result } of batchResults) {
      results.set(key, result);
    }
  }

  return results;
}

/**
 * Single song library check (wrapper for consistency).
 */
export async function findSongInLibrary(
  artist: string,
  title: string,
  musicFolders: string[],
  similarityThreshold?: number
): Promise<LibraryCheckResult> {
  // Web mode OR threshold disabled (0): assume exists (simulation-like behavior)
  if (!isElectronEnv || !window.electronAPI?.findSongMatch || similarityThreshold === 0) {
    return { exists: true }; // Assume exists
  }
  
  try {
    const result = await window.electronAPI.findSongMatch({
      artist,
      title,
      musicFolders,
    });
    
    if (result.exists && result.baseName) {
      return { exists: true, filename: `${result.baseName}.mp3` };
    }
    return { exists: result.exists };
  } catch (error) {
    console.error('[GRADE] Error finding song match:', error);
    return { exists: true }; // On error, assume exists to avoid blocking
  }
}
