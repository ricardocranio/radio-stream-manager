/**
 * Vinheta Resolver
 * 
 * Replaces VHT/VHTN tokens in grade lines with real .mp3 files
 * from C:\Playlist\Vinhetas, randomly without repetition.
 * Only repeats after all files have been used (full cycle).
 */
import { getIsElectronEnv } from './constants';

let vinhetaPool: string[] = [];
let usedVinhetas: Set<string> = new Set();
let cachedFiles: string[] | null = null;

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
 * Replace all VHT and VHTN tokens in a grade line with real vinheta filenames.
 * Tokens are case-insensitive. Each replacement uses a unique file.
 * 
 * @param line - The grade line (e.g. '08:00 (ID=PROGRAMA) "SONG.MP3",vht,"SONG2.MP3",vhtn')
 * @param vinhetaFolder - Path to vinhetas folder (default: C:\Playlist\Vinhetas)
 * @returns The line with VHT/VHTN replaced by quoted filenames
 */
export async function resolveVinhetasInLine(
  line: string,
  vinhetaFolder: string = 'C:\\Playlist\\Vinhetas'
): Promise<string> {
  const files = await loadVinhetaFiles(vinhetaFolder);
  if (files.length === 0) return line; // No files available, keep tokens as-is

  // Split by comma, replace vht/vhtn tokens
  const parts = line.split(',');
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim().toLowerCase();
    if (trimmed === 'vht' || trimmed === 'vhtn') {
      const vinhetaFile = getNextVinheta(files);
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
  console.log('[VINHETA] 🧹 Pool e cache resetados');
}
