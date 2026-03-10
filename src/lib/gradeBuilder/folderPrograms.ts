/**
 * Folder-Based Program Generators
 * 
 * Generates blocks by pulling songs directly from local download folders
 * instead of the scraped songs database. Used for specific time slots
 * where pre-downloaded content from specific stations should be used.
 * 
 * Currently covers:
 * - Romance (22:00-00:00): Músicas Românticas folder (BPM-aware)
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import type { BlockResult, BlockLogItem, BlockStats, GradeContext } from './types';
import type { WeekDay } from '@/types/radio';
import { getIsElectronEnv, FULL_DAY_NAMES_BY_INDEX } from './constants';
import { getBpmFromCache, updateBpmCacheEntry } from '@/lib/bpmCacheBridge';

/** Configuration for the 22:00-00:00 Romance blocks */
export const ROMANCE_CONFIG = {
  programName: 'Romance',
  folders: [
    'C:\\Playlist\\Músicas\\Romnticas',
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
  if (!getIsElectronEnv() || !window.electronAPI?.listFolderFiles) return [];

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
 * Parse artist and title from a filename like "Artist - Title.mp3"
 */
function parseFilename(filename: string): { artist: string; title: string } {
  const baseName = filename.replace(/\.mp3$/i, '');
  const parts = baseName.split(' - ');
  const artist = parts[0]?.trim() || '';
  const title = parts.slice(1).join(' - ')?.trim() || baseName;
  return { artist, title };
}

/**
 * Read BPM from ID3 tags via Electron for a single file in a folder.
 */
async function readFileBpm(filename: string, folders: string[]): Promise<number | null> {
  // Check cache first
  const { artist, title } = parseFilename(filename);
  const cached = getBpmFromCache(artist, title);
  if (cached) return cached;

  // Try reading from file
  if (!getIsElectronEnv() || !window.electronAPI?.readId3Genre) return null;
  try {
    const result = await (window.electronAPI as any).readId3Genre({
      filePath: filename,
      musicFolders: folders,
    });
    if (result?.success && (result as any).bpm) {
      const bpm = parseInt(String((result as any).bpm), 10);
      if (bpm > 0 && bpm < 300) {
        updateBpmCacheEntry(artist, title, bpm);
        return bpm;
      }
    }
  } catch { /* non-critical */ }
  return null;
}

/**
 * Sort candidates by BPM proximity to create smooth transitions.
 * Uses a "nearest neighbor" greedy approach starting from the first song.
 */
function sortByBpmFlow(
  candidates: Array<{ filename: string; bpm: number | null; artist: string; title: string }>
): typeof candidates {
  if (candidates.length <= 2) return candidates;

  const withBpm = candidates.filter(c => c.bpm && c.bpm > 0);
  const withoutBpm = candidates.filter(c => !c.bpm || c.bpm <= 0);

  if (withBpm.length <= 1) return candidates; // Not enough BPM data

  // Greedy nearest-neighbor BPM chain
  const sorted: typeof withBpm = [];
  const remaining = [...withBpm];

  // Start with a medium-tempo song (~100-110 BPM, typical for ballads)
  remaining.sort((a, b) => Math.abs((a.bpm || 0) - 105) - Math.abs((b.bpm || 0) - 105));
  sorted.push(remaining.shift()!);

  while (remaining.length > 0) {
    const lastBpm = sorted[sorted.length - 1].bpm || 100;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const diff = Math.abs((remaining[i].bpm || 0) - lastBpm);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    sorted.push(remaining.splice(bestIdx, 1)[0]);
  }

  // Interleave songs without BPM data throughout
  const result: typeof candidates = [];
  let noBpmIdx = 0;
  for (let i = 0; i < sorted.length; i++) {
    result.push(sorted[i]);
    // Insert one without-BPM song every 3 songs
    if (noBpmIdx < withoutBpm.length && i % 3 === 2) {
      result.push(withoutBpm[noBpmIdx++]);
    }
  }
  // Add remaining without-BPM songs
  while (noBpmIdx < withoutBpm.length) {
    result.push(withoutBpm[noBpmIdx++]);
  }

  return result;
}

/**
 * Generate a Romance block (22:00-00:00).
 * Includes fixed content ROMANCE_BLOCO{ED} at start + songs from Românticas folder.
 * Each block gets a correct edition number (01-05).
 * 
 * BPM-Aware: Reads BPM from ID3 tags and sorts songs for smooth transitions.
 * Anti-repetition: Respects artist and song repetition rules via GradeContext.
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

  console.log(`[ROMANCE] 💕 Montando bloco ${timeStr} (edição ${editionStr}) a partir de pasta local (BPM-aware)`);

  // List files from the Românticas folder
  const allFiles: string[] = [];
  for (const folder of cfg.folders) {
    const files = await listMp3Files(folder);
    allFiles.push(...files);
    console.log(`[ROMANCE] 📁 ${folder}: ${files.length} arquivos`);
  }

  if (allFiles.length === 0) {
    console.warn(`[ROMANCE] ⚠️ Nenhum arquivo encontrado nas pastas configuradas`);
    const coringas = Array(cfg.targetSongs).fill(cfg.coringa);
    stats.missing += cfg.targetSongs;
    return {
      line: ctx.sanitizeGradeLine(`${timeStr} (ID=${cfg.programName}) "${fixedFileName}",vht,${coringas.join(',vht,')}`),
      logs,
    };
  }

  // Parse all files and read BPM (batch — use cache when possible)
  const candidates: Array<{ filename: string; bpm: number | null; artist: string; title: string }> = [];
  for (const filename of allFiles) {
    const { artist, title } = parseFilename(filename);
    const bpm = getBpmFromCache(artist, title);
    candidates.push({ filename, bpm, artist, title });
  }

  // Scan BPMs for files not in cache (batch read, limited)
  const needsBpmScan = candidates.filter(c => !c.bpm).slice(0, 50);
  if (needsBpmScan.length > 0 && getIsElectronEnv() && window.electronAPI?.scanBpmTags) {
    try {
      const result = await window.electronAPI.scanBpmTags({ folders: cfg.folders });
      if (result?.success && result.samples) {
        for (const entry of result.samples) {
          const match = candidates.find(c => c.filename === entry.filename);
          if (match && entry.bpm > 0) {
            match.bpm = entry.bpm;
            updateBpmCacheEntry(match.artist, match.title, entry.bpm);
          }
        }
        console.log(`[ROMANCE] 🥁 BPM scan: ${result.samples.length} resultados`);
      }
    } catch { /* non-critical */ }
  }

  // Filter valid candidates (not recently used, no artist repetition)
  const validCandidates = candidates.filter(c => {
    if (!c.artist) return true; // Can't check, allow it
    if (ctx.isRecentlyUsed(c.title, c.artist, timeStr, isFullDay)) return false;
    return true;
  });

  // Sort by BPM flow for smooth transitions
  const bpmSorted = sortByBpmFlow(validCandidates);

  // Select songs with artist dedup
  const selectedSongs: string[] = [];
  const usedFiles = new Set<string>();
  const usedArtists = new Set<string>();
  let previousBpm: number | null = null;

  for (const candidate of bpmSorted) {
    if (selectedSongs.length >= cfg.targetSongs) break;

    const normalizedFilename = candidate.filename.toUpperCase();
    if (usedFiles.has(normalizedFilename)) continue;

    const normalizedArtist = candidate.artist.toLowerCase().trim();
    if (normalizedArtist && usedArtists.has(normalizedArtist)) continue;

    const sanitized = sanitizeFilename(candidate.filename).toUpperCase();
    selectedSongs.push(`"${sanitized}"`);
    usedFiles.add(normalizedFilename);
    if (normalizedArtist) usedArtists.add(normalizedArtist);
    ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);

    const bpmInfo = candidate.bpm ? ` (${candidate.bpm} BPM)` : '';
    const transitionInfo = previousBpm && candidate.bpm
      ? ` [Δ${Math.abs(previousBpm - candidate.bpm)}]`
      : '';

    logs.push({
      blockTime: timeStr,
      type: 'used',
      title: candidate.title,
      artist: candidate.artist,
      station: 'Românticas',
      reason: `Pasta local: Românticas${bpmInfo}${transitionInfo}`,
    });

    previousBpm = candidate.bpm || previousBpm;
  }

  // Fill remaining with coringas
  while (selectedSongs.length < cfg.targetSongs) {
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

  const bpmCount = bpmSorted.filter(c => c.bpm && c.bpm > 0).length;
  console.log(`[ROMANCE] ✅ Bloco ${timeStr}: ${selectedSongs.length} músicas (${bpmCount} com BPM) + fixo BLOCO${editionStr}`);

  // Build final line: fixed content at start, then songs with VHT between
  const allContent = [`"${fixedFileName}"`, ...selectedSongs];

  return {
    line: ctx.sanitizeGradeLine(`${timeStr} (ID=${cfg.programName}) ${allContent.join(',vht,')}`),
    logs,
  };
}
