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
    line: '21:00 (FIXO ID=VOZ DO BRASIL) vht,vozbrasil',
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
 * Uses real ranking songs with library verification.
 */
export async function generateMisturadao(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = ctx.getFullDayName(targetDay);
  const sortedRanking = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays);
  const logs: BlockLogItem[] = [];
  const usedPositions = new Set<number>();

  /**
   * Get the real filename from ranking at preferred position.
   * Falls back to any available ranking song, then coringa.
   */
  const getRankingFilename = async (preferredPosition: number): Promise<string> => {
    // Try preferred position first, then nearby positions
    const positionsToTry: number[] = [preferredPosition];
    for (let offset = 1; offset <= sortedRanking.length; offset++) {
      if (preferredPosition + offset <= sortedRanking.length) positionsToTry.push(preferredPosition + offset);
      if (preferredPosition - offset > 0) positionsToTry.push(preferredPosition - offset);
    }

    for (const pos of positionsToTry) {
      if (pos < 1 || pos > sortedRanking.length || usedPositions.has(pos)) continue;
      
      const song = sortedRanking[pos - 1];
      if (ctx.isRecentlyUsed(song.title, song.artist, timeStr)) continue;

      const libraryResult = await ctx.findSongInLibrary(song.artist, song.title);
      if (libraryResult.exists) {
        usedPositions.add(pos);
        ctx.markSongAsUsed(song.title, song.artist, timeStr);
        const realFilename = libraryResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
        
        logs.push({
          blockTime: timeStr,
          type: 'used',
          title: song.title,
          artist: song.artist,
          station: 'RANKING',
          reason: `Ranking posição ${pos}${pos !== preferredPosition ? ` (fallback da posição ${preferredPosition})` : ''}`,
        });
        
        return realFilename;
      }
    }

    // All ranking songs exhausted or missing from library → coringa
    console.warn(`[MISTURADAO] ⚠️ Nenhuma música do ranking disponível para posição ${preferredPosition}, usando coringa`);
    logs.push({
      blockTime: timeStr,
      type: 'substituted',
      title: ctx.coringaCode,
      artist: 'CORINGA',
      station: 'RANKING',
      reason: `Ranking vazio ou sem música na biblioteca para posição ${preferredPosition}`,
    });
    return ctx.coringaCode;
  };

  if (minute === 0) {
    const misturadao01 = `MISTURADAO_BLOCO01_${dayName}.mp3`;
    const misturadao02 = `MISTURADAO_BLOCO02_${dayName}.mp3`;
    const posicao05 = await getRankingFilename(5);
    const posicao02 = await getRankingFilename(2);
    
    logs.push({
      blockTime: timeStr,
      type: 'fixed',
      title: 'MISTURADÃO Bloco 20:00',
      artist: `${misturadao01}, ${misturadao02}`,
      station: 'FIXO',
      reason: `Formato especial com ranking (posições usadas: ${[...usedPositions].join(', ') || 'nenhuma'})`,
    });
    
    return {
      line: ctx.sanitizeGradeLine(`${timeStr} (ID=MISTURADAO) "${misturadao01}",vht,"${posicao05}",vht,"${misturadao02}",vht,"${posicao02}"`),
      logs,
    };
  } else {
    const misturadao03 = `MISTURADAO_BLOCO03_${dayName}.mp3`;
    const misturadao04 = `MISTURADAO_BLOCO04_${dayName}.mp3`;
    const posicao08 = await getRankingFilename(8);
    const posicao09 = await getRankingFilename(9);
    
    logs.push({
      blockTime: timeStr,
      type: 'fixed',
      title: 'MISTURADÃO Bloco 20:30',
      artist: `${misturadao03}, ${misturadao04}`,
      station: 'FIXO',
      reason: `Formato especial com ranking (posições usadas: ${[...usedPositions].join(', ') || 'nenhuma'})`,
    });
    
    return {
      line: ctx.sanitizeGradeLine(`${timeStr} (ID=MISTURADAO) "${misturadao03}",vht,"${posicao08}",vht,"${misturadao04}",vht,"${posicao09}"`),
      logs,
    };
  }
}

/**
 * Generate TOP50 block (19:00/19:30 weekdays).
 * Uses 20 positions from the ranking in reverse order:
 *  - 19:00 → positions 20 down to 11 (least to mid)
 *  - 19:30 → positions 10 down to 01 (mid to top)
 * Each song is verified in the local music library.
 */
export async function generateTop50Block(
  hour: number,
  minute: number,
  top50Count: number,
  ctx: GradeContext
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const SONGS_PER_BLOCK = 10;
  
  // Sort ranking by plays descending → index 0 = position 1 (most played)
  const sorted = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays);
  
  // 19:00 block: positions 20→11 (indices 19→10)
  // 19:30 block: positions 10→01 (indices 9→0)
  const isFirstBlock = minute === 0;
  const startIndex = isFirstBlock ? 19 : 9;  // position 20 or 10
  const endIndex = isFirstBlock ? 10 : 0;    // position 11 or 01

  const top50Songs: string[] = [];
  const usedPositions: number[] = [];

  // Walk from startIndex down to endIndex (reverse order)
  for (let i = startIndex; i >= endIndex && top50Songs.length < SONGS_PER_BLOCK; i--) {
    if (i >= sorted.length) continue;
    
    const song = sorted[i];
    if (ctx.isRecentlyUsed(song.title, song.artist, timeStr)) continue;

    const libraryResult = await ctx.findSongInLibrary(song.artist, song.title);
    if (libraryResult.exists) {
      const realFilename = libraryResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
      top50Songs.push(realFilename);
      ctx.markSongAsUsed(song.title, song.artist, timeStr);
      usedPositions.push(i + 1); // human-readable position (1-based)
      
      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: song.title,
        artist: song.artist,
        station: 'RANKING',
        reason: `TOP50 posição ${i + 1}`,
      });
    } else {
      // Song not in library → use coringa and log
      top50Songs.push(ctx.coringaCode);
      logs.push({
        blockTime: timeStr,
        type: 'substituted',
        title: ctx.coringaCode,
        artist: song.artist,
        station: 'RANKING',
        reason: `TOP50 posição ${i + 1} - não encontrada na biblioteca`,
      });
    }
  }

  // Fill remaining slots with coringa if ranking has fewer than needed
  while (top50Songs.length < SONGS_PER_BLOCK) {
    top50Songs.push(ctx.coringaCode);
    logs.push({
      blockTime: timeStr,
      type: 'substituted',
      title: ctx.coringaCode,
      artist: 'CORINGA',
      station: 'RANKING',
      reason: 'Ranking insuficiente para preencher bloco TOP50',
    });
  }

  const posRange = isFirstBlock ? '20→11' : '10→01';
  logs.push({
    blockTime: timeStr,
    type: 'fixed',
    title: `TOP50 - Posições ${posRange}`,
    artist: 'Ranking',
    station: 'TOP50',
    reason: `Bloco TOP50 com músicas reais do ranking (posições ${usedPositions.join(', ') || 'nenhuma'})`,
  });

  return {
    line: ctx.sanitizeGradeLine(`${timeStr} (ID=TOP50) ${top50Songs.map(s => s === ctx.coringaCode ? s : `"${s}"`).join(',vht,')}`),
    logs,
  };
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
