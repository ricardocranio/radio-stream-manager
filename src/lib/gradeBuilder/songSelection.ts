/**
 * Song Selection Logic — Priority Hierarchy (STRICT MONITORING)
 * 
 * The grade MUST follow the monitoring sequence. Each position in the sequence
 * specifies a radio station, and songs MUST come from that station's captures.
 * Randomness is only acceptable as the absolute last resort.
 * 
 * Order: P1 → P1-EXT → P0 → P1.5 → P0.75 → P4 → P5 → P6
 * 
 * P1:     Station Pool — fresh songs (≤15min) from the configured radio station
 * P1-EXT: Station Pool Extended — OLDER songs from the SAME station (preserves identity)
 * P0:     Carry-over — songs from previous blocks now downloaded
 * P1.5:   DNA/Style match — songs from other stations with same style (4 JIT attempts)
 * P0.75:  TOP25 — songs from the ranking TOP25
 * P4:     General Pool — STYLE-FILTERED first, then any (3 JIT for same style)
 * P5:     Curadoria — random ranking song
 * P6:     Coringa — wildcard fallback code (mus/rom/jov)
 * 
 * P0.5 (fresh from ANY station) was REMOVED because it caused random selection
 * that broke the monitoring sequence identity.
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import { buildBlockedEngine } from '@/lib/blockedSongsEngine';
import { buildAliasEngine } from '@/lib/aliasEngine';
import { getDownloadDecision } from '@/lib/downloadGuard';
import { songKey as makeSongKey, normalizeStr } from '@/lib/songUtils';
import { ensureFileMatchesGradeName, filenameNeedsSanitization, ensureFileRenamedOnDisk } from './sanitize';
import type { SongEntry, BlockLogItem, BlockStats, GradeContext, CarryOverSong } from './types';
import { STATION_ID_TO_DB_NAME } from './constants';
import type { WeekDay, SequenceConfig } from '@/types/radio';
import { getGenreScore, getEnergyTransitionPenalty, getBpmTransitionPenalty, isGenreCompatible } from './smartGrade';

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
  artist: string, title: string, ctx: GradeContext, maxWaitMs: number = 30000,
  aliasArtist?: string, aliasTitle?: string
): Promise<boolean> {
  if (!isElectron || !window.electronAPI?.downloadFromDeezer) {
    return false;
  }

  const { useRadioStore } = await import('@/store/radioStore');
  const storeState = useRadioStore.getState();
  if (!storeState.deezerConfig.enabled || !storeState.deezerConfig.arl) {
    return false;
  }

  const decision = getDownloadDecision(artist, title, {
    blockedSongs: storeState.config.blockedSongs ?? [],
    forbiddenWords: storeState.config.forbiddenWords ?? [],
    songAliases: storeState.songAliases ?? [],
  });
  if (!decision.allowed) {
    console.log(`[SONG-SELECT] 🚫 Download JIT bloqueado: ${artist} - ${title}`);
    return false;
  }

  // Use alias-corrected name for Deezer search (better match), fall back to raw name
  const dlArtist = decision.downloadArtist || aliasArtist || artist;
  const dlTitle = decision.downloadTitle || aliasTitle || title;
  
  if (dlArtist !== artist || dlTitle !== title) {
    console.log(`[SONG-SELECT] ⏬ Download JIT (alias): "${artist} - ${title}" → "${dlArtist} - ${dlTitle}" (timeout: ${Math.round(maxWaitMs / 1000)}s)`);
  } else {
    console.log(`[SONG-SELECT] ⏬ Download imediato: ${dlArtist} - ${dlTitle} (timeout: ${Math.round(maxWaitMs / 1000)}s)`);
  }

  try {
    const result = await Promise.race([
      window.electronAPI.downloadFromDeezer({
        artist: dlArtist, title: dlTitle,
        arl: storeState.deezerConfig.arl,
        outputFolder: storeState.deezerConfig.downloadFolder,
        quality: storeState.deezerConfig.quality,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), maxWaitMs)),
    ]);

    if (result && typeof result === 'object' && 'success' in result && result.success) {
      console.log(`[SONG-SELECT] ✅ Download concluído a tempo: ${dlArtist} - ${dlTitle}`);
      const { clearVerificationForSong, markSongAsDownloadedWithAlias } = await import('@/lib/libraryVerificationCache');
      // Clear stale cache and mark as downloaded for BOTH names
      clearVerificationForSong(artist, title);
      if (dlArtist !== artist || dlTitle !== title) {
        clearVerificationForSong(dlArtist, dlTitle);
      }
      markSongAsDownloadedWithAlias(artist, title, dlArtist || artist, dlTitle || title);
      return true;
    }

    console.log(`[SONG-SELECT] ⏰ Download não concluiu a tempo: ${dlArtist} - ${dlTitle}`);
    return false;
  } catch (error) {
    console.error(`[SONG-SELECT] ❌ Erro no download imediato: ${dlArtist} - ${dlTitle}`, error);
    return false;
  }
}

/**
 * CRITICAL SEQUENCE: Validate → Rename on disk → Write clean name to grade
 * 1. Check if filename has accents/special chars
 * 2. If yes, rename the physical file on disk FIRST
 * 3. Only AFTER renaming, use the sanitized name in the grade
 */
async function finalizeGradeFilename(
  currentFilename: string,
  artist: string,
  title: string,
  musicFolders: string[],
  filterChars?: string[]
): Promise<string> {
  const filenameToUse = currentFilename || sanitizeFilename(`${artist} - ${title}.mp3`);
  
  // Step 1: Check if file needs sanitization (accents, apostrophes, special chars)
  if (filenameNeedsSanitization(filenameToUse)) {
    // Step 2: Rename the physical file on disk FIRST
    console.log(`[SANITIZE] 📝 Arquivo precisa sanitização: "${filenameToUse}"`);
    const sanitized = await ensureFileRenamedOnDisk(filenameToUse, musicFolders, filterChars);
    // Step 3: Return the clean name for the grade .TXT
    return sanitized;
  }
  
  // No special chars — just apply standard grade formatting (uppercase, filter chars)
  return ensureFileMatchesGradeName(filenameToUse, filenameToUse, musicFolders, filterChars);
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
  previousEnergy?: string | null;
  previousBpm?: number | null; // BPM tracking for smooth rhythm transitions
}

/**
 * Apply smart scoring (genre + energy) as secondary sort within a candidate list.
 * Primary sort (freshness/style) is preserved; this only reorders among similar candidates.
 */
function applySmartScoring(
  candidates: SongEntry[],
  timeStr: string,
  previousEnergy: string | null | undefined,
  previousBpm?: number | null
): SongEntry[] {
  return candidates.map(c => ({
    song: c,
    smartScore: getGenreScore((c as any).ai_genre, timeStr) 
      - getEnergyTransitionPenalty(previousEnergy, (c as any).ai_energy)
      - getBpmTransitionPenalty(previousBpm, (c as any).bpm),
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

  // Helper: check candidate validity (includes blackout + blocked songs check)
  const [blockHour] = timeStr.split(':').map(Number);

  const toLibKey = (artist: string, title: string) => `${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`;

  // Import store once (used for blocked songs, aliases, reverse alias map)
  const { useRadioStore } = await import('@/store/radioStore');
  const _storeState = useRadioStore.getState();

  // Build engines (O(1) lookups)
  const storeConfig = _storeState.config;
  const _allAliases = _storeState.songAliases || [];
  const blockedEngine = buildBlockedEngine(
    storeConfig.blockedSongs || [],
    storeConfig.forbiddenWords || [],
    _allAliases
  );
  const aliasEngine = buildAliasEngine(_allAliases);

  const isBlockedSong = (artist: string, title: string): boolean =>
    blockedEngine.isBlocked(artist, title);

  // Build a set of blocked title fragments for partial matching
  const _blockedTitleFragments: string[] = (storeConfig.blockedSongs || [])
    .map(entry => {
      const dash = entry.indexOf(' - ');
      return dash !== -1 ? normalizeStr(entry.slice(dash + 3)) : '';
    })
    .filter(t => t.length >= 4); // Only fragments with 4+ chars to avoid false positives

  const isValidCandidate = (title: string, artist: string) => {
    const key = `${title.toLowerCase()}-${artist.toLowerCase()}`;
    const normalizedArtist = artist.toLowerCase().trim();
    if (usedInBlock.has(key) || usedArtistsInBlock.has(normalizedArtist)) return false;
    if (ctx.isRecentlyUsed(title, artist, timeStr, isFullDay)) return false;
    // 🚫 Blocked songs NEVER enter the grade (checks raw + alias-corrected + reverse-alias)
    if (isBlockedSong(artist, title)) {
      console.log(`[SONG-SELECT] 🚫 Bloqueada: "${artist} - ${title}" (detectada pelo blockedEngine)`);
      return false;
    }
    // 🚫 Also check the ALIAS-CORRECTED name against the block list
    // This catches cases where the corrected name itself is blocked
    const corrected = aliasEngine.resolve(artist, title);
    if ((corrected.artist !== artist || corrected.title !== title) && isBlockedSong(corrected.artist, corrected.title)) {
      console.log(`[SONG-SELECT] 🚫 Bloqueada via alias: "${artist} - ${title}" → "${corrected.artist} - ${corrected.title}"`);
      return false;
    }
    // 🚫 Partial title match — catches variations like "feat." or "remix" appended by radio
    const normTitle = normalizeStr(title);
    const normCorrectedTitle = normalizeStr(corrected.title);
    for (const frag of _blockedTitleFragments) {
      if (normTitle === frag || normCorrectedTitle === frag ||
          (frag.length >= 6 && (normTitle.includes(frag) || normCorrectedTitle.includes(frag)))) {
        // Double-check: also verify artist partially matches any blocked entry with this title
        const normArt = normalizeStr(artist);
        const normCorrArt = normalizeStr(corrected.artist);
        const matchesArtist = (storeConfig.blockedSongs || []).some(entry => {
          const dash = entry.indexOf(' - ');
          if (dash === -1) return false;
          const blockedArtist = normalizeStr(entry.slice(0, dash));
          const blockedTitle = normalizeStr(entry.slice(dash + 3));
          return blockedTitle === frag && (normArt.includes(blockedArtist) || blockedArtist.includes(normArt) ||
                                            normCorrArt.includes(blockedArtist) || blockedArtist.includes(normCorrArt));
        });
        if (matchesArtist) {
          console.log(`[SONG-SELECT] 🚫 Bloqueada (match parcial): "${artist} - ${title}" contém título bloqueado "${frag}"`);
          return false;
        }
      }
    }
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

  // Build reverse alias map using aliasEngine for O(1) library fallback
  const songAliases = _allAliases;

  /**
   * Enhanced library lookup: tries corrected name first, then original alias name.
   * This handles cases where the file was downloaded before the alias was created.
   */
  const findWithAliasFallback = async (artist: string, title: string, batchMap?: Map<string, any>): Promise<{ exists: boolean; filename?: string }> => {
    const key = toLibKey(artist, title);
    // Try original/raw name first (from batch or individual)
    if (batchMap) {
      const result = batchMap.get(key) as { exists: boolean; filename?: string } | undefined;
      if (result?.exists) return result;
    } else {
      const result = await ctx.findSongInLibrary(artist, title);
      if (result.exists) return result;
    }
    // Fallback 1: FORWARD alias — try the CORRECTED name on disk
    // This handles cases where the file was downloaded with the corrected name (via alias)
    // but the candidate still has the raw scraped name
    const corrected = aliasEngine.resolve(artist, title);
    if (corrected.artist !== artist || corrected.title !== title) {
      console.log(`[SONG-SELECT] 🔄 Alias forward: "${artist} - ${title}" → tentando "${corrected.artist} - ${corrected.title}" no disco`);
      const correctedKey = toLibKey(corrected.artist, corrected.title);
      // Check batch map first
      if (batchMap) {
        const batchResult = batchMap.get(correctedKey) as { exists: boolean; filename?: string } | undefined;
        if (batchResult?.exists) {
          console.log(`[SONG-SELECT] ✅ Encontrado via alias forward (batch): ${batchResult.filename}`);
          return batchResult;
        }
      }
      const forwardResult = await ctx.findSongInLibrary(corrected.artist, corrected.title);
      if (forwardResult.exists) {
        console.log(`[SONG-SELECT] ✅ Encontrado via alias forward: ${forwardResult.filename}`);
        return forwardResult;
      }
    }
    // Fallback 2: REVERSE alias — try the ORIGINAL name on disk
    // This handles cases where the candidate has the corrected name but the file has the old name
    const reverse = aliasEngine.resolveReverse(artist, title);
    if (reverse.artist !== artist || reverse.title !== title) {
      console.log(`[SONG-SELECT] 🔄 Alias reverso: "${artist} - ${title}" → tentando "${reverse.artist} - ${reverse.title}" no disco`);
      const fallbackResult = await ctx.findSongInLibrary(reverse.artist, reverse.title);
      if (fallbackResult.exists) {
        console.log(`[SONG-SELECT] ✅ Encontrado via alias reverso: ${fallbackResult.filename}`);
        return fallbackResult;
      }
    }
    return { exists: false };
  };

  // Prevent long "rodando..." when JIT download is slow/unavailable in incremental builds
  const downloadTimeoutMs = isFullDay ? 30000 : 120000;

  const MAX_MISSING_MARKS_PER_PRIORITY = 10;

  // ============================================================
  // PRIORITY 1: Station Pool (primary source — the configured radio)
  // GRADUATED FRESHNESS: Tries 20min → 40min → 60min → 120min tiers.
  // Each tier expands the window only if the previous one found ZERO
  // library-available candidates. This maximizes P1 hit rate while
  // still preferring the freshest songs from the target station.
  // ============================================================
  if (!selectedSong) {
    const now = Date.now();
    // Graduated freshness tiers (ms) — try narrow first, widen if empty
    const P1_TIERS_MS = [
      20 * 60 * 1000,   // Tier 1: ≤20min (fresh — matches monitor 12min cycle)
      40 * 60 * 1000,   // Tier 2: ≤40min (recent — ~3 cycles)
      60 * 60 * 1000,   // Tier 3: ≤1h (still relevant)
      120 * 60 * 1000,  // Tier 4: ≤2h (last resort before P1-EXT)
    ];
    const P1_TIER_LABELS = ['≤20min', '≤40min', '≤1h', '≤2h'];

    // Sort by freshness DESC (newest first)
    const freshnessSorted = [...stationSongs].sort((a, b) => {
      if (a.scrapedAt && b.scrapedAt) return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
      if (a.scrapedAt) return -1;
      if (b.scrapedAt) return 1;
      return 0;
    });

    console.log(`[SONG-SELECT] 🕐 [P1] Pool "${stationName}" (resolvedBy: ${resolvedBy}): ${freshnessSorted.length} total`);
    if (freshnessSorted.length > 0 && freshnessSorted[0].scrapedAt) {
      const newestAge = Math.round((now - new Date(freshnessSorted[0].scrapedAt).getTime()) / 60000);
      console.log(`[SONG-SELECT] 🎵 [P1] Música mais nova de "${stationName}": ${freshnessSorted[0].artist} - ${freshnessSorted[0].title} (${newestAge}min)`);
    }

    // Try each freshness tier until we find a library-available song
    for (let tierIdx = 0; tierIdx < P1_TIERS_MS.length && !selectedSong; tierIdx++) {
      const tierMaxMs = P1_TIERS_MS[tierIdx];
      const tierLabel = P1_TIER_LABELS[tierIdx];

      const tierPool = freshnessSorted.filter(c => {
        if (!c.scrapedAt) return false;
        return (now - new Date(c.scrapedAt).getTime()) <= tierMaxMs;
      });

      if (tierPool.length === 0) {
        if (tierIdx === 0) {
          console.log(`[SONG-SELECT] ⚠️ [P1-T${tierIdx + 1}] Nenhuma música ${tierLabel} de "${stationName}", expandindo janela...`);
        }
        continue;
      }

      const tierCandidates = tierPool.filter(c => isValidCandidate(c.title, c.artist));

      if (tierCandidates.length === 0) {
        console.log(`[SONG-SELECT] ⚠️ [P1-T${tierIdx + 1}] ${tierPool.length} músicas ${tierLabel} de "${stationName}" mas TODAS filtradas (anti-rep/bloqueio). Expandindo...`);
        continue;
      }

      console.log(`[SONG-SELECT] 🎯 [P1-T${tierIdx + 1}] ${tierCandidates.length} candidatas ${tierLabel} de "${stationName}". Top 3: ${tierCandidates.slice(0, 3).map(c => {
        const ageMin = c.scrapedAt ? Math.round((now - new Date(c.scrapedAt).getTime()) / 60000) : '?';
        return `${c.artist} - ${c.title} (${ageMin}m)`;
      }).join('; ')}`);

      // Build batch lookup including BOTH raw names AND alias-corrected names
      const batchEntries = tierCandidates.flatMap(c => {
        const entries = [{ artist: c.artist, title: c.title }];
        const corrected = aliasEngine.resolve(c.artist, c.title);
        if (corrected.artist !== c.artist || corrected.title !== c.title) {
          entries.push({ artist: corrected.artist, title: corrected.title });
        }
        return entries;
      });
      const tierMap = batchEntries.length
        ? await ctx.batchFindSongsInLibrary(batchEntries)
        : new Map();

      // PHASE 1: Pick the first candidate that ALREADY exists in library (instant, no download)
      const missingFromTier: SongEntry[] = [];
      for (const candidate of tierCandidates) {
        const libraryResult = await findWithAliasFallback(candidate.artist, candidate.title, tierMap as Map<string, any>);

        if (libraryResult?.exists) {
          const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          const ageMin = candidate.scrapedAt ? Math.round((now - new Date(candidate.scrapedAt).getTime()) / 60000) : '?';
          selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
          selCtx.previousEnergy = (candidate as any).ai_energy || null;
          selCtx.previousBpm = (candidate as any).bpm || null;
          logs.push({
            blockTime: timeStr,
            type: 'used',
            title: candidate.title,
            artist: candidate.artist,
            station: candidate.station,
            style: candidate.style,
            reason: `[P1] Pool da estação "${stationName}" (resolvedBy: ${resolvedBy}, frescor: ${ageMin}min, tier: ${tierLabel})`,
          });
          console.log(`[SONG-SELECT] ✅ [P1-T${tierIdx + 1}] Selecionada: "${candidate.artist} - ${candidate.title}" (frescor: ${ageMin}min, resolvedBy: ${resolvedBy})`);
          break;
        } else {
          missingFromTier.push(candidate);
        }
      }

      // PHASE 2: No song from this tier exists in library — try JIT download
      // ALL tiers attempt JIT because the monitor updates every 12min,
      // so candidates exist but may not have been downloaded yet.
      // Freshest tier gets most attempts; older tiers get fewer.
      if (!selectedSong && missingFromTier.length > 0) {
        let jitAttemptsP1 = 0;
        // Tier 1 (≤20min): 10 attempts — most critical, freshest captures
        // Tier 2 (≤40min): 6 attempts — still very relevant
        // Tier 3 (≤1h): 4 attempts — worth trying
        // Tier 4 (≤2h): 3 attempts — last resort within P1
        const jitBudgetByTier = [10, 6, 4, 3];
        const maxJitAttemptsP1 = jitBudgetByTier[tierIdx] || 3;
        let missingMarks = 0;

        console.log(`[SONG-SELECT] ⚠️ [P1-T${tierIdx + 1}] Nenhuma música ${tierLabel} de "${stationName}" na biblioteca (${missingFromTier.length} candidatas). Tentando JIT (${maxJitAttemptsP1} tentativas)...`);

        for (const candidate of missingFromTier) {
          if (jitAttemptsP1 >= maxJitAttemptsP1) break;

          jitAttemptsP1++;
          const ageMin = candidate.scrapedAt ? Math.round((now - new Date(candidate.scrapedAt).getTime()) / 60000) : '?';
          console.log(`[SONG-SELECT] 🔍 [P1-T${tierIdx + 1}] "${candidate.artist} - ${candidate.title}" (${ageMin}min) ausente, tentativa JIT ${jitAttemptsP1}/${maxJitAttemptsP1}...`);
          const jitAlias = aliasEngine.resolve(candidate.artist, candidate.title);
          const downloaded = await tryDownloadAndWait(candidate.artist, candidate.title, ctx, downloadTimeoutMs, jitAlias.artist, jitAlias.title);
          if (downloaded) {
            const recheck = await findWithAliasFallback(candidate.artist, candidate.title);
            if (recheck.exists) {
              const correctFilename = recheck.filename || sanitizeFilename(`${jitAlias.artist} - ${jitAlias.title}.mp3`);
              selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
              logs.push({
                blockTime: timeStr,
                type: 'used',
                title: candidate.title,
                artist: candidate.artist,
                station: candidate.station,
                style: candidate.style,
                reason: `[P1] Baixada JIT de "${stationName}" (tentativa ${jitAttemptsP1}, frescor: ${ageMin}min, tier: ${tierLabel})`,
              });
              break;
            }
          }
          console.log(`[SONG-SELECT] ⚠️ [P1-T${tierIdx + 1}] JIT ${jitAttemptsP1}/${maxJitAttemptsP1} falhou, continuando...`);

          // Mark missing + carry-over (capped)
          if (missingMarks < MAX_MISSING_MARKS_PER_PRIORITY) {
            missingMarks++;
            if (!ctx.isSongAlreadyMissing(candidate.artist, candidate.title)) {
              ctx.addMissingSong({
                id: `missing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: candidate.title,
                artist: candidate.artist,
                station: stationName || 'UNKNOWN',
                timestamp: new Date(),
                status: 'missing',
                dna: stationStyle,
                urgency: 'grade',
              });
            }
            ctx.addCarryOverSong({
              title: candidate.title,
              artist: candidate.artist,
              station: stationName || 'UNKNOWN',
              style: stationStyle,
              targetBlock: timeStr,
            });
          }
        }
      }
    } // end tier loop
  }

  // ============================================================
  // PRIORITY P1-EXT: Same station, older songs (beyond graduated tiers)
  // When ALL graduated tiers found no songs, try ALL remaining songs
  // from the SAME station regardless of age. This preserves station
  // identity and is MUCH more assertive than jumping to other stations.
  // ============================================================
  if (!selectedSong && stationSongs.length > 0) {
    const now_ext = Date.now();
    const P1_GRADUATED_MAX_MS = 120 * 60 * 1000; // Match last graduated tier (2h)

    // Get songs that were TOO OLD for graduated tiers but still belong to the correct station
    const olderStationSongs = [...stationSongs]
      .filter(c => {
        if (!c.scrapedAt) return true; // no timestamp = include (could be from historico)
        return (now_ext - new Date(c.scrapedAt).getTime()) > P1_GRADUATED_MAX_MS;
      })
      .sort((a, b) => {
        if (a.scrapedAt && b.scrapedAt) return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
        return 0;
      })
      .filter(c => isValidCandidate(c.title, c.artist));

    if (olderStationSongs.length > 0) {
      console.log(`[SONG-SELECT] 🕐 [P1-EXT] Tentando ${olderStationSongs.length} músicas MAIS ANTIGAS (>2h) de "${stationName}" (mantendo identidade da rádio)`);

      const extBatchEntries = olderStationSongs.flatMap(c => {
        const entries = [{ artist: c.artist, title: c.title }];
        const corrected = aliasEngine.resolve(c.artist, c.title);
        if (corrected.artist !== c.artist || corrected.title !== c.title) {
          entries.push({ artist: corrected.artist, title: corrected.title });
        }
        return entries;
      });
      const extMap = extBatchEntries.length
        ? await ctx.batchFindSongsInLibrary(extBatchEntries)
        : new Map();

      for (const candidate of olderStationSongs) {
        const libraryResult = await findWithAliasFallback(candidate.artist, candidate.title, extMap as Map<string, any>);
        if (libraryResult?.exists) {
          const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          const ageMin = candidate.scrapedAt ? Math.round((now_ext - new Date(candidate.scrapedAt).getTime()) / 60000) : '?';
          selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
          selCtx.previousEnergy = (candidate as any).ai_energy || null;
          selCtx.previousBpm = (candidate as any).bpm || null;
          logs.push({
            blockTime: timeStr,
            type: 'used',
            title: candidate.title,
            artist: candidate.artist,
            station: candidate.station,
            style: candidate.style,
            reason: `[P1-EXT] Pool estendido "${stationName}" (frescor: ${ageMin}min, mantendo identidade)`,
          });
          console.log(`[SONG-SELECT] ✅ [P1-EXT] Selecionada: "${candidate.artist} - ${candidate.title}" (${ageMin}min, da mesma rádio)`);
          break;
        }
      }

      // JIT for older station songs — AGGRESSIVE: up to 8 attempts to respect sequence
      if (!selectedSong) {
        let jitExtAttempts = 0;
        const maxJitExt = 8;
        console.log(`[SONG-SELECT] ⚠️ [P1-EXT] Nenhuma música antiga de "${stationName}" na biblioteca. Tentando JIT agressivo (${maxJitExt} tentativas)...`);
        for (const candidate of olderStationSongs) {
          if (jitExtAttempts >= maxJitExt) break;
          jitExtAttempts++;
          const jitAlias = aliasEngine.resolve(candidate.artist, candidate.title);
          const downloaded = await tryDownloadAndWait(candidate.artist, candidate.title, ctx, downloadTimeoutMs, jitAlias.artist, jitAlias.title);
          if (downloaded) {
            const recheck = await findWithAliasFallback(candidate.artist, candidate.title);
            if (recheck.exists) {
              const correctFilename = recheck.filename || sanitizeFilename(`${jitAlias.artist} - ${jitAlias.title}.mp3`);
              const ageMin = candidate.scrapedAt ? Math.round((now_ext - new Date(candidate.scrapedAt).getTime()) / 60000) : '?';
              selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
              logs.push({
                blockTime: timeStr,
                type: 'used',
                title: candidate.title,
                artist: candidate.artist,
                station: candidate.station,
                style: candidate.style,
                reason: `[P1-EXT] JIT da mesma rádio "${stationName}" (${ageMin}min, tentativa ${jitExtAttempts})`,
              });
              break;
            }
          }
        }
      }
    }
  }

  // ============================================================
  // PRIORITY P0-SAME: Carry-over from the SAME station first
  // Before trying any other station, check if we have carry-over
  // songs specifically from the target station.
  // ============================================================
  if (!selectedSong && stationName) {
    const carryOverSameStation = (carryOverByStation[stationName] || []).filter(s => isValidCandidate(s.title, s.artist));

    if (carryOverSameStation.length > 0) {
      const map = await ctx.batchFindSongsInLibrary(carryOverSameStation.map(s => ({ artist: s.artist, title: s.title })));
      for (const carryOverSong of carryOverSameStation) {
        const r = (map as Map<string, any>).get(toLibKey(carryOverSong.artist, carryOverSong.title)) as { exists: boolean; filename?: string } | undefined;
        if (!r?.exists) continue;
        const correctFilename = r.filename || sanitizeFilename(`${carryOverSong.artist} - ${carryOverSong.title}.mp3`);
        selectedSong = { ...carryOverSong, filename: correctFilename, existsInLibrary: true };
        usedInBlock.add(`${carryOverSong.title.toLowerCase()}-${carryOverSong.artist.toLowerCase()}`);
        usedArtistsInBlock.add(carryOverSong.artist.toLowerCase().trim());
        logs.push({
          blockTime: timeStr,
          type: 'used',
          title: carryOverSong.title,
          artist: carryOverSong.artist,
          station: carryOverSong.station,
          style: carryOverSong.style,
          reason: `[P0-SAME] Carry-over da mesma rádio "${stationName}" (batch)`,
        });
        console.log(`[SONG-SELECT] ✅ [P0-SAME] Carry-over de "${stationName}": "${carryOverSong.artist} - ${carryOverSong.title}"`);
        break;
      }
    }
  }

  // === LOG SEQUENCE VIOLATION if we're about to leave the target station ===
  if (!selectedSong && stationName && stationSongs.length > 0) {
    console.warn(`[SONG-SELECT] ⚠️🔴 VIOLAÇÃO DE SEQUÊNCIA: Posição P${seq.position} deveria ser "${stationName}" mas NENHUMA música dessa rádio está disponível na biblioteca. Pool tinha ${stationSongs.length} candidatas. Caindo para prioridades cruzadas...`);
  }

  // ============================================================
  // PRIORITY P0: Carry-over (songs from previous blocks, now downloaded)
  // ============================================================
  if (!selectedSong) {
    const carryOverForStation = (carryOverByStation[stationName] || []).filter(s => isValidCandidate(s.title, s.artist));

    if (carryOverForStation.length > 0) {
      const map = await ctx.batchFindSongsInLibrary(carryOverForStation.map(s => ({ artist: s.artist, title: s.title })));
      for (const carryOverSong of carryOverForStation) {
        const r = (map as Map<string, any>).get(toLibKey(carryOverSong.artist, carryOverSong.title)) as { exists: boolean; filename?: string } | undefined;
        if (!r?.exists) continue;
        const correctFilename = r.filename || sanitizeFilename(`${carryOverSong.artist} - ${carryOverSong.title}.mp3`);
        selectedSong = { ...carryOverSong, filename: correctFilename, existsInLibrary: true };
        usedInBlock.add(`${carryOverSong.title.toLowerCase()}-${carryOverSong.artist.toLowerCase()}`);
        usedArtistsInBlock.add(carryOverSong.artist.toLowerCase().trim());
        logs.push({
          blockTime: timeStr,
          type: 'used',
          title: carryOverSong.title,
          artist: carryOverSong.artist,
          station: carryOverSong.station,
          style: carryOverSong.style,
          reason: `[P0] Carry-over do bloco anterior (batch)`,
        });
        break;
      }
    }
  }

  // ============================================================
  // PRIORITY P1.5: DNA/Style match — same-style stations FIRST
  // ============================================================
  if (!selectedSong) {
    let jitAttemptsDNA = 0;
    const maxJitAttemptsDNA = 4;
    let missingMarks = 0;

    const sortedStations = Object.entries(songsByStation).sort(([nameA], [nameB]) => {
      const styleA = ctx.stations.find(s => s.name === nameA)?.styles?.[0] || '';
      const styleB = ctx.stations.find(s => s.name === nameB)?.styles?.[0] || '';
      if (styleA === stationStyle && styleB !== stationStyle) return -1;
      if (styleB === stationStyle && styleA !== stationStyle) return 1;
      return 0;
    });

    for (const [otherStation, songs] of sortedStations) {
      if (otherStation === stationName) continue;

      const freshSorted = [...songs].sort((a, b) => {
        if (a.scrapedAt && b.scrapedAt) return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
        if (a.scrapedAt) return -1;
        if (b.scrapedAt) return 1;
        return 0;
      });

      const smartDnaSorted = applySmartScoring(freshSorted, timeStr, selCtx.previousEnergy, selCtx.previousBpm);
      // Use ID3 genre (ai_genre) for compatibility matching instead of just station style
      const dnaCandidates = smartDnaSorted
        .filter(c => {
          // Primary: exact style match (legacy behavior)
          if (c.style === stationStyle) return true;
          // Enhanced: ID3 genre compatibility check
          const songGenre = (c as any).ai_genre;
          if (songGenre && isGenreCompatible(songGenre, stationStyle)) return true;
          return false;
        })
        .filter(c => isValidCandidate(c.title, c.artist));

      if (dnaCandidates.length === 0) continue;

      const dnaMap = await ctx.batchFindSongsInLibrary(dnaCandidates.map(c => ({ artist: c.artist, title: c.title })));

      for (const candidate of dnaCandidates) {
        const r = (dnaMap as Map<string, any>).get(toLibKey(candidate.artist, candidate.title)) as { exists: boolean; filename?: string } | undefined;
        if (r?.exists) {
          const correctFilename = r.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
          stats.substituted++;
          const matchType = candidate.style === stationStyle ? 'estilo' : `ID3:${(candidate as any).ai_genre || '?'}`;
          logs.push({
            blockTime: timeStr,
            type: 'substituted',
            title: candidate.title,
            artist: candidate.artist,
            station: candidate.station,
            style: candidate.style,
            reason: `[P1.5] DNA match (${matchType} → ${stationStyle}, de ${otherStation}) [batch]`,
            substituteFor: stationName || 'UNKNOWN',
          });
          break;
        }

        if (jitAttemptsDNA < maxJitAttemptsDNA) {
          jitAttemptsDNA++;
          const jitAlias = aliasEngine.resolve(candidate.artist, candidate.title);
          const downloaded = await tryDownloadAndWait(candidate.artist, candidate.title, ctx, downloadTimeoutMs, jitAlias.artist, jitAlias.title);
          if (downloaded) {
            const recheck = await findWithAliasFallback(candidate.artist, candidate.title);
            if (recheck.exists) {
              const correctFilename = recheck.filename || sanitizeFilename(`${jitAlias.artist} - ${jitAlias.title}.mp3`);
              selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
              stats.substituted++;
              logs.push({
                blockTime: timeStr,
                type: 'substituted',
                title: candidate.title,
                artist: candidate.artist,
                station: candidate.station,
                style: candidate.style,
                reason: `[P1.5] DNA similar JIT ${jitAttemptsDNA}: ${stationStyle} (de ${otherStation})`,
                substituteFor: stationName || 'UNKNOWN',
              });
              break;
            }
          }

          if (missingMarks < MAX_MISSING_MARKS_PER_PRIORITY) {
            missingMarks++;
            if (!ctx.isSongAlreadyMissing(candidate.artist, candidate.title)) {
              ctx.addMissingSong({
                id: `missing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: candidate.title,
                artist: candidate.artist,
                station: otherStation,
                timestamp: new Date(),
                status: 'missing',
                dna: stationStyle,
                urgency: 'grade',
              });
            }
          }
        }
      }

      if (selectedSong) break;
    }
  }

  // ============================================================
  // PRIORITY P0.75: TOP25 Ranking
  // ============================================================
  if (!selectedSong && ctx.rankingSongs.length > 0) {
    const top25 = [...ctx.rankingSongs]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 25);

    const topCandidates = top25.filter(s => isValidCandidate(s.title, s.artist));

    if (topCandidates.length > 0) {
      const map = await ctx.batchFindSongsInLibrary(topCandidates.map(s => ({ artist: s.artist, title: s.title })));
      for (const rankSong of topCandidates) {
        const r = (map as Map<string, any>).get(toLibKey(rankSong.artist, rankSong.title)) as { exists: boolean; filename?: string } | undefined;
        if (!r?.exists) continue;
        const correctFilename = r.filename || sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`);
        selectedSong = {
          title: rankSong.title,
          artist: rankSong.artist,
          station: 'TOP25',
          style: rankSong.style,
          filename: correctFilename,
          existsInLibrary: true,
        };
        logs.push({
          blockTime: timeStr,
          type: 'used',
          title: rankSong.title,
          artist: rankSong.artist,
          station: 'TOP25',
          style: rankSong.style,
          reason: `[P0.75] TOP25 posição ${top25.indexOf(rankSong) + 1} [batch]`,
        });
        break;
      }
    }
  }

  // ============================================================
  // PRIORITY P4: General Pool — STYLE-FILTERED FIRST (chunked batch)
  // ============================================================
  if (!selectedSong) {
    let jitAttemptsP4 = 0;
    const maxJitAttemptsP4 = 3;
    let missingMarks = 0;

    const styleFilteredPool = [...allSongsPool].sort((a, b) => {
      const aStyleMatch = a.style === stationStyle ? 0 : 1;
      const bStyleMatch = b.style === stationStyle ? 0 : 1;
      if (aStyleMatch !== bStyleMatch) return aStyleMatch - bStyleMatch;
      if (a.scrapedAt && b.scrapedAt) return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
      if (a.scrapedAt) return -1;
      if (b.scrapedAt) return 1;
      return 0;
    });

    const smartP4Pool = applySmartScoring(styleFilteredPool, timeStr, selCtx.previousEnergy, selCtx.previousBpm);

    const BATCH_SIZE = 60;
    const MAX_SCAN = 300; // avoid scanning the entire universe

    for (let offset = 0; offset < Math.min(smartP4Pool.length, MAX_SCAN) && !selectedSong; offset += BATCH_SIZE) {
      const chunk = smartP4Pool
        .slice(offset, offset + BATCH_SIZE)
        .filter(c => isValidCandidate(c.title, c.artist));

      if (chunk.length === 0) continue;

      const chunkMap = await ctx.batchFindSongsInLibrary(chunk.map(c => ({ artist: c.artist, title: c.title })));

      for (const candidate of chunk) {
        const r = (chunkMap as Map<string, any>).get(toLibKey(candidate.artist, candidate.title)) as { exists: boolean; filename?: string } | undefined;
        if (r?.exists) {
          const correctFilename = r.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
          stats.substituted++;
          const styleInfo = candidate.style === stationStyle ? 'mesmo estilo' : 'estilo diferente';
          logs.push({
            blockTime: timeStr,
            type: 'substituted',
            title: candidate.title,
            artist: candidate.artist,
            station: candidate.station,
            style: candidate.style,
            reason: `[P4] Pool geral (${styleInfo}, de ${candidate.station}) [batch]`,
          });
          break;
        }

        if (jitAttemptsP4 < maxJitAttemptsP4 && candidate.style === stationStyle) {
          jitAttemptsP4++;
          const jitAlias = aliasEngine.resolve(candidate.artist, candidate.title);
          const downloaded = await tryDownloadAndWait(candidate.artist, candidate.title, ctx, downloadTimeoutMs, jitAlias.artist, jitAlias.title);
          if (downloaded) {
            const recheck = await findWithAliasFallback(candidate.artist, candidate.title);
            if (recheck.exists) {
              const correctFilename = recheck.filename || sanitizeFilename(`${jitAlias.artist} - ${jitAlias.title}.mp3`);
              selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
              stats.substituted++;
              logs.push({
                blockTime: timeStr,
                type: 'substituted',
                title: candidate.title,
                artist: candidate.artist,
                station: candidate.station,
                style: candidate.style,
                reason: `[P4] Pool geral JIT ${jitAttemptsP4} (mesmo estilo, de ${candidate.station})`,
              });
              break;
            }
          }

          if (missingMarks < MAX_MISSING_MARKS_PER_PRIORITY) {
            missingMarks++;
            if (!ctx.isSongAlreadyMissing(candidate.artist, candidate.title)) {
              ctx.addMissingSong({
                id: `missing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: candidate.title,
                artist: candidate.artist,
                station: candidate.station,
                timestamp: new Date(),
                status: 'missing',
                dna: candidate.style,
                urgency: 'grade',
              });
            }
          }
        }
      }
    }
  }

  // ============================================================
  // PRIORITY P5: Curadoria (random ranking song) — batch first slice
  // ============================================================
  if (!selectedSong) {
    const shuffledRanking = [...ctx.rankingSongs].sort(() => Math.random() - 0.5);
    const candidates = shuffledRanking.filter(s => isValidCandidate(s.title, s.artist)).slice(0, 80);

    if (candidates.length > 0) {
      const map = await ctx.batchFindSongsInLibrary(candidates.map(s => ({ artist: s.artist, title: s.title })));
      for (const rankSong of candidates) {
        const r = (map as Map<string, any>).get(toLibKey(rankSong.artist, rankSong.title)) as { exists: boolean; filename?: string } | undefined;
        if (!r?.exists) continue;
        const correctFilename = r.filename || sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`);
        selectedSong = {
          title: rankSong.title,
          artist: rankSong.artist,
          station: 'CURADORIA',
          style: rankSong.style,
          filename: correctFilename,
          existsInLibrary: true,
        };
        stats.substituted++;
        logs.push({
          blockTime: timeStr,
          type: 'substituted',
          title: rankSong.title,
          artist: rankSong.artist,
          station: 'CURADORIA',
          style: rankSong.style,
          reason: '[P5] Curadoria automática do ranking [batch]',
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
    // Track energy for next transition
    selCtx.previousEnergy = (selectedSong as any).ai_energy || selCtx.previousEnergy;
    selCtx.previousBpm = (selectedSong as any).bpm || selCtx.previousBpm;

    // Add 'used' log if not already logged by a priority level
    const hasLog = logs.some(l => l.title === selectedSong!.title && l.artist === selectedSong!.artist && l.blockTime === timeStr);
    if (!hasLog) {
      logs.push({
        blockTime: timeStr, type: 'used',
        title: selectedSong.title, artist: selectedSong.artist,
        station: selectedSong.station, style: selectedSong.style,
      });
    }

    // 🔄 ALIAS RESOLUTION: Use the CORRECTED name (from Correções de Músicas) in the grade.
    // The scraped name may be wrong — the alias provides the canonical name.
    const aliasResolved = aliasEngine.resolve(selectedSong.artist, selectedSong.title);
    const gradeArtist = aliasResolved.artist;
    const gradeTitle = aliasResolved.title;
    if (gradeArtist !== selectedSong.artist || gradeTitle !== selectedSong.title) {
      console.log(`[SONG-SELECT] 🔄 Alias para grade: "${selectedSong.artist} - ${selectedSong.title}" → "${gradeArtist} - ${gradeTitle}"`);
      // Also mark the corrected name as used to prevent double usage
      usedInBlock.add(`${gradeTitle.toLowerCase()}-${gradeArtist.toLowerCase()}`);
      usedArtistsInBlock.add(gradeArtist.toLowerCase().trim());
      ctx.markSongAsUsed(gradeTitle, gradeArtist, timeStr);
    }

    // CRITICAL SEQUENCE: Validate → Rename on disk → Write clean name to grade
    // 1. Check if filename has accents/special chars
    // 2. If yes, rename the physical file on disk FIRST
    // 3. Only AFTER renaming, use the sanitized name in the grade
    const originalFilename = selectedSong.filename || '';
    const sanitizedFilename = await finalizeGradeFilename(
      originalFilename,
      gradeArtist,
      gradeTitle,
      ctx.musicFolders,
      ctx.filterChars
    );

    return `"${sanitizedFilename}"`;
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

  // Skip ALL fixed content on Sunday (DOM = 100% monitoring, no fixed programs)
  const isSunday = targetDay === 'dom';

  // Handle fixo_ID
  if (seq.radioSource.startsWith('fixo_')) {
    if (isSunday) {
      console.log(`[SONG-SELECT] 🌞 Domingo: conteúdo fixo "${seq.radioSource}" ignorado às ${timeStr}`);
      return null; // Skip — will be filled with music from monitoring
    }
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
    if (isSunday) {
      console.log(`[SONG-SELECT] 🌞 Domingo: conteúdo fixo genérico ignorado às ${timeStr}`);
      return null;
    }
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
        const sanitizedFilename = await finalizeGradeFilename(correctFilename, rankSong.artist, rankSong.title, ctx.musicFolders, ctx.filterChars);
        return `"${sanitizedFilename}"`;
      }
    }
    logs.push({
      blockTime: timeStr, type: 'substituted',
      title: 'TOP50', artist: 'CORINGA', station: 'FALLBACK',
      reason: 'Ranking TOP50 vazio ou nenhuma música disponível na biblioteca',
    });
    return ctx.coringaCode;
  }

  // Handle genre_* (e.g. genre_SERTANEJO, genre_PAGODE, genre_ROCK,METAL)
  if (seq.radioSource.startsWith('genre_')) {
    const genreStr = seq.radioSource.replace('genre_', '');
    const genres = genreStr.split(',').map(g => g.trim());
    const { findSongByGenre } = await import('./specialPrograms');
    
    const result = await findSongByGenre(genres, timeStr, usedInBlock, usedArtistsInBlock, ctx, isFullDay);
    if (result) {
      const key = `${result.title.toLowerCase()}-${result.artist.toLowerCase()}`;
      usedInBlock.add(key);
      usedArtistsInBlock.add(result.artist.toLowerCase().trim());
      ctx.markSongAsUsed(result.title, result.artist, timeStr);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: result.title, artist: result.artist,
        station: result.genre.toUpperCase(),
        reason: `Gênero ${genres.join('/')} (ai_genre)`,
      });
      const sanitizedFilename = await finalizeGradeFilename(result.filename, result.artist, result.title, ctx.musicFolders, ctx.filterChars);
      return `"${sanitizedFilename}"`;
    }
    logs.push({
      blockTime: timeStr, type: 'substituted',
      title: genres.join('/'), artist: 'CORINGA', station: 'FALLBACK',
      reason: `Nenhuma música do gênero ${genres.join('/')} disponível`,
    });
    return ctx.coringaCode;
  }

  // Handle genreyear_* combined (e.g. genreyear_POP_90s, genreyear_ROCK,METAL_80s)
  if (seq.radioSource.startsWith('genreyear_')) {
    const parts = seq.radioSource.replace('genreyear_', '');
    const lastUnderscore = parts.lastIndexOf('_');
    const genreStr = parts.substring(0, lastUnderscore);
    const yearKey = parts.substring(lastUnderscore + 1);
    const genres = genreStr.split(',').map(g => g.trim());
    const yearRanges: Record<string, [number, number]> = {
      '80s': [1980, 1989], '90s': [1990, 1999],
      '2000s': [2000, 2009], '2010s': [2010, 2019], '2020s': [2020, 2030],
    };
    const range = yearRanges[yearKey] || [2000, 2030];
    const { findSongByGenreAndYear } = await import('./specialPrograms');

    const result = await findSongByGenreAndYear(genres, range[0], range[1], timeStr, usedInBlock, usedArtistsInBlock, ctx, isFullDay);
    if (result) {
      const key = `${result.title.toLowerCase()}-${result.artist.toLowerCase()}`;
      usedInBlock.add(key);
      usedArtistsInBlock.add(result.artist.toLowerCase().trim());
      ctx.markSongAsUsed(result.title, result.artist, timeStr);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: result.title, artist: result.artist,
        station: `${result.genre} ${yearKey.toUpperCase()}`,
        reason: `Gênero ${genres.join('/')} + Anos ${range[0]}-${range[1]}`,
      });
      const sanitizedFilename = await finalizeGradeFilename(result.filename, result.artist, result.title, ctx.musicFolders, ctx.filterChars);
      return `"${sanitizedFilename}"`;
    }
    logs.push({
      blockTime: timeStr, type: 'substituted',
      title: `${genres.join('/')} ${yearKey}`, artist: 'CORINGA', station: 'FALLBACK',
      reason: `Nenhuma música ${genres.join('/')} dos anos ${yearKey} disponível`,
    });
    return ctx.coringaCode;
  }

  // Handle year_* (e.g. year_80s, year_90s, year_2000s, year_2010s, year_2020s)
  if (seq.radioSource.startsWith('year_')) {
    const yearKey = seq.radioSource.replace('year_', '');
    const yearRanges: Record<string, [number, number]> = {
      '80s': [1980, 1989],
      '90s': [1990, 1999],
      '2000s': [2000, 2009],
      '2010s': [2010, 2019],
      '2020s': [2020, 2030],
    };
    const range = yearRanges[yearKey] || [2000, 2030];
    const { findSongByYear } = await import('./specialPrograms');
    
    const result = await findSongByYear(range[0], range[1], timeStr, usedInBlock, usedArtistsInBlock, ctx, isFullDay);
    if (result) {
      const key = `${result.title.toLowerCase()}-${result.artist.toLowerCase()}`;
      usedInBlock.add(key);
      usedArtistsInBlock.add(result.artist.toLowerCase().trim());
      ctx.markSongAsUsed(result.title, result.artist, timeStr);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: result.title, artist: result.artist,
        station: `ANOS ${yearKey.toUpperCase()}`,
        reason: `Ano ${range[0]}-${range[1]}`,
      });
      const sanitizedFilename = await finalizeGradeFilename(result.filename, result.artist, result.title, ctx.musicFolders, ctx.filterChars);
      return `"${sanitizedFilename}"`;
    }
    logs.push({
      blockTime: timeStr, type: 'substituted',
      title: yearKey, artist: 'CORINGA', station: 'FALLBACK',
      reason: `Nenhuma música dos anos ${yearKey} disponível`,
    });
    return ctx.coringaCode;
  }
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
          const sanitizedFilename = await finalizeGradeFilename(correctFilename, candidate.artist, candidate.title, ctx.musicFolders, ctx.filterChars);
          return `"${sanitizedFilename}"`;
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
