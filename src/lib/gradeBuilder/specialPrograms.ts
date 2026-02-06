/**
 * Special Program Generators
 * 
 * Each function generates a complete block for a specific radio program:
 * - Voz do Brasil (21:00 weekdays)
 * - Misturadão (20:00 and 20:30 weekdays)
 * - Madrugada (00:00-04:30)
 * - Sertanejo Nossa (05:00-07:30)
 * - TOP50 (19:00-19:30)
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import type { SongEntry, BlockResult, BlockLogItem, BlockStats, GradeContext } from './types';
import type { WeekDay } from '@/types/radio';

/**
 * Generate the Voz do Brasil block (21:00 weekdays).
 * Hardcoded format - never goes through sanitization.
 */
export function generateVozDoBrasil(timeStr: string): BlockResult {
  return {
    line: '21:00 (FIXO ID=VOZ DO BRASIL) vht,VOZ_DO_BRASI',
    logs: [{
      blockTime: timeStr,
      type: 'fixed',
      title: 'A Voz do Brasil',
      artist: 'Governo Federal',
      station: 'EBC',
      reason: 'Conteúdo fixo obrigatório - sem montagem do sistema',
    }],
  };
}

/**
 * Generate Misturadão block (20:00 or 20:30 weekdays).
 */
export function generateMisturadao(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay
): BlockResult {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = ctx.getFullDayName(targetDay);
  const sortedRanking = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays);
  const logs: BlockLogItem[] = [];

  const getRankingFilename = (position: number): string => {
    if (position <= sortedRanking.length && position > 0) {
      const song = sortedRanking[position - 1];
      return sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
    }
    return `posicao${position.toString().padStart(2, '0')}.mp3`;
  };

  if (minute === 0) {
    const misturadao01 = `MISTURADAO_BLOCO01_${dayName}.mp3`;
    const posicao05 = getRankingFilename(5);
    const misturadao02 = `MISTURADAO_BLOCO02_${dayName}.mp3`;
    const posicao02 = getRankingFilename(2);
    
    logs.push({
      blockTime: timeStr,
      type: 'fixed',
      title: 'MISTURADÃO Bloco 20:00',
      artist: `${misturadao01}, ${misturadao02}`,
      station: 'FIXO',
      reason: 'Formato especial com ranking posições 2 e 5',
    });
    
    return {
      line: ctx.sanitizeGradeLine(`${timeStr} (ID=MISTURADAO) "${misturadao01}",vht,"${posicao05}",vht,"${misturadao02}",vht,"${posicao02}"`),
      logs,
    };
  } else {
    const misturadao03 = `MISTURADAO_BLOCO03_${dayName}.mp3`;
    const posicao08 = getRankingFilename(8);
    const misturadao04 = `MISTURADAO_BLOCO04_${dayName}.mp3`;
    const posicao09 = getRankingFilename(9);
    
    logs.push({
      blockTime: timeStr,
      type: 'fixed',
      title: 'MISTURADÃO Bloco 20:30',
      artist: `${misturadao03}, ${misturadao04}`,
      station: 'FIXO',
      reason: 'Formato especial com ranking posições 8 e 9',
    });
    
    return {
      line: ctx.sanitizeGradeLine(`${timeStr} (ID=MISTURADAO) "${misturadao03}",vht,"${posicao08}",vht,"${misturadao04}",vht,"${posicao09}"`),
      logs,
    };
  }
}

/**
 * Generate TOP50 block (19:00/19:30 weekdays).
 */
export function generateTop50Block(
  hour: number,
  minute: number,
  top50Count: number,
  ctx: GradeContext
): BlockResult {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  
  // For 19:00: positions 1-10, for 19:30: positions 11-20
  const blockIndex = (hour - 19) * 2 + (minute === 30 ? 1 : 0);
  const startPosition = Math.max(0, blockIndex * 10);
  
  const sorted = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays);
  const top50Songs: string[] = [];

  for (let i = startPosition; i < sorted.length && top50Songs.length < top50Count; i++) {
    const song = sorted[i];
    if (!ctx.isRecentlyUsed(song.title, song.artist, timeStr)) {
      const realFilename = sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
      top50Songs.push(realFilename);
      ctx.markSongAsUsed(song.title, song.artist, timeStr);
    }
  }

  if (top50Songs.length > 0) {
    logs.push({
      blockTime: timeStr,
      type: 'fixed',
      title: `TOP50 - Posições ${startPosition + 1} a ${startPosition + top50Songs.length}`,
      artist: 'Ranking',
      station: 'TOP50',
      reason: `Bloco TOP50 com músicas reais do ranking (posições ${startPosition + 1}-${startPosition + top50Songs.length})`,
    });
    
    return {
      line: ctx.sanitizeGradeLine(`${timeStr} (ID=TOP50) ${top50Songs.map(s => `"${s}"`).join(',vht,')}`),
      logs,
    };
  }
  
  // Fallback: empty TOP50
  return { line: `${timeStr} (ID=TOP50) ${ctx.coringaCode}`, logs };
}

/**
 * Generate Madrugada block (00:00-04:30) - Mix from ALL stations.
 */
export async function generateMadrugada(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  programName: string
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const TARGET_SONGS = 10;

  // Build flattened pool and shuffle
  const allPool: SongEntry[] = [];
  for (const stationSongs of Object.values(songsByStation)) {
    allPool.push(...stationSongs);
  }
  const shuffled = [...allPool].sort(() => Math.random() - 0.5);

  // Pre-check library existence in batch for candidates
  const candidatesToCheck = shuffled.slice(0, 30); // Check more than needed for filtering
  const batchResults = await ctx.batchFindSongsInLibrary(
    candidatesToCheck.map(s => ({ artist: s.artist, title: s.title }))
  );

  const mixSongs: string[] = [];
  const mixUsedArtists = new Set<string>();
  const mixUsedKeys = new Set<string>();

  for (const candidate of shuffled) {
    if (mixSongs.length >= TARGET_SONGS) break;
    
    const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
    const normalizedArtist = candidate.artist.toLowerCase().trim();
    
    if (mixUsedKeys.has(key) || mixUsedArtists.has(normalizedArtist)) continue;
    if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) continue;
    
    // Use batch result if available, otherwise check individually
    const batchKey = `${candidate.artist.toLowerCase().trim()}|${candidate.title.toLowerCase().trim()}`;
    const libraryResult = batchResults.get(batchKey) || await ctx.findSongInLibrary(candidate.artist, candidate.title);
    
    if (libraryResult.exists) {
      const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
      mixSongs.push(`"${correctFilename}"`);
      mixUsedKeys.add(key);
      mixUsedArtists.add(normalizedArtist);
      ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);
      
      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: candidate.title,
        artist: candidate.artist,
        station: candidate.station,
        style: candidate.style,
        reason: 'Miscelânea madrugada (todas as rádios)',
      });
    }
  }

  // Fill remaining with coringa
  while (mixSongs.length < TARGET_SONGS) {
    mixSongs.push(ctx.coringaCode);
    stats.missing++;
    logs.push({
      blockTime: timeStr,
      type: 'substituted',
      title: ctx.coringaCode,
      artist: 'CORINGA',
      station: 'FALLBACK',
      reason: 'Pool da madrugada esgotado',
    });
  }

  return {
    line: ctx.sanitizeGradeLine(`${timeStr} (ID=${programName}) ${mixSongs.join(',vht,')}`),
    logs,
  };
}

/**
 * Generate Sertanejo Nossa block (05:00-07:30).
 * Alternates Liberdade FM and Positiva FM. Coringa: clas.
 */
export async function generateSertanejoNossa(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const SERTANEJO_STATIONS = ['Liberdade FM', 'Positiva FM'];
  const TARGET_SONGS = 10;
  const CORINGA = 'clas';

  // Collect songs per station
  const stationPools: Record<string, SongEntry[]> = {};
  for (const stName of SERTANEJO_STATIONS) {
    const directPool = songsByStation[stName] || [];
    if (directPool.length > 0) {
      stationPools[stName] = [...directPool].sort(() => Math.random() - 0.5);
    } else {
      // Try flexible matching
      for (const [poolName, poolSongs] of Object.entries(songsByStation)) {
        const norm1 = poolName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const norm2 = stName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (norm1.includes(norm2) || norm2.includes(norm1)) {
          stationPools[stName] = [...poolSongs].sort(() => Math.random() - 0.5);
          break;
        }
      }
    }
    if (!stationPools[stName]) stationPools[stName] = [];
  }

  // Pre-check library in batch
  const allCandidates: Array<{ artist: string; title: string }> = [];
  for (const pool of Object.values(stationPools)) {
    for (const song of pool) {
      allCandidates.push({ artist: song.artist, title: song.title });
    }
  }
  const batchResults = await ctx.batchFindSongsInLibrary(allCandidates);

  const sertanejoSongs: string[] = [];
  const sertUsedArtists = new Set<string>();
  const sertUsedKeys = new Set<string>();
  const stationIndices: Record<string, number> = {};
  SERTANEJO_STATIONS.forEach(s => stationIndices[s] = 0);

  for (let i = 0; i < TARGET_SONGS; i++) {
    const currentStation = SERTANEJO_STATIONS[i % SERTANEJO_STATIONS.length];
    const pool = stationPools[currentStation] || [];
    let found = false;

    while (stationIndices[currentStation] < pool.length && !found) {
      const candidate = pool[stationIndices[currentStation]];
      stationIndices[currentStation]++;

      const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
      const normalizedArtist = candidate.artist.toLowerCase().trim();

      if (sertUsedKeys.has(key) || sertUsedArtists.has(normalizedArtist)) continue;
      if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) continue;

      const batchKey = `${candidate.artist.toLowerCase().trim()}|${candidate.title.toLowerCase().trim()}`;
      const libraryResult = batchResults.get(batchKey) || await ctx.findSongInLibrary(candidate.artist, candidate.title);

      if (libraryResult.exists) {
        const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
        sertanejoSongs.push(`"${correctFilename}"`);
        sertUsedKeys.add(key);
        sertUsedArtists.add(normalizedArtist);
        ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);

        logs.push({
          blockTime: timeStr,
          type: 'used',
          title: candidate.title,
          artist: candidate.artist,
          station: currentStation,
          style: candidate.style,
          reason: `Sertanejo Nossa (${currentStation})`,
        });
        found = true;
      }
    }

    if (!found) {
      sertanejoSongs.push(CORINGA);
      stats.missing++;
      logs.push({
        blockTime: timeStr,
        type: 'substituted',
        title: CORINGA,
        artist: 'CORINGA',
        station: currentStation,
        reason: `Pool ${currentStation} esgotado`,
      });
    }
  }

  return {
    line: ctx.sanitizeGradeLine(`${timeStr} (ID=Sertanejo Nossa) ${sertanejoSongs.join(',vht,')}`),
    logs,
  };
}
