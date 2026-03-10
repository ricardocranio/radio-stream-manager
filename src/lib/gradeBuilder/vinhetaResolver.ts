/**
 * Vinheta Resolver
 * 
 * Replaces VHT/VHTN tokens in grade lines with real .mp3 files
 * from C:\Playlist\Vinhetas, randomly without repetition.
 * Only repeats after all files have been used (full cycle).
 * 
 * BPM-Aware: Scans vinheta ID3 tags for BPM and picks the vinheta
 * whose tempo best bridges adjacent songs for smooth transitions.
 */
import { getIsElectronEnv } from './constants';
import { getBpmFromCache, updateBpmCacheEntry } from '@/lib/bpmCacheBridge';

let vinhetaPool: string[] = [];
let usedVinhetas: Set<string> = new Set();
let cachedFiles: string[] | null = null;

// BPM cache for vinhetas: filename → bpm
let vhtBpmMap: Map<string, number> = new Map();
let vhtBpmScanned = false;

/**
 * Load vinheta files from the configured folder.
 * Caches the file list for the session.
 */
async function loadVinhetaFiles(folder: string): Promise<string[]> {
  if (cachedFiles !== null) return cachedFiles;

  if (!getIsElectronEnv() || !window.electronAPI?.listFolderFiles) {
    cachedFiles = [];
    return [];
  }

  try {
    const result = await window.electronAPI.listFolderFiles({
      folder,
      extension: '.mp3',
    });

    if (result.success && result.files.length > 0) {
      cachedFiles = result.files.map(f => f.name);
      console.log(`[VINHETA] 📂 ${cachedFiles.length} vinhetas encontradas em ${folder}`);
    } else {
      cachedFiles = [];
      console.warn(`[VINHETA] ⚠️ Nenhuma vinheta encontrada em ${folder}`);
    }
  } catch (err) {
    console.warn(`[VINHETA] Erro ao listar pasta ${folder}:`, err);
    cachedFiles = [];
  }

  return cachedFiles;
}

/**
 * Scan BPM tags from all vinheta files (once per session).
 * Uses batch scanning for efficiency.
 */
async function scanVhtBpm(folder: string, files: string[]): Promise<void> {
  if (vhtBpmScanned || files.length === 0) return;
  if (!getIsElectronEnv() || !window.electronAPI?.scanBpmTags) return;

  try {
    const result = await window.electronAPI.scanBpmTags({
      folders: [folder],
    });

    if (result?.success && result.samples) {
      let count = 0;
      for (const entry of result.samples) {
        if (entry.bpm > 0 && entry.bpm < 300) {
          vhtBpmMap.set(entry.filename, entry.bpm);
          count++;
        }
      }
      console.log(`[VINHETA] 🥁 BPM scanned: ${count}/${files.length} vinhetas com BPM`);
    }
  } catch (err) {
    console.warn('[VINHETA] BPM scan falhou (não-crítico):', err);
  }
  vhtBpmScanned = true;
}

/**
 * Shuffle array using Fisher-Yates algorithm.
 */
function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get the next vinheta file without repetition.
 * Resets the pool when all files have been used.
 */
function getNextVinheta(files: string[]): string | null {
  if (files.length === 0) return null;

  // Refill pool if empty
  if (vinhetaPool.length === 0) {
    vinhetaPool = shuffleArray(files);
    usedVinhetas.clear();
    console.log(`[VINHETA] 🔄 Pool reiniciado: ${vinhetaPool.length} vinhetas embaralhadas`);
  }

  const next = vinhetaPool.pop()!;
  usedVinhetas.add(next);
  return next;
}

/**
 * Get the best BPM-matched vinheta for smooth transition.
 * Picks the vinheta whose BPM is closest to the target BPM.
 * Falls back to random selection if no BPM data is available.
 */
function getBpmMatchedVinheta(files: string[], targetBpm: number | null): string | null {
  if (files.length === 0) return null;

  // If no target BPM or no VHT BPM data, fall back to standard selection
  if (!targetBpm || vhtBpmMap.size === 0) {
    return getNextVinheta(files);
  }

  // Refill pool if empty
  if (vinhetaPool.length === 0) {
    vinhetaPool = shuffleArray(files);
    usedVinhetas.clear();
    console.log(`[VINHETA] 🔄 Pool reiniciado (BPM-aware): ${vinhetaPool.length} vinhetas`);
  }

  // Find the best match from remaining pool
  let bestIdx = -1;
  let bestDiff = Infinity;

  for (let i = 0; i < vinhetaPool.length; i++) {
    const vhtBpm = vhtBpmMap.get(vinhetaPool[i]);
    if (!vhtBpm) continue;
    const diff = Math.abs(vhtBpm - targetBpm);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  // If we found a BPM match within 20 BPM, use it; otherwise fall back to random
  if (bestIdx >= 0 && bestDiff <= 20) {
    const [chosen] = vinhetaPool.splice(bestIdx, 1);
    usedVinhetas.add(chosen);
    const chosenBpm = vhtBpmMap.get(chosen);
    console.log(`[VINHETA] 🎯 BPM match: ${chosen} (${chosenBpm} BPM, target: ${targetBpm}, diff: ${bestDiff})`);
    return chosen;
  }

  // Fallback to standard random
  return getNextVinheta(files);
}

/**
 * Extract BPM from a song filename token in the grade line.
 * Tries the BPM cache bridge first.
 */
function extractBpmFromToken(token: string): number | null {
  const cleanName = token.replace(/^"|"$/g, '').replace(/\.mp3$/i, '');
  // Try "Artist - Title" pattern
  const parts = cleanName.split(' - ');
  if (parts.length >= 2) {
    const artist = parts[0].trim();
    const title = parts.slice(1).join(' - ').trim();
    return getBpmFromCache(artist, title);
  }
  return null;
}

/**
 * Replace all VHT and VHTN tokens in a grade line with real vinheta filenames.
 * BPM-aware: picks vinhetas that bridge adjacent song tempos smoothly.
 * 
 * @param line - The grade line
 * @param vinhetaFolder - Path to vinhetas folder
 * @returns The line with VHT/VHTN replaced by quoted filenames
 */
export async function resolveVinhetasInLine(
  line: string,
  vinhetaFolder: string = 'C:\\Playlist\\Vinhetas'
): Promise<string> {
  const files = await loadVinhetaFiles(vinhetaFolder);
  if (files.length === 0) return line;

  // Scan BPM on first call
  if (!vhtBpmScanned) {
    await scanVhtBpm(vinhetaFolder, files);
  }

  // Split by comma, replace vht/vhtn tokens with BPM-aware selection
  const parts = line.split(',');
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim().toLowerCase();
    if (trimmed === 'vht' || trimmed === 'vhtn') {
      // Look at adjacent song tokens for BPM context
      let targetBpm: number | null = null;

      // Check preceding song
      if (i > 0) {
        const prevBpm = extractBpmFromToken(parts[i - 1].trim());
        if (prevBpm) targetBpm = prevBpm;
      }
      // Check following song and average if both available
      if (i < parts.length - 1) {
        const nextBpm = extractBpmFromToken(parts[i + 1].trim());
        if (nextBpm) {
          targetBpm = targetBpm ? Math.round((targetBpm + nextBpm) / 2) : nextBpm;
        }
      }

      const vinhetaFile = getBpmMatchedVinheta(files, targetBpm);
      if (vinhetaFile) {
        parts[i] = `"${vinhetaFile}"`;
      }
    }
  }

  return parts.join(',');
}

/**
 * Replace VHT/VHTN tokens in all lines of a full grade.
 */
export async function resolveVinhetasInGrade(
  lines: string[],
  vinhetaFolder: string = 'C:\\Playlist\\Vinhetas'
): Promise<string[]> {
  // Reset pool for a fresh full-day build
  resetVinhetaPool();
  
  const resolved: string[] = [];
  for (const line of lines) {
    resolved.push(await resolveVinhetasInLine(line, vinhetaFolder));
  }
  return resolved;
}

/**
 * Reset the vinheta pool and cache (e.g. on daily reset or full rebuild).
 */
export function resetVinhetaPool(): void {
  vinhetaPool = [];
  usedVinhetas.clear();
  cachedFiles = null;
  vhtBpmMap.clear();
  vhtBpmScanned = false;
  console.log('[VINHETA] 🧹 Pool, cache e BPM resetados');
}
