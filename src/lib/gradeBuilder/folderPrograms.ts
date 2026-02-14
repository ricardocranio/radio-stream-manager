/**
 * Folder-Based Program Generators
 * 
 * Generates blocks by pulling songs directly from local download folders
 * instead of the scraped songs database. Used for specific time slots
 * where pre-downloaded content from specific stations should be used.
 * 
 * Currently covers:
 * - Happy Hour (17:00-18:30): Mix FM, Positiva FM, Metropolitana FM
 * - Romance (22:00-00:00): Músicas Românticas folder
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import type { BlockResult, BlockLogItem, BlockStats, GradeContext } from './types';
import type { WeekDay } from '@/types/radio';
import { isElectronEnv, FULL_DAY_NAMES_BY_INDEX } from './constants';

/** Configuration for folder-based blocks */
export interface FolderBlockConfig {
  /** Program name for the grade line */
  programName: string;
  /** Folders to pull songs from (full paths) */
  folders: string[];
  /** Labels for each folder (for logging) */
  folderLabels: string[];
  /** Number of songs per block */
  targetSongs: number;
  /** Coringa/fallback code */
  coringa: string;
}

/** Default configuration for the 17:00-18:30 Happy Hour blocks */
export const HAPPY_HOUR_CONFIG: FolderBlockConfig = {
  programName: 'HAPPY HOUR',
  folders: [
    'C:\\Playlist\\Downloads\\Mix FM',
    'C:\\Playlist\\Downloads\\Positiva FM',
    'C:\\Playlist\\Downloads\\Metropolitana FM',
  ],
  folderLabels: ['Mix FM', 'Positiva FM', 'Metropolitana FM'],
  targetSongs: 10,
  coringa: 'jov',
};

/** Configuration for the 21:00-00:00 Nossa Balada (weekend) blocks */
export const NOSSA_BALADA_CONFIG: FolderBlockConfig = {
  programName: 'Nossa Balada',
  folders: [
    '\\\\DESKTOP-DPOUD22\\Playlist\\Downloads\\Metropolitana FM',
    '\\\\DESKTOP-DPOUD22\\Playlist\\Downloads\\Energia 97',
    '\\\\DESKTOP-DPOUD22\\Playlist\\Downloads\\Mix FM',
    '\\\\DESKTOP-DPOUD22\\Playlist\\Downloads\\Positividade FM',
  ],
  folderLabels: ['Metropolitana FM', 'Energia 97', 'Mix FM', 'Positividade FM'],
  targetSongs: 10,
  coringa: 'jov',
};

/** Configuration for the 22:00-00:00 Romance blocks */
export const ROMANCE_CONFIG: FolderBlockConfig = {
  programName: 'Romance',
  folders: [
    'C:\\Playlist\\Músicas\\Românticas',
  ],
  folderLabels: ['Românticas'],
  targetSongs: 10,
  coringa: 'rom',
};

/** Romance time slots with their edition indices */
const ROMANCE_SLOTS: Array<{ hour: number; minute: number; edition: number }> = [
  { hour: 22, minute: 0, edition: 1 },
  { hour: 22, minute: 30, edition: 2 },
  { hour: 23, minute: 0, edition: 3 },
  { hour: 23, minute: 30, edition: 4 },
  { hour: 0, minute: 0, edition: 5 },
];

/**
 * Check if a given hour:minute falls within the folder-based Happy Hour range.
 */
export function isFolderBasedBlock(hour: number, minute: number): boolean {
  // 17:00, 17:30, 18:00
  if (hour === 17 && (minute === 0 || minute === 30)) return true;
  if (hour === 18 && minute === 0) return true;
  return false;
}

/**
 * Check if a given hour:minute falls within the Nossa Balada range (21:00-23:30).
 */
export function isNossaBaladaBlock(hour: number, minute: number): boolean {
  if (hour >= 21 && hour <= 23 && (minute === 0 || minute === 30)) return true;
  return false;
}

/**
 * Check if a given hour:minute falls within the Romance range.
 */
export function isRomanceBlock(hour: number, minute: number): boolean {
  return ROMANCE_SLOTS.some(s => s.hour === hour && s.minute === minute);
}

/**
 * Get the edition number for a Romance block (1-5).
 */
function getRomanceEdition(hour: number, minute: number): number {
  const slot = ROMANCE_SLOTS.find(s => s.hour === hour && s.minute === minute);
  return slot?.edition || 1;
}

/**
 * List MP3 files from a folder using Electron API.
 */
async function listMp3Files(folderPath: string): Promise<string[]> {
  if (!isElectronEnv || !window.electronAPI?.listFolderFiles) return [];

  try {
    const result = await window.electronAPI.listFolderFiles({
      folder: folderPath,
      extension: '.mp3',
    });

    if (result.success && result.files.length > 0) {
      return result.files.map(f => f.name);
    }
  } catch (err) {
    console.warn(`[FOLDER-BLOCK] Could not list files in ${folderPath}:`, err);
  }
  return [];
}

/**
 * Generate a block from local download folders.
 * Songs are selected randomly, intercalating equally between folders,
 * respecting anti-repetition rules.
 */
export async function generateFolderBasedBlock(
  hour: number,
  minute: number,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  config?: FolderBlockConfig
): Promise<BlockResult> {
  const cfg = config || HAPPY_HOUR_CONFIG;
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];

  console.log(`[FOLDER-BLOCK] 📂 Montando bloco ${timeStr} a partir de pastas locais`);

  // List files from each folder
  const folderFiles: string[][] = [];
  for (const folder of cfg.folders) {
    const files = await listMp3Files(folder);
    // Shuffle for random selection
    const shuffled = [...files].sort(() => Math.random() - 0.5);
    folderFiles.push(shuffled);
    console.log(`[FOLDER-BLOCK] 📁 ${folder}: ${files.length} arquivos`);
  }

  const selectedSongs: string[] = [];
  const usedFiles = new Set<string>();
  const usedArtists = new Set<string>();
  const folderIndices = cfg.folders.map(() => 0);

  // Intercalate equally between folders
  for (let i = 0; i < cfg.targetSongs; i++) {
    const folderIdx = i % cfg.folders.length;
    const files = folderFiles[folderIdx];
    const label = cfg.folderLabels[folderIdx];
    let found = false;

    while (folderIndices[folderIdx] < files.length && !found) {
      const filename = files[folderIndices[folderIdx]];
      folderIndices[folderIdx]++;

      const normalizedFilename = filename.toUpperCase();
      if (usedFiles.has(normalizedFilename)) continue;

      // Extract artist from filename pattern "ARTIST - TITLE.mp3"
      const baseName = filename.replace(/\.mp3$/i, '');
      const parts = baseName.split(' - ');
      const artist = parts[0]?.trim() || '';
      const title = parts.slice(1).join(' - ')?.trim() || baseName;
      const normalizedArtist = artist.toLowerCase().trim();

      // Check anti-repetition
      if (normalizedArtist && usedArtists.has(normalizedArtist)) continue;
      if (ctx.isRecentlyUsed(title, artist, timeStr, isFullDay)) continue;

      // Use the file as-is (already sanitized from download)
      const sanitized = sanitizeFilename(filename).toUpperCase();
      selectedSongs.push(`"${sanitized}"`);
      usedFiles.add(normalizedFilename);
      if (normalizedArtist) usedArtists.add(normalizedArtist);
      ctx.markSongAsUsed(title, artist, timeStr);

      logs.push({
        blockTime: timeStr,
        type: 'used',
        title,
        artist,
        station: label,
        reason: `Pasta local: ${label}`,
      });
      found = true;
    }

    // If this folder is exhausted, try next folders
    if (!found) {
      let fallbackFound = false;
      for (let j = 1; j < cfg.folders.length; j++) {
        const altIdx = (folderIdx + j) % cfg.folders.length;
        const altFiles = folderFiles[altIdx];
        const altLabel = cfg.folderLabels[altIdx];

        while (folderIndices[altIdx] < altFiles.length && !fallbackFound) {
          const filename = altFiles[folderIndices[altIdx]];
          folderIndices[altIdx]++;

          const normalizedFilename = filename.toUpperCase();
          if (usedFiles.has(normalizedFilename)) continue;

          const baseName = filename.replace(/\.mp3$/i, '');
          const parts = baseName.split(' - ');
          const artist = parts[0]?.trim() || '';
          const title = parts.slice(1).join(' - ')?.trim() || baseName;
          const normalizedArtist = artist.toLowerCase().trim();

          if (normalizedArtist && usedArtists.has(normalizedArtist)) continue;
          if (ctx.isRecentlyUsed(title, artist, timeStr, isFullDay)) continue;

          const sanitized = sanitizeFilename(filename).toUpperCase();
          selectedSongs.push(`"${sanitized}"`);
          usedFiles.add(normalizedFilename);
          if (normalizedArtist) usedArtists.add(normalizedArtist);
          ctx.markSongAsUsed(title, artist, timeStr);

          logs.push({
            blockTime: timeStr,
            type: 'used',
            title,
            artist,
            station: altLabel,
            reason: `Pasta local (fallback): ${altLabel}`,
          });
          fallbackFound = true;
        }
        if (fallbackFound) break;
      }

      // Ultimate fallback: coringa
      if (!fallbackFound) {
        selectedSongs.push(cfg.coringa);
        stats.missing++;
        logs.push({
          blockTime: timeStr,
          type: 'substituted',
          title: cfg.coringa,
          artist: 'CORINGA',
          station: 'FALLBACK',
          reason: 'Todas as pastas esgotadas',
        });
      }
    }
  }

  console.log(`[FOLDER-BLOCK] ✅ Bloco ${timeStr}: ${selectedSongs.length} músicas selecionadas de pastas locais`);

  return {
    line: ctx.sanitizeGradeLine(`${timeStr} (ID=${cfg.programName}) ${selectedSongs.join(',vht,')}`),
    logs,
  };
}

/**
 * Generate a Romance block (22:00-00:00).
 * Includes fixed content ROMANCE_BLOCO{ED} at start + songs from Românticas folder.
 * Each block gets a correct edition number (01-05).
 */
export async function generateRomanceBlock(
  hour: number,
  minute: number,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  targetDay?: WeekDay
): Promise<BlockResult> {
  const cfg = ROMANCE_CONFIG;
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const edition = getRomanceEdition(hour, minute);
  const editionStr = edition.toString().padStart(2, '0');

  // Build fixed content filename: ROMANCE_BLOCO01_SEGUNDA.MP3
  const dayIndex = targetDay
    ? ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'].indexOf(targetDay)
    : new Date().getDay();
  const fullDayName = FULL_DAY_NAMES_BY_INDEX[dayIndex] || 'SEGUNDA';
  const fixedFileName = `ROMANCE_BLOCO${editionStr}_${fullDayName}.MP3`;

  logs.push({
    blockTime: timeStr,
    type: 'fixed',
    title: `Romance Bloco ${editionStr}`,
    artist: fixedFileName,
    station: 'FIXO',
    reason: `Conteúdo fixo Romance edição ${editionStr} (${fullDayName})`,
  });

  console.log(`[ROMANCE] 💕 Montando bloco ${timeStr} (edição ${editionStr}) a partir de pasta local`);

  // List files from the Românticas folder
  const folderFiles: string[][] = [];
  for (const folder of cfg.folders) {
    const files = await listMp3Files(folder);
    const shuffled = [...files].sort(() => Math.random() - 0.5);
    folderFiles.push(shuffled);
    console.log(`[ROMANCE] 📁 ${folder}: ${files.length} arquivos`);
  }

  const selectedSongs: string[] = [];
  const usedFiles = new Set<string>();
  const usedArtists = new Set<string>();
  const folderIndices = cfg.folders.map(() => 0);

  // Select songs from folder(s)
  for (let i = 0; i < cfg.targetSongs; i++) {
    const folderIdx = i % cfg.folders.length;
    const files = folderFiles[folderIdx];
    const label = cfg.folderLabels[folderIdx];
    let found = false;

    while (folderIndices[folderIdx] < files.length && !found) {
      const filename = files[folderIndices[folderIdx]];
      folderIndices[folderIdx]++;

      const normalizedFilename = filename.toUpperCase();
      if (usedFiles.has(normalizedFilename)) continue;

      const baseName = filename.replace(/\.mp3$/i, '');
      const parts = baseName.split(' - ');
      const artist = parts[0]?.trim() || '';
      const title = parts.slice(1).join(' - ')?.trim() || baseName;
      const normalizedArtist = artist.toLowerCase().trim();

      if (normalizedArtist && usedArtists.has(normalizedArtist)) continue;
      if (ctx.isRecentlyUsed(title, artist, timeStr, isFullDay)) continue;

      const sanitized = sanitizeFilename(filename).toUpperCase();
      selectedSongs.push(`"${sanitized}"`);
      usedFiles.add(normalizedFilename);
      if (normalizedArtist) usedArtists.add(normalizedArtist);
      ctx.markSongAsUsed(title, artist, timeStr);

      logs.push({
        blockTime: timeStr,
        type: 'used',
        title,
        artist,
        station: label,
        reason: `Pasta local: ${label}`,
      });
      found = true;
    }

    if (!found) {
      selectedSongs.push(cfg.coringa);
      stats.missing++;
      logs.push({
        blockTime: timeStr,
        type: 'substituted',
        title: cfg.coringa,
        artist: 'CORINGA',
        station: 'FALLBACK',
        reason: 'Pasta Românticas esgotada',
      });
    }
  }

  console.log(`[ROMANCE] ✅ Bloco ${timeStr}: ${selectedSongs.length} músicas + fixo BLOCO${editionStr}`);

  // Build final line: fixed content at start, then songs
  const allContent = [`"${fixedFileName}"`, ...selectedSongs];

  return {
    line: ctx.sanitizeGradeLine(`${timeStr} (ID=${cfg.programName}) ${allContent.join(',vht,')}`),
    logs,
  };
}
