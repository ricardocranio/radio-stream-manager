/**
 * Song Selection Logic
 * 
 * Handles the selection of songs for normal blocks with STRICT station loyalty:
 * P0: Carry-over (songs from same station, now downloaded)
 * P1: Station Pool (all songs from configured station)
 * CORINGA: If no song from the target station is available in the library
 * 
 * Songs MUST come from the station configured in the sequence position.
 * No cross-station substitution occurs — this ensures the grade respects
 * the sequence rotation exactly as the user programmed it.
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import type { SongEntry, BlockLogItem, BlockStats, GradeContext, CarryOverSong } from './types';
import { STATION_ID_TO_DB_NAME } from './constants';
import type { WeekDay, SequenceConfig } from '@/types/radio';

interface SelectionContext {
  timeStr: string;
  isFullDay: boolean;
  usedInBlock: Set<string>;
  usedArtistsInBlock: Set<string>;
  songsByStation: Record<string, SongEntry[]>;
  allSongsPool: SongEntry[];
  carryOverByStation: Record<string, SongEntry[]>;
  stationSongIndex: Record<string, number>;
  logs: BlockLogItem[];
  stats: BlockStats;
}

/**
 * Select a song for one sequence position with STRICT station loyalty.
 * Only picks songs from the target station — never substitutes from other stations.
 */
export async function selectSongForSlot(
  seq: SequenceConfig,
  selCtx: SelectionContext,
  ctx: GradeContext
): Promise<string> {
  const { timeStr, isFullDay, usedInBlock, usedArtistsInBlock, songsByStation, carryOverByStation, stationSongIndex, logs, stats } = selCtx;

  // Resolve station name
  let stationName = STATION_ID_TO_DB_NAME[seq.radioSource] || STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()] || '';
  if (!stationName) {
    const stationConfig = ctx.stations.find(s => s.id === seq.radioSource || s.id.toLowerCase() === seq.radioSource.toLowerCase());
    stationName = stationConfig?.name || '';
  }

  // Get songs for this station
  let stationSongs: SongEntry[] = [];
  if (stationName && songsByStation[stationName]) {
    stationSongs = songsByStation[stationName];
  } else {
    const normalizedSource = seq.radioSource.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedConfigName = stationName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [poolStationName, poolSongs] of Object.entries(songsByStation)) {
      const normalizedPool = poolStationName.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedPool === normalizedSource || normalizedPool === normalizedConfigName ||
          normalizedPool.includes(normalizedSource) || normalizedSource.includes(normalizedPool)) {
        stationName = poolStationName;
        stationSongs = poolSongs;
        break;
      }
    }
  }

  const stationStyle = ctx.stations.find(s => s.id === seq.radioSource)?.styles?.[0] || 'POP/VARIADO';

  if (stationName && stationSongIndex[stationName] === undefined) {
    stationSongIndex[stationName] = 0;
  }

  let selectedSong: SongEntry | null = null;

  // PRIORITY 0: Carry-over songs (from same station, previously missing, now downloaded)
  const carryOverForStation = carryOverByStation[stationName] || [];
  for (const carryOverSong of carryOverForStation) {
    const key = `${carryOverSong.title.toLowerCase()}-${carryOverSong.artist.toLowerCase()}`;
    const normalizedArtist = carryOverSong.artist.toLowerCase().trim();
    if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !ctx.isRecentlyUsed(carryOverSong.title, carryOverSong.artist, timeStr, isFullDay)) {
      selectedSong = carryOverSong;
      usedInBlock.add(key);
      usedArtistsInBlock.add(normalizedArtist);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: carryOverSong.title, artist: carryOverSong.artist,
        station: carryOverSong.station, style: carryOverSong.style,
        reason: `✅ Carry-over (${stationName})`,
      });
      break;
    }
  }

  // PRIORITY 1: Station pool — STRICT: only songs from this station
  if (!selectedSong) {
    let startIndex = stationSongIndex[stationName] || 0;
    let checkedCount = 0;
    while (checkedCount < (stationSongs?.length || 0) && !selectedSong) {
      const songIdx = (startIndex + checkedCount) % stationSongs.length;
      const candidate = stationSongs[songIdx];
      const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
      const normalizedArtist = candidate.artist.toLowerCase().trim();
      
      if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
        const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
        if (libraryResult.exists) {
          const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
          stationSongIndex[stationName] = (songIdx + 1) % stationSongs.length;
          break;
        } else {
          // Mark as missing for download + carry-over to next block
          if (!ctx.isSongAlreadyMissing(candidate.artist, candidate.title)) {
            ctx.addMissingSong({
              id: `missing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              title: candidate.title, artist: candidate.artist,
              station: stationName || 'UNKNOWN',
              timestamp: new Date(), status: 'missing', dna: stationStyle,
            });
          }
          ctx.addCarryOverSong({
            title: candidate.title, artist: candidate.artist,
            station: stationName || 'UNKNOWN', style: stationStyle,
            targetBlock: timeStr,
          });
        }
      }
      checkedCount++;
    }
  }

  // If a song was selected from the target station
  if (selectedSong) {
    usedInBlock.add(`${selectedSong.title.toLowerCase()}-${selectedSong.artist.toLowerCase()}`);
    usedArtistsInBlock.add(selectedSong.artist.toLowerCase().trim());
    ctx.markSongAsUsed(selectedSong.title, selectedSong.artist, timeStr);

    // Add 'used' log if not already logged
    const hasLog = logs.some(l => l.title === selectedSong!.title && l.artist === selectedSong!.artist && l.blockTime === timeStr);
    if (!hasLog) {
      logs.push({
        blockTime: timeStr, type: 'used',
        title: selectedSong.title, artist: selectedSong.artist,
        station: selectedSong.station, style: selectedSong.style,
        reason: `✅ ${stationName}`,
      });
    }

    return `"${selectedSong.filename}"`;
  }

  // CORINGA: No song from the target station is available in the library
  // This position will be filled when missing songs are downloaded and the grade regenerates
  stats.missing++;
  logs.push({
    blockTime: timeStr, type: 'missing',
    title: ctx.coringaCode, artist: 'CORINGA',
    station: stationName || seq.radioSource,
    reason: `⚠️ Nenhuma música de ${stationName || seq.radioSource} disponível na biblioteca`,
  });
  return ctx.coringaCode;
}

/**
 * Handle special sequence types (fixo, top50, random_pop).
 * Returns the song string if handled, or null if it's a normal station.
 */
export async function handleSpecialSequenceType(
  seq: SequenceConfig,
  hour: number,
  minute: number,
  selCtx: SelectionContext,
  ctx: GradeContext,
  targetDay?: WeekDay
): Promise<string | null> {
  const { timeStr, isFullDay, usedInBlock, usedArtistsInBlock, allSongsPool, logs, stats } = selCtx;

  // Handle fixo_ID
  if (seq.radioSource.startsWith('fixo_')) {
    const contentId = seq.radioSource.replace('fixo_', '');
    const specificContent = ctx.fixedContent.find(fc => fc.id === contentId && fc.enabled);
    if (specificContent) {
      const fileNameToUse = seq.customFileName || specificContent.fileName;
      const processedFileName = ctx.processFixedContentFilename(fileNameToUse, hour, minute, 0, targetDay);
      const finalFileName = processedFileName.toLowerCase().endsWith('.mp3') ? processedFileName : `${processedFileName}.mp3`;
      logs.push({
        blockTime: timeStr, type: 'fixed',
        title: specificContent.name, artist: finalFileName,
        station: 'FIXO',
        reason: seq.customFileName ? `Conteúdo fixo personalizado (${ctx.getDayCode(targetDay)})` : `Conteúdo fixo da sequência (${ctx.getDayCode(targetDay)})`,
      });
      return `"${finalFileName}"`;
    } else {
      logs.push({
        blockTime: timeStr, type: 'substituted',
        title: 'FIXO', artist: 'CORINGA', station: 'FALLBACK',
        reason: `Conteúdo fixo ID ${contentId} não encontrado ou desabilitado`,
      });
      return ctx.coringaCode;
    }
  }

  // Handle generic fixo
  if (seq.radioSource === 'fixo') {
    // Simplified: pick round-robin from available fixed content
    const availableFixed = ctx.fixedContent.filter(fc => fc.enabled && fc.type !== 'top50' && fc.type !== 'vozbrasil');
    if (availableFixed.length > 0) {
      const selectedFixed = availableFixed[0]; // Simplified for extraction
      const processedFileName = ctx.processFixedContentFilename(selectedFixed.fileName, hour, minute, 0, targetDay);
      const finalFileName = processedFileName.toLowerCase().endsWith('.mp3') ? processedFileName : `${processedFileName}.mp3`;
      logs.push({
        blockTime: timeStr, type: 'fixed',
        title: selectedFixed.name, artist: finalFileName,
        station: 'FIXO', reason: `Conteúdo fixo da sequência (${ctx.getDayCode(targetDay)})`,
      });
      return `"${finalFileName}"`;
    }
    logs.push({
      blockTime: timeStr, type: 'substituted',
      title: 'FIXO', artist: 'CORINGA', station: 'FALLBACK',
      reason: 'Nenhum conteúdo fixo disponível',
    });
    return ctx.coringaCode;
  }

  // Handle top50
  if (seq.radioSource === 'top50') {
    const sortedRanking = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays);
    for (const rankSong of sortedRanking) {
      const key = `${rankSong.title.toLowerCase()}-${rankSong.artist.toLowerCase()}`;
      const normalizedArtist = rankSong.artist.toLowerCase().trim();
      if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !ctx.isRecentlyUsed(rankSong.title, rankSong.artist, timeStr, isFullDay)) {
        usedInBlock.add(key);
        usedArtistsInBlock.add(normalizedArtist);
        ctx.markSongAsUsed(rankSong.title, rankSong.artist, timeStr);
        logs.push({
          blockTime: timeStr, type: 'used',
          title: rankSong.title, artist: rankSong.artist,
          station: 'TOP50', style: rankSong.style,
          reason: `TOP50 posição ${sortedRanking.indexOf(rankSong) + 1}`,
        });
        return `"${sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`)}"`;
      }
    }
    logs.push({
      blockTime: timeStr, type: 'substituted',
      title: 'TOP50', artist: 'CORINGA', station: 'FALLBACK',
      reason: 'Ranking TOP50 vazio',
    });
    return ctx.coringaCode;
  }

  // Handle random_pop
  if (seq.radioSource === 'random_pop') {
    for (const candidate of allSongsPool) {
      const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
      const normalizedArtist = candidate.artist.toLowerCase().trim();
      if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
        const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
        if (libraryResult.exists) {
          const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          usedInBlock.add(key);
          usedArtistsInBlock.add(normalizedArtist);
          ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);
          logs.push({
            blockTime: timeStr, type: 'used',
            title: candidate.title, artist: candidate.artist,
            station: candidate.station, style: candidate.style,
            reason: 'Aleatório',
          });
          return `"${correctFilename}"`;
        }
      }
    }
    logs.push({
      blockTime: timeStr, type: 'substituted',
      title: 'RANDOM', artist: 'CORINGA', station: 'FALLBACK',
      reason: 'Nenhuma música aleatória disponível',
    });
    return ctx.coringaCode;
  }

  // Not a special type - return null to indicate normal station processing
  return null;
}
