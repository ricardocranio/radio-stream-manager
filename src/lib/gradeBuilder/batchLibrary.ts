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
 * Remove common suffixes like (Ao Vivo), (Live), (Acústico), [Remix], etc.
 * This allows matching "Song (Ao Vivo)" with "Song" in the library
 */
function normalizeTitle(title: string): string {
  return title
    .replace(/\s*\((?:ao\s*vivo|live|acustico|acústico|acoustic|remix|remaster(?:ed)?|radio\s*edit|single\s*version|album\s*version|explicit|clean|feat\.?[^)]*|ft\.?[^)]*)\)/gi, '')
    .replace(/\s*\[(?:ao\s*vivo|live|acustico|acústico|acoustic|remix|remaster(?:ed)?|radio\s*edit|single\s*version|album\s*version|explicit|clean|feat\.?[^]]*|ft\.?[^]]*)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize artist name for comparison
 */
function normalizeArtist(artist: string): string {
  return artist
    .replace(/\s*(?:feat\.?|ft\.?|featuring|part\.?|c\/|&|,)\s*.+$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Single song library check with similarity threshold and normalization.
 */
async function findSongMatchWithFallback(
  artist: string,
  title: string,
  musicFolders: string[],
  threshold: number = 0.75
): Promise<LibraryCheckResult> {
  if (!window.electronAPI?.findSongMatch) {
    return { exists: true };
  }

  const normalizedArtist = normalizeArtist(artist);
  const normalizedTitle = normalizeTitle(title);

  try {
    // First try with normalized title/artist
    let result = await window.electronAPI.findSongMatch({
      artist: normalizedArtist,
      title: normalizedTitle,
      musicFolders,
      threshold,
    } as any);

    // If no match with normalized, try original
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

    if (result.exists && result.baseName) {
      return { exists: true, filename: `${result.baseName}.mp3` };
    }
    return { exists: result.exists };
  } catch (error) {
    console.error(`[BATCH-LIBRARY] Error matching ${artist} - ${title}:`, error);
    return { exists: true }; // On error, assume exists to avoid blocking
  }
}

/**
 * Check multiple songs in the library in parallel batches.
 * Returns a Map keyed by "artist|title" (lowercase).
 */
export async function batchFindSongsInLibrary(
  songs: Array<{ artist: string; title: string }>,
  musicFolders: string[],
  threshold: number = 0.75
): Promise<Map<string, LibraryCheckResult>> {
  const results = new Map<string, LibraryCheckResult>();
  
  if (!isElectronEnv || !window.electronAPI?.findSongMatch) {
    // Web mode: assume all exist
    for (const song of songs) {
      const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
      results.set(key, { exists: true });
    }
    return results;
  }

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
        const result = await findSongMatchWithFallback(song.artist, song.title, musicFolders, threshold);
        return { key, result };
      })
    );
    
    for (const { key, result } of batchResults) {
      results.set(key, result);
    }
  }

  // Log summary
  const found = Array.from(results.values()).filter(r => r.exists).length;
  console.log(`[BATCH-LIBRARY] Verificação: ${found}/${results.size} músicas encontradas (threshold: ${Math.round(threshold * 100)}%)`);

  return results;
}

/**
 * Single song library check (wrapper for consistency).
 */
export async function findSongInLibrary(
  artist: string,
  title: string,
  musicFolders: string[],
  threshold: number = 0.75
): Promise<LibraryCheckResult> {
  if (!isElectronEnv || !window.electronAPI?.findSongMatch) {
    return { exists: true }; // Web mode: assume exists
  }
  
  return findSongMatchWithFallback(artist, title, musicFolders, threshold);
}
