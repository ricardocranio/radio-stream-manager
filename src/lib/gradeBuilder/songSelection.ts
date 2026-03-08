/**
 * Song Selection Logic — Priority Hierarchy (STRICT MONITORING)
 * 
 * The grade MUST follow the monitoring sequence. Each position in the sequence
 * specifies a radio station, and songs MUST come from that station's captures.
 * Randomness is only acceptable as the absolute last resort.
 * 
 * Order: P1 → P0 → P1.5 → P0.75 → P4 → P5 → P6
 * 
 * P1:    Station Pool — songs from the configured radio station (8 JIT attempts)
 * P0:    Carry-over — songs from previous blocks now downloaded
 * P1.5:  DNA/Style match — songs from other stations with same style (4 JIT attempts)
 * P0.75: TOP25 — songs from the ranking TOP25
 * P4:    General Pool — STYLE-FILTERED first, then any (3 JIT for same style)
 * P5:    Curadoria — random ranking song
 * P6:    Coringa — wildcard fallback code (mus/rom/jov)
 * 
 * P0.5 (fresh from ANY station) was REMOVED because it caused random selection
 * that broke the monitoring sequence identity.
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import type { SongEntry, BlockLogItem, BlockStats, GradeContext, CarryOverSong } from './types';
import { STATION_ID_TO_DB_NAME } from './constants';
import type { WeekDay, SequenceConfig } from '@/types/radio';
import { getCachedVerification } from '@/lib/libraryVerificationCache';
import { getGenreScore, getEnergyTransitionPenalty } from './smartGrade';

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
  previousEnergy?: string | null; // Tracks last selected song's energy for smooth transitions
}

/**
 * Apply smart scoring (genre + energy) as secondary sort within a candidate list.
 * Primary sort (freshness/style) is preserved; this only reorders among similar candidates.
 */
function applySmartScoring(
  candidates: SongEntry[],
  timeStr: string,
  previousEnergy: string | null | undefined
): SongEntry[] {
  return candidates.map(c => ({
    song: c,
    smartScore: getGenreScore((c as any).ai_genre, timeStr) - getEnergyTransitionPenalty(previousEnergy, (c as any).ai_energy),
  }))
  .sort((a, b) => b.smartScore - a.smartScore)
  .map(x => x.song);
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

  // Helper: check candidate validity (includes blackout check)
  const [blockHour] = timeStr.split(':').map(Number);
  const isValidCandidate = (title: string, artist: string) => {
    const key = `${title.toLowerCase()}-${artist.toLowerCase()}`;
    const normalizedArtist = artist.toLowerCase().trim();
    if (usedInBlock.has(key) || usedArtistsInBlock.has(normalizedArtist)) return false;
    if (ctx.isRecentlyUsed(title, artist, timeStr, isFullDay)) return false;
    // Artist blackout by time range
    if (ctx.artistBlackouts?.length) {
      for (const bo of ctx.artistBlackouts) {
        if (normalizedArtist.includes(bo.artist.toLowerCase().trim())) {
          if (bo.startHour <= bo.endHour) {
            if (blockHour >= bo.startHour && blockHour < bo.endHour) return false;
          } else {
            if (blockHour >= bo.startHour || blockHour < bo.endHour) return false;
          }
        }
      }
    }
    return true;
  };

  const downloadTimeoutMs = isFullDay ? 30000 : 720000;

  // ============================================================
  // PRIORITY 1: Station Pool (primary source — the configured radio)
  // This is the MAIN source: songs from the exact station in the sequence
  // Tries up to 8 JIT downloads to MAXIMIZE use of captured monitoring data
  // The grade MUST follow the monitoring sequence — this is the whole point of the system
  // ============================================================
  if (!selectedSong) {
    let jitAttemptsP1 = 0;
    const maxJitAttemptsP1 = 8; // Try up to 8 JIT downloads — be aggressive to follow monitoring

    // Sort by freshness (most recent scrapedAt first)
    const freshnessSorted = [...stationSongs].sort((a, b) => {
      if (a.scrapedAt && b.scrapedAt) return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
      if (a.scrapedAt) return -1;
      if (b.scrapedAt) return 1;
      return 0;
    });

    // Apply smart scoring (genre + energy) as tiebreaker within freshness groups
    const smartSorted = applySmartScoring(freshnessSorted, timeStr, selCtx.previousEnergy);

    for (const candidate of smartSorted) {
      if (!isValidCandidate(candidate.title, candidate.artist)) continue;

      const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
      if (libraryResult.exists) {
        const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
        selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
        selCtx.previousEnergy = (candidate as any).ai_energy || null;
        logs.push({
          blockTime: timeStr, type: 'used',
          title: candidate.title, artist: candidate.artist,
          station: candidate.station, style: candidate.style,
          reason: `[P1] Pool da estação "${stationName}" (resolvedBy: ${resolvedBy}) [smart]`,
        });
        break;
      } else if (jitAttemptsP1 < maxJitAttemptsP1) {
        jitAttemptsP1++;
        console.log(`[SONG-SELECT] 🔍 [P1] "${candidate.artist} - ${candidate.title}" ausente, tentativa JIT ${jitAttemptsP1}/${maxJitAttemptsP1}...`);
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
              reason: `[P1] Baixada JIT de "${stationName}" (tentativa ${jitAttemptsP1})`,
            });
            break;
          }
        }
        console.log(`[SONG-SELECT] ⚠️ [P1] JIT ${jitAttemptsP1}/${maxJitAttemptsP1} falhou, continuando...`);
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
      // Verify the carry-over song now exists in library (it was missing before)
      const libraryResult = await ctx.findSongInLibrary(carryOverSong.artist, carryOverSong.title);
      if (!libraryResult.exists) continue; // Still missing — skip
      const correctFilename = libraryResult.filename || sanitizeFilename(`${carryOverSong.artist} - ${carryOverSong.title}.mp3`);
      selectedSong = { ...carryOverSong, filename: correctFilename, existsInLibrary: true };
      usedInBlock.add(`${carryOverSong.title.toLowerCase()}-${carryOverSong.artist.toLowerCase()}`);
      usedArtistsInBlock.add(carryOverSong.artist.toLowerCase().trim());
      logs.push({
        blockTime: timeStr, type: 'used',
        title: carryOverSong.title, artist: carryOverSong.artist,
        station: carryOverSong.station, style: carryOverSong.style,
        reason: `[P0] Carry-over do bloco anterior (verificada na biblioteca)`,
      });
      break;
    }
  }

  // ============================================================
  // PRIORITY P1.5: DNA/Style match — same-style stations FIRST before random pools
  // Keeps the musical identity of the monitoring sequence intact
  // ============================================================
  if (!selectedSong) {
    let jitAttemptsDNA = 0;
    const maxJitAttemptsDNA = 4; // More aggressive to maintain musical identity

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
      // Sort by freshness within each station, then apply smart scoring
      const freshSorted = [...songs].sort((a, b) => {
        if (a.scrapedAt && b.scrapedAt) return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
        if (a.scrapedAt) return -1;
        if (b.scrapedAt) return 1;
        return 0;
      });
      const smartDnaSorted = applySmartScoring(freshSorted, timeStr, selCtx.previousEnergy);
      for (const candidate of smartDnaSorted) {
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
            reason: `[P1.5] DNA similar: ${stationStyle} (de ${otherStation})`, substituteFor: stationName || 'UNKNOWN',
          });
          break;
        } else if (jitAttemptsDNA < maxJitAttemptsDNA) {
          jitAttemptsDNA++;
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
                reason: `[P1.5] DNA similar JIT ${jitAttemptsDNA}: ${stationStyle} (de ${otherStation})`, substituteFor: stationName || 'UNKNOWN',
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
  // P0.5 REMOVED — Fresh captures from "ANY station" caused random selection
  // that broke the monitoring sequence. The grade must follow the configured
  // station order. If the target station has no songs, P1.5 (same style)
  // already covers the need for fresh content while maintaining musical identity.
  // ============================================================

  // ============================================================
  // PRIORITY P0.75: TOP25 Ranking — use highest-ranked songs from curated ranking
  // ============================================================
  if (!selectedSong && ctx.rankingSongs.length > 0) {
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
        logs.push({
          blockTime: timeStr, type: 'used',
          title: rankSong.title, artist: rankSong.artist,
          station: 'TOP25', style: rankSong.style,
          reason: `[P0.75] TOP25 posição ${top25.indexOf(rankSong) + 1}`,
        });
        break;
      }
    }
  }

  // ============================================================
  // PRIORITY P4: General Pool — STYLE-FILTERED FIRST, then any (with JIT)
  // Prioritizes songs matching the target station's style to maintain identity
  // ============================================================
  if (!selectedSong) {
    let jitAttemptsP4 = 0;
    const maxJitAttemptsP4 = 3;

    // Sort: same-style songs first, then by freshness within each group
    const styleFilteredPool = [...allSongsPool].sort((a, b) => {
      // Same style as target station gets priority
      const aStyleMatch = a.style === stationStyle ? 0 : 1;
      const bStyleMatch = b.style === stationStyle ? 0 : 1;
      if (aStyleMatch !== bStyleMatch) return aStyleMatch - bStyleMatch;
      // Within same priority, sort by freshness
      if (a.scrapedAt && b.scrapedAt) return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
      if (a.scrapedAt) return -1;
      if (b.scrapedAt) return 1;
      return 0;
    });

    for (const candidate of styleFilteredPool) {
      if (!isValidCandidate(candidate.title, candidate.artist)) continue;
      const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
      if (libraryResult.exists) {
        const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
        selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
        stats.substituted++;
        const styleInfo = candidate.style === stationStyle ? 'mesmo estilo' : 'estilo diferente';
        logs.push({
          blockTime: timeStr, type: 'substituted',
          title: candidate.title, artist: candidate.artist,
          station: candidate.station, style: candidate.style,
          reason: `[P4] Pool geral (${styleInfo}, de ${candidate.station})`,
        });
        break;
      } else if (jitAttemptsP4 < maxJitAttemptsP4 && candidate.style === stationStyle) {
        // Only JIT download for same-style songs in P4
        jitAttemptsP4++;
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
              reason: `[P4] Pool geral JIT ${jitAttemptsP4} (mesmo estilo, de ${candidate.station})`,
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
        // Verify song exists in library before adding to grade
        const libraryResult = await ctx.findSongInLibrary(rankSong.artist, rankSong.title);
        if (!libraryResult.exists) continue; // Skip missing songs
        const correctFilename = libraryResult.filename || sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`);
        usedInBlock.add(key);
        usedArtistsInBlock.add(normalizedArtist);
        ctx.markSongAsUsed(rankSong.title, rankSong.artist, timeStr);
        logs.push({
          blockTime: timeStr, type: 'used',
          title: rankSong.title, artist: rankSong.artist,
          station: 'TOP50', style: rankSong.style,
          reason: `TOP50 posição ${sortedRanking.indexOf(rankSong) + 1}`,
        });
        return `"${correctFilename}"`;
      }
    }
    logs.push({
      blockTime: timeStr, type: 'substituted',
      title: 'TOP50', artist: 'CORINGA', station: 'FALLBACK',
      reason: 'Ranking TOP50 vazio ou nenhuma música disponível na biblioteca',
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
