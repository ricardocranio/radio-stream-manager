/**
 * Song Selection Logic (Priority 0-6)
 * 
 * Handles the hierarchical selection of songs for normal blocks:
 * P0: Carry-over (songs from previous blocks, now downloaded)
 * P1: Station Pool (songs from configured station)
 * P2: TOP50 substitute
 * P3: DNA/Style match from other stations
 * P4: General Pool (sorted by freshness - most recent first)
 * P5: Curadoria (random from ranking)
 * P6: Coringa wildcard
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import type { SongEntry, BlockLogItem, BlockStats, GradeContext, CarryOverSong } from './types';
import { STATION_ID_TO_DB_NAME } from './constants';
import type { WeekDay, SequenceConfig } from '@/types/radio';

interface SelectionContext {
  timeStr: string;
  isFullDay: boolean;
  minutesToBlock: number; // Minutes until block goes on-air; ≤12 = no downloads, substitute only
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
 * Select a song for one sequence position following Priority 0-6 hierarchy.
 */
export async function selectSongForSlot(
  seq: SequenceConfig,
  selCtx: SelectionContext,
  ctx: GradeContext
): Promise<string> {
  const { timeStr, isFullDay, usedInBlock, usedArtistsInBlock, songsByStation, allSongsPool, carryOverByStation, stationSongIndex, logs, stats } = selCtx;

  // Resolve station name using multiple strategies
  let stationName = '';

  // Strategy 1: Hardcoded legacy mapping (short IDs like 'bh', 'band')
  stationName = STATION_ID_TO_DB_NAME[seq.radioSource] || STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()] || '';

  // Strategy 2: Find station config by ID (handles UUIDs) and use its name
  if (!stationName) {
    const stationConfig = ctx.stations.find(
      s => s.id === seq.radioSource || s.id.toLowerCase() === seq.radioSource.toLowerCase()
    );
    stationName = stationConfig?.name || '';
  }

  // Strategy 3: Check if radioSource itself is a station name that exists in the pool
  if (!stationName && songsByStation[seq.radioSource]) {
    stationName = seq.radioSource;
  }

  // Get songs for this station
  let stationSongs: SongEntry[] = [];
  if (stationName && songsByStation[stationName]) {
    stationSongs = songsByStation[stationName];
  }
  
  // Fallback: fuzzy match against songsByStation keys
  if (stationSongs.length === 0) {
    const normalizedSource = seq.radioSource.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedConfigName = stationName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [poolStationName, poolSongs] of Object.entries(songsByStation)) {
      const normalizedPool = poolStationName.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        normalizedPool === normalizedSource || normalizedPool === normalizedConfigName ||
        normalizedPool.includes(normalizedSource) || normalizedSource.includes(normalizedPool) ||
        (normalizedConfigName && (normalizedPool.includes(normalizedConfigName) || normalizedConfigName.includes(normalizedPool)))
      ) {
        stationName = poolStationName;
        stationSongs = poolSongs;
        break;
      }
    }
  }

  if (stationSongs.length > 0) {
    console.log(`[SONG-SELECT] 🎯 Estação "${stationName}" encontrada com ${stationSongs.length} músicas para slot (source: ${seq.radioSource})`);
  } else {
    console.warn(`[SONG-SELECT] ⚠️ Nenhuma música encontrada para source "${seq.radioSource}" (resolved: "${stationName}"). Pool disponível: ${Object.keys(songsByStation).join(', ')}`);
  }

  const stationStyle = ctx.stations.find(s => s.id === seq.radioSource)?.styles?.[0] || 'POP/VARIADO';

  if (stationName && stationSongIndex[stationName] === undefined) {
    stationSongIndex[stationName] = 0;
  }

  let selectedSong: SongEntry | null = null;

  // PRIORITY 0: Carry-over songs
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
        reason: '✅ Carry-over do bloco anterior (já baixada)',
      });
      break;
    }
  }

  // PRIORITY 1: Station pool
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
          // If ≤12 minutes to block, skip download — just continue to find an existing song
          if (selCtx.minutesToBlock <= 12) {
            logs.push({
              blockTime: timeStr, type: 'skipped',
              title: candidate.title, artist: candidate.artist,
              station: stationName || 'UNKNOWN', style: stationStyle,
              reason: `⏰ Faltam ${selCtx.minutesToBlock}min - pulando download, buscando substituta`,
            });
          } else {
            // Mark as missing + carry-over (normal behavior with time to download)
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
      }
      checkedCount++;
    }
  }

  // PRIORITY 2: TOP50 substitute
  if (!selectedSong) {
    const sortedRanking = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays);
    for (const rankSong of sortedRanking) {
      const key = `${rankSong.title.toLowerCase()}-${rankSong.artist.toLowerCase()}`;
      const normalizedArtist = rankSong.artist.toLowerCase().trim();
      if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !ctx.isRecentlyUsed(rankSong.title, rankSong.artist, timeStr, isFullDay)) {
        const libraryResult = await ctx.findSongInLibrary(rankSong.artist, rankSong.title);
        if (libraryResult.exists) {
          const correctFilename = libraryResult.filename || sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`);
          selectedSong = {
            title: rankSong.title, artist: rankSong.artist,
            station: 'TOP50', style: rankSong.style,
            filename: correctFilename, existsInLibrary: true,
          };
          stats.substituted++;
          logs.push({
            blockTime: timeStr, type: 'substituted',
            title: rankSong.title, artist: rankSong.artist,
            station: 'TOP50', style: rankSong.style,
            reason: `TOP50 substituto (posição ${sortedRanking.indexOf(rankSong) + 1})`,
            substituteFor: stationName || 'UNKNOWN',
          });
          break;
        }
      }
    }
  }

  // PRIORITY 3: DNA/Style match
  if (!selectedSong) {
    for (const [otherStation, songs] of Object.entries(songsByStation)) {
      if (otherStation === stationName) continue;
      for (const candidate of songs) {
        if (candidate.style !== stationStyle) continue;
        const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
        const normalizedArtist = candidate.artist.toLowerCase().trim();
        if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
          const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
          if (libraryResult.exists) {
            const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
            selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
            stats.substituted++;
            logs.push({
              blockTime: timeStr, type: 'substituted',
              title: candidate.title, artist: candidate.artist,
              station: candidate.station, style: candidate.style,
              reason: `DNA similar: ${stationStyle}`, substituteFor: stationName || 'UNKNOWN',
            });
            break;
          }
        }
      }
      if (selectedSong) break;
    }
  }

  // PRIORITY 4: General Pool (sorted by freshness - most recent captures first)
  if (!selectedSong) {
    // Sort by freshness: most recently captured songs first
    const freshSortedPool = [...allSongsPool].sort((a, b) => {
      if (a.scrapedAt && b.scrapedAt) {
        return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
      }
      if (a.scrapedAt) return -1;
      if (b.scrapedAt) return 1;
      return 0;
    });

    for (const candidate of freshSortedPool) {
      const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
      const normalizedArtist = candidate.artist.toLowerCase().trim();
      if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
        const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
        if (libraryResult.exists) {
          const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
          stats.substituted++;
          logs.push({
            blockTime: timeStr, type: 'substituted',
            title: candidate.title, artist: candidate.artist,
            station: candidate.station, style: candidate.style,
            reason: 'Pool geral (priorizado por frescor)',
          });
          break;
        }
      }
    }
  }

  // PRIORITY 5: Curadoria (random ranking song)
  if (!selectedSong) {
    const shuffledRanking = [...ctx.rankingSongs].sort(() => Math.random() - 0.5);
    for (const rankSong of shuffledRanking) {
      const key = `${rankSong.title.toLowerCase()}-${rankSong.artist.toLowerCase()}`;
      const normalizedArtist = rankSong.artist.toLowerCase().trim();
      if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !ctx.isRecentlyUsed(rankSong.title, rankSong.artist, timeStr, isFullDay)) {
        const libraryResult = await ctx.findSongInLibrary(rankSong.artist, rankSong.title);
        if (libraryResult.exists) {
          const correctFilename = libraryResult.filename || sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`);
          selectedSong = {
            title: rankSong.title, artist: rankSong.artist,
            station: 'CURADORIA', style: rankSong.style,
            filename: correctFilename, existsInLibrary: true,
          };
          stats.substituted++;
          logs.push({
            blockTime: timeStr, type: 'substituted',
            title: rankSong.title, artist: rankSong.artist,
            station: 'CURADORIA', style: rankSong.style,
            reason: 'Curadoria automática do ranking',
          });
          break;
        }
      }
    }
  }

  // If a song was selected
  if (selectedSong) {
    usedInBlock.add(`${selectedSong.title.toLowerCase()}-${selectedSong.artist.toLowerCase()}`);
    usedArtistsInBlock.add(selectedSong.artist.toLowerCase().trim());
    ctx.markSongAsUsed(selectedSong.title, selectedSong.artist, timeStr);

    // Add 'used' log if not already logged by a priority level
    const hasLog = logs.some(l => l.title === selectedSong!.title && l.artist === selectedSong!.artist && l.blockTime === timeStr);
    if (!hasLog) {
      logs.push({
        blockTime: timeStr, type: 'used',
        title: selectedSong.title, artist: selectedSong.artist,
        station: selectedSong.station, style: selectedSong.style,
      });
    }

    return `"${selectedSong.filename}"`;
  }

  // PRIORITY 6: Coringa
  stats.missing++;
  logs.push({
    blockTime: timeStr, type: 'substituted',
    title: ctx.coringaCode, artist: 'CORINGA',
    station: 'FALLBACK',
    reason: 'Nenhuma música válida encontrada, usando coringa para curadoria manual',
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
