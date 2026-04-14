/**
 * Batch library verification for parallel song checking.
 * 
 * Instead of checking songs one-by-one (sequential), this module
 * checks multiple candidates in parallel using Promise.all with
 * concurrency limiting to avoid overwhelming the Electron IPC.
 * 
 * Normalization is delegated to songUtils.ts to avoid duplication.
 */

import { getIsElectronEnv } from './constants';
import { normalizeStr, normalizeStrKeepSuffix } from '@/lib/songUtils';
import type { LibraryCheckResult } from './types';

const BATCH_CONCURRENCY = 5; // Max parallel Electron IPC calls

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
 * Normalize title for library file search.
 * Uses normalizeStr (strips suffixes like "Ao Vivo") for fuzzy matching.
 */
function normalizeTitleForSearch(title: string): string {
  return normalizeStr(title);
}

/**
 * Normalize artist for library file search.
 * Uses normalizeStr (strips feat/ft, accents, ampersand) for fuzzy matching.
 */
function normalizeArtistForSearch(artist: string): string {
  return normalizeStr(artist);
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

  const normalizedArtist = normalizeArtistForSearch(artist);
  const normalizedTitle = normalizeTitleForSearch(title);

  try {
    console.log(`[BATCH-LIBRARY] 🔍 Buscando: "${artist} - ${title}" (normalized: "${normalizedArtist} - ${normalizedTitle}") (threshold: ${Math.round(threshold * 100)}%, folders: ${musicFolders.length})`);
    
    // First try with normalized title/artist (suffixes stripped)
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

    // If no match with normalized, try with suffixes preserved (normalizeStrKeepSuffix)
    if (!result.exists) {
      const keepSuffixArtist = normalizeStrKeepSuffix(artist);
      const keepSuffixTitle = normalizeStrKeepSuffix(title);
      if (keepSuffixArtist !== normalizedArtist || keepSuffixTitle !== normalizedTitle) {
        console.log(`[BATCH-LIBRARY] 🔄 Tentando com sufixos preservados: "${keepSuffixArtist} - ${keepSuffixTitle}"`);
        const suffixResult = await window.electronAPI.findSongMatch({
          artist: keepSuffixArtist,
          title: keepSuffixTitle,
          musicFolders,
          threshold,
        } as any);
        if (suffixResult.exists) {
          result = suffixResult;
          console.log(`[BATCH-LIBRARY] ✅ Match (keep-suffix): sim=${result.similarity ? Math.round(result.similarity * 100) : '?'}% file="${result.filename || '?'}"`);
        }
      }
    }

    // Fallback 3: Try original strings (no normalization at all)
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
      }
    }

    // Fallback 4: Try with ampersand-normalized names (& ↔ E)
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

    // Fallback 5: If threshold > 0.60, retry with relaxed threshold (0.60)
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
    return { exists: true };
  }
  
  return findSongMatchWithFallback(artist, title, musicFolders, threshold);
}
