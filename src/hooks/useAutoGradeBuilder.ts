/**
 * Auto Grade Builder - Orchestrator Hook
 * 
 * Generates programming grids for radio automation.
 * All heavy logic is delegated to specialized modules in src/lib/gradeBuilder/.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { useGradeLogStore, logSystemError } from '@/store/gradeLogStore';
import { sanitizeFilename, processFixedContentTemplate } from '@/lib/sanitizeFilename';
import { getCachedVerification, setCachedVerification } from '@/lib/libraryVerificationCache';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { WeekDay, ScheduledSequence, SequenceConfig } from '@/types/radio';

// Import from refactored modules
import {
  STATION_ID_TO_DB_NAME,
  DAY_CODE_MAP, FULL_DAY_NAME_MAP,
  DAY_CODES_BY_INDEX, FULL_DAY_NAMES_BY_INDEX, WEEKDAY_KEYS,
  ARTIST_REPETITION_MINUTES, DEFAULT_MINUTES_BEFORE_BLOCK,
  getIsElectronEnv,
} from '@/lib/gradeBuilder/constants';
import { sanitizeGradeFilename, sanitizeGradeLine, createLineSanitizer } from '@/lib/gradeBuilder/sanitize';
import {
  generateVozDoBrasil, generateMisturadao,
  generateTop50Block, generateTop10Block, generateTop10Decada, generateRockMetal, generateMadrugada, generateSertanejoNossa,
  generateRaridades,
} from '@/lib/gradeBuilder/specialPrograms';
import { selectSongForSlot, handleSpecialSequenceType } from '@/lib/gradeBuilder/songSelection';
import { batchFindSongsInLibrary, findSongInLibrary as findSongInLibraryFn } from '@/lib/gradeBuilder/batchLibrary';
import { isRomanceBlock, generateRomanceBlock } from '@/lib/gradeBuilder/folderPrograms';
import { isWeekdayTemplateBlock, generateWeekdayTemplateBlock } from '@/lib/gradeBuilder/weekdayTemplates';
import type {
  SongEntry, UsedSong, CarryOverSong, BlockStats, BlockLogItem, BlockResult, GradeContext,
} from '@/lib/gradeBuilder/types';
import { mergeGradeLinePreservingResolved } from '@/lib/gradeBuilder/lineMerge';
import { saveGradeToStorage, loadGradeFromStorage, clearGradeStorage } from '@/lib/gradeBuilder/gradePersistence';
import { resolveVinhetasInLine, resolveVinhetasInGrade, resetVinhetaPool } from '@/lib/gradeBuilder/vinhetaResolver';
import { saveOfflineSongCache, loadOfflineSongCache } from '@/lib/offlineSongCache';
import { saveCrossDayBuffer, loadCrossDayBuffer } from '@/lib/crossDayRepetition';
import { loadBpmCacheFromDisk, enrichSongsWithBpmCache } from '@/lib/bpmCacheBridge';
import { reportServiceHeartbeat } from '@/hooks/useServiceWatchdog';

// === MODULE-LEVEL VHT DURATION CACHE ===
let _cachedAvgVhtDurationSec: number | null = null;
let _vhtDurationCacheExpiry = 0;

async function getAvgVhtDuration(vinhetasFolder: string): Promise<number> {
  const VHT_FALLBACK = 7;
  const now = Date.now();
  // Cache for 10 minutes
  if (_cachedAvgVhtDurationSec !== null && now < _vhtDurationCacheExpiry) {
    return _cachedAvgVhtDurationSec;
  }
  if (!getIsElectronEnv() || !window.electronAPI?.listFolderFiles || !window.electronAPI?.getFileDurationsBatch) {
    return VHT_FALLBACK;
  }
  try {
    const listResult = await window.electronAPI.listFolderFiles({ folder: vinhetasFolder, extension: '.mp3' });
    if (!listResult.success || listResult.files.length === 0) return VHT_FALLBACK;
    const vhtFilenames = listResult.files.map((f: any) => f.name);
    const durResult = await window.electronAPI.getFileDurationsBatch({ filenames: vhtFilenames, musicFolders: [vinhetasFolder] });
    if (durResult.success && durResult.durations) {
      const durations = Object.values(durResult.durations).filter((d: number) => d > 0);
      if (durations.length > 0) {
        _cachedAvgVhtDurationSec = durations.reduce((sum: number, d: number) => sum + d, 0) / durations.length;
        _vhtDurationCacheExpiry = now + 10 * 60 * 1000;
        console.log(`[AUTO-GRADE] 🎵 VHT duração real: média ${_cachedAvgVhtDurationSec.toFixed(1)}s de ${durations.length} arquivos`);
        return _cachedAvgVhtDurationSec;
      }
    }
  } catch (e) {
    console.warn('[AUTO-GRADE] ⚠️ Falha ao ler duração das vinhetas, usando fallback 7s:', e);
  }
  return VHT_FALLBACK;
}

interface AutoGradeState {
  isBuilding: boolean;
  lastBuildTime: Date | null;
  currentBlock: string;
  nextBlock: string;
  lastSavedFile: string | null;
  error: string | null;
  blocksGenerated: number;
  isAutoEnabled: boolean;
  nextBuildIn: number;
  minutesBeforeBlock: number;
  fullDayProgress: number;
  fullDayTotal: number;
  skippedSongs: number;
  substitutedSongs: number;
  missingSongs: number;
  currentProcessingSong: string | null;
  currentProcessingBlock: string | null;
  lastSaveProgress: number;
  /** The actual grade lines built by the engine, keyed by block time (e.g. "18:00") */
  pendingGradeLines: Map<string, string>;
  /** Duration in minutes for each built block, keyed by block time */
  pendingBlockDurations: Map<string, number>;
  /** Station map for preview: normalized "artist-title" → station name */
  pendingStationMap: Record<string, string>;
}

/** Build a normalized station map from block logs for preview radio badges */
function buildStationMapFromLogs(logs: BlockLogItem[]): Record<string, string> {
  const map: Record<string, string> = {};
  const normalizeKey = (str: string) =>
    str.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
  
  for (const log of logs) {
    if (log.type === 'used' && log.station && log.artist && log.title) {
      const key = `${normalizeKey(log.artist)}-${normalizeKey(log.title)}`;
      map[key] = log.station;
    }
  }
  return map;
}

export function useAutoGradeBuilder() {
  const { toast } = useToast();
  const {
    programs, sequence: defaultSequence, scheduledSequences,
    stations, config, fixedContent, rankingSongs,
    addGradeHistory, addMissingSong,
    missingSongs: existingMissingSongs,
  } = useRadioStore();

  const { addBlockLogs } = useGradeLogStore();
  const filterChars = config.filterCharacters;

  const [state, setState] = useState<AutoGradeState>(() => {
    // Restore persisted grade from localStorage on mount
    const dayCode = DAY_CODES_BY_INDEX[new Date().getDay()];
    const persisted = loadGradeFromStorage(dayCode);
    return {
      isBuilding: false, lastBuildTime: null,
      currentBlock: '--:--', nextBlock: '--:--',
      lastSavedFile: null, error: null, blocksGenerated: 0,
      isAutoEnabled: true, nextBuildIn: 0,
      minutesBeforeBlock: DEFAULT_MINUTES_BEFORE_BLOCK,
      fullDayProgress: 0, fullDayTotal: 0,
      skippedSongs: 0, substitutedSongs: 0, missingSongs: 0,
      currentProcessingSong: null, currentProcessingBlock: null, lastSaveProgress: 0,
      pendingGradeLines: persisted?.lineMap || new Map(),
      pendingBlockDurations: new Map(),
      pendingStationMap: {},
    };
  });

  const lastBuildRef = useRef<string | null>(null);
  const buildIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usedSongsRef = useRef<UsedSong[]>(loadCrossDayBuffer());
  const carryOverSongsRef = useRef<CarryOverSong[]>([]);
  /** Tracks which block time keys (e.g. "18:00") have already been assembled and locked */
  const builtBlocksRef = useRef<Set<string>>(
    (() => {
      const dc = DAY_CODES_BY_INDEX[new Date().getDay()];
      const p = loadGradeFromStorage(dc);
      return p?.lockedBlocks || new Set<string>();
    })()
  );
  const activeDayCodeRef = useRef<string>(DAY_CODES_BY_INDEX[new Date().getDay()]);

  /** Tracks the date string for which we already pre-generated the next day's grade (avoids re-running) */
  const nextDayBuiltForRef = useRef<string>('');
  const nextDayBuildInProgressRef = useRef(false);

  // Restore pendingGradeRef from localStorage on mount
  const pendingGradeRestored = useRef(false);
  if (!pendingGradeRestored.current) {
    pendingGradeRestored.current = true;
    const dayCode = DAY_CODES_BY_INDEX[new Date().getDay()];
    const persisted = loadGradeFromStorage(dayCode);
    if (persisted && persisted.lineMap.size > 0) {
      console.log(`[AUTO-GRADE] 💾 Grade restaurada do localStorage: ${persisted.lineMap.size} blocos, ${persisted.lockedBlocks.size} locks`);
    }
  }

  // ==================== Utility Helpers ====================

  const getDayCode = useCallback((targetDay?: WeekDay) => {
    if (targetDay) return DAY_CODE_MAP[targetDay] || 'SEG';
    return DAY_CODES_BY_INDEX[new Date().getDay()];
  }, []);

  const getFullDayName = useCallback((targetDay?: WeekDay) => {
    if (targetDay) return FULL_DAY_NAME_MAP[targetDay] || 'SEGUNDA';
    return FULL_DAY_NAMES_BY_INDEX[new Date().getDay()];
  }, []);

  const isWeekday = useCallback((targetDay?: WeekDay) => {
    if (targetDay) return WEEKDAY_KEYS.includes(targetDay);
    const day = new Date().getDay();
    return day >= 1 && day <= 5;
  }, []);

  const getProgramForHour = useCallback((hour: number) => {
    for (const prog of programs) {
      const [start, end] = prog.timeRange.split('-').map(Number);
      if (hour >= start && hour <= end) return prog.programName;
    }
    return 'PROGRAMA';
  }, [programs]);

  const getFixedContentForTime = useCallback((hour: number, minute: number, targetDay?: WeekDay) => {
    const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
    const currentDayKey = targetDay || dayMap[new Date().getDay()];
    const dayIndex = dayMap.indexOf(currentDayKey as typeof dayMap[number]);
    const isWeekdayDay = dayIndex >= 1 && dayIndex <= 5;
    const isWeekendDay = dayIndex === 0 || dayIndex === 6;
    return fixedContent.filter(fc => {
      if (!fc.enabled) return false;
      if (fc.dayPattern === 'WEEKDAYS' && !isWeekdayDay) return false;
      if (fc.dayPattern === 'WEEKEND' && !isWeekendDay) return false;
      return fc.timeSlots.some(ts => ts.hour === hour && ts.minute === minute);
    });
  }, [fixedContent]);

  const getActiveSequenceForBlock = useCallback((hour: number, minute: number, targetDay?: WeekDay): SequenceConfig[] => {
    const timeMinutes = hour * 60 + minute;
    const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
    const currentDay = targetDay || dayMap[new Date().getDay()];
    const activeScheduled = scheduledSequences
      .filter(s => s.enabled)
      .filter(s => s.weekDays.length === 0 || s.weekDays.includes(currentDay))
      .filter(s => {
        const startMin = s.startHour * 60 + s.startMinute;
        const endMin = s.endHour * 60 + s.endMinute;
        if (endMin <= startMin) return timeMinutes >= startMin || timeMinutes < endMin;
        return timeMinutes >= startMin && timeMinutes < endMin;
      })
      .sort((a, b) => b.priority - a.priority);
    if (activeScheduled.length > 0) {
      console.log(`[SEQUENCE] Usando sequência agendada "${activeScheduled[0].name}" para ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (${currentDay})`);
      return activeScheduled[0].sequence;
    }
    return defaultSequence;
  }, [scheduledSequences, defaultSequence]);

  /**
   * Derive unique station names from the active sequence for a given block.
   * Used by template blocks to pick monitoring songs from the correct stations.
   */
  const getSequenceStationNames = useCallback((hour: number, minute: number, targetDay?: WeekDay): string[] => {
    const activeSeq = getActiveSequenceForBlock(hour, minute, targetDay);
    const stationNames: string[] = [];
    for (const entry of activeSeq) {
      // Skip special types (fixo_, top50, genre_, etc.)
      if (entry.radioSource.startsWith('fixo') || entry.radioSource === 'top50' || 
          entry.radioSource === 'random_pop' || entry.radioSource.startsWith('genre_') ||
          entry.radioSource.startsWith('year_') || entry.radioSource.startsWith('genreyear_')) continue;
      const name = STATION_ID_TO_DB_NAME[entry.radioSource] || 
        STATION_ID_TO_DB_NAME[entry.radioSource.toLowerCase()] ||
        stations.find(s => s.id === entry.radioSource)?.name || 
        entry.radioSource;
      if (!stationNames.includes(name)) stationNames.push(name);
    }
    return stationNames.length > 0 ? stationNames : ['BH FM', 'Rádio Globo RJ', 'Band FM', 'Clube FM'];
  }, [getActiveSequenceForBlock, stations]);

  // ==================== Song Tracking ====================

  const isRecentlyUsed = useCallback((title: string, artist: string, currentBlockTime: string, isFullDay: boolean = false): boolean => {
    // Always respect user-configured repetition minutes; use configured value for both full-day and incremental
    const artistRepMinutes = config.artistRepetitionMinutes || ARTIST_REPETITION_MINUTES;
    const normalizedTitle = title.toLowerCase().trim();
    const normalizedArtist = artist.toLowerCase().trim();
    const [currentHour, currentMinute] = currentBlockTime.split(':').map(Number);
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    for (const used of usedSongsRef.current) {
      const [usedHour, usedMinute] = used.blockTime.split(':').map(Number);
      const usedTotalMinutes = usedHour * 60 + usedMinute;
      // Calculate the SHORTEST distance between two times on a 24h clock
      // This fixes the bug where rebuilding an earlier block (e.g., 05:00) after a later one (05:30)
      // would wrap to ~23.5 hours instead of the correct 30 minutes
      let diffMinutes = Math.abs(currentTotalMinutes - usedTotalMinutes);
      if (diffMinutes > 720) diffMinutes = 1440 - diffMinutes; // Use shorter arc on 24h circle
      if (diffMinutes < artistRepMinutes) {
        if (used.title.toLowerCase().trim() === normalizedTitle || used.artist.toLowerCase().trim() === normalizedArtist) {
          return true;
        }
      }
    }
    return false;
  }, [config.artistRepetitionMinutes]);

  const markSongAsUsed = useCallback((title: string, artist: string, blockTime: string) => {
    usedSongsRef.current.push({ title, artist, usedAt: new Date(), blockTime });
    // Full day = 48 blocks × ~10 songs = ~480 entries; keep 500 to cover full day without evicting
    if (usedSongsRef.current.length > 500) usedSongsRef.current = usedSongsRef.current.slice(-500);
    // Persist for cross-day repetition prevention
    saveCrossDayBuffer(usedSongsRef.current);
  }, []);

  const clearUsedSongs = useCallback(() => {
    usedSongsRef.current = [];
    carryOverSongsRef.current = [];
    builtBlocksRef.current.clear();
    clearGradeStorage();
    resetVinhetaPool();
  }, []);

  // ==================== Invalidate locks when scheduled sequences change ====================
  const prevScheduledSeqRef = useRef(scheduledSequences);
  useEffect(() => {
    if (prevScheduledSeqRef.current === scheduledSequences) return;
    prevScheduledSeqRef.current = scheduledSequences;

    // When scheduled sequences are created/edited/toggled, clear ALL block locks
    // so the builder regenerates blocks using the updated sequence configuration
    const lockCount = builtBlocksRef.current.size;
    if (lockCount > 0) {
      builtBlocksRef.current.clear();
      console.log(`[AUTO-GRADE] 🔓 Sequências agendadas alteradas — ${lockCount} locks de blocos removidos para regeneração`);
    }
  }, [scheduledSequences]);

  const addCarryOverSong = useCallback((song: Omit<CarryOverSong, 'addedAt'>) => {
    const exists = carryOverSongsRef.current.some(
      s => s.title.toLowerCase() === song.title.toLowerCase() && s.artist.toLowerCase() === song.artist.toLowerCase()
    );
    if (!exists) {
      carryOverSongsRef.current.push({ ...song, addedAt: new Date() });
      console.log(`[CARRY-OVER] Adicionado para próximo bloco: ${song.artist} - ${song.title}`);
    }
    if (carryOverSongsRef.current.length > 50) carryOverSongsRef.current = carryOverSongsRef.current.slice(-50);
  }, []);

  const getCarryOverSongs = useCallback((blockTime: string): CarryOverSong[] => {
    const validSongs = carryOverSongsRef.current.filter(song => (Date.now() - song.addedAt.getTime()) >= 60000);
    carryOverSongsRef.current = carryOverSongsRef.current.filter(song => (Date.now() - song.addedAt.getTime()) < 60000);
    console.log(`[CARRY-OVER] ${validSongs.length} músicas disponíveis do bloco anterior`);
    return validSongs;
  }, []);

  // ==================== Library Helpers ====================

  const similarityThreshold = config.similarityThreshold || 0.75;

  const toLibKey = (artist: string, title: string) => `${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`;

  const findSongInLibrary = useCallback(async (artist: string, title: string) => {
    const cached = getCachedVerification(artist, title);
    if (cached && cached.matchedFile) {
      // Only use cache if it has a real filename — otherwise recheck disk
      return { exists: cached.exists, filename: cached.matchedFile };
    }

    const result = await findSongInLibraryFn(artist, title, config.musicFolders, similarityThreshold);

    setCachedVerification(artist, title, {
      exists: result.exists,
      matchedFile: result.filename,
    });

    if (!result.exists) {
      console.warn(`[AUTO-GRADE] ❌ NÃO encontrado na biblioteca: "${artist} - ${title}"`);
    }

    return result;
  }, [config.musicFolders, similarityThreshold]);

  const batchFind = useCallback(async (songs: Array<{ artist: string; title: string }>) => {
    const results = new Map<string, { exists: boolean; filename?: string }>();
    const toCheck: Array<{ artist: string; title: string }> = [];

    for (const s of songs) {
      const cached = getCachedVerification(s.artist, s.title);
      const key = toLibKey(s.artist, s.title);
      // CRITICAL: Only use cache if it has a real filename (matchedFile).
      // Without the real filename the grade writes scraped metadata instead of the disk name.
      if (cached && (!cached.exists || cached.matchedFile)) {
        results.set(key, { exists: cached.exists, filename: cached.matchedFile });
      } else {
        toCheck.push(s);
      }
    }

    if (toCheck.length > 0) {
      const checked = await batchFindSongsInLibrary(toCheck, config.musicFolders, similarityThreshold);
      for (const [key, r] of checked.entries()) {
        results.set(key, r);
        const [artist, title] = key.split('|');
        // We only have normalized key components here; cache is best-effort
        setCachedVerification(artist, title, { exists: r.exists, matchedFile: r.filename });
      }
    }

    return results as any;
  }, [config.musicFolders, similarityThreshold]);

  const isSongAlreadyMissing = useCallback((artist: string, title: string): boolean => {
    return existingMissingSongs.some(
      s => s.artist.toLowerCase() === artist.toLowerCase() && s.title.toLowerCase() === title.toLowerCase()
    );
  }, [existingMissingSongs]);

  // ==================== File Operations ====================

  const renameFilesInGradeContent = useCallback(async (gradeContent: string): Promise<void> => {
    // FAIL-SAFE: never rename physical music files from grade generation.
    // This avoids any risk of mismatching filenames on disk (e.g. Artist A file renamed as Artist B).
    if (!gradeContent) return;

    const filenameMatches = gradeContent.match(/"([^"]+\.(?:mp3|MP3))"/g);
    const total = filenameMatches?.length || 0;
    if (total > 0) {
      console.log(`[RENAME] 🔒 Renomeação em disco desativada por segurança (${total} referências na grade).`);
    }
  }, []);

  const processFixedContentFilename = useCallback((fileName: string, hour: number, minute: number, editionIndex: number, targetDay?: WeekDay): string => {
    const fullDayName = getFullDayName(targetDay);
    const hourStr = hour.toString().padStart(2, '0');
    const edition = (editionIndex + 1).toString().padStart(2, '0');
    let result = fileName
      .replace(/\{HH\}/gi, hourStr)
      .replace(/\{DIA\}/gi, fullDayName)
      .replace(/\{DD\}/gi, fullDayName)
      .replace(/\{ED\}/gi, edition);
    // Skip day suffix for filenames containing FINAL_DE_SEMANA — they already indicate the period
    const hasFinalDeSemana = result.toUpperCase().includes('FINAL_DE_SEMANA');
    const hasFullDayName = FULL_DAY_NAMES_BY_INDEX.some(day => result.toUpperCase().includes(`_${day}`));
    if (!hasFinalDeSemana && !result.toLowerCase().includes('_{dia}') && !result.toLowerCase().includes('_{dd}') && !hasFullDayName) {
      if (result.toLowerCase().endsWith('.mp3')) {
        result = result.slice(0, -4) + `_${fullDayName}.mp3`;
      } else {
        result = result + `_${fullDayName}`;
      }
    } else if (!hasFinalDeSemana) {
      result = result.replace(/\{DIA\}/gi, fullDayName).replace(/\{DD\}/gi, fullDayName);
    }
    return processFixedContentTemplate(result, hour, fullDayName);
  }, [getFullDayName]);

  // ==================== Build GradeContext ====================

  const buildGradeContext = useCallback((sequenceStations?: string[]): GradeContext => {
    const lineSanitizer = createLineSanitizer(filterChars);
    return {
      isRecentlyUsed,
      findSongInLibrary,
      batchFindSongsInLibrary: batchFind,
      markSongAsUsed,
      sanitizeFilename,
      sanitizeGradeLine: lineSanitizer,
      getFullDayName,
      getDayCode,
      processFixedContentFilename,
      addMissingSong,
      isSongAlreadyMissing,
      addCarryOverSong,
      getCarryOverSongs,
      coringaCode: (config.coringaCode || 'mus').replace('.mp3', ''),
      rankingSongs,
      filterChars,
      fixedContent: fixedContent as GradeContext['fixedContent'],
      stations: stations.map(s => ({ id: s.id, name: s.name, styles: s.styles })),
      musicFolders: config.musicFolders,
      artistBlackouts: config.artistBlackouts,
      sequenceStations,
    };
  }, [
    isRecentlyUsed, findSongInLibrary, batchFind, markSongAsUsed,
    getFullDayName, getDayCode, processFixedContentFilename,
    addMissingSong, isSongAlreadyMissing, addCarryOverSong, getCarryOverSongs,
    config.coringaCode, config.musicFolders, rankingSongs, filterChars,
    fixedContent, stations,
  ]);

  // ==================== Data Fetching ====================

  const fetchSongsForBlock = useCallback(async (blockHour: number, blockMinute: number, targetDate?: Date): Promise<Record<string, SongEntry[]>> => {
    // NOTE: This function is kept for potential future use but incremental builds
    // now use fetchAllRecentSongs() directly for a larger, more reliable pool.
    try {
      const baseDate = targetDate || new Date();
      const blockTime = new Date(baseDate);
      blockTime.setHours(blockHour, blockMinute, 0, 0);
      // Use local-to-ISO conversion to avoid UTC date shift
      const formatLocalISO = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const s = String(d.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${day}T${h}:${min}:${s}`;
      };
      const windowEnd = formatLocalISO(blockTime);
      // Use a 24h window instead of 1h to capture all available monitoring data
      const windowStart = formatLocalISO(new Date(blockTime.getTime() - 24 * 60 * 60 * 1000));
      console.log(`[AUTO-GRADE] 🕐 Buscando músicas para bloco ${blockHour.toString().padStart(2, '0')}:${blockMinute.toString().padStart(2, '0')} (janela de 24h)`);

      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at, ai_genre, ai_energy')
        .gte('scraped_at', windowStart)
        .lte('scraped_at', windowEnd)
        .order('scraped_at', { ascending: false })
        .limit(2000);
      if (error) throw error;

      return buildSongsByStation(data || [], 300);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
      console.error('[AUTO-GRADE] Error fetching songs for block:', errorMsg);
      logSystemError('GRADE', 'error', 'Erro ao buscar músicas do Supabase', errorMsg);
      return {};
    }
  }, [stations]);

  const fetchAllRecentSongs = useCallback(async (retryCount = 0): Promise<Record<string, SongEntry[]>> => {
    try {
      // Fetch scraped_songs and radio_historico independently to handle partial failures
      let scrapedData: Array<{ title: string; artist: string; station_name: string; scraped_at: string; ai_genre?: string | null; ai_energy?: string | null }> = [];
      let historicoData: Array<{ title: string; artist: string; station_name: string; captured_at: string }> = [];

      try {
        const scrapedResult = await supabase
          .from('scraped_songs')
          .select('title, artist, station_name, scraped_at, ai_genre, ai_energy')
          .order('scraped_at', { ascending: false })
          .limit(3000);
        
        if (scrapedResult.error) {
          console.warn(`[AUTO-GRADE] ⚠️ scraped_songs falhou: ${scrapedResult.error.message || scrapedResult.error.code || JSON.stringify(scrapedResult.error)}`);
        } else {
          scrapedData = scrapedResult.data || [];
        }
      } catch (e) {
        console.warn('[AUTO-GRADE] ⚠️ scraped_songs exception:', e instanceof Error ? e.message : e);
      }

      try {
        const historicoResult = await supabase
          .from('radio_historico')
          .select('title, artist, station_name, captured_at')
          .order('captured_at', { ascending: false })
          .limit(1500);
        
        if (historicoResult.error) {
          console.warn(`[AUTO-GRADE] ⚠️ radio_historico falhou: ${historicoResult.error.message || historicoResult.error.code || JSON.stringify(historicoResult.error)}`);
        } else {
          historicoData = historicoResult.data || [];
        }
      } catch (e) {
        console.warn('[AUTO-GRADE] ⚠️ radio_historico exception:', e instanceof Error ? e.message : e);
      }

      // If both failed, try offline cache before retrying
      if (scrapedData.length === 0 && historicoData.length === 0) {
        const cached = loadOfflineSongCache();
        if (cached && cached.length > 0) {
          console.log(`[AUTO-GRADE] 📂 Usando cache offline: ${cached.length} músicas`);
          return buildSongsByStation(cached, 300);
        }

        if (retryCount < 2) {
          console.log(`[AUTO-GRADE] 🔄 Nenhum dado obtido. Retry ${retryCount + 1}/2 em 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          return fetchAllRecentSongs(retryCount + 1);
        }
        logSystemError('GRADE', 'error', 'Erro ao buscar músicas do Supabase', 'Ambas as tabelas retornaram vazio ou com erro após 3 tentativas');
        return {};
      }

      // Merge both sources
      const allData = [
        ...scrapedData,
        ...historicoData.map(h => ({
          title: h.title,
          artist: h.artist,
          station_name: h.station_name,
          scraped_at: h.captured_at,
        })),
      ];

      // Deduplicate: keep the most recent entry per song
      // Sort by scraped_at DESC BEFORE dedup to ensure Map preserves chronological insertion order
      const sortedData = allData.sort((a, b) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime());

      const seen = new Map<string, typeof allData[0]>();
      for (const song of sortedData) {
        const key = `${song.title.toLowerCase().trim()}-${song.artist.toLowerCase().trim()}`;
        if (!seen.has(key)) {
          seen.set(key, song); // First seen = most recent due to DESC sort
        }
      }

      const deduplicated = Array.from(seen.values()); // Already in DESC order (Map insertion order)

      // Apply song aliases (corrections) using aliasEngine (O(1) lookups)
      const { songAliases } = useRadioStore.getState();
      if (songAliases && songAliases.length > 0) {
        const { buildAliasEngine } = await import('@/lib/aliasEngine');
        const aliasEngine = buildAliasEngine(songAliases);
        let aliasCount = 0;
        for (const song of deduplicated) {
          const resolved = aliasEngine.resolve(song.artist, song.title);
          if (resolved.artist !== song.artist || resolved.title !== song.title) {
            console.log(`[AUTO-GRADE] 🔄 Alias: "${song.artist} - ${song.title}" → "${resolved.artist} - ${resolved.title}"`);
            song.artist = resolved.artist;
            song.title = resolved.title;
            aliasCount++;
          }
        }
        if (aliasCount > 0) {
          console.log(`[AUTO-GRADE] 🔄 ${aliasCount} aliases aplicados`);
          // Re-deduplicate after aliases to merge entries that now have the same artist+title
          const postAliasSeen = new Map<string, typeof deduplicated[0]>();
          for (const song of deduplicated) {
            const key = `${song.title.toLowerCase().trim()}-${song.artist.toLowerCase().trim()}`;
            const existing = postAliasSeen.get(key);
            if (!existing || new Date(song.scraped_at) > new Date(existing.scraped_at)) {
              postAliasSeen.set(key, song);
            }
          }
          const beforeCount = deduplicated.length;
          deduplicated.length = 0;
          deduplicated.push(...postAliasSeen.values());
          if (deduplicated.length < beforeCount) {
            console.log(`[AUTO-GRADE] 🔄 Re-dedup pós-alias: ${beforeCount} → ${deduplicated.length} (${beforeCount - deduplicated.length} duplicatas removidas)`);
          }
        }
      }

      console.log(`[AUTO-GRADE] Pool ampliado: ${scrapedData.length} scraped + ${historicoData.length} histórico = ${deduplicated.length} únicas`);

      // Save to offline cache for fallback
      saveOfflineSongCache(deduplicated);

      return buildSongsByStation(deduplicated, 300);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
      console.error('[AUTO-GRADE] Error fetching all songs:', errorMsg);
      
      // Try offline cache before retrying
      const cached = loadOfflineSongCache();
      if (cached && cached.length > 0) {
        console.log(`[AUTO-GRADE] 📂 Fallback: cache offline com ${cached.length} músicas`);
        return buildSongsByStation(cached, 300);
      }

      if (retryCount < 2) {
        console.log(`[AUTO-GRADE] 🔄 Retry ${retryCount + 1}/2 em 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        return fetchAllRecentSongs(retryCount + 1);
      }
      
      logSystemError('GRADE', 'error', 'Erro ao buscar músicas do Supabase', errorMsg);
      return {};
    }
  }, [stations]);

  // Helper to build songsByStation from raw data
  // IMPORTANT: data MUST arrive sorted by scraped_at DESC so the maxPerStation cap keeps the freshest songs
  const buildSongsByStation = useCallback((data: Array<{ title: string; artist: string; station_name: string; scraped_at: string; ai_genre?: string | null; ai_energy?: string | null }>, maxPerStation = 300): Record<string, SongEntry[]> => {
    // Defensive sort: ensure DESC order even if caller doesn't guarantee it
    const sortedData = [...data].sort((a, b) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime());
    const songsByStation: Record<string, SongEntry[]> = {};
    const stationNameToStyle: Record<string, string> = {};
    const seenSongs = new Set<string>();

    // Build blocked songs matching with wildcard support
    const blockedList = (config.blockedSongs || []).map(s => s.toLowerCase().trim());
    const blockedExact = new Set<string>(blockedList.filter(s => !s.endsWith(' - *')));
    const blockedWildcardArtists = blockedList
      .filter(s => s.endsWith(' - *'))
      .map(s => s.replace(/ - \*$/, ''));
    
    // Also include forbiddenWords for artist/title filtering
    const forbiddenLower = (config.forbiddenWords || []).map(w => w.toLowerCase().trim()).filter(Boolean);
    
    const isBlocked = (artist: string, title: string): boolean => {
      const key = `${artist.trim()} - ${title.trim()}`.toLowerCase();
      if (blockedExact.has(key)) return true;
      const artistLower = artist.trim().toLowerCase();
      const titleLower = title.trim().toLowerCase();
      if (blockedWildcardArtists.some(blocked => artistLower === blocked || artistLower.includes(blocked))) return true;
      // Check forbiddenWords against artist AND title
      if (forbiddenLower.some(word => artistLower.includes(word) || titleLower.includes(word))) return true;
      return false;
    };

    stations.forEach(s => {
      stationNameToStyle[s.name] = s.styles?.[0] || 'POP/VARIADO';
      stationNameToStyle[s.name.toLowerCase()] = s.styles?.[0] || 'POP/VARIADO';
      stationNameToStyle[s.id] = s.styles?.[0] || 'POP/VARIADO';
    });
    sortedData.forEach(song => {
      const songKey = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
      if (seenSongs.has(songKey)) return;
      seenSongs.add(songKey);

      // Check if song is blocked (exact or wildcard)
      if (isBlocked(song.artist, song.title)) return;
      if (!songsByStation[song.station_name]) songsByStation[song.station_name] = [];
      if (songsByStation[song.station_name].length < maxPerStation) {
        const style = stationNameToStyle[song.station_name] || stationNameToStyle[song.station_name.toLowerCase()] || 'POP/VARIADO';
        songsByStation[song.station_name].push({
          title: song.title, artist: song.artist, station: song.station_name,
          style, filename: sanitizeFilename(`${song.artist} - ${song.title}.mp3`),
          scrapedAt: song.scraped_at, // Preserve for freshness sorting
          ...(song.ai_genre ? { ai_genre: song.ai_genre } : {}),
          ...(song.ai_energy ? { ai_energy: song.ai_energy } : {}),
        } as SongEntry);
      }
    });
    const now = Date.now();
    const stationList = Object.keys(songsByStation).map(name => {
      const songs = songsByStation[name];
      const freshCount = songs.filter(s => s.scrapedAt && (now - new Date(s.scrapedAt).getTime()) <= 15 * 60 * 1000).length;
      return `${name}(${songs.length}, ${freshCount}⚡)`;
    }).join(', ');
    console.log(`[AUTO-GRADE] Pool (total, frescas≤20m): ${stationList}`);
    return songsByStation;
  }, [stations, config.blockedSongs, config.forbiddenWords]);

  // ==================== Weekend Template Generator ====================

  // FALLBACK station rotation — only used when sequence has no valid stations
  const FALLBACK_STATION_ROTATION = ['BH FM', 'Rádio Globo RJ', 'Band FM', 'Clube FM', 'Mix FM'];
  const saturdayStationIndexRef = useRef(0);
  // Cross-block anti-repetition set for weekend templates (persists across all blocks in the same build)
  const weekendUsedKeysRef = useRef<Set<string>>(new Set());

  /**
   * Pick a song from a specific station's monitoring pool.
   * stationHint: partial name like 'disney', 'bh', 'Clube', 'Globo', 'Mix', 'Positividade', 'Band'
   * 
   * FRESHNESS PRIORITY: Songs are sorted by scraped_at (most recent first),
   * ensuring the grade always uses the freshest monitoring data available.
   */
  const pickMonitoringSong = useCallback(async (
    stationHint: string,
    songsByStation: Record<string, SongEntry[]>,
    ctx: GradeContext,
    timeStr: string,
    logs: BlockLogItem[],
    usedKeys: Set<string>,
  ): Promise<string> => {
    const normHint = stationHint.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [poolName, pool] of Object.entries(songsByStation)) {
      const normPool = poolName.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!normPool.includes(normHint) && !normHint.includes(normPool)) continue;
      
      // Sort by freshness (most recent first) to prioritize live monitoring data
      const freshSorted = [...pool].sort((a, b) => {
        const aTime = a.scrapedAt ? new Date(a.scrapedAt).getTime() : 0;
        const bTime = b.scrapedAt ? new Date(b.scrapedAt).getTime() : 0;
        return bTime - aTime;
      });
      
      for (const candidate of freshSorted) {
        const key = `${candidate.artist.toLowerCase().trim()}|${candidate.title.toLowerCase().trim()}`;
        // Check both local block usedKeys AND cross-block weekend ref
        if (usedKeys.has(key) || weekendUsedKeysRef.current.has(key)) continue;
        if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr)) continue;
        const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
        if (libraryResult.exists) {
          const realFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          usedKeys.add(key);
          weekendUsedKeysRef.current.add(key); // Cross-block anti-repetition
          ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);
          logs.push({ blockTime: timeStr, type: 'used', title: candidate.title, artist: candidate.artist, station: stationHint, style: candidate.style, reason: `Sábado monitoramento (${stationHint})` });
          return `"${realFilename}"`;
        }
      }
    }
    return 'mus';
  }, []);

  /**
   * Replace 'mus' codes in a template line with real songs from the monitoring
   * station rotation (cyclic fallback).
   */
  const replaceMusWithMonitoring = useCallback(async (
    templateLine: string,
    songsByStation: Record<string, SongEntry[]>,
    ctx: GradeContext,
    timeStr: string,
    logs: BlockLogItem[]
  ): Promise<string> => {
    // Use sequence-derived stations from context, or fallback
    const stationRotation = (ctx.sequenceStations && ctx.sequenceStations.length > 0) 
      ? ctx.sequenceStations 
      : FALLBACK_STATION_ROTATION;
    
    const parts = templateLine.split(',');
    const usedKeys = new Set<string>();

    for (let i = 0; i < parts.length; i++) {
      if (parts[i].trim().toLowerCase() !== 'mus') continue;

      let found = false;
      for (let attempt = 0; attempt < stationRotation.length; attempt++) {
        const stationName = stationRotation[saturdayStationIndexRef.current % stationRotation.length];
        saturdayStationIndexRef.current++;
        const result = await pickMonitoringSong(stationName, songsByStation, ctx, timeStr, logs, usedKeys);
        if (result !== 'mus') {
          parts[i] = result;
          found = true;
          break;
        }
      }
      if (!found) saturdayStationIndexRef.current++;
    }

    return parts.join(',');
  }, [pickMonitoringSong]);

  /**
   * Generates Saturday blocks using the detailed template.
   * Returns null if no template matches.
   */
  const generateWeekendTemplateBlock = useCallback(async (
    hour: number,
    minute: number,
    timeStr: string,
    songsByStation: Record<string, SongEntry[]>,
    ctx: GradeContext
  ): Promise<BlockResult | null> => {
    const usedKeys = new Set<string>();
    const logs: BlockLogItem[] = [];

    // Use sequence-derived stations from context, or fallback
    const stationRotation = (ctx.sequenceStations && ctx.sequenceStations.length > 0)
      ? ctx.sequenceStations
      : FALLBACK_STATION_ROTATION;

    // Helper: pick station song cycling through the active sequence's stations
    const mon = async (_stationHint?: string) => {
      // Cycle through the SEQUENCE stations instead of hardcoded ones
      for (let attempt = 0; attempt < stationRotation.length; attempt++) {
        const stationName = stationRotation[saturdayStationIndexRef.current % stationRotation.length];
        saturdayStationIndexRef.current++;
        const result = await pickMonitoringSong(stationName, songsByStation, ctx, timeStr, logs, usedKeys);
        if (result !== 'mus') return result;
      }
      saturdayStationIndexRef.current++;
      return 'mus';
    };

    // Helper to build result with generic mus replacement
    const buildWithMonitoring = async (line: string, blockLogs: BlockLogItem[]): Promise<BlockResult> => {
      const resolvedLine = await replaceMusWithMonitoring(line, songsByStation, ctx, timeStr, blockLogs);
      return { line: resolvedLine, logs: blockLogs };
    };

    // ===== 00:00 - 07:30 — Music blocks with varying lengths =====
    if (hour >= 0 && hour <= 7) {
      // Some blocks are longer (31 items) vs shorter (19 items) based on user spec
      const longBlocks = ['00:00','01:00','02:30','03:30','04:30','06:00','07:00'];
      const musShort = 'mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus';
      const musLong = 'mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,VHT,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus';
      const musLine = longBlocks.includes(timeStr) ? musLong : musShort;
      const blockLogs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: 'Weekend Music', artist: '', station: 'TEMPLATE', reason: 'Bloco musical FDS' }];
      return buildWithMonitoring(`${timeStr} (ID=SABADO) ${musLine}`, blockLogs);
    }

    // ===== 08:00 - 09:30 — SHAKE MIX (4 blocks) =====
    if ((hour === 8) || (hour === 9 && minute <= 30)) {
      const blockMap: Record<string, number> = { '08:00': 1, '08:30': 2, '09:00': 3, '09:30': 4 };
      const blockNum = blockMap[timeStr] || 1;
      const ed = blockNum.toString().padStart(2, '0');
      const fixedFile = `"SHAKE_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3"`;
      // 08:00-08:30 use disney+Clube, 09:00-09:30 use disney+bh
      const station2 = hour === 8 ? 'Clube' : 'bh';
      const mon1 = await mon('disney');
      const mon2 = await mon(station2);
      const blockLogs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: `Shake Mix Bloco ${ed}`, artist: `SHAKE_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3`, station: 'FIXO', reason: 'Shake Mix FDS' }];
      return { line: `${timeStr} (ID=SHAKE_MIX) ${fixedFile},vht,${mon1},vht,${mon2}`, logs: blockLogs };
    }

    // ===== 10:00 - 12:30 — CONEXÃO MIX (6 blocks) =====
    if ((hour === 10) || (hour === 11) || (hour === 12 && minute <= 30)) {
      const blockMap: Record<string, number> = { '10:00': 1, '10:30': 2, '11:00': 3, '11:30': 4, '12:00': 5, '12:30': 8 };
      const blockNum = blockMap[timeStr] || 1;
      const ed = blockNum.toString().padStart(2, '0');
      const fixedFile = `"CONEXAO_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3"`;
      // Station pairs per block
      let s1 = 'Positividade', s2 = 'Band FM';
      if (hour === 11) { s1 = 'Globo'; s2 = 'Mix FM'; }
      if (hour === 12) { s1 = 'disney'; s2 = 'Clube'; }
      const mon1 = await mon(s1);
      const mon2 = await mon(s2);
      const vhtPre = timeStr === '10:30' ? 'MUS' : 'VHTN';
      const blockLogs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: `Conexão Mix Bloco ${ed}`, artist: `CONEXAO_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3`, station: 'FIXO', reason: 'Conexão Mix FDS' }];
      return { line: `${timeStr} (ID=CONEXAO_MIX) VHTN,${fixedFile},${vhtPre},${mon1},vht,${mon2}`, logs: blockLogs };
    }

    // ===== 13:00 - 17:30 — MEGA MIX (8 blocks) =====
    if (hour >= 13 && hour <= 17) {
      const blockMap: Record<string, number> = {
        '13:00': 1, '13:30': 2, '14:00': 3, '15:30': 4,
        '16:00': 5, '16:30': 6, '17:00': 7, '17:30': 8,
      };
      const blockNum = blockMap[timeStr];
      if (blockNum) {
        const ed = blockNum.toString().padStart(2, '0');
        const fixedFile = `"MEGA_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3"`;
        // Station pairs by block
        let s1 = 'disney', s2 = 'bh';
        if (blockNum === 3 || blockNum === 4 || blockNum === 7 || blockNum === 8) { s1 = 'Globo'; s2 = 'Mix FM'; }
        if (blockNum === 5 || blockNum === 6) { s1 = 'Positividade'; s2 = 'Band FM'; }
        const mon1 = await mon(s1);
        const mon2 = await mon(s2);
        const blockLogs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: `Mega Mix Bloco ${ed}`, artist: `MEGA_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3`, station: 'FIXO', reason: 'Mega Mix FDS' }];
        return { line: `${timeStr} (ID=MEGA_MIX) ${fixedFile},VHTN,${mon1},vht,${mon2}`, logs: blockLogs };
      }
      // 14:30, 15:00 not in user spec — fill with monitoring
      const blockLogs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: 'Mega Mix Extra', artist: '', station: 'TEMPLATE', reason: 'Bloco extra FDS' }];
      return buildWithMonitoring(`${timeStr} (ID=MEGA_MIX) mus,vht,mus,vht,mus,vht,mus,vht,mus`, blockLogs);
    }

    // ===== 18:00 - 19:30 — SEM PARAR (4 blocks) =====
    if (hour >= 18 && hour <= 19) {
      const blockMap: Record<string, number> = { '18:00': 1, '18:30': 2, '19:00': 3, '19:30': 4 };
      const blockNum = blockMap[timeStr] || 1;
      const ed = blockNum.toString().padStart(2, '0');
      const fixedFile = `"SEM_PARAR_BLOCO${ed}_FINAL_DE_SEMANA.MP3"`;
      // 18:00-18:30 use Globo+Mix, 19:00-19:30 use disney+bh
      let s1 = 'Globo', s2 = 'Mix FM';
      if (hour === 19) { s1 = 'disney'; s2 = 'bh'; }
      const mon1 = await mon(s1);
      const mon2 = await mon(s2);
      const vhtPost = blockNum === 4 ? '' : ',VHTN';
      const blockLogs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: `Sem Parar Bloco ${ed}`, artist: `SEM_PARAR_BLOCO${ed}_FINAL_DE_SEMANA.MP3`, station: 'FIXO', reason: 'Sem Parar FDS' }];
      return { line: `${timeStr} (ID=SEM_PARAR) VHTN,${fixedFile}${vhtPost},${mon1},vht,${mon2}`, logs: blockLogs };
    }

    // ===== 20:00 - 20:30 — MEGA FUNK (2 blocks, 2 files each + fun) =====
    if (hour === 20) {
      if (minute === 0) {
        return {
          line: `${timeStr} (ID=FUNK) VHTN,"MEGA_FUNK_BLOCO01_FINAL_DE_SEMANA.MP3",VHTN,"MEGA_FUNK_BLOCO02_FINAL_DE_SEMANA.MP3",fun,vhtn,fun,vhtn`,
          logs: [{ blockTime: timeStr, type: 'fixed', title: 'Mega Funk Blocos 01-02', artist: 'MEGA_FUNK_BLOCO01/02', station: 'FIXO', reason: 'Mega Funk FDS' }],
        };
      }
      return {
        line: `${timeStr} (ID=FUNK) VHTN,"MEGA_FUNK_BLOCO03_FINAL_DE_SEMANA.MP3",VHTN,"MEGA_FUNK_BLOCO04_FINAL_DE_SEMANA.MP3",fun,vhtn,fun,vhtn`,
        logs: [{ blockTime: timeStr, type: 'fixed', title: 'Mega Funk Blocos 03-04', artist: 'MEGA_FUNK_BLOCO03/04', station: 'FIXO', reason: 'Mega Funk FDS' }],
      };
    }

    // ===== 21:00 - 22:00 — GAS TOTAL (6 blocks) =====
    if (hour === 21 || (hour === 22 && minute === 0)) {
      const blockMap: Record<string, number> = { '21:00': 1, '21:30': 2, '22:00': 3 };
      // 21:00→blocos 01+02, 21:30→blocos 03+04, 22:00→blocos 05+06
      const pair = blockMap[timeStr] || 1;
      const b1 = ((pair - 1) * 2 + 1).toString().padStart(2, '0');
      const b2 = ((pair - 1) * 2 + 2).toString().padStart(2, '0');
      return {
        line: `${timeStr} (ID=GAS) vht,"Gas Total _ bloco ${b1}.mp3",vht,"Gas Total _ bloco ${b2}.mp3"`,
        logs: [{ blockTime: timeStr, type: 'fixed', title: `Gas Total Blocos ${b1}-${b2}`, artist: `Gas Total`, station: 'FIXO', reason: 'Gas Total FDS' }],
      };
    }

    // ===== 22:30 - 23:30 — AMNESIA (6 blocks) =====
    if ((hour === 22 && minute === 30) || hour === 23) {
      const blockMap: Record<string, number> = { '22:30': 1, '23:00': 2, '23:30': 3 };
      const pair = blockMap[timeStr] || 1;
      const b1 = ((pair - 1) * 2 + 1).toString().padStart(2, '0');
      const b2 = ((pair - 1) * 2 + 2).toString().padStart(2, '0');
      return {
        line: `${timeStr} (ID=Amnesia) vht,"Amnesia _ bloco ${b1}.mp3",vht,"Amnesia _ bloco ${b2}.mp3"`,
        logs: [{ blockTime: timeStr, type: 'fixed', title: `Amnesia Blocos ${b1}-${b2}`, artist: `Amnesia`, station: 'FIXO', reason: 'Amnesia FDS' }],
      };
    }

    return null;
  }, [replaceMusWithMonitoring]);

  // ==================== Block Generation ====================

  const generateBlockLine = useCallback(async (
    hour: number, minute: number,
    songsByStation: Record<string, SongEntry[]>,
    stats: BlockStats,
    isFullDay: boolean = false,
    targetDay?: WeekDay
  ): Promise<BlockResult> => {
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const programName = getProgramForHour(hour);
    const fixedItems = getFixedContentForTime(hour, minute, targetDay);
    const seqStations = getSequenceStationNames(hour, minute, targetDay);
    const ctx = buildGradeContext(seqStations);
    console.log(`[AUTO-GRADE] 🎯 Sequência ativa para ${timeStr}: [${seqStations.join(', ')}]`);

    // === DURATION FILL HELPER (applies to ALL block types including specials) ===
    const MIN_DUR_SEC = 29 * 60;
    const MAX_DUR_SEC = 32 * 60;
    const DEFAULT_SONG_DUR = 210;
    const vinhetasF = config.vinhetasFolder || 'C:\\Playlist\\Vinhetas';
    const VHT_DUR = await getAvgVhtDuration(vinhetasF);
    const FILL_STATIONS = config.fillPriorityStations?.length
      ? config.fillPriorityStations
      : ['BH FM', 'Metropolitana FM', 'Metropolitana'];

    const fillBlockIfShort = async (result: BlockResult): Promise<BlockResult> => {
      // Skip filling for Voz do Brasil (legally fixed duration)
      if (result.line.includes('ID=VOZ DO BRASIL')) return result;

      // Parse existing tokens from the line
      const headerMatch = result.line.match(/^(\d{2}:\d{2}\s+\([^)]+\)\s*)(.*)/);
      if (!headerMatch) return result;
      const header = headerMatch[1];
      const tokens = headerMatch[2].split(',').map(t => t.trim()).filter(Boolean);

      // Estimate current duration
      let estimatedSec = 0;
      for (const token of tokens) {
        const lower = token.toLowerCase();
        if (lower === 'vht' || lower === 'vhtn') {
          estimatedSec += VHT_DUR;
        } else if (token.startsWith('"')) {
          // Try real duration via Electron
          if (getIsElectronEnv() && window.electronAPI?.getFileDuration) {
            const cleanName = token.replace(/^"|"$/g, '');
            try {
              const dr = await window.electronAPI.getFileDuration({ filename: cleanName, musicFolders: [...config.musicFolders, config.contentFolder, config.gradeFolder].filter(Boolean) });
              estimatedSec += (dr.success && dr.duration > 0) ? dr.duration : DEFAULT_SONG_DUR;
            } catch { estimatedSec += DEFAULT_SONG_DUR; }
          } else {
            estimatedSec += DEFAULT_SONG_DUR;
          }
        } else {
          // fallback codes (mus, rom, clas, fun)
          estimatedSec += DEFAULT_SONG_DUR;
        }
      }

      if (estimatedSec >= MIN_DUR_SEC) return result;

      console.log(`[FILL] ⏱️ Bloco ${timeStr} com ${(estimatedSec/60).toFixed(1)} min < 29 min — preenchendo`);
      const usedArtists = new Set<string>();
      const usedKeys = new Set<string>();
      const addedTokens: string[] = [];
      const addedLogs: typeof result.logs = [];

      // Try priority stations first
      for (const stName of FILL_STATIONS) {
        if (estimatedSec >= MIN_DUR_SEC) break;
        const pool = songsByStation[stName] || [];
        for (const candidate of pool) {
          if (estimatedSec >= MAX_DUR_SEC) break;
          const key = `${candidate.title.toLowerCase().trim()}-${candidate.artist.toLowerCase().trim()}`;
          if (usedKeys.has(key) || usedArtists.has(candidate.artist.toLowerCase().trim())) continue;
          if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) continue;
          const libResult = await findSongInLibrary(candidate.artist, candidate.title);
          if (libResult.exists) {
            const fname = libResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
            addedTokens.push(`vht,"${fname}"`);
            usedKeys.add(key);
            usedArtists.add(candidate.artist.toLowerCase().trim());
            markSongAsUsed(candidate.title, candidate.artist, timeStr);
            estimatedSec += DEFAULT_SONG_DUR + VHT_DUR;
            addedLogs.push({
              blockTime: timeStr, type: 'used',
              title: candidate.title, artist: candidate.artist,
              station: stName, reason: `Preenchimento de duração (${stName})`,
            });
          }
        }
      }

      // Coringa as last resort
      const coringaCode = config.coringaCode || 'mus';
      while (estimatedSec < MIN_DUR_SEC) {
        addedTokens.push(`vht,${coringaCode}`);
        estimatedSec += DEFAULT_SONG_DUR + VHT_DUR;
        addedLogs.push({
          blockTime: timeStr, type: 'substituted',
          title: coringaCode, artist: 'CORINGA',
          station: 'FILL', reason: 'Preenchimento mínimo 29 min',
        });
      }

      if (addedTokens.length > 0) {
        const filledLine = `${result.line},${addedTokens.join(',')}`;
        console.log(`[FILL] ✅ Bloco ${timeStr}: +${addedTokens.length} itens → ${(estimatedSec/60).toFixed(1)} min`);
        return {
          line: filledLine,
          logs: [...result.logs, ...addedLogs],
          durationMinutes: parseFloat((estimatedSec / 60).toFixed(1)),
        };
      }
      return result;
    };

    // === Check if a scheduled sequence overrides special programs ===
    const hasScheduledSequence = scheduledSequences
      .filter(s => s.enabled)
      .some(s => {
        const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
        const currentDay = targetDay || dayMap[new Date().getDay()];
        if (s.weekDays.length > 0 && !s.weekDays.includes(currentDay)) return false;
        const timeMinutes = hour * 60 + minute;
        const startMin = s.startHour * 60 + s.startMinute;
        const endMin = s.endHour * 60 + s.endMinute;
        if (endMin <= startMin) return timeMinutes >= startMin || timeMinutes < endMin;
        return timeMinutes >= startMin && timeMinutes < endMin;
      });

    // === VOZ DO BRASIL: PRIORIDADE MÁXIMA — NUNCA pode ser sobreposta ===
    // Obrigatório por lei (60 min, bloco 21:30 eliminado)
    if (hour === 21 && minute === 0 && isWeekday(targetDay)) {
      console.log(`[GRADE] 🇧🇷 Voz do Brasil às ${timeStr} — OBRIGATÓRIO, ignora sequência agendada`);
      return generateVozDoBrasil(timeStr);
    }

    // === SEQUÊNCIA AGENDADA TEM PRIORIDADE SOBRE DEMAIS PROGRAMAS ===
    // Quando há sequência agendada ativa, pula programas especiais,
    // templates de sábado e conteúdo fixo — vai direto para geração baseada na sequência.
    if (hasScheduledSequence) {
      // Check if the scheduled sequence contains a program_* entry — if so, invoke that specific template
      const activeSeq = getActiveSequenceForBlock(hour, minute, targetDay);
      const programEntry = activeSeq.find(s => s.radioSource.startsWith('program_'));
      if (programEntry) {
        const pgm = programEntry.radioSource;
        console.log(`[GRADE] 📺 Programa "${pgm}" na sequência agendada às ${timeStr}`);
        
        // Weekday programs
        if (pgm === 'program_sintonia_total' && (hour === 9 || hour === 10)) {
          const result = await generateWeekdayTemplateBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
          if (result) return fillBlockIfShort(result);
        }
        if (pgm === 'program_painel_flashback' && hour === 12) {
          const result = await generateWeekdayTemplateBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
          if (result) return fillBlockIfShort(result);
        }
        if (pgm === 'program_top10' && hour === 13) {
          const result = await generateWeekdayTemplateBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
          if (result) return fillBlockIfShort(result);
        }
        if (pgm === 'program_intensidade' && hour === 17) {
          const result = await generateWeekdayTemplateBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
          if (result) return fillBlockIfShort(result);
        }
        if (pgm === 'program_radar_noticias' && hour === 18 && minute === 0) {
          const result = await generateWeekdayTemplateBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
          if (result) return fillBlockIfShort(result);
        }
        if (pgm === 'program_top10_mix' && hour === 18 && minute === 30) {
          const result = await generateWeekdayTemplateBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
          if (result) return fillBlockIfShort(result);
        }
        if (pgm === 'program_radio_revista' && (hour === 19)) {
          const result = await generateWeekdayTemplateBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
          if (result) return fillBlockIfShort(result);
        }
        if (pgm === 'program_misturadao' && hour === 20) {
          const result = await generateWeekdayTemplateBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
          if (result) return fillBlockIfShort(result);
        }
        if (pgm === 'program_songs_of_love' && hour >= 22) {
          const result = await generateWeekdayTemplateBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
          if (result) return fillBlockIfShort(result);
        }

        // Weekend programs — invoke weekend template
        const weekendPgms = ['program_shake_mix', 'program_conexao_mix', 'program_mega_mix', 
          'program_sem_parar', 'program_mega_funk', 'program_gas_total', 'program_amnesia'];
        if (weekendPgms.includes(pgm)) {
          const weekendResult = await generateWeekendTemplateBlock(hour, minute, timeStr, songsByStation, ctx);
          if (weekendResult) return fillBlockIfShort(weekendResult);
        }

        // If the program template didn't match the current time, fall through to normal block logic
        console.log(`[GRADE] ⚠️ Programa "${pgm}" não corresponde ao horário ${timeStr} — usando sequência normal`);
      } else {
        console.log(`[GRADE] 📅 Sequência agendada ativa às ${timeStr} — sobrepondo programas especiais e conteúdo fixo`);
      }
      // Fall through to Normal Block Logic below
    } else {
      // === Special Programs (only when NO scheduled sequence overrides) ===

      // Saturday template blocks
      if (targetDay === 'sab') {
        const weekendResult = await generateWeekendTemplateBlock(hour, minute, timeStr, songsByStation, ctx);
        if (weekendResult) return fillBlockIfShort(weekendResult);
      }

      // === WEEKDAY TEMPLATE BLOCKS (09:00-10:30, 12:00-13:30, 17:00-20:30, 22:00-23:30) ===
      // These replace the old individual handlers for these time slots
      if (isWeekday(targetDay) && isWeekdayTemplateBlock(hour, minute)) {
        const templateResult = await generateWeekdayTemplateBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
        if (templateResult) return fillBlockIfShort(templateResult);
      }

      // Raridades (year-filtered program) — skip on Sunday (no fixed programs)
      const raridadesItem = targetDay !== 'dom' ? fixedItems.find(fc => fc.type === 'raridades' && fc.yearMin && fc.yearMax) : undefined;
      if (raridadesItem) {
        const slotIndex = raridadesItem.timeSlots.findIndex(ts => ts.hour === hour && ts.minute === minute);
        return fillBlockIfShort(await generateRaridades(
          hour, minute,
          raridadesItem.yearMin!, raridadesItem.yearMax!,
          raridadesItem.fileName,
          slotIndex >= 0 ? slotIndex : 0,
          songsByStation, stats, isFullDay, ctx, targetDay
        ));
      }

      // TOP50 blocks (skip on Sunday)
      const top50Item = targetDay !== 'dom' ? fixedItems.find(fc => fc.type === 'top50') : undefined;
      if (top50Item) {
        return fillBlockIfShort(await generateTop50Block(hour, minute, top50Item.top50Count || 10, ctx));
      }

      // === MADRUGADA 00:00-07:30: Usa sequência padrão/programada ===
      // Removido: generateMadrugada e generateSertanejoNossa
      // Agora segue para Normal Block Logic usando a sequência configurada
      // com APENAS músicas reais do monitoramento (sem códigos mus/clas/rom)
      if (hour >= 0 && hour <= 7) {
        console.log(`[GRADE] 🌙 Madrugada ${timeStr}: usando sequência normal (padrão ou programada) — sem códigos`);
        // Fall through to Normal Block Logic below
      }
    }

    // === Normal Block Logic ===

    const blockLogs: BlockLogItem[] = [];

    // Fixed content handling — SKIPPED on Sunday, during scheduled sequences, AND during madrugada (00:00-07:59)
    const isSunday = targetDay === 'dom';
    const isMadrugada = hour >= 0 && hour <= 7;
    const fixedItem = (hasScheduledSequence || isSunday || isMadrugada) ? undefined : fixedItems.find(fc => fc.type !== 'top50' && fc.type !== 'vozbrasil' && fc.type !== 'raridades');
    let fixedContentFile: string | null = null;
    let fixedPosition: 'start' | 'middle' | 'end' | number = 'start';

    if (fixedItem) {
      const slotIndex = fixedItem.timeSlots.findIndex(ts => ts.hour === hour && ts.minute === minute);
      const editionIndex = slotIndex >= 0 ? slotIndex : 0;
      const processedFileName = processFixedContentFilename(fixedItem.fileName, hour, minute, editionIndex, targetDay);
      const finalFileName = processedFileName.toLowerCase().endsWith('.mp3') ? processedFileName : `${processedFileName}.mp3`;
      fixedContentFile = `"${finalFileName}"`;
      fixedPosition = fixedItem.position || 'start';
      blockLogs.push({
        blockTime: timeStr, type: 'fixed',
        title: fixedItem.name, artist: finalFileName,
        station: 'FIXO', reason: `Conteúdo fixo com dia: ${getDayCode(targetDay)}`,
      });
    } else if (isSunday) {
      console.log(`[GRADE] 🌞 Domingo: conteúdo fixo ignorado às ${timeStr} — 100% monitoramento`);
    } else if (isMadrugada) {
      console.log(`[GRADE] 🌙 Madrugada: conteúdo fixo ignorado às ${timeStr} — 100% monitoramento`);
    } else if (hasScheduledSequence && fixedItems.some(fc => fc.type !== 'top50' && fc.type !== 'vozbrasil')) {
      console.log(`[GRADE] ⏭️ Conteúdo fixo ignorado às ${timeStr} — sequência agendada ativa`);
    }

    // Build pools
    const allSongsPool: SongEntry[] = [];
    for (const stationSongs of Object.values(songsByStation)) {
      allSongsPool.push(...stationSongs);
    }

    // Carry-over
    const carryOverAvailable = getCarryOverSongs(timeStr);
    const carryOverByStation: Record<string, SongEntry[]> = {};
    for (const carryOver of carryOverAvailable) {
      const libraryResult = await findSongInLibrary(carryOver.artist, carryOver.title);
      if (libraryResult.exists) {
        const correctFilename = libraryResult.filename || sanitizeFilename(`${carryOver.artist} - ${carryOver.title}.mp3`);
        const songEntry: SongEntry = {
          title: carryOver.title, artist: carryOver.artist,
          station: carryOver.station, style: carryOver.style,
          filename: correctFilename, existsInLibrary: true,
        };
        if (!carryOverByStation[carryOver.station]) carryOverByStation[carryOver.station] = [];
        carryOverByStation[carryOver.station].push(songEntry);
      }
    }

    // Get active sequence for this specific block
    const activeSequence = getActiveSequenceForBlock(hour, minute, targetDay);
    
    // === SEQUENCE DIAGNOSTIC LOG ===
    const seqSummary = activeSequence.map((s, i) => {
      const resolvedName = STATION_ID_TO_DB_NAME[s.radioSource] || 
        stations.find(st => st.id === s.radioSource)?.name || 
        s.radioSource;
      const poolSongs = songsByStation[resolvedName] || [];
      // Try case-insensitive match if exact fails
      let matchedPool = poolSongs.length;
      if (matchedPool === 0) {
        for (const key of Object.keys(songsByStation)) {
          if (key.toLowerCase().trim() === resolvedName.toLowerCase().trim()) {
            matchedPool = songsByStation[key].length;
            break;
          }
        }
      }
      return `P${i + 1}:${s.radioSource}→${resolvedName}(${matchedPool})`;
    }).join(' | ');
    console.log(`[AUTO-GRADE] 🎼 SEQUÊNCIA ${timeStr}: [${seqSummary}]`);
    // === END DIAGNOSTIC ===
    
    const usedInBlock = new Set<string>();
    const usedArtistsInBlock = new Set<string>();
    const stationSongIndex: Record<string, number> = {};
    const songs: string[] = [];

    const selCtx = {
      timeStr, isFullDay, usedInBlock, usedArtistsInBlock,
      songsByStation, allSongsPool, carryOverByStation, stationSongIndex,
      logs: blockLogs, stats,
    };

    // === DURATION-AWARE BLOCK GENERATION ===
    // Target: 29-32 minutes per block (1740-1920 seconds)
    const MIN_BLOCK_DURATION_SEC = 29 * 60; // 1740s
    const MAX_BLOCK_DURATION_SEC = 32 * 60; // 1920s
    const DEFAULT_SONG_DURATION_SEC = 210;   // 3:30 fallback
    const DEFAULT_FIXED_DURATION_SEC = 180;  // 3:00 for fixed content fallback

    // === DYNAMIC VHT DURATION from cached real file durations ===
    const vinhetasFolder = config.vinhetasFolder || 'C:\\Playlist\\Vinhetas';
    const VHT_DURATION_SEC = await getAvgVhtDuration(vinhetasFolder);

    let accumulatedDurationSec = 0;
    let sequenceCycleIndex = 0;

    // Pre-calculate fixed content duration if present
    if (fixedContentFile) {
      let fixedDuration = DEFAULT_FIXED_DURATION_SEC;
      if (getIsElectronEnv() && window.electronAPI?.getFileDuration) {
        try {
          const cleanName = fixedContentFile.replace(/^"|"$/g, '');
          const allFolders = [...config.musicFolders, config.contentFolder, config.gradeFolder].filter(Boolean);
          const durResult = await window.electronAPI.getFileDuration({ filename: cleanName, musicFolders: allFolders });
          if (durResult.success && durResult.duration > 0) {
            fixedDuration = durResult.duration;
          }
        } catch (e) { /* use default */ }
      }
      accumulatedDurationSec += fixedDuration;
    }

    // Helper to get duration of a song file
    const getSongDuration = async (songStr: string): Promise<number> => {
      if (!getIsElectronEnv() || !window.electronAPI?.getFileDuration) return DEFAULT_SONG_DURATION_SEC;
      // Only query for quoted filenames (real files), not codes like 'mus', 'rom', etc.
      if (!songStr.startsWith('"')) return DEFAULT_SONG_DURATION_SEC;
      const cleanName = songStr.replace(/^"|"$/g, '');
      try {
        const durResult = await window.electronAPI.getFileDuration({ filename: cleanName, musicFolders: config.musicFolders });
        if (durResult.success && durResult.duration > 0) return durResult.duration;
      } catch (e) { /* fallback */ }
      return DEFAULT_SONG_DURATION_SEC;
    };

    // === PRIORITY STATIONS FOR FILLING ===
    // When we need extra songs to fill duration, prefer these stations
    const FILL_PRIORITY_STATIONS = config.fillPriorityStations?.length 
      ? config.fillPriorityStations 
      : ['BH FM', 'Metropolitana FM', 'Metropolitana'];

    // Helper to get songs from priority stations for filling
    const getFillerSong = async (): Promise<string | null> => {
      for (const stationName of FILL_PRIORITY_STATIONS) {
        const pool = songsByStation[stationName] || [];
        for (const candidate of pool) {
          const key = `${candidate.title.toLowerCase().trim()}-${candidate.artist.toLowerCase().trim()}`;
          if (usedInBlock.has(key)) continue;
          if (usedArtistsInBlock.has(candidate.artist.toLowerCase().trim())) continue;
          if (isRecentlyUsed(candidate.title, candidate.artist, timeStr)) continue;
          
          // Check if exists in library
          const libraryResult = await findSongInLibrary(candidate.artist, candidate.title);
          if (libraryResult.exists) {
            const filename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
            usedInBlock.add(key);
            usedArtistsInBlock.add(candidate.artist.toLowerCase().trim());
            markSongAsUsed(candidate.title, candidate.artist, timeStr);
            blockLogs.push({ 
              blockTime: timeStr, type: 'used', 
              title: candidate.title, artist: candidate.artist, 
              station: stationName, reason: `Preenchimento de duração (${stationName})` 
            });
            return `"${filename}"`;
          }
        }
      }
      return null;
    };

    // === PRE-DOWNLOAD BURST: Proactively download missing songs from sequence stations ===
    // This runs BEFORE the selection loop to maximize P1 hit rate on Desktop.
    // Without this, the selection loop's JIT downloads happen one-by-one per position,
    // causing most positions to fall through to P4/P5/P6 (random library songs).
    if (getIsElectronEnv() && window.electronAPI?.downloadFromDeezer) {
      const storeState = useRadioStore.getState();
      if (storeState.deezerConfig.enabled && storeState.deezerConfig.arl) {
        const uniqueStationsInSeq = new Set<string>();
        for (const seq of activeSequence) {
          if (seq.radioSource.startsWith('fixo') || seq.radioSource === 'top50' ||
              seq.radioSource === 'random_pop' || seq.radioSource.startsWith('genre_') ||
              seq.radioSource.startsWith('year_') || seq.radioSource.startsWith('genreyear_') ||
              seq.radioSource.startsWith('program_')) continue;
          const resolvedName = STATION_ID_TO_DB_NAME[seq.radioSource] ||
            STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()] ||
            stations.find(s => s.id === seq.radioSource)?.name ||
            seq.radioSource;
          uniqueStationsInSeq.add(resolvedName);
        }

        // Collect top candidates missing from library
        // AGGRESSIVE: 6 per station, 30 total — ensures P1 has maximum fresh songs available
        const missingCandidates: Array<{ artist: string; title: string; station: string }> = [];
        const MAX_PER_STATION = 6;
        const MAX_TOTAL = 30;

        for (const stName of uniqueStationsInSeq) {
          if (missingCandidates.length >= MAX_TOTAL) break;
          // Find pool (case-insensitive)
          let pool: SongEntry[] = songsByStation[stName] || [];
          if (pool.length === 0) {
            for (const [k, v] of Object.entries(songsByStation)) {
              if (k.toLowerCase().trim() === stName.toLowerCase().trim()) { pool = v; break; }
            }
          }
          // Sort by freshness, pick candidates NOT in library
          const sorted = [...pool].sort((a, b) => {
            if (a.scrapedAt && b.scrapedAt) return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
            return 0;
          });
          let added = 0;
          for (const candidate of sorted) {
            if (added >= MAX_PER_STATION || missingCandidates.length >= MAX_TOTAL) break;
            const cached = getCachedVerification(candidate.artist, candidate.title);
            // Only check candidates where cache says NOT exists or cache is empty
            if (cached && cached.exists) continue;
            // Quick disk check
            const diskResult = await findSongInLibrary(candidate.artist, candidate.title);
            if (!diskResult.exists) {
              missingCandidates.push({ artist: candidate.artist, title: candidate.title, station: stName });
              added++;
            }
          }
        }

        if (missingCandidates.length > 0) {
          console.log(`[AUTO-GRADE] 🚀 PRE-DOWNLOAD BURST: ${missingCandidates.length} músicas ausentes das estações da sequência. Baixando sequencialmente...`);
          const { getDownloadDecision } = await import('@/lib/downloadGuard');
          const { useBurstStatsStore } = await import('@/store/burstStatsStore');
          const burstDetails: Array<{ artist: string; title: string; station: string; status: 'downloaded' | 'failed' | 'timeout' | 'blocked'; reason?: string }> = [];

          const downloadTimeoutBurst = 90000;
          let burstDownloaded = 0;
          let burstFailed = 0;
          let burstTimedOut = 0;
          let burstBlocked = 0;
          const burstStartTime = Date.now();

          for (const c of missingCandidates) {
              const decision = getDownloadDecision(c.artist, c.title, {
                blockedSongs: storeState.config.blockedSongs ?? [],
                forbiddenWords: storeState.config.forbiddenWords ?? [],
                songAliases: storeState.songAliases ?? [],
              });
              if (!decision.allowed) {
                burstBlocked++;
                burstDetails.push({ artist: c.artist, title: c.title, station: c.station, status: 'blocked', reason: decision.reason });
                console.log(`[PRE-DL] 🚫 Bloqueado: ${c.artist} - ${c.title} (${decision.reason})`);
                continue;
              }
              const dlArtist = decision.downloadArtist || c.artist;
              const dlTitle = decision.downloadTitle || c.title;
              try {
                console.log(`[PRE-DL] 🔍 findSongMatch diagnostics for: "${c.artist} - ${c.title}" → download as "${dlArtist} - ${dlTitle}"`);
                const result = await Promise.race([
                  window.electronAPI!.downloadFromDeezer!({
                    artist: dlArtist, title: dlTitle,
                    arl: storeState.deezerConfig.arl,
                    outputFolder: storeState.deezerConfig.downloadFolder,
                    quality: storeState.deezerConfig.quality,
                  }),
                  new Promise<null>((r) => setTimeout(() => r(null), downloadTimeoutBurst)),
                ]);
                if (result && typeof result === 'object' && 'success' in result && result.success) {
                  burstDownloaded++;
                  burstDetails.push({ artist: c.artist, title: c.title, station: c.station, status: 'downloaded' });
                  console.log(`[PRE-DL] ✅ ${burstDownloaded}/${missingCandidates.length}: ${dlArtist} - ${dlTitle}`);
                  const { clearVerificationForSong, markSongAsDownloadedWithAlias } = await import('@/lib/libraryVerificationCache');
                  clearVerificationForSong(c.artist, c.title);
                  if (dlArtist !== c.artist || dlTitle !== c.title) clearVerificationForSong(dlArtist, dlTitle);
                  markSongAsDownloadedWithAlias(c.artist, c.title, dlArtist, dlTitle);
                } else {
                  burstTimedOut++;
                  burstDetails.push({ artist: c.artist, title: c.title, station: c.station, status: 'timeout' });
                  console.log(`[PRE-DL] ⏰ Timeout: ${dlArtist} - ${dlTitle}`);
                }
              } catch (e) {
                burstFailed++;
                burstDetails.push({ artist: c.artist, title: c.title, station: c.station, status: 'failed', reason: String(e) });
                console.warn(`[PRE-DL] ❌ Erro: ${dlArtist} - ${dlTitle}`, e);
              }
          }

          const burstDurationMs = Date.now() - burstStartTime;
          console.log(`[AUTO-GRADE] 🚀 PRE-DOWNLOAD BURST completo: ${burstDownloaded}✅ ${burstFailed}❌ ${burstTimedOut}⏰ ${burstBlocked}🚫 em ${(burstDurationMs / 1000).toFixed(1)}s`);
          
          // Store burst stats for dashboard
          useBurstStatsStore.getState().addEvent({
            blockTime: timeStr,
            candidates: missingCandidates.length,
            downloaded: burstDownloaded,
            failed: burstFailed,
            timedOut: burstTimedOut,
            blocked: burstBlocked,
            durationMs: burstDurationMs,
            details: burstDetails,
          });
        }
      }
    }

    // === PHASE 1: Follow the sequence but STOP when approaching max duration ===
    // Each block MUST stay between 29-32 minutes. Stop adding songs near the ceiling.
    const sequenceLength = activeSequence.length;
    for (let i = 0; i < sequenceLength; i++) {
      // HARD STOP: if we've already hit max duration, stop adding songs
      if (accumulatedDurationSec >= MAX_BLOCK_DURATION_SEC) {
        console.log(`[AUTO-GRADE] 🛑 Bloco ${timeStr}: parou na posição ${i}/${sequenceLength} — já atingiu ${(accumulatedDurationSec / 60).toFixed(1)} min (max 32)`);
        break;
      }

      const seq = activeSequence[i];

      // Try special sequence types first
      const specialResult = await handleSpecialSequenceType(seq, hour, minute, selCtx, ctx, targetDay);
      if (specialResult !== null) {
        const dur = await getSongDuration(specialResult);
        const projectedTotal = accumulatedDurationSec + dur + (songs.length > 0 ? VHT_DURATION_SEC : 0);
        // Don't add if it would push past max (allow small 30s grace)
        if (projectedTotal > MAX_BLOCK_DURATION_SEC + 30) {
          console.log(`[AUTO-GRADE] ⏸️ Bloco ${timeStr}: música especial pulada na pos ${i} — ultrapassaria ${(projectedTotal / 60).toFixed(1)} min`);
          break;
        }
        songs.push(specialResult);
        accumulatedDurationSec = projectedTotal;
        continue;
      }

      // Normal station selection (P0-P6)
      const songStr = await selectSongForSlot(seq, selCtx, ctx);
      const dur = await getSongDuration(songStr);
      const projectedTotal = accumulatedDurationSec + dur + (songs.length > 0 ? VHT_DURATION_SEC : 0);
      
      // Don't add if it would push past max (allow small 30s grace)
      if (projectedTotal > MAX_BLOCK_DURATION_SEC + 30) {
        console.log(`[AUTO-GRADE] ⏸️ Bloco ${timeStr}: parou na posição ${i}/${sequenceLength} — próxima música levaria a ${(projectedTotal / 60).toFixed(1)} min`);
        break;
      }
      
      songs.push(songStr);
      accumulatedDurationSec = projectedTotal;
    }

    // === PHASE 2: Duration adjustment by REPLACING songs ===
    // If block is TOO LONG (>32min): replace longest songs with shorter alternatives from same station
    // If block is TOO SHORT (<29min): replace shortest songs with longer alternatives from same station
    
    // Build list of songs with their durations
    const songDurations: Array<{ idx: number; dur: number; song: string }> = [];
    for (let si = 0; si < songs.length; si++) {
      const dur = await getSongDuration(songs[si]);
      songDurations.push({ idx: si, dur, song: songs[si] });
    }
    
    if (accumulatedDurationSec > MAX_BLOCK_DURATION_SEC) {
      // === TOO LONG: Replace longest songs with shorter alternatives ===
      console.log(`[AUTO-GRADE] 🔻 Bloco ${timeStr} acima do máximo: ${(accumulatedDurationSec / 60).toFixed(1)} min > 32 min — tentando encurtar`);
      songDurations.sort((a, b) => b.dur - a.dur); // longest first
      
      for (const { idx: swapIdx, dur: currentDur } of songDurations) {
        if (accumulatedDurationSec <= MAX_BLOCK_DURATION_SEC) break;
        
        const seqEntry = swapIdx < activeSequence.length ? activeSequence[swapIdx] : null;
        if (!seqEntry) continue;
        
        const stationName = seqEntry.radioSource;
        const resolvedName = Object.entries(STATION_ID_TO_DB_NAME).find(([k]) => k === stationName)?.[1] || stationName;
        const pool = songsByStation[resolvedName] || songsByStation[stationName] || [];
        
        for (const candidate of pool) {
          const key = `${candidate.title.toLowerCase().trim()}-${candidate.artist.toLowerCase().trim()}`;
          if (usedInBlock.has(key)) continue;
          if (usedArtistsInBlock.has(candidate.artist.toLowerCase().trim())) continue;
          if (isRecentlyUsed(candidate.title, candidate.artist, timeStr)) continue;
          
          const libraryResult = await findSongInLibrary(candidate.artist, candidate.title);
          if (!libraryResult.exists) continue;
          
          const candidateFile = `"${libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`)}"`;
          const candidateDur = await getSongDuration(candidateFile);
          
          // Accept if candidate is SHORTER than current (at least 15s shorter)
          if (candidateDur < currentDur - 15 && candidateDur >= 120) {
            const durDiff = currentDur - candidateDur;
            console.log(`[AUTO-GRADE] 🔻 Encurtou pos ${swapIdx}: "${songs[swapIdx]}" (${(currentDur/60).toFixed(1)}min) → "${candidateFile}" (${(candidateDur/60).toFixed(1)}min) [-${(durDiff/60).toFixed(1)}min]`);
            songs[swapIdx] = candidateFile;
            usedInBlock.add(key);
            usedArtistsInBlock.add(candidate.artist.toLowerCase().trim());
            markSongAsUsed(candidate.title, candidate.artist, timeStr);
            accumulatedDurationSec -= durDiff;
            blockLogs.push({
              blockTime: timeStr, type: 'substituted',
              title: candidate.title, artist: candidate.artist,
              station: stationName, reason: `Encurtou bloco (-${(durDiff/60).toFixed(1)} min)`,
            });
            break;
          }
        }
      }
      
      // If STILL too long after swaps, remove last songs until under max
      while (accumulatedDurationSec > MAX_BLOCK_DURATION_SEC + 30 && songs.length > 5) {
        const removedSong = songs.pop()!;
        const removedDur = songDurations.find(sd => sd.song === removedSong)?.dur || DEFAULT_SONG_DURATION_SEC;
        accumulatedDurationSec -= removedDur + VHT_DURATION_SEC;
        console.log(`[AUTO-GRADE] ✂️ Removida música do final do bloco ${timeStr}: ${removedSong} — bloco agora ${(accumulatedDurationSec / 60).toFixed(1)} min`);
      }
      
    } else if (accumulatedDurationSec < MIN_BLOCK_DURATION_SEC) {
      // === TOO SHORT: Replace shortest songs with longer alternatives ===
      console.log(`[AUTO-GRADE] 🔺 Bloco ${timeStr} abaixo do mínimo: ${(accumulatedDurationSec / 60).toFixed(1)} min < 29 min — tentando alongar`);
      songDurations.sort((a, b) => a.dur - b.dur); // shortest first
      
      for (const { idx: swapIdx, dur: currentDur } of songDurations) {
        if (accumulatedDurationSec >= MIN_BLOCK_DURATION_SEC) break;
        
        const seqEntry = swapIdx < activeSequence.length ? activeSequence[swapIdx] : null;
        if (!seqEntry) continue;
        
        const stationName = seqEntry.radioSource;
        const resolvedName = Object.entries(STATION_ID_TO_DB_NAME).find(([k]) => k === stationName)?.[1] || stationName;
        const pool = songsByStation[resolvedName] || songsByStation[stationName] || [];
        
        for (const candidate of pool) {
          const key = `${candidate.title.toLowerCase().trim()}-${candidate.artist.toLowerCase().trim()}`;
          if (usedInBlock.has(key)) continue;
          if (usedArtistsInBlock.has(candidate.artist.toLowerCase().trim())) continue;
          if (isRecentlyUsed(candidate.title, candidate.artist, timeStr)) continue;
          
          const libraryResult = await findSongInLibrary(candidate.artist, candidate.title);
          if (!libraryResult.exists) continue;
          
          const candidateFile = `"${libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`)}"`;
          const candidateDur = await getSongDuration(candidateFile);
          
          // Accept if candidate is LONGER (at least 15s longer)
          if (candidateDur > currentDur + 15) {
            const durDiff = candidateDur - currentDur;
            console.log(`[AUTO-GRADE] 🔺 Alongou pos ${swapIdx}: "${songs[swapIdx]}" (${(currentDur/60).toFixed(1)}min) → "${candidateFile}" (${(candidateDur/60).toFixed(1)}min) [+${(durDiff/60).toFixed(1)}min]`);
            songs[swapIdx] = candidateFile;
            usedInBlock.add(key);
            usedArtistsInBlock.add(candidate.artist.toLowerCase().trim());
            markSongAsUsed(candidate.title, candidate.artist, timeStr);
            accumulatedDurationSec += durDiff;
            blockLogs.push({
              blockTime: timeStr, type: 'substituted',
              title: candidate.title, artist: candidate.artist,
              station: stationName, reason: `Alongou bloco (+${(durDiff/60).toFixed(1)} min)`,
            });
            break;
          }
        }
      }
      
      // If STILL under minimum after swaps, add filler songs or coringa
      if (accumulatedDurationSec < MIN_BLOCK_DURATION_SEC) {
        if (isMadrugada) {
          // 🌙 Madrugada: NO codes — try harder to find real songs from ANY station
          console.log(`[AUTO-GRADE] 🌙 Madrugada ${timeStr}: bloco curto, buscando músicas extras de qualquer rádio...`);
          for (const [stName, pool] of Object.entries(songsByStation)) {
            if (accumulatedDurationSec >= MIN_BLOCK_DURATION_SEC) break;
            for (const candidate of pool) {
              if (accumulatedDurationSec >= MIN_BLOCK_DURATION_SEC) break;
              const key = `${candidate.title.toLowerCase().trim()}-${candidate.artist.toLowerCase().trim()}`;
              if (usedInBlock.has(key) || usedArtistsInBlock.has(candidate.artist.toLowerCase().trim())) continue;
              if (isRecentlyUsed(candidate.title, candidate.artist, timeStr)) continue;
              const libraryResult = await findSongInLibrary(candidate.artist, candidate.title);
              if (libraryResult.exists) {
                const fname = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
                songs.push(`"${fname}"`);
                usedInBlock.add(key);
                usedArtistsInBlock.add(candidate.artist.toLowerCase().trim());
                markSongAsUsed(candidate.title, candidate.artist, timeStr);
                accumulatedDurationSec += DEFAULT_SONG_DURATION_SEC + VHT_DURATION_SEC;
                blockLogs.push({
                  blockTime: timeStr, type: 'used',
                  title: candidate.title, artist: candidate.artist,
                  station: stName, reason: `Madrugada fill (${stName}) — sem códigos`,
                });
              }
            }
          }
          if (accumulatedDurationSec < MIN_BLOCK_DURATION_SEC) {
            console.warn(`[AUTO-GRADE] ⚠️ Madrugada ${timeStr}: bloco ainda curto (${(accumulatedDurationSec/60).toFixed(1)}min) mas SEM coringa`);
          }
        } else {
          const coringaCode = config.coringaCode || 'mus';
          songs.push(coringaCode);
          accumulatedDurationSec += DEFAULT_SONG_DURATION_SEC + VHT_DURATION_SEC;
          console.log(`[AUTO-GRADE] ⚠️ Coringa de segurança: "${coringaCode}" (bloco ainda abaixo de 29 min após trocas)`);
          blockLogs.push({
            blockTime: timeStr, type: 'substituted',
            title: coringaCode, artist: 'CORINGA',
            station: 'fallback', reason: 'Segurança: bloco abaixo de 29 min após trocas',
          });
        }
      }
    }

    // Insert fixed content at configured position
    let allContent: string[] = [...songs].filter(s => s && s.length > 0); // Filter empty strings (madrugada omitted positions)
    if (fixedContentFile) {
      if (fixedPosition === 'start') {
        allContent = [fixedContentFile, ...songs];
      } else if (fixedPosition === 'end') {
        allContent = [...songs, fixedContentFile];
      } else if (fixedPosition === 'middle') {
        const midIndex = Math.floor(songs.length / 2);
        allContent = [...songs.slice(0, midIndex), fixedContentFile, ...songs.slice(midIndex)];
      } else if (typeof fixedPosition === 'number') {
        const insertIndex = Math.max(0, Math.min(fixedPosition - 1, songs.length));
        allContent = [...songs.slice(0, insertIndex), fixedContentFile, ...songs.slice(insertIndex)];
      }
    }

    // === RECALCULATE TOTAL DURATION INCLUDING ALL VHT SEPARATORS ===
    // VHT separators: number of elements - 1 (between each content item)
    const vhtCount = allContent.length > 1 ? allContent.length - 1 : 0;
    const totalVhtDurationSec = vhtCount * VHT_DURATION_SEC;
    // accumulatedDurationSec already has partial VHT, so recalculate cleanly:
    // Total = fixed content duration + all song durations + VHT separators
    const finalDurationSec = accumulatedDurationSec + totalVhtDurationSec - ((songs.length > 1 ? songs.length - 1 : 0) * VHT_DURATION_SEC);
    
    const blockMinutes = (finalDurationSec / 60).toFixed(1);
    const durationStatus = finalDurationSec >= MIN_BLOCK_DURATION_SEC ? '✅' : '⚠️';
    console.log(`[AUTO-GRADE] ⏱️ ${durationStatus} Bloco ${timeStr}: ${songs.length} músicas (seq=${sequenceLength}), ${allContent.length} itens total, ${blockMinutes} min (alvo: 29-32 min)`);

    const lineContent = allContent.join(',vht,');
    return {
      line: sanitizeGradeLine(`${timeStr} (ID=${programName}) ${lineContent}`, filterChars),
      logs: blockLogs,
      durationMinutes: parseFloat((finalDurationSec / 60).toFixed(1)),
    };
  }, [
    getProgramForHour, getFixedContentForTime, isWeekday,
    getActiveSequenceForBlock, getSequenceStationNames, findSongInLibrary,
    processFixedContentFilename, getDayCode, getCarryOverSongs,
    buildGradeContext, filterChars, stations, scheduledSequences,
  ]);

  // ==================== Block Times ====================

  const getBlockTimes = useCallback(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentBlockMinute = currentMinute < 30 ? 0 : 30;
    const nextBlockHour = currentBlockMinute === 30 ? (currentHour + 1) % 24 : currentHour;
    const nextBlockMinute = currentBlockMinute === 30 ? 0 : 30;
    const thirdBlockHour = nextBlockMinute === 30 ? (nextBlockHour + 1) % 24 : nextBlockHour;
    const thirdBlockMinute = nextBlockMinute === 30 ? 0 : 30;
    return {
      current: { hour: currentHour, minute: currentBlockMinute },
      next: { hour: nextBlockHour, minute: nextBlockMinute },
      third: { hour: thirdBlockHour, minute: thirdBlockMinute },
    };
  }, []);

  // ==================== Full Day Grade ====================

  const buildFullDayGrade = useCallback(async (overrideDay?: WeekDay) => {
    if (!getIsElectronEnv() || !window.electronAPI?.saveGradeFile) {
      toast({ title: '⚠️ Modo Web', description: 'Geração de grade disponível apenas no aplicativo desktop.' });
      return;
    }
    setState(prev => ({
      ...prev, isBuilding: true, error: null,
      fullDayProgress: 0, fullDayTotal: 48,
      skippedSongs: 0, substitutedSongs: 0, missingSongs: 0,
      currentProcessingSong: null, currentProcessingBlock: null, lastSaveProgress: 0,
    }));

    const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
    const targetDay = overrideDay || dayMap[new Date().getDay()];
    const dayCode = getDayCode(targetDay);

    // Reset weekend cross-block anti-repetition for fresh build
    weekendUsedKeysRef.current.clear();
    saturdayStationIndexRef.current = 0;
    const filename = `${dayCode.toUpperCase()}.txt`;

    try {
      console.log(`[AUTO-GRADE] 🚀 Building full day grade: ${filename}...`);
      reportServiceHeartbeat('grade-builder');
      logSystemError('GRADE', 'info', `Iniciando geração da grade completa: ${filename} (salvamento progressivo)`);
      // Only clear used songs if building for today — next-day builds use fresh context
      if (!overrideDay) clearUsedSongs();

      // Load BPM cache from disk before building
      await loadBpmCacheFromDisk();

      const songsByStation = await fetchAllRecentSongs();
      // Enrich all song pools with cached BPM data
      for (const songs of Object.values(songsByStation)) {
        enrichSongsWithBpmCache(songs as any[]);
      }
      const stats: BlockStats = { skipped: 0, substituted: 0, missing: 0 };
      const lines: string[] = [];
      const allLogs: BlockLogItem[] = [];
      let blockCount = 0;

      // Full-day carry-over: pass missing songs between consecutive blocks
      const fullDayCarryOver: CarryOverSong[] = [];

      for (let hour = 0; hour < 24; hour++) {
        for (const minute of [0, 30]) {
          // Skip 21:30 on weekdays — Voz do Brasil occupies 21:00-22:00 (60 min)
          if (hour === 21 && minute === 30 && isWeekday(targetDay)) continue;

          const blockTimeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          setState(prev => ({
            ...prev, currentProcessingBlock: blockTimeStr,
            currentProcessingSong: `Processando bloco ${blockTimeStr}...`,
          }));

          // Inject carry-over songs from previous block into the ref
          // so generateBlockLine's carry-over logic picks them up
          if (fullDayCarryOver.length > 0) {
            for (const co of fullDayCarryOver) {
              carryOverSongsRef.current.push({
                ...co,
                addedAt: new Date(Date.now() - 120000), // Simulate 2 min ago to pass the 1-min threshold
              });
            }
            fullDayCarryOver.length = 0; // Clear after injecting
          }

          const result = await generateBlockLine(hour, minute, songsByStation, stats, true, targetDay);
          const resolvedLine = await resolveVinhetasInLine(result.line, config.vinhetasFolder || 'C:\\Playlist\\Vinhetas');
          lines.push(resolvedLine);
          allLogs.push(...result.logs);
          blockCount++;

          // Collect any new carry-over songs added during this block for next block
          const newCarryOvers = carryOverSongsRef.current.filter(
            co => (Date.now() - co.addedAt.getTime()) < 60000 // Recently added (within 1 min)
          );
          fullDayCarryOver.push(...newCarryOvers);

          const lastLog = result.logs.filter(l => l.type === 'used' || l.type === 'substituted').pop();
          setState(prev => ({
            ...prev, fullDayProgress: blockCount,
            skippedSongs: stats.skipped, substitutedSongs: stats.substituted, missingSongs: stats.missing,
            currentProcessingSong: lastLog ? `${lastLog.artist} - ${lastLog.title}` : 'Processando...',
          }));

          // Progressive save every 4 blocks
          if (blockCount % 4 === 0 || blockCount === 48) {
            try {
              const saveResult = await window.electronAPI.saveGradeFile({ folder: config.gradeFolder, filename, content: lines.join('\n') });
              if (saveResult.success) {
                console.log(`[AUTO-GRADE] 💾 Progressive save: ${blockCount}/48 blocos`);
                setState(prev => ({ ...prev, lastSaveProgress: blockCount, lastSavedFile: filename }));
              }
            } catch (saveError) {
              console.error('[AUTO-GRADE] Progressive save error:', saveError);
            }
          }

          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      addBlockLogs(allLogs);
      
      // Feed ranking TOP25 from songs actually used in the full-day grade
      const usedSongs = allLogs.filter(log => log.type === 'used');
      if (usedSongs.length > 0) {
        const { applyRankingBatch } = useRadioStore.getState();
        const rankingUpdates = usedSongs.map(log => ({
          title: log.title,
          artist: log.artist,
          style: log.style || 'POP/VARIADO',
          count: 1,
        }));
        applyRankingBatch(rankingUpdates);
        console.log(`[AUTO-GRADE] 📊 Ranking atualizado (grade completa): ${usedSongs.length} músicas`);
      }
      const finalContent = lines.join('\n');
      await renameFilesInGradeContent(finalContent);

      const result = await window.electronAPI.saveGradeFile({ folder: config.gradeFolder, filename, content: finalContent });
      if (result.success) {
        console.log(`[AUTO-GRADE] ✅ Full day grade saved: ${result.filePath}`);
        logSystemError('GRADE', 'info', `Grade completa salva: ${filename}`, `${lines.length} blocos, ${stats.skipped} puladas, ${stats.substituted} substituídas, ${stats.missing} faltando`);
        addGradeHistory({
          id: `grade-fullday-${Date.now()}`, timestamp: new Date(), blockTime: 'COMPLETA',
          songsProcessed: 48 * defaultSequence.length, songsFound: lines.length, songsMissing: stats.missing, programName: 'Grade Completa',
        });
        // Build pendingGradeLines from all generated lines for preview sync
        const fullDayLineMap = new Map<string, string>();
        for (const line of lines) {
          const timeMatch = line.match(/^(\d{2}:\d{2})/);
          if (timeMatch) fullDayLineMap.set(timeMatch[1], line);
        }
        // Persist full-day grade to localStorage
        const allBlockKeys = new Set(fullDayLineMap.keys());
        saveGradeToStorage(fullDayLineMap, allBlockKeys, dayCode);
        setState(prev => ({
          ...prev, isBuilding: false, lastBuildTime: new Date(), lastSavedFile: filename,
          blocksGenerated: prev.blocksGenerated + 48, fullDayProgress: 48, fullDayTotal: 0,
          skippedSongs: stats.skipped, substitutedSongs: stats.substituted, missingSongs: stats.missing,
          currentProcessingSong: null, currentProcessingBlock: null,
          pendingGradeLines: fullDayLineMap,
          pendingStationMap: buildStationMapFromLogs(allLogs),
        }));
        toast({ title: '✅ Grade Completa Gerada!', description: `${filename} salvo com 48 blocos. ${stats.skipped} puladas, ${stats.substituted} substituídas, ${stats.missing} faltando.` });
      } else {
        throw new Error(result.error || 'Erro ao salvar grade');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logSystemError('GRADE', 'error', 'Erro na geração da grade completa', errorMessage);
      setState(prev => ({ ...prev, isBuilding: false, error: errorMessage, fullDayTotal: 0, currentProcessingSong: null, currentProcessingBlock: null }));
      toast({ title: '❌ Erro na Grade', description: errorMessage, variant: 'destructive' });
    }
  }, [
    clearUsedSongs, fetchAllRecentSongs, generateBlockLine, renameFilesInGradeContent,
    getDayCode, config.gradeFolder, addGradeHistory, defaultSequence.length, toast, addBlockLogs,
  ]);

  // ==================== Next Day Pre-Generation (22:00) — Only 00:00-01:00 ====================

  const buildNextDayGrade = useCallback(async () => {
    const todayStr = new Date().toDateString();
    if (nextDayBuiltForRef.current === todayStr) return;
    if (nextDayBuildInProgressRef.current) return;

    nextDayBuildInProgressRef.current = true;
    try {
      const dayMapArr: WeekDay[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
      const tomorrowIndex = (new Date().getDay() + 1) % 7;
      const tomorrowDay = dayMapArr[tomorrowIndex];
      const tomorrowCode = getDayCode(tomorrowDay);
      const tomorrowFilename = `${tomorrowCode.toUpperCase()}.txt`;

      console.log(`[AUTO-GRADE] 🌙 22:00 — Pré-gerando blocos 00:00-01:00 do dia seguinte: ${tomorrowFilename} (${tomorrowDay})`);
      logSystemError('GRADE', 'info', `Pré-geração parcial do dia seguinte: ${tomorrowFilename}`, 'Blocos 00:00 e 00:30 gerados às 22:00. O restante será montado pelo monitoramento em tempo real.');

      if (!getIsElectronEnv() || !window.electronAPI?.saveGradeFile) return;

      // Load BPM cache
      await loadBpmCacheFromDisk();

      const songsByStation = await fetchAllRecentSongs();
      for (const songs of Object.values(songsByStation)) {
        enrichSongsWithBpmCache(songs as any[]);
      }

      const stats: BlockStats = { skipped: 0, substituted: 0, missing: 0 };
      const lines: string[] = [];
      const allLogs: BlockLogItem[] = [];

      // Only build blocks 00:00 and 00:30
      for (const minute of [0, 30]) {
        const blockTimeStr = `00:${minute.toString().padStart(2, '0')}`;
        console.log(`[AUTO-GRADE] 🌙 Gerando bloco ${blockTimeStr} para ${tomorrowDay}...`);

        const result = await generateBlockLine(0, minute, songsByStation, stats, true, tomorrowDay);
        const resolvedLine = await resolveVinhetasInLine(result.line, config.vinhetasFolder || 'C:\\Playlist\\Vinhetas');
        lines.push(resolvedLine);
        allLogs.push(...result.logs);

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (lines.length > 0) {
        addBlockLogs(allLogs);
        const content = lines.join('\n');

        const result = await window.electronAPI.saveGradeFile({
          folder: config.gradeFolder, filename: tomorrowFilename, content,
        });

        if (result.success) {
          nextDayBuiltForRef.current = todayStr;
          console.log(`[AUTO-GRADE] ✅ Blocos 00:00-01:00 do dia seguinte salvos: ${tomorrowFilename}`);
          toast({ title: '🌙 Grade do Dia Seguinte', description: `${tomorrowFilename} — blocos 00:00 e 00:30 pré-gerados. O monitoramento completa o restante.` });
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error(`[AUTO-GRADE] ❌ Erro na pré-geração do dia seguinte:`, msg);
      logSystemError('GRADE', 'error', 'Erro na pré-geração do dia seguinte', msg);
    } finally {
      nextDayBuildInProgressRef.current = false;
    }
  }, [getDayCode, fetchAllRecentSongs, generateBlockLine, resolveVinhetasInLine, config.gradeFolder, config.vinhetasFolder, addBlockLogs, toast]);

  const buildNextDayGradeRef = useRef(buildNextDayGrade);
  buildNextDayGradeRef.current = buildNextDayGrade;

  // ==================== Pending Grade (in-memory buffer) ====================

  /** Holds the latest generated grade content in memory, ready to be flushed to disk */
  const pendingGradeRef = useRef<{ lineMap: Map<string, string>; filename: string; blockKey: string } | null>(null);

  // ==================== Incremental Build (silent, in-memory) ====================

  const buildGrade = useCallback(async (forceWrite: boolean = false, forceRegenerate: boolean = false) => {
    const isWebOnly = !getIsElectronEnv() || !window.electronAPI?.saveGradeFile;

    try {
      const blocks = getBlockTimes();
      let currentTimeKey = `${blocks.current.hour.toString().padStart(2, '0')}:${blocks.current.minute.toString().padStart(2, '0')}`;
      let nextTimeKey = `${blocks.next.hour.toString().padStart(2, '0')}:${blocks.next.minute.toString().padStart(2, '0')}`;
      let thirdTimeKey = `${blocks.third.hour.toString().padStart(2, '0')}:${blocks.third.minute.toString().padStart(2, '0')}`;
      const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
      const targetDay = dayMap[new Date().getDay()];
      const dayCode = getDayCode(targetDay);
      const filename = `${dayCode.toUpperCase()}.txt`;

      // Day rollover guard: at midnight, clear stale locks/buffer from previous day
      if (activeDayCodeRef.current !== dayCode) {
        console.log(`[AUTO-GRADE] 🌅 Virada de dia: ${activeDayCodeRef.current} → ${dayCode}. Limpando buffers da grade.`);
        activeDayCodeRef.current = dayCode;
        usedSongsRef.current = [];
        carryOverSongsRef.current = [];
        builtBlocksRef.current.clear();
        pendingGradeRef.current = null;
        clearGradeStorage();
        setState(prev => ({
          ...prev,
          pendingGradeLines: new Map(),
          pendingBlockDurations: new Map(),
          pendingStationMap: {},
        }));
      }

      // Skip 21:30 on weekdays — Voz do Brasil occupies 21:00-22:00 (60 min)
      if (blocks.current.hour === 21 && blocks.current.minute === 30 && isWeekday(targetDay)) {
        console.log('[AUTO-GRADE] ⏭️ Bloco atual 21:30 pulado (Voz do Brasil) — avançando para 22:00/22:30');
        blocks.current = { hour: 22, minute: 0 };
        blocks.next = { hour: 22, minute: 30 };
        blocks.third = { hour: 23, minute: 0 };
        // Recalculate time keys after skip (NO recursive call — avoids infinite loop)
        currentTimeKey = '22:00';
        nextTimeKey = '22:30';
        thirdTimeKey = '23:00';
      }
      if (blocks.next.hour === 21 && blocks.next.minute === 30 && isWeekday(targetDay)) {
        nextTimeKey = '22:00';
        blocks.next = { hour: 22, minute: 0 };
        thirdTimeKey = '22:30';
        blocks.third = { hour: 22, minute: 30 };
        console.log('[AUTO-GRADE] ⏭️ Pulando 21:30 (Voz do Brasil) — próximo bloco: 22:00');
      }
      if (blocks.third.hour === 21 && blocks.third.minute === 30 && isWeekday(targetDay)) {
        thirdTimeKey = '22:00';
        blocks.third = { hour: 22, minute: 0 };
        console.log('[AUTO-GRADE] ⏭️ Pulando 21:30 (Voz do Brasil) — terceiro bloco: 22:00');
      }

      // === SEQUÊNCIA AGENDADA: forçar rebuild de blocos cobertos ===
      // Sequências programadas têm prioridade absoluta (exceto Voz do Brasil)
      // e devem SEMPRE reescrever blocos, mesmo que já estejam travados/completos.
      const isBlockCoveredByScheduledSequence = (blockHour: number, blockMinute: number): boolean => {
        return scheduledSequences
          .filter(s => s.enabled)
          .some(s => {
            if (s.weekDays.length > 0 && !s.weekDays.includes(targetDay)) return false;
            const timeMinutes = blockHour * 60 + blockMinute;
            const startMin = s.startHour * 60 + s.startMinute;
            const endMin = s.endHour * 60 + s.endMinute;
            if (endMin <= startMin) return timeMinutes >= startMin || timeMinutes < endMin;
            return timeMinutes >= startMin && timeMinutes < endMin;
          });
      };

      const currentCoveredBySchedule = isBlockCoveredByScheduledSequence(blocks.current.hour, blocks.current.minute);
      const nextCoveredBySchedule = isBlockCoveredByScheduledSequence(blocks.next.hour, blocks.next.minute);
      const thirdCoveredBySchedule = isBlockCoveredByScheduledSequence(blocks.third.hour, blocks.third.minute);

      if (currentCoveredBySchedule) {
        builtBlocksRef.current.delete(currentTimeKey);
        console.log(`[AUTO-GRADE] 📅 Sequência agendada cobre ${currentTimeKey} — forçando rebuild`);
      }
      if (nextCoveredBySchedule) {
        builtBlocksRef.current.delete(nextTimeKey);
        console.log(`[AUTO-GRADE] 📅 Sequência agendada cobre ${nextTimeKey} — forçando rebuild`);
      }
      if (thirdCoveredBySchedule) {
        builtBlocksRef.current.delete(thirdTimeKey);
        console.log(`[AUTO-GRADE] 📅 Sequência agendada cobre ${thirdTimeKey} — forçando rebuild`);
      }

      // If forceRegenerate (manual refresh), clear locks so blocks are rebuilt
      if (forceRegenerate) {
        builtBlocksRef.current.delete(currentTimeKey);
        builtBlocksRef.current.delete(nextTimeKey);
        builtBlocksRef.current.delete(thirdTimeKey);
        console.log(`[AUTO-GRADE] 🔓 Force regenerate: locks limpos para ${currentTimeKey}, ${nextTimeKey} e ${thirdTimeKey}`);
      }

      // Check lock state first (in-memory cycle lock)
      let currentLocked = builtBlocksRef.current.has(currentTimeKey);
      let nextLocked = builtBlocksRef.current.has(nextTimeKey);
      let thirdLocked = builtBlocksRef.current.has(thirdTimeKey);

      // Start from pending in-memory map to preserve already assembled lines (web + desktop)
      const lineMap = new Map<string, string>(pendingGradeRef.current?.lineMap || []);

      // Read existing file and overlay into lineMap (Electron only)
      let existingContent = '';
      if (!isWebOnly) {
        try {
          if (window.electronAPI?.readGradeFile) {
            const readResult = await window.electronAPI.readGradeFile({ folder: config.gradeFolder, filename });
            if (readResult.success && readResult.content) existingContent = readResult.content;
          }
        } catch { /* ignore */ }
      }

      if (existingContent) {
        for (const line of existingContent.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const timeMatch = trimmed.match(/^(\d{2}:\d{2})/);
          if (timeMatch) lineMap.set(timeMatch[1], trimmed);
        }
      }

      const coringaCode = (config.coringaCode || 'mus').replace('.mp3', '');
      const currentExistingLine = lineMap.get(currentTimeKey);
      const nextExistingLine = lineMap.get(nextTimeKey);
      const thirdExistingLine = lineMap.get(thirdTimeKey);

      // Check if blocks are fully resolved (all song slots filled — no fallbacks)
      const { isBlockFullyResolved } = await import('@/lib/gradeBuilder/lineMerge');
      const currentFullyResolved = currentExistingLine ? isBlockFullyResolved(currentExistingLine, coringaCode) : false;
      const nextFullyResolved = nextExistingLine ? isBlockFullyResolved(nextExistingLine, coringaCode) : false;
      const thirdFullyResolved = thirdExistingLine ? isBlockFullyResolved(thirdExistingLine, coringaCode) : false;

      // Heal stale locks persisted from previous cycles/sessions
      if (currentLocked && !currentFullyResolved) {
        builtBlocksRef.current.delete(currentTimeKey);
        currentLocked = false;
        console.log(`[AUTO-GRADE] 🔓 Lock antigo removido de ${currentTimeKey} (bloco ainda incompleto)`);
      }
      if (nextLocked && !nextFullyResolved) {
        builtBlocksRef.current.delete(nextTimeKey);
        nextLocked = false;
        console.log(`[AUTO-GRADE] 🔓 Lock antigo removido de ${nextTimeKey} (bloco ainda incompleto)`);
      }
      if (thirdLocked && !thirdFullyResolved) {
        builtBlocksRef.current.delete(thirdTimeKey);
        thirdLocked = false;
        console.log(`[AUTO-GRADE] 🔓 Lock antigo removido de ${thirdTimeKey} (bloco ainda incompleto)`);
      }

      // Blocks covered by scheduled sequences should NOT be locked — they must always rebuild
      if (currentFullyResolved && !forceRegenerate && !currentCoveredBySchedule) {
        builtBlocksRef.current.add(currentTimeKey);
        console.log(`[AUTO-GRADE] 🔒 Bloco ${currentTimeKey} COMPLETO (todas as músicas resolvidas) — travado`);
      }
      if (nextFullyResolved && !forceRegenerate && !nextCoveredBySchedule) {
        builtBlocksRef.current.add(nextTimeKey);
        console.log(`[AUTO-GRADE] 🔒 Bloco ${nextTimeKey} COMPLETO (todas as músicas resolvidas) — travado`);
      }
      if (thirdFullyResolved && !forceRegenerate && !thirdCoveredBySchedule) {
        builtBlocksRef.current.add(thirdTimeKey);
        console.log(`[AUTO-GRADE] 🔒 Bloco ${thirdTimeKey} COMPLETO (todas as músicas resolvidas) — travado`);
      }

      // Detect legacy weekday lines that should never persist on Saturday
      const hasSaturdayMismatch = (line?: string | null) => {
        if (targetDay !== 'sab' || !line) return false;
        return /(VOZ[_\s]?BRASIL|\(ID=TOP10\)|\(ID=TOP50\)|\(ID=MISTURADAO\)|\(ID=ROMANCE\)|\bROMANCE\b|HAPPY\s*HOUR)/i.test(line);
      };

      // Detect weekday-only program lines that should NEVER persist on Sunday
      const hasSundayMismatch = (line?: string | null) => {
        if (targetDay !== 'dom' || !line) return false;
        return /(VOZ[_\s]?BRASIL|\(ID=TOP10\)|\(ID=TOP50\)|\(ID=MISTURADAO\)|\(ID=ROMANCE\)|\(ID=ROCK\s*METAL\)|\(ID=RARIDADES\)|\bROMANCE\b|HAPPY\s*HOUR|SERTANEJO)/i.test(line);
      };

      const currentSaturdayMismatch = hasSaturdayMismatch(currentExistingLine);
      const nextSaturdayMismatch = hasSaturdayMismatch(nextExistingLine);
      const thirdSaturdayMismatch = hasSaturdayMismatch(thirdExistingLine);
      const currentSundayMismatch = hasSundayMismatch(currentExistingLine);
      const nextSundayMismatch = hasSundayMismatch(nextExistingLine);
      const thirdSundayMismatch = hasSundayMismatch(thirdExistingLine);

      // === 3-BLOCK LOOKAHEAD COM LOCK PROGRESSIVO ===
      // Bloco ATUAL: sempre travado (locked) assim que totalmente resolvido — já está tocando/prestes a tocar.
      // Blocos NEXT e THIRD: construídos imediatamente, mas continuam sendo atualizados com dados
      // frescos do monitoramento até faltarem 10 minutos para o horário — quando travam definitivamente.
      const now = new Date();
      const nowTotalMin = now.getHours() * 60 + now.getMinutes();
      const minutesUntil = (blockHour: number, blockMinute: number): number => {
        let diff = (blockHour * 60 + blockMinute) - nowTotalMin;
        if (diff < 0) diff += 1440; // past midnight wrap
        return diff;
      };
      const maxLeadMinutes = DEFAULT_MINUTES_BEFORE_BLOCK; // 10 min

      // Next/Third: se faltam <= 10 min, travar; caso contrário, permitir atualização contínua
      const nextMinutesAway = minutesUntil(blocks.next.hour, blocks.next.minute);
      const thirdMinutesAway = minutesUntil(blocks.third.hour, blocks.third.minute);
      const nextShouldLock = nextMinutesAway <= maxLeadMinutes;
      const thirdShouldLock = thirdMinutesAway <= maxLeadMinutes;

      // Bloco atual: locked se resolvido (comportamento padrão — não desbloqueia para refresh)
      // Next/Third: se ainda fora da janela de 10 min, DESBLOQUEIA para permitir atualização contínua
      if (!nextShouldLock && nextFullyResolved && !forceRegenerate && !nextCoveredBySchedule) {
        builtBlocksRef.current.delete(nextTimeKey);
        nextLocked = false;
        console.log(`[AUTO-GRADE] 🔄 Bloco ${nextTimeKey} desbloqueado para atualização (${nextMinutesAway} min restantes)`);
      }
      if (!thirdShouldLock && thirdFullyResolved && !forceRegenerate && !thirdCoveredBySchedule) {
        builtBlocksRef.current.delete(thirdTimeKey);
        thirdLocked = false;
        console.log(`[AUTO-GRADE] 🔄 Bloco ${thirdTimeKey} desbloqueado para atualização (${thirdMinutesAway} min restantes)`);
      }

      // Fully resolved blocks: LOCK rules
      const shouldBuildCurrent = forceRegenerate || currentCoveredBySchedule
        ? true
        : (!currentLocked && !currentFullyResolved) || currentSaturdayMismatch || currentSundayMismatch;
      const shouldBuildNext = forceRegenerate || nextCoveredBySchedule
        ? true
        : nextShouldLock
          ? ((!nextLocked && !nextFullyResolved) || nextSaturdayMismatch || nextSundayMismatch)  // dentro dos 10 min — só build se incompleto
          : true;  // fora dos 10 min — sempre rebuild para incorporar dados frescos
      const shouldBuildThird = forceRegenerate || thirdCoveredBySchedule
        ? true
        : thirdShouldLock
          ? ((!thirdLocked && !thirdFullyResolved) || thirdSaturdayMismatch || thirdSundayMismatch)
          : true;

      console.log(`[AUTO-GRADE] 🔮 Lookahead: ${currentTimeKey} (${shouldBuildCurrent ? 'BUILD' : '🔒LOCKED'}), ${nextTimeKey} (${shouldBuildNext ? nextShouldLock ? 'BUILD-FINAL' : '🔄UPDATE' : '🔒LOCKED'} ${nextMinutesAway}min), ${thirdTimeKey} (${shouldBuildThird ? thirdShouldLock ? 'BUILD-FINAL' : '🔄UPDATE' : '🔒LOCKED'} ${thirdMinutesAway}min)`);

      if (!shouldBuildCurrent && !shouldBuildNext && !shouldBuildThird) {
        console.log(`[AUTO-GRADE] ⏭️ Blocos ${currentTimeKey}, ${nextTimeKey} e ${thirdTimeKey} já resolvidos, pulando`);
        if (currentFullyResolved) builtBlocksRef.current.add(currentTimeKey);
        else builtBlocksRef.current.delete(currentTimeKey);
        if (nextFullyResolved) builtBlocksRef.current.add(nextTimeKey);
        else builtBlocksRef.current.delete(nextTimeKey);
        if (thirdFullyResolved) builtBlocksRef.current.add(thirdTimeKey);
        else builtBlocksRef.current.delete(thirdTimeKey);
        setState(prev => ({
          ...prev,
          isBuilding: false,
          lastBuildTime: new Date(),
          currentBlock: currentTimeKey,
          nextBlock: nextTimeKey,
          pendingGradeLines: new Map(lineMap),
          pendingStationMap: { ...prev.pendingStationMap },
        }));
        return;
      }

      setState(prev => ({ ...prev, isBuilding: true, error: null }));

      // ═══ PRE-POPULATE used songs from existing grade lines ═══
      // This prevents the builder from selecting songs that are already
      // in other blocks (manually placed or previously generated).
      let prePopulatedCount = 0;
      for (const [timeKey, line] of lineMap.entries()) {
        // Skip the blocks we're about to regenerate
        if ((shouldBuildCurrent && timeKey === currentTimeKey) || (shouldBuildNext && timeKey === nextTimeKey) || (shouldBuildThird && timeKey === thirdTimeKey)) continue;
        // Extract quoted filenames like "ARTIST - TITLE.MP3"
        const quotedTokens = line.match(/"([^"]+)"/g);
        if (!quotedTokens) continue;
        for (const token of quotedTokens) {
          const clean = token.replace(/^"|"$/g, '').replace(/\.mp3$/i, '');
          const dashIdx = clean.indexOf(' - ');
          if (dashIdx > 0) {
            const artist = clean.substring(0, dashIdx).trim();
            const title = clean.substring(dashIdx + 3).trim();
            if (artist && title) {
              markSongAsUsed(title, artist, timeKey);
              prePopulatedCount++;
            }
          }
        }
      }
      if (prePopulatedCount > 0) {
        console.log(`[AUTO-GRADE] 🛡️ Pré-registradas ${prePopulatedCount} músicas existentes para anti-duplicação`);
      }

      const stats: BlockStats = { skipped: 0, substituted: 0, missing: 0 };
      const allLogs: BlockLogItem[] = [];

      // Always use the FULL song pool from monitoring (scraped_songs + radio_historico)
      // A narrow 1h window misses songs captured earlier, causing unnecessary Coringas
      reportServiceHeartbeat('grade-builder');
      await loadBpmCacheFromDisk();
      const fullPool = await fetchAllRecentSongs();
      // Enrich all song pools with cached BPM data
      for (const songs of Object.values(fullPool)) {
        enrichSongsWithBpmCache(songs as any[]);
      }

      const durationMap = new Map(state.pendingBlockDurations);
      if (shouldBuildCurrent) {
        const currentResult = await generateBlockLine(blocks.current.hour, blocks.current.minute, fullPool, stats, false, targetDay);
        const resolvedCurrentLine = await resolveVinhetasInLine(currentResult.line, config.vinhetasFolder || 'C:\\Playlist\\Vinhetas');
        const forceReplaceCurrent = forceRegenerate || currentSaturdayMismatch || currentSundayMismatch || currentCoveredBySchedule;
        const mergedCurrentLine = currentExistingLine && !forceReplaceCurrent
          ? mergeGradeLinePreservingResolved(currentExistingLine, resolvedCurrentLine, coringaCode)
          : resolvedCurrentLine;
        lineMap.set(currentTimeKey, mergedCurrentLine);
        if (currentResult.durationMinutes) durationMap.set(currentTimeKey, currentResult.durationMinutes);
        allLogs.push(...currentResult.logs);

        const currentResolvedAfterBuild = isBlockFullyResolved(mergedCurrentLine, coringaCode);
        if (currentResolvedAfterBuild && !currentCoveredBySchedule) {
          builtBlocksRef.current.add(currentTimeKey);
          console.log(`[AUTO-GRADE] 🔒 Bloco ${currentTimeKey} COMPLETO após atualização — travado`);
        } else {
          builtBlocksRef.current.delete(currentTimeKey);
          console.log(`[AUTO-GRADE] 🔄 Bloco ${currentTimeKey} ${currentCoveredBySchedule ? '(seq. agendada - sem lock)' : 'ainda incompleto'}`);
        }
      }

      if (shouldBuildNext) {
        const nextResult = await generateBlockLine(blocks.next.hour, blocks.next.minute, fullPool, stats, false, targetDay);
        const resolvedNextLine = await resolveVinhetasInLine(nextResult.line, config.vinhetasFolder || 'C:\\Playlist\\Vinhetas');
        const forceReplaceNext = forceRegenerate || nextSaturdayMismatch || nextSundayMismatch || nextCoveredBySchedule;
        const mergedNextLine = nextExistingLine && !forceReplaceNext
          ? mergeGradeLinePreservingResolved(nextExistingLine, resolvedNextLine, coringaCode)
          : resolvedNextLine;
        lineMap.set(nextTimeKey, mergedNextLine);
        if (nextResult.durationMinutes) durationMap.set(nextTimeKey, nextResult.durationMinutes);
        allLogs.push(...nextResult.logs);

        const nextResolvedAfterBuild = isBlockFullyResolved(mergedNextLine, coringaCode);
        if (nextResolvedAfterBuild && !nextCoveredBySchedule) {
          builtBlocksRef.current.add(nextTimeKey);
          console.log(`[AUTO-GRADE] 🔒 Bloco ${nextTimeKey} COMPLETO após atualização — travado`);
        } else {
          builtBlocksRef.current.delete(nextTimeKey);
          console.log(`[AUTO-GRADE] 🔄 Bloco ${nextTimeKey} ${nextCoveredBySchedule ? '(seq. agendada - sem lock)' : 'ainda incompleto'}`);
        }
      }

      if (shouldBuildThird) {
        const thirdResult = await generateBlockLine(blocks.third.hour, blocks.third.minute, fullPool, stats, false, targetDay);
        const resolvedThirdLine = await resolveVinhetasInLine(thirdResult.line, config.vinhetasFolder || 'C:\\Playlist\\Vinhetas');
        const forceReplaceThird = forceRegenerate || thirdSaturdayMismatch || thirdSundayMismatch || thirdCoveredBySchedule;
        const mergedThirdLine = thirdExistingLine && !forceReplaceThird
          ? mergeGradeLinePreservingResolved(thirdExistingLine, resolvedThirdLine, coringaCode)
          : resolvedThirdLine;
        lineMap.set(thirdTimeKey, mergedThirdLine);
        if (thirdResult.durationMinutes) durationMap.set(thirdTimeKey, thirdResult.durationMinutes);
        allLogs.push(...thirdResult.logs);

        const thirdResolvedAfterBuild = isBlockFullyResolved(mergedThirdLine, coringaCode);
        if (thirdResolvedAfterBuild && !thirdCoveredBySchedule) {
          builtBlocksRef.current.add(thirdTimeKey);
          console.log(`[AUTO-GRADE] 🔒 Bloco ${thirdTimeKey} COMPLETO após atualização — travado`);
        } else {
          builtBlocksRef.current.delete(thirdTimeKey);
          console.log(`[AUTO-GRADE] 🔄 Bloco ${thirdTimeKey} ${thirdCoveredBySchedule ? '(seq. agendada - sem lock)' : 'ainda incompleto'}`);
        }
      }

      if (allLogs.length > 0) {
        addBlockLogs(allLogs);
        
        // Feed ranking TOP25 from songs actually used in the grade
        const usedSongs = allLogs.filter(log => log.type === 'used');
        if (usedSongs.length > 0) {
          const { applyRankingBatch } = useRadioStore.getState();
          const rankingUpdates = usedSongs.map(log => ({
            title: log.title,
            artist: log.artist,
            style: log.style || 'POP/VARIADO',
            count: 1,
          }));
          applyRankingBatch(rankingUpdates);
          console.log(`[AUTO-GRADE] 📊 Ranking atualizado: ${usedSongs.length} músicas da grade`);
        }
      }

      // Store in memory buffer
      pendingGradeRef.current = { lineMap, filename, blockKey: thirdTimeKey };

      // Persist to localStorage for refresh survival
      saveGradeToStorage(lineMap, builtBlocksRef.current, dayCode);

      // Update state for UI preview (silent - no file write)
      setState(prev => ({
        ...prev, isBuilding: false, lastBuildTime: new Date(),
        currentBlock: currentTimeKey, nextBlock: nextTimeKey,
        blocksGenerated: prev.blocksGenerated + (shouldBuildCurrent ? 1 : 0) + (shouldBuildNext ? 1 : 0) + (shouldBuildThird ? 1 : 0),
        skippedSongs: stats.skipped, substitutedSongs: stats.substituted, missingSongs: stats.missing,
        pendingGradeLines: new Map(lineMap),
        pendingBlockDurations: new Map(durationMap),
        pendingStationMap: { ...prev.pendingStationMap, ...buildStationMapFromLogs(allLogs) },
      }));

      console.log(`[AUTO-GRADE] 📋 Grade montada em memória e persistida${isWebOnly ? ' (modo web - preview only)' : ' (aguardando janela de 10min para escrita)'}`);

      // Only write to disk if forceWrite is true and in Electron mode
      if (forceWrite && !isWebOnly) {
        await flushGradeToDisk();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logSystemError('GRADE', 'error', 'Erro ao atualizar grade', errorMessage);
      setState(prev => ({ ...prev, isBuilding: false, error: errorMessage }));
    }
  }, [
    getBlockTimes, fetchSongsForBlock, fetchAllRecentSongs, generateBlockLine,
    getDayCode, config.gradeFolder, addBlockLogs,
  ]);

  // ==================== Flush to Disk (only at 10min before block) ====================

  const flushGradeToDisk = useCallback(async () => {
    const pending = pendingGradeRef.current;
    if (!pending || !getIsElectronEnv() || !window.electronAPI?.saveGradeFile) {
      console.log('[AUTO-GRADE] Nada pendente para escrita');
      return;
    }

    try {
      // Remove 21:30 from weekday grades (Voz do Brasil occupies 21:00-22:00)
      const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
      const currentDay = dayMap[new Date().getDay()];
      const isWeekdayNow = isWeekday(currentDay);
      
      const sortedContent = Array.from(pending.lineMap.keys())
        .filter(t => !(isWeekdayNow && t === '21:30'))
        .sort()
        .map(t => pending.lineMap.get(t))
        .join('\n');
      await renameFilesInGradeContent(sortedContent);

      const result = await window.electronAPI.saveGradeFile({
        folder: config.gradeFolder,
        filename: pending.filename,
        content: sortedContent,
      });

      if (result.success) {
        console.log(`[AUTO-GRADE] ✅ Grade escrita no disco: ${result.filePath}`);
        addGradeHistory({
          id: `grade-${Date.now()}`, timestamp: new Date(), blockTime: pending.blockKey,
          songsProcessed: defaultSequence.length * 2,
          songsFound: pending.lineMap.size,
          songsMissing: 0, programName: getProgramForHour(parseInt(pending.blockKey)),
        });
        setState(prev => ({ ...prev, lastSavedFile: pending.filename }));
        toast({ title: '✅ Grade Atualizada', description: `${pending.filename} escrito 10 min antes do bloco ${pending.blockKey}` });
      } else {
        throw new Error(result.error || 'Erro ao salvar');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logSystemError('GRADE', 'error', 'Erro ao escrever grade no disco', errorMessage);
      toast({ title: '❌ Erro na escrita', description: errorMessage, variant: 'destructive' });
    }
  }, [renameFilesInGradeContent, config.gradeFolder, addGradeHistory, defaultSequence.length, getProgramForHour, toast]);

  // ==================== Timer & Auto Build ====================

  const getSecondsUntilNextBuild = useCallback(() => {
    const now = new Date();
    const minutesBefore = state.minutesBeforeBlock;
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();
    const buildAt1 = 30 - minutesBefore;
    const buildAt2 = 60 - minutesBefore;
    let targetMinute: number;
    if (currentMinute < buildAt1) targetMinute = buildAt1;
    else if (currentMinute < 30) targetMinute = buildAt2;
    else if (currentMinute < buildAt2) targetMinute = buildAt2;
    else targetMinute = buildAt1 + 60;
    return Math.max(0, ((targetMinute - currentMinute) * 60) - currentSecond);
  }, [state.minutesBeforeBlock]);

  const toggleAutoGeneration = useCallback(() => {
    setState(prev => ({ ...prev, isAutoEnabled: !prev.isAutoEnabled }));
  }, []);

  const setMinutesBeforeBlock = useCallback((minutes: number) => {
    setState(prev => ({ ...prev, minutesBeforeBlock: Math.max(1, Math.min(10, minutes)) }));
  }, []);

  // === REALTIME-TRIGGERED GRADE GENERATION ===
  // Builds immediately when new scraped songs arrive via Supabase realtime.
  // Once a block is fully resolved (all songs + correct duration), it locks permanently for that cycle.
  // A safety polling interval (every 2 min) catches any missed realtime events.
  // Disk write still happens only within the configured minutesBeforeBlock window.

  const realtimeBuildRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRealtimeBlockRef = useRef<string>('');
  const lastWrittenContentHashRef = useRef<string>('');
  const realtimeTickInProgressRef = useRef(false);
  /** Timestamp when the current tick started — used to detect stale/hung builds */
  const tickStartedAtRef = useRef<number>(0);
  /** Maximum time (ms) a single tick is allowed to run before the lock is force-released */
  const TICK_TIMEOUT_MS = 90_000; // 90 seconds

  const getUpcomingBlockInfo = useCallback(() => {
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentHour = now.getHours();
    let targetBlockHour = currentHour;
    let targetBlockMinute = 0;
    if (currentMinute < 30) targetBlockMinute = 30;
    else { targetBlockHour = (currentHour + 1) % 24; targetBlockMinute = 0; }
    const minutesUntilBlock = currentMinute < 30 ? 30 - currentMinute : 60 - currentMinute;
    const blockKey = `${targetBlockHour.toString().padStart(2, '0')}:${targetBlockMinute.toString().padStart(2, '0')}`;
    return { blockKey, minutesUntilBlock };
  }, []);

  // Core tick: build grade + write if in window
  const runGradeTick = useCallback(async (reason: string) => {
    // Safety: force-release stale lock if previous tick exceeded timeout
    if (realtimeTickInProgressRef.current) {
      const elapsed = Date.now() - tickStartedAtRef.current;
      if (elapsed > TICK_TIMEOUT_MS) {
        console.warn(`[AUTO-GRADE] ⚠️ Tick anterior travado há ${Math.round(elapsed / 1000)}s — forçando desbloqueio`);
        realtimeTickInProgressRef.current = false;
      } else {
        return;
      }
    }
    realtimeTickInProgressRef.current = true;
    tickStartedAtRef.current = Date.now();
    try {
      const isWebOnly = !getIsElectronEnv();
      const { isRunning } = useRadioStore.getState();
      if (!isRunning && !isWebOnly) return;

      const { blockKey, minutesUntilBlock } = getUpcomingBlockInfo();

      // === 22:00+ trigger: pre-generate next day's grade ===
      const currentHour = new Date().getHours();
      if (currentHour >= 22 && !isWebOnly) {
        void buildNextDayGradeRef.current();
      }

      // New cycle detection — unlock next block
      if (lastRealtimeBlockRef.current !== blockKey) {
        console.log(`[AUTO-GRADE] 🔓 Ciclo ${lastRealtimeBlockRef.current || 'inicial'} → ${blockKey} (${reason})`);
        builtBlocksRef.current.delete(blockKey);
        lastRealtimeBlockRef.current = blockKey;
        lastWrittenContentHashRef.current = ''; // Reset hash for new cycle
      }

      // Always run tick build; per-block lock/completeness is decided inside buildGrade
      console.log(`[AUTO-GRADE] ⚡ Tick realtime para bloco ${blockKey} (${reason})`);
      await buildGrade(false, false);

      // Disk write within the configured window — re-write whenever content changes
      const shouldWrite = !isWebOnly && minutesUntilBlock <= state.minutesBeforeBlock;
      if (shouldWrite && pendingGradeRef.current) {
        // Compute a simple hash of the current lineMap content to detect changes
        const currentContent = Array.from(pendingGradeRef.current.lineMap.keys())
          .sort()
          .map(t => pendingGradeRef.current!.lineMap.get(t))
          .join('\n');
        const contentHash = currentContent.length + ':' + currentContent.slice(0, 200) + currentContent.slice(-200);
        
        if (contentHash !== lastWrittenContentHashRef.current) {
          console.log(`[AUTO-GRADE] 📝 Conteúdo da grade mudou — re-escrevendo no disco para bloco ${blockKey} (${minutesUntilBlock} min antes)`);
          await flushGradeToDisk();
          lastWrittenContentHashRef.current = contentHash;
        }
      }
    } finally {
      realtimeTickInProgressRef.current = false;
    }
  }, [getUpcomingBlockInfo, buildGrade, flushGradeToDisk, state.minutesBeforeBlock]);

  // Use refs for stable callback references in the realtime effect
  // This prevents re-subscribing to the channel every time buildGrade deps change
  const runGradeTickRef = useRef(runGradeTick);
  runGradeTickRef.current = runGradeTick;

  // Debounced trigger for realtime events (avoid building 10x in 1 second)
  const debouncedRealtimeBuild = useCallback(() => {
    if (realtimeBuildRef.current) clearTimeout(realtimeBuildRef.current);
    realtimeBuildRef.current = setTimeout(() => {
      void runGradeTickRef.current('realtime-event');
    }, 3000); // 3s debounce — batches rapid inserts
  }, []); // stable — uses ref

  // Realtime subscription: triggers build on new scraped_songs
  // IMPORTANT: deps are minimal to prevent channel re-subscription loops.
  // Callback changes are handled via refs above.
  const isAutoEnabledRef = useRef(state.isAutoEnabled);
  isAutoEnabledRef.current = state.isAutoEnabled;

  useEffect(() => {
    if (!state.isAutoEnabled) return;

    console.log('[AUTO-GRADE] 📡 Realtime grade builder ATIVO — monta assim que novos dados chegam');

    // Subscribe to scraped_songs inserts
    const channel = supabase
      .channel('grade-realtime-trigger')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scraped_songs' },
        (payload) => {
          const song = payload.new as { artist?: string; station_name?: string };
          console.log(`[AUTO-GRADE] 📡 Nova captura: ${song.artist || '?'} (${song.station_name || '?'}) — disparando montagem`);
          debouncedRealtimeBuild();
        }
      )
      .subscribe((status) => {
        console.log(`[AUTO-GRADE] 📡 Realtime status: ${status}`);
        // If channel drops, force a polling build immediately
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[AUTO-GRADE] ⚠️ Canal realtime ${status} — acionando build via polling`);
          void runGradeTickRef.current('realtime-recovery');
        }
      });

    // Safety polling fallback: every 60s, synced with 6-min monitor cycle
    const pollingInterval = setInterval(() => {
      console.log('[AUTO-GRADE] 🔄 Polling fallback tick (60s)');
      void runGradeTickRef.current('polling-fallback');
    }, 60 * 1000);

    // Initial build immediately
    const { isRunning } = useRadioStore.getState();
    const isWebOnly = !getIsElectronEnv();
    if (isRunning || isWebOnly) {
      console.log('[AUTO-GRADE] 🚀 Build inicial imediato');
      void runGradeTickRef.current('initial');
    }

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollingInterval);
      if (realtimeBuildRef.current) clearTimeout(realtimeBuildRef.current);
    };
  }, [state.isAutoEnabled, debouncedRealtimeBuild]); // minimal deps — no more loop

  // Countdown update effect
  useEffect(() => {
    const update = () => {
      const blocks = getBlockTimes();
      setState(prev => ({
        ...prev,
        currentBlock: `${blocks.current.hour.toString().padStart(2, '0')}:${blocks.current.minute.toString().padStart(2, '0')}`,
        nextBlock: `${blocks.next.hour.toString().padStart(2, '0')}:${blocks.next.minute.toString().padStart(2, '0')}`,
        nextBuildIn: getSecondsUntilNextBuild(),
      }));
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [getBlockTimes, getSecondsUntilNextBuild]);

  return {
    ...state,
    buildGrade,
    buildFullDayGrade,
    toggleAutoGeneration,
    setMinutesBeforeBlock,
    clearUsedSongs,
    isElectron: getIsElectronEnv(),
  };
}
