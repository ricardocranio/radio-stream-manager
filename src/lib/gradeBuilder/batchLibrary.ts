/**
 * Batch library verification for parallel song checking.
 * 
 * Instead of checking songs one-by-one (sequential), this module
 * checks multiple candidates in parallel using Promise.all with
 * concurrency limiting to avoid overwhelming the Electron IPC.
 */

import { getIsElectronEnv } from './constants';
import type { LibraryCheckResult } from './types';

const BATCH_CONCURRENCY = 5; // Max parallel Electron IPC calls

/**
 * Strip accents/diacritics from a string for fuzzy matching.
 */
function stripAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalize ampersand vs "E"/"e" — common in Brazilian duo names.
 * "Henrique & Juliano" ↔ "Henrique E Juliano"
 */
function normalizeAmpersand(str: string): string {
  return str
    .replace(/\s*&\s*/g, ' E ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove common suffixes like (Ao Vivo), (Live), (Acústico), [Remix], etc.
 * This allows matching "Song (Ao Vivo)" with "Song" in the library
 */
function normalizeTitle(title: string): string {
  return stripAccents(
    title
      .replace(/\s*\((?:ao\s*vivo|live|acustico|acústico|acoustic|remix|remaster(?:ed)?|radio\s*edit|single\s*version|album\s*version|explicit|clean|feat\.?[^)]*|ft\.?[^)]*)\)/gi, '')
      .replace(/\s*\[(?:ao\s*vivo|live|acustico|acústico|acoustic|remix|remaster(?:ed)?|radio\s*edit|single\s*version|album\s*version|explicit|clean|feat\.?[^]]*|ft\.?[^]]*)\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Normalize artist name for comparison.
 * Strips feat/ft suffixes and normalizes ampersand/accents.
 */
function normalizeArtist(artist: string): string {
  return stripAccents(
    normalizeAmpersand(
      artist
        .replace(/\s*(?:feat\.?|ft\.?|featuring|part\.?|c\/)\s*.+$/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
  );
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
    console.log(`[BATCH-LIBRARY] 🔍 Buscando: "${artist} - ${title}" (normalized: "${normalizedArtist} - ${normalizedTitle}") (threshold: ${Math.round(threshold * 100)}%, folders: ${musicFolders.length})`);
    
    // First try with normalized title/artist
    let result = await window.electronAPI.findSongMatch({
      artist: normalizedArtist,
      title: normalizedTitle,
      musicFolders,
      threshold,
    } as any);

    if (result.exists) {
      console.log(`[BATCH-LIBRARY] ✅ Match (normalized): sim=${result.similarity ? Math.round(result.similarity * 100) : '?'}% strategy=${result.strategy || '?'} file="${result.filename || result.baseName || '?'}"`);
    } else {
      console.log(`[BATCH-LIBRARY] 🔸 No match (normalized): bestSim=${result.similarity ? Math.round(result.similarity * 100) : 0}% bestFile="${result.filename || 'none'}"`);
    }

    // If no match with normalized, try original
    if (!result.exists && (normalizedTitle !== title || normalizedArtist !== artist)) {
      console.log(`[BATCH-LIBRARY] 🔄 Tentando original: "${artist} - ${title}"`);
      const originalResult = await window.electronAPI.findSongMatch({
        artist,
        title,
        musicFolders,
        threshold,
      } as any);
      if (originalResult.exists) {
        result = originalResult;
        console.log(`[BATCH-LIBRARY] ✅ Match (original): sim=${result.similarity ? Math.round(result.similarity * 100) : '?'}% file="${result.filename || '?'}"`);
      } else {
        console.log(`[BATCH-LIBRARY] 🔸 No match (original): bestSim=${originalResult.similarity ? Math.round(originalResult.similarity * 100) : 0}%`);
      }
    }

    // Fallback 3: Try with ampersand-normalized names (& ↔ E)
    if (!result.exists) {
      const ampArtist = normalizeAmpersand(artist);
      const ampTitle = normalizeAmpersand(title);
      if (ampArtist !== normalizedArtist || ampTitle !== normalizedTitle) {
        const ampResult = await window.electronAPI.findSongMatch({
          artist: ampArtist, title: ampTitle, musicFolders, threshold,
        } as any);
        if (ampResult.exists) {
          result = ampResult;
          console.log(`[BATCH-LIBRARY] ✅ Match (ampersand-norm): sim=${result.similarity ? Math.round(result.similarity * 100) : '?'}% file="${result.filename || '?'}"`);
        }
      }
    }

    // Fallback 4: If threshold > 0.60, retry with relaxed threshold (0.60)
    // This catches close matches that miss the strict threshold
    if (!result.exists && threshold > 0.60) {
      const RELAXED = 0.60;
      const relaxedResult = await window.electronAPI.findSongMatch({
        artist: normalizedArtist, title: normalizedTitle, musicFolders, threshold: RELAXED,
      } as any);
      if (relaxedResult.exists) {
        result = relaxedResult;
        console.log(`[BATCH-LIBRARY] ✅ Match (relaxed ${Math.round(RELAXED * 100)}%): sim=${result.similarity ? Math.round(result.similarity * 100) : '?'}% file="${result.filename || '?'}"`);
      }
    }

    if (result.exists) {
      const realFilename = result.filename || (result.baseName ? `${result.baseName}.mp3` : null);
      if (realFilename) {
        console.log(`[BATCH-LIBRARY] ✅ Encontrado: "${artist} - ${title}" → ${realFilename}`);
        return { exists: true, filename: realFilename };
      }
    }
    console.log(`[BATCH-LIBRARY] ❌ Não encontrado: "${artist} - ${title}" (threshold: ${Math.round(threshold * 100)}%)`);
    return { exists: false };
  } catch (error) {
    console.error(`[BATCH-LIBRARY] 💥 Error matching "${artist} - ${title}":`, error);
    return { exists: false };
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
  
  if (!getIsElectronEnv() || !window.electronAPI?.findSongMatch) {
    console.log(`[BATCH-LIBRARY] 🌐 Modo web detectado (isElectron: ${getIsElectronEnv()}, hasAPI: ${!!window.electronAPI?.findSongMatch}) - assumindo todas existem`);
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
  if (!getIsElectronEnv() || !window.electronAPI?.findSongMatch) {
    console.log(`[BATCH-LIBRARY] 🌐 findSongInLibrary: modo web (isElectron: ${getIsElectronEnv()}) - assumindo existe`);
    return { exists: true }; // Web mode: assume exists
  }
  
  return findSongMatchWithFallback(artist, title, musicFolders, threshold);
}
