/**
 * Song Selection Logic — Priority Hierarchy
 * 
 * Order: P1 → P0 → P0.5 → P0.75 → P2 → P3 → P4 → P5 → P6
 * 
 * P1:    Station Pool — songs from the configured radio station (PRIMARY source)
 * P0:    Carry-over — songs from previous blocks now downloaded
 * P0.5:  Fresh 30min — captures from any station in the last 30 minutes
 * P0.75: TOP25 — songs from the ranking TOP25
 * P2:    TOP50 substitute — positions 26-50 from ranking
 * P3:    DNA/Style match — songs from other stations with same style
 * P4:    General Pool — any available song sorted by freshness
 * P5:    Curadoria — random ranking song
 * P6:    Coringa — wildcard fallback code (mus/rom/jov)
 * 
 * Each level includes JIT download support for missing library files.
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import type { SongEntry, BlockLogItem, BlockStats, GradeContext, CarryOverSong } from './types';
import { STATION_ID_TO_DB_NAME } from './constants';
import type { WeekDay, SequenceConfig } from '@/types/radio';
import { getCachedVerification } from '@/lib/libraryVerificationCache';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

/**
 * Attempt to download a missing song and wait for it to become available.
 * Returns true if the song was downloaded successfully within the timeout.
 * @param artist - Song artist
 * @param title - Song title  
 * @param ctx - Grade context with library check
 * @param maxWaitMs - Maximum time to wait (default 30s for full-day, up to 720s/12min for incremental)
 */
async function tryDownloadAndWait(
  artist: string, title: string, ctx: GradeContext, maxWaitMs: number = 30000
): Promise<boolean> {
  if (!isElectron || !window.electronAPI?.downloadFromDeezer) {
    return false;
  }

  const { useRadioStore } = await import('@/store/radioStore');
  const storeState = useRadioStore.getState();
  if (!storeState.deezerConfig.enabled || !storeState.deezerConfig.arl) {
    return false;
  }

  console.log(`[SONG-SELECT] ⏬ Download imediato: ${artist} - ${title} (timeout: ${Math.round(maxWaitMs / 1000)}s)`);

  try {
    const result = await Promise.race([
      window.electronAPI.downloadFromDeezer({
        artist, title,
        arl: storeState.deezerConfig.arl,
        outputFolder: storeState.deezerConfig.downloadFolder,
        quality: storeState.deezerConfig.quality,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), maxWaitMs)),
    ]);

    if (result && typeof result === 'object' && 'success' in result && result.success) {
      console.log(`[SONG-SELECT] ✅ Download concluído a tempo: ${artist} - ${title}`);
      // Update cache so findSongInLibrary picks it up
      const { markSongAsDownloaded } = await import('@/lib/libraryVerificationCache');
      markSongAsDownloaded(artist, title, (result as any).output);
      return true;
    }

    console.log(`[SONG-SELECT] ⏰ Download não concluiu a tempo: ${artist} - ${title}`);
    return false;
  } catch (error) {
    console.error(`[SONG-SELECT] ❌ Erro no download imediato: ${artist} - ${title}`, error);
    return false;
  }
}

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
 * Centralized station resolver — tries all strategies in order and returns
 * the resolved station name + the matching song pool.
 * Logs the resolution path for diagnostics.
 */
function resolveStation(
  radioSource: string,
  songsByStation: Record<string, SongEntry[]>,
  stations: GradeContext['stations'],
  seqPosition: number,
): { stationName: string; stationSongs: SongEntry[]; resolvedBy: string } {
  // Strategy 1: Hardcoded legacy mapping (short IDs like 'bh', 'band')
  const legacyName = STATION_ID_TO_DB_NAME[radioSource] || STATION_ID_TO_DB_NAME[radioSource.toLowerCase()];
  if (legacyName) {
    const songs = songsByStation[legacyName] || [];
    if (songs.length > 0) {
      console.log(`[RESOLVE] P${seqPosition}: "${radioSource}" → "${legacyName}" via legacy map (${songs.length} músicas)`);
      return { stationName: legacyName, stationSongs: songs, resolvedBy: 'legacy' };
    }
    // Legacy name found but no pool — still try case-insensitive below
  }

  // Strategy 2: Find station config by UUID and use its name
  const stationByUuid = stations.find(
    s => s.id === radioSource || s.id.toLowerCase() === radioSource.toLowerCase()
  );
  if (stationByUuid) {
    const songs = songsByStation[stationByUuid.name] || [];
    if (songs.length > 0) {
      console.log(`[RESOLVE] P${seqPosition}: "${radioSource}" → "${stationByUuid.name}" via UUID (${songs.length} músicas)`);
      return { stationName: stationByUuid.name, stationSongs: songs, resolvedBy: 'uuid' };
    }
  }

  // Strategy 3: Exact match in pool keys
  if (songsByStation[radioSource]) {
    const songs = songsByStation[radioSource];
    console.log(`[RESOLVE] P${seqPosition}: "${radioSource}" exact pool match (${songs.length} músicas)`);
    return { stationName: radioSource, stationSongs: songs, resolvedBy: 'exact' };
  }

  // Strategy 4: Case-insensitive exact match against pool keys
  const lowerSource = radioSource.toLowerCase().trim();
  const resolvedName = legacyName || stationByUuid?.name || radioSource;
  const lowerResolved = resolvedName.toLowerCase().trim();

  for (const [poolKey, poolSongs] of Object.entries(songsByStation)) {
    const lowerPool = poolKey.toLowerCase().trim();
    if (lowerPool === lowerSource || lowerPool === lowerResolved) {
      console.log(`[RESOLVE] P${seqPosition}: "${radioSource}" → "${poolKey}" via case-insensitive (${poolSongs.length} músicas)`);
      return { stationName: poolKey, stationSongs: poolSongs, resolvedBy: 'case-insensitive' };
    }
  }

  // Strategy 5: Fuzzy/partial match (contains)
  const normalizedSource = radioSource.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedResolved = resolvedName.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const [poolKey, poolSongs] of Object.entries(songsByStation)) {
    const normalizedPool = poolKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      normalizedPool === normalizedSource || normalizedPool === normalizedResolved ||
      normalizedPool.includes(normalizedSource) || normalizedSource.includes(normalizedPool) ||
      (normalizedResolved && (normalizedPool.includes(normalizedResolved) || normalizedResolved.includes(normalizedPool)))
    ) {
      console.log(`[RESOLVE] P${seqPosition}: "${radioSource}" → "${poolKey}" via fuzzy match (${poolSongs.length} músicas)`);
      return { stationName: poolKey, stationSongs: poolSongs, resolvedBy: 'fuzzy' };
    }
  }

  // No match found
  console.warn(`[RESOLVE] P${seqPosition}: "${radioSource}" → SEM MATCH! Pool keys: [${Object.keys(songsByStation).join(', ')}]`);
  return { stationName: resolvedName, stationSongs: [], resolvedBy: 'none' };
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

  // Use centralized station resolver
  const { stationName, stationSongs, resolvedBy } = resolveStation(
    seq.radioSource, songsByStation, ctx.stations, seq.position
  );

  const stationStyle = ctx.stations.find(s => s.id === seq.radioSource)?.styles?.[0] ||
    ctx.stations.find(s => s.name.toLowerCase() === stationName.toLowerCase())?.styles?.[0] ||
    'POP/VARIADO';

  if (stationName && stationSongIndex[stationName] === undefined) {
    stationSongIndex[stationName] = 0;
  }

  let selectedSong: SongEntry | null = null;

  // Helper: check candidate validity
  const isValidCandidate = (title: string, artist: string) => {
    const key = `${title.toLowerCase()}-${artist.toLowerCase()}`;
    const normalizedArtist = artist.toLowerCase().trim();
    return !usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !ctx.isRecentlyUsed(title, artist, timeStr, isFullDay);
  };

  const downloadTimeoutMs = isFullDay ? 30000 : 720000;

  // ============================================================
  // PRIORITY 1: Station Pool (primary source — the configured radio)
  // This is the MAIN source: songs from the exact station in the sequence
  // ============================================================
  if (!selectedSong) {
    let attemptedDownload = false;

    // Sort by freshness (most recent scrapedAt first)
    const freshnessSorted = [...stationSongs].sort((a, b) => {
      if (a.scrapedAt && b.scrapedAt) return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
      if (a.scrapedAt) return -1;
      if (b.scrapedAt) return 1;
      return 0;
    });

    for (const candidate of freshnessSorted) {
      if (!isValidCandidate(candidate.title, candidate.artist)) continue;

      const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
      if (libraryResult.exists) {
        const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
        selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
        logs.push({
          blockTime: timeStr, type: 'used',
          title: candidate.title, artist: candidate.artist,
          station: candidate.station, style: candidate.style,
          reason: `[P1] Pool da estação "${stationName}" (resolvedBy: ${resolvedBy})`,
        });
        break;
      } else if (!attemptedDownload) {
        attemptedDownload = true;
        console.log(`[SONG-SELECT] 🔍 [P1] "${candidate.artist} - ${candidate.title}" ausente, tentando download JIT...`);
        const downloaded = await tryDownloadAndWait(candidate.artist, candidate.title, ctx, downloadTimeoutMs);
        if (downloaded) {
          const recheck = await ctx.findSongInLibrary(candidate.artist, candidate.title);
          if (recheck.exists) {
            const correctFilename = recheck.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
            selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
            logs.push({
              blockTime: timeStr, type: 'used',
              title: candidate.title, artist: candidate.artist,
              station: candidate.station, style: candidate.style,
              reason: `[P1] Baixada JIT de "${stationName}"`,
            });
            break;
          }
        }
        console.log(`[SONG-SELECT] ⚠️ [P1] Download não disponível a tempo, continuando...`);
      }

      // Mark as missing + carry-over
      if (!ctx.isSongAlreadyMissing(candidate.artist, candidate.title)) {
        ctx.addMissingSong({
          id: `missing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          title: candidate.title, artist: candidate.artist,
          station: stationName || 'UNKNOWN',
          timestamp: new Date(), status: 'missing', dna: stationStyle,
          urgency: 'grade',
        });
      }
      ctx.addCarryOverSong({
        title: candidate.title, artist: candidate.artist,
        station: stationName || 'UNKNOWN', style: stationStyle,
        targetBlock: timeStr,
      });
    }
  }

  // ============================================================
  // PRIORITY P0: Carry-over (songs from previous blocks, now downloaded)
  // ============================================================
  if (!selectedSong) {
    const carryOverForStation = carryOverByStation[stationName] || [];
    for (const carryOverSong of carryOverForStation) {
      if (!isValidCandidate(carryOverSong.title, carryOverSong.artist)) continue;
      selectedSong = carryOverSong;
      usedInBlock.add(`${carryOverSong.title.toLowerCase()}-${carryOverSong.artist.toLowerCase()}`);
      usedArtistsInBlock.add(carryOverSong.artist.toLowerCase().trim());
      logs.push({
        blockTime: timeStr, type: 'used',
        title: carryOverSong.title, artist: carryOverSong.artist,
        station: carryOverSong.station, style: carryOverSong.style,
        reason: `[P0] Carry-over do bloco anterior (já baixada)`,
      });
      break;
    }
  }

  // ============================================================
  // PRIORITY P0.5: Fresh captures (last 30 minutes from ANY station)
  // Prioritizes what's playing RIGHT NOW on competitors
  // ============================================================
  if (!selectedSong) {
    const now = new Date();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);

    // Get fresh songs from all stations, sorted by most recent
    const freshSongs = allSongsPool
      .filter(s => s.scrapedAt && new Date(s.scrapedAt) >= thirtyMinAgo)
      .sort((a, b) => new Date(b.scrapedAt!).getTime() - new Date(a.scrapedAt!).getTime());

    for (const candidate of freshSongs) {
      if (!isValidCandidate(candidate.title, candidate.artist)) continue;
      const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
      if (libraryResult.exists) {
        const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
        selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
        const minutesAgo = Math.round((now.getTime() - new Date(candidate.scrapedAt!).getTime()) / 60000);
        logs.push({
          blockTime: timeStr, type: 'used',
          title: candidate.title, artist: candidate.artist,
          station: candidate.station, style: candidate.style,
          reason: `[P0.5] Captura fresca (${minutesAgo}min atrás, de ${candidate.station})`,
        });
        break;
      }
    }
  }

  // ============================================================
  // PRIORITY P0.75: TOP25 ranking songs
  // ============================================================
  if (!selectedSong) {
    const top25 = [...ctx.rankingSongs]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 25);

    for (const rankSong of top25) {
      if (!isValidCandidate(rankSong.title, rankSong.artist)) continue;
      const libraryResult = await ctx.findSongInLibrary(rankSong.artist, rankSong.title);
      if (libraryResult.exists) {
        const correctFilename = libraryResult.filename || sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`);
        selectedSong = {
          title: rankSong.title, artist: rankSong.artist,
          station: 'TOP25', style: rankSong.style,
          filename: correctFilename, existsInLibrary: true,
        };
        const pos = top25.indexOf(rankSong) + 1;
        logs.push({
          blockTime: timeStr, type: 'used',
          title: rankSong.title, artist: rankSong.artist,
          station: 'TOP25', style: rankSong.style,
          reason: `[P0.75] TOP25 ranking (posição #${pos})`,
        });
        break;
      }
    }
  }

  // ============================================================
  // PRIORITY P2: TOP50 substitute (positions 26-50)
  // ============================================================
  if (!selectedSong) {
    const sortedRanking = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays);
    for (const rankSong of sortedRanking) {
      if (!isValidCandidate(rankSong.title, rankSong.artist)) continue;
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
          reason: `[P2] TOP50 substituto (posição ${sortedRanking.indexOf(rankSong) + 1})`,
          substituteFor: stationName || 'UNKNOWN',
        });
        break;
      }
    }
  }

  // ============================================================
  // PRIORITY P3: DNA/Style match — same-style stations first, with JIT download
  // ============================================================
  if (!selectedSong) {
    let attemptedDownloadP3 = false;

    // Sort stations: same-style first to maximize sequence affinity
    const sortedStations = Object.entries(songsByStation).sort(([nameA], [nameB]) => {
      const styleA = ctx.stations.find(s => s.name === nameA)?.styles?.[0] || '';
      const styleB = ctx.stations.find(s => s.name === nameB)?.styles?.[0] || '';
      if (styleA === stationStyle && styleB !== stationStyle) return -1;
      if (styleB === stationStyle && styleA !== stationStyle) return 1;
      return 0;
    });

    for (const [otherStation, songs] of sortedStations) {
      if (otherStation === stationName) continue;
      for (const candidate of songs) {
        if (candidate.style !== stationStyle) continue;
        if (!isValidCandidate(candidate.title, candidate.artist)) continue;

        const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
        if (libraryResult.exists) {
          const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
          stats.substituted++;
          logs.push({
            blockTime: timeStr, type: 'substituted',
            title: candidate.title, artist: candidate.artist,
            station: candidate.station, style: candidate.style,
            reason: `[P3] DNA similar: ${stationStyle} (de ${otherStation})`, substituteFor: stationName || 'UNKNOWN',
          });
          break;
        } else if (!attemptedDownloadP3) {
          attemptedDownloadP3 = true;
          const downloaded = await tryDownloadAndWait(candidate.artist, candidate.title, ctx, downloadTimeoutMs);
          if (downloaded) {
            const recheck = await ctx.findSongInLibrary(candidate.artist, candidate.title);
            if (recheck.exists) {
              const correctFilename = recheck.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
              selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
              stats.substituted++;
              logs.push({
                blockTime: timeStr, type: 'substituted',
                title: candidate.title, artist: candidate.artist,
                station: candidate.station, style: candidate.style,
                reason: `[P3] DNA similar JIT: ${stationStyle} (de ${otherStation})`, substituteFor: stationName || 'UNKNOWN',
              });
              break;
            }
          }
          if (!ctx.isSongAlreadyMissing(candidate.artist, candidate.title)) {
            ctx.addMissingSong({
              id: `missing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              title: candidate.title, artist: candidate.artist,
              station: otherStation, timestamp: new Date(), status: 'missing',
              dna: stationStyle, urgency: 'grade',
            });
          }
        }
      }
      if (selectedSong) break;
    }
  }

  // ============================================================
  // PRIORITY P4: General Pool (freshness-sorted) — with JIT download
  // ============================================================
  if (!selectedSong) {
    let attemptedDownloadP4 = false;

    const freshSortedPool = [...allSongsPool].sort((a, b) => {
      if (a.scrapedAt && b.scrapedAt) return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
      if (a.scrapedAt) return -1;
      if (b.scrapedAt) return 1;
      return 0;
    });

    for (const candidate of freshSortedPool) {
      if (!isValidCandidate(candidate.title, candidate.artist)) continue;
      const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
      if (libraryResult.exists) {
        const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
        selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
        stats.substituted++;
        logs.push({
          blockTime: timeStr, type: 'substituted',
          title: candidate.title, artist: candidate.artist,
          station: candidate.station, style: candidate.style,
          reason: '[P4] Pool geral (priorizado por frescor)',
        });
        break;
      } else if (!attemptedDownloadP4) {
        attemptedDownloadP4 = true;
        const downloaded = await tryDownloadAndWait(candidate.artist, candidate.title, ctx, downloadTimeoutMs);
        if (downloaded) {
          const recheck = await ctx.findSongInLibrary(candidate.artist, candidate.title);
          if (recheck.exists) {
            const correctFilename = recheck.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
            selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
            stats.substituted++;
            logs.push({
              blockTime: timeStr, type: 'substituted',
              title: candidate.title, artist: candidate.artist,
              station: candidate.station, style: candidate.style,
              reason: '[P4] Pool geral JIT (baixada just-in-time)',
            });
            break;
          }
        }
        if (!ctx.isSongAlreadyMissing(candidate.artist, candidate.title)) {
          ctx.addMissingSong({
            id: `missing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: candidate.title, artist: candidate.artist,
            station: candidate.station, timestamp: new Date(), status: 'missing',
            dna: candidate.style, urgency: 'grade',
          });
        }
      }
    }
  }

  // ============================================================
  // PRIORITY P5: Curadoria (random ranking song)
  // ============================================================
  if (!selectedSong) {
    const shuffledRanking = [...ctx.rankingSongs].sort(() => Math.random() - 0.5);
    for (const rankSong of shuffledRanking) {
      if (!isValidCandidate(rankSong.title, rankSong.artist)) continue;
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
          reason: '[P5] Curadoria automática do ranking',
        });
        break;
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
  
  // === DIAGNOSTIC LOGGING ===
  const stationPoolSize = stationSongs?.length || 0;
  const allPoolSize = allSongsPool.length;
  const rankingSize = ctx.rankingSongs.length;
  console.warn(`[SONG-SELECT] ❌ [P6] CORINGA usado para slot P${seq.position} "${seq.radioSource}" (resolved: "${stationName}", resolvedBy: "${resolvedBy}")`);
  console.warn(`[SONG-SELECT] ❌ DIAGNÓSTICO:`);
  console.warn(`  - Pool da estação "${stationName}": ${stationPoolSize} músicas`);
  console.warn(`  - Pool geral: ${allPoolSize} músicas`);
  console.warn(`  - Ranking: ${rankingSize} músicas`);
  console.warn(`  - Usadas no bloco: ${usedInBlock.size}`);
  console.warn(`  - Artistas no bloco: ${usedArtistsInBlock.size}`);
  console.warn(`  - Pastas de música: ${ctx.musicFolders.join(', ')}`);
  if (stationPoolSize > 0) {
    const first3 = stationSongs.slice(0, 3).map(s => `${s.artist} - ${s.title}`).join('; ');
    console.warn(`  - Primeiras 3 do pool: ${first3}`);
    console.warn(`  - TODAS foram verificadas e NÃO encontradas na biblioteca!`);
  }
  // === END DIAGNOSTIC ===
  
  logs.push({
    blockTime: timeStr, type: 'substituted',
    title: ctx.coringaCode, artist: 'CORINGA',
    station: 'FALLBACK',
    reason: `[P6] Nenhuma música válida encontrada para P${seq.position} (pool: ${stationPoolSize}, geral: ${allPoolSize}, ranking: ${rankingSize})`,
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
