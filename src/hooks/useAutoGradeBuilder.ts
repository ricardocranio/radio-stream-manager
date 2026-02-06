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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { WeekDay, ScheduledSequence, SequenceConfig } from '@/types/radio';

// Import from refactored modules
import {
  STATION_ID_TO_DB_NAME,
  DAY_CODE_MAP, FULL_DAY_NAME_MAP,
  DAY_CODES_BY_INDEX, FULL_DAY_NAMES_BY_INDEX, WEEKDAY_KEYS,
  ARTIST_REPETITION_MINUTES, DEFAULT_MINUTES_BEFORE_BLOCK,
  isElectronEnv,
} from '@/lib/gradeBuilder/constants';
import { sanitizeGradeFilename, sanitizeGradeLine, createLineSanitizer } from '@/lib/gradeBuilder/sanitize';
import {
  generateVozDoBrasil, generateMisturadao,
  generateTop50Block, generateMadrugada, generateSertanejoNossa,
} from '@/lib/gradeBuilder/specialPrograms';
import { selectSongForSlot, handleSpecialSequenceType } from '@/lib/gradeBuilder/songSelection';
import { batchFindSongsInLibrary, findSongInLibrary as findSongInLibraryFn } from '@/lib/gradeBuilder/batchLibrary';
import type {
  SongEntry, UsedSong, CarryOverSong, BlockStats, BlockLogItem, BlockResult, GradeContext,
} from '@/lib/gradeBuilder/types';

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

  const [state, setState] = useState<AutoGradeState>({
    isBuilding: false, lastBuildTime: null,
    currentBlock: '--:--', nextBlock: '--:--',
    lastSavedFile: null, error: null, blocksGenerated: 0,
    isAutoEnabled: true, nextBuildIn: 0,
    minutesBeforeBlock: DEFAULT_MINUTES_BEFORE_BLOCK,
    fullDayProgress: 0, fullDayTotal: 0,
    skippedSongs: 0, substitutedSongs: 0, missingSongs: 0,
    currentProcessingSong: null, currentProcessingBlock: null, lastSaveProgress: 0,
  });

  const lastBuildRef = useRef<string | null>(null);
  const buildIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const usedSongsRef = useRef<UsedSong[]>([]);
  const carryOverSongsRef = useRef<CarryOverSong[]>([]);
  /** Tracks which block time keys (e.g. "18:00") have already been assembled and locked */
  const builtBlocksRef = useRef<Set<string>>(new Set());

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

  const getFixedContentForTime = useCallback((hour: number, minute: number) => {
    const dayOfWeek = new Date().getDay();
    const isWeekdayNow = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isWeekendNow = dayOfWeek === 0 || dayOfWeek === 6;
    return fixedContent.filter(fc => {
      if (!fc.enabled) return false;
      if (fc.dayPattern === 'WEEKDAYS' && !isWeekdayNow) return false;
      if (fc.dayPattern === 'WEEKEND' && !isWeekendNow) return false;
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

  // ==================== Song Tracking ====================

  const isRecentlyUsed = useCallback((title: string, artist: string, currentBlockTime: string, isFullDay: boolean = false): boolean => {
    const artistRepMinutes = isFullDay ? 30 : (config.artistRepetitionMinutes || ARTIST_REPETITION_MINUTES);
    const normalizedTitle = title.toLowerCase().trim();
    const normalizedArtist = artist.toLowerCase().trim();
    const [currentHour, currentMinute] = currentBlockTime.split(':').map(Number);
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    for (const used of usedSongsRef.current) {
      const [usedHour, usedMinute] = used.blockTime.split(':').map(Number);
      const usedTotalMinutes = usedHour * 60 + usedMinute;
      let diffMinutes = currentTotalMinutes - usedTotalMinutes;
      if (diffMinutes < 0) diffMinutes += 24 * 60;
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
    if (usedSongsRef.current.length > 100) usedSongsRef.current = usedSongsRef.current.slice(-100);
  }, []);

  const clearUsedSongs = useCallback(() => {
    usedSongsRef.current = [];
    carryOverSongsRef.current = [];
    builtBlocksRef.current.clear();
  }, []);

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

  const findSongInLibrary = useCallback(async (artist: string, title: string) => {
    return findSongInLibraryFn(artist, title, config.musicFolders);
  }, [config.musicFolders]);

  const batchFind = useCallback(async (songs: Array<{ artist: string; title: string }>) => {
    return batchFindSongsInLibrary(songs, config.musicFolders);
  }, [config.musicFolders]);

  const isSongAlreadyMissing = useCallback((artist: string, title: string): boolean => {
    return existingMissingSongs.some(
      s => s.artist.toLowerCase() === artist.toLowerCase() && s.title.toLowerCase() === title.toLowerCase()
    );
  }, [existingMissingSongs]);

  // ==================== File Operations ====================

  const renameFilesInGradeContent = useCallback(async (gradeContent: string): Promise<void> => {
    if (!isElectronEnv || !window.electronAPI?.renameMusicFile) return;
    const filenameMatches = gradeContent.match(/"([^"]+\.(?:mp3|MP3))"/g);
    if (!filenameMatches) return;
    const uniqueFilenames = new Set<string>();
    filenameMatches.forEach(match => uniqueFilenames.add(match.slice(1, -1)));
    for (const sanitizedName of uniqueFilenames) {
      if (/^[A-Z0-9_]+\.MP3$/.test(sanitizedName)) continue;
      if (['mus', 'rom', 'clas'].includes(sanitizedName.toLowerCase())) continue;
      try {
        await window.electronAPI.renameMusicFile({ musicFolders: config.musicFolders, currentFilename: sanitizedName, newFilename: sanitizedName });
      } catch (err) {
        console.warn(`[RENAME] Warning: Could not process "${sanitizedName}":`, err);
      }
    }
  }, [config.musicFolders]);

  const processFixedContentFilename = useCallback((fileName: string, hour: number, minute: number, editionIndex: number, targetDay?: WeekDay): string => {
    const fullDayName = getFullDayName(targetDay);
    const hourStr = hour.toString().padStart(2, '0');
    const edition = (editionIndex + 1).toString().padStart(2, '0');
    let result = fileName
      .replace(/\{HH\}/gi, hourStr)
      .replace(/\{DIA\}/gi, fullDayName)
      .replace(/\{DD\}/gi, fullDayName)
      .replace(/\{ED\}/gi, edition);
    const hasFullDayName = FULL_DAY_NAMES_BY_INDEX.some(day => result.toUpperCase().includes(`_${day}`));
    if (!result.toLowerCase().includes('_{dia}') && !result.toLowerCase().includes('_{dd}') && !hasFullDayName) {
      if (result.toLowerCase().endsWith('.mp3')) {
        result = result.slice(0, -4) + `_${fullDayName}.mp3`;
      } else {
        result = result + `_${fullDayName}`;
      }
    } else {
      result = result.replace(/\{DIA\}/gi, fullDayName).replace(/\{DD\}/gi, fullDayName);
    }
    return processFixedContentTemplate(result, hour, fullDayName);
  }, [getFullDayName]);

  // ==================== Build GradeContext ====================

  const buildGradeContext = useCallback((): GradeContext => {
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
    try {
      const baseDate = targetDate || new Date();
      const blockTime = new Date(baseDate);
      blockTime.setHours(blockHour, blockMinute, 0, 0);
      const windowEnd = blockTime.toISOString();
      const windowStart = new Date(blockTime.getTime() - 30 * 60 * 1000).toISOString();
      console.log(`[AUTO-GRADE] 🕐 Buscando músicas para bloco ${blockHour.toString().padStart(2, '0')}:${blockMinute.toString().padStart(2, '0')}`);

      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .gte('scraped_at', windowStart)
        .lte('scraped_at', windowEnd)
        .order('scraped_at', { ascending: false })
        .limit(500);
      if (error) throw error;

      return buildSongsByStation(data || []);
    } catch (error) {
      console.error('[AUTO-GRADE] Error fetching songs for block:', error);
      logSystemError('GRADE', 'error', 'Erro ao buscar músicas do Supabase', String(error));
      return {};
    }
  }, [stations]);

  const fetchAllRecentSongs = useCallback(async (): Promise<Record<string, SongEntry[]>> => {
    try {
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .order('scraped_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      return buildSongsByStation(data || [], 150);
    } catch (error) {
      console.error('[AUTO-GRADE] Error fetching all songs:', error);
      logSystemError('GRADE', 'error', 'Erro ao buscar músicas do Supabase', String(error));
      return {};
    }
  }, [stations]);

  // Helper to build songsByStation from raw data
  const buildSongsByStation = useCallback((data: Array<{ title: string; artist: string; station_name: string; scraped_at: string }>, maxPerStation = 50): Record<string, SongEntry[]> => {
    const songsByStation: Record<string, SongEntry[]> = {};
    const stationNameToStyle: Record<string, string> = {};
    const seenSongs = new Set<string>();
    stations.forEach(s => {
      stationNameToStyle[s.name] = s.styles?.[0] || 'POP/VARIADO';
      stationNameToStyle[s.name.toLowerCase()] = s.styles?.[0] || 'POP/VARIADO';
      stationNameToStyle[s.id] = s.styles?.[0] || 'POP/VARIADO';
    });
    data.forEach(song => {
      const songKey = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
      if (seenSongs.has(songKey)) return;
      seenSongs.add(songKey);
      if (!songsByStation[song.station_name]) songsByStation[song.station_name] = [];
      if (songsByStation[song.station_name].length < maxPerStation) {
        const style = stationNameToStyle[song.station_name] || stationNameToStyle[song.station_name.toLowerCase()] || 'POP/VARIADO';
        songsByStation[song.station_name].push({
          title: song.title, artist: song.artist, station: song.station_name,
          style, filename: sanitizeFilename(`${song.artist} - ${song.title}.mp3`),
          scrapedAt: song.scraped_at, // Preserve for freshness sorting
        });
      }
    });
    const stationList = Object.keys(songsByStation).map(name => `${name}(${songsByStation[name].length})`).join(', ');
    console.log(`[AUTO-GRADE] Pool: ${stationList}`);
    return songsByStation;
  }, [stations]);

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
    const fixedItems = getFixedContentForTime(hour, minute);
    const ctx = buildGradeContext();

    // === Special Programs ===

    // Voz do Brasil (21:00 weekdays)
    if (hour === 21 && minute === 0 && isWeekday(targetDay)) {
      return generateVozDoBrasil(timeStr);
    }

    // Misturadão (20:00, 20:30 weekdays)
    if ((hour === 20 && (minute === 0 || minute === 30)) && isWeekday(targetDay)) {
      return generateMisturadao(hour, minute, ctx, targetDay);
    }

    // TOP50 blocks
    const top50Item = fixedItems.find(fc => fc.type === 'top50');
    if (top50Item) {
      return generateTop50Block(hour, minute, top50Item.top50Count || 10, ctx);
    }

    // Madrugada (00:00-04:30)
    if (hour >= 0 && hour <= 5) {
      // Hour 5 is Sertanejo Nossa, check below
      if (hour <= 4 || (hour === 5 && minute === 0 && !(hour >= 5 && hour <= 7))) {
        // Actually hours 0-4 only for madrugada
      }
    }
    if (hour >= 0 && hour <= 4) {
      return generateMadrugada(hour, minute, songsByStation, stats, isFullDay, ctx, programName);
    }

    // Sertanejo Nossa (05:00-07:30)
    if (hour >= 5 && hour <= 7) {
      return generateSertanejoNossa(hour, minute, songsByStation, stats, isFullDay, ctx);
    }

    // === Normal Block Logic ===

    const blockLogs: BlockLogItem[] = [];

    // Fixed content handling
    const fixedItem = fixedItems.find(fc => fc.type !== 'top50' && fc.type !== 'vozbrasil');
    let fixedContentFile: string | null = null;
    let fixedPosition: 'start' | 'middle' | 'end' | number = 'start';

    if (fixedItem) {
      const processedFileName = processFixedContentFilename(fixedItem.fileName, hour, minute, 0, targetDay);
      const finalFileName = processedFileName.toLowerCase().endsWith('.mp3') ? processedFileName : `${processedFileName}.mp3`;
      fixedContentFile = `"${finalFileName}"`;
      fixedPosition = fixedItem.position || 'start';
      blockLogs.push({
        blockTime: timeStr, type: 'fixed',
        title: fixedItem.name, artist: finalFileName,
        station: 'FIXO', reason: `Conteúdo fixo com dia: ${getDayCode(targetDay)}`,
      });
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

    // Get active sequence
    const activeSequence = getActiveSequenceForBlock(hour, minute, targetDay);
    const usedInBlock = new Set<string>();
    const usedArtistsInBlock = new Set<string>();
    const stationSongIndex: Record<string, number> = {};
    const songs: string[] = [];

    const selCtx = {
      timeStr, isFullDay, usedInBlock, usedArtistsInBlock,
      songsByStation, allSongsPool, carryOverByStation, stationSongIndex,
      logs: blockLogs, stats,
    };

    for (const seq of activeSequence) {
      if (songs.length >= activeSequence.length) break;

      // Try special sequence types first
      const specialResult = await handleSpecialSequenceType(seq, hour, minute, selCtx, ctx, targetDay);
      if (specialResult !== null) {
        songs.push(specialResult);
        continue;
      }

      // Normal station selection (P0-P6)
      const songStr = await selectSongForSlot(seq, selCtx, ctx);
      songs.push(songStr);
    }

    // Insert fixed content at configured position
    let allContent: string[] = [...songs];
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

    const lineContent = allContent.join(',vht,');
    return {
      line: sanitizeGradeLine(`${timeStr} (ID=${programName}) ${lineContent}`, filterChars),
      logs: blockLogs,
    };
  }, [
    getProgramForHour, getFixedContentForTime, isWeekday,
    getActiveSequenceForBlock, findSongInLibrary,
    processFixedContentFilename, getDayCode, getCarryOverSongs,
    buildGradeContext, filterChars, stations,
  ]);

  // ==================== Block Times ====================

  const getBlockTimes = useCallback(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentBlockMinute = currentMinute < 30 ? 0 : 30;
    const nextBlockHour = currentBlockMinute === 30 ? (currentHour + 1) % 24 : currentHour;
    const nextBlockMinute = currentBlockMinute === 30 ? 0 : 30;
    return {
      current: { hour: currentHour, minute: currentBlockMinute },
      next: { hour: nextBlockHour, minute: nextBlockMinute },
    };
  }, []);

  // ==================== Full Day Grade ====================

  const buildFullDayGrade = useCallback(async () => {
    if (!isElectronEnv || !window.electronAPI?.saveGradeFile) {
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
    const targetDay = dayMap[new Date().getDay()];
    const dayCode = getDayCode(targetDay);
    const filename = `${dayCode}.txt`;

    try {
      console.log('[AUTO-GRADE] 🚀 Building full day grade with progressive saving...');
      logSystemError('GRADE', 'info', 'Iniciando geração da grade completa (salvamento progressivo)');
      clearUsedSongs();

      const songsByStation = await fetchAllRecentSongs();
      const stats: BlockStats = { skipped: 0, substituted: 0, missing: 0 };
      const lines: string[] = [];
      const allLogs: BlockLogItem[] = [];
      let blockCount = 0;

      // Full-day carry-over: pass missing songs between consecutive blocks
      const fullDayCarryOver: CarryOverSong[] = [];

      for (let hour = 0; hour < 24; hour++) {
        for (const minute of [0, 30]) {
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
          lines.push(result.line);
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
        setState(prev => ({
          ...prev, isBuilding: false, lastBuildTime: new Date(), lastSavedFile: filename,
          blocksGenerated: prev.blocksGenerated + 48, fullDayProgress: 48, fullDayTotal: 0,
          skippedSongs: stats.skipped, substitutedSongs: stats.substituted, missingSongs: stats.missing,
          currentProcessingSong: null, currentProcessingBlock: null,
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

  // ==================== Incremental Build ====================

  const buildGrade = useCallback(async () => {
    if (!isElectronEnv || !window.electronAPI?.saveGradeFile) {
      console.log('[AUTO-GRADE] Not in Electron mode, skipping');
      return;
    }

    try {
      const blocks = getBlockTimes();
      const currentTimeKey = `${blocks.current.hour.toString().padStart(2, '0')}:${blocks.current.minute.toString().padStart(2, '0')}`;
      const nextTimeKey = `${blocks.next.hour.toString().padStart(2, '0')}:${blocks.next.minute.toString().padStart(2, '0')}`;
      const dayCode = getDayCode();
      const filename = `${dayCode}.txt`;

      // Check which blocks are already locked (already built)
      const currentLocked = builtBlocksRef.current.has(currentTimeKey);
      const nextLocked = builtBlocksRef.current.has(nextTimeKey);

      if (currentLocked && nextLocked) {
        console.log(`[AUTO-GRADE] ⏭️ Blocos ${currentTimeKey} e ${nextTimeKey} já montados, pulando`);
        return;
      }

      setState(prev => ({ ...prev, isBuilding: true, error: null }));

      // Read existing file first
      let existingContent = '';
      try {
        if (window.electronAPI?.readGradeFile) {
          const readResult = await window.electronAPI.readGradeFile({ folder: config.gradeFolder, filename });
          if (readResult.success && readResult.content) existingContent = readResult.content;
        }
      } catch { /* ignore */ }

      const lineMap = new Map<string, string>();
      if (existingContent) {
        for (const line of existingContent.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const timeMatch = trimmed.match(/^(\d{2}:\d{2})/);
          if (timeMatch) lineMap.set(timeMatch[1], trimmed);
        }
      }

      const stats: BlockStats = { skipped: 0, substituted: 0, missing: 0 };
      const allLogs: BlockLogItem[] = [];

      // Only generate blocks that are NOT locked
      if (!currentLocked) {
        const songsCurrent = await fetchSongsForBlock(blocks.current.hour, blocks.current.minute);
        let currentPool = songsCurrent;
        if (Object.keys(currentPool).length === 0) {
          currentPool = await fetchAllRecentSongs();
        }
        const currentResult = await generateBlockLine(blocks.current.hour, blocks.current.minute, currentPool, stats);
        lineMap.set(currentTimeKey, currentResult.line);
        allLogs.push(...currentResult.logs);
        builtBlocksRef.current.add(currentTimeKey);
        console.log(`[AUTO-GRADE] 🔒 Bloco ${currentTimeKey} montado e travado`);
      } else {
        console.log(`[AUTO-GRADE] ⏭️ Bloco ${currentTimeKey} já travado, mantendo`);
      }

      if (!nextLocked) {
        const songsNext = await fetchSongsForBlock(blocks.next.hour, blocks.next.minute);
        let nextPool = songsNext;
        if (Object.keys(nextPool).length === 0) {
          nextPool = await fetchAllRecentSongs();
        }
        const nextResult = await generateBlockLine(blocks.next.hour, blocks.next.minute, nextPool, stats);
        lineMap.set(nextTimeKey, nextResult.line);
        allLogs.push(...nextResult.logs);
        builtBlocksRef.current.add(nextTimeKey);
        console.log(`[AUTO-GRADE] 🔒 Bloco ${nextTimeKey} montado e travado`);
      } else {
        console.log(`[AUTO-GRADE] ⏭️ Bloco ${nextTimeKey} já travado, mantendo`);
      }

      if (allLogs.length > 0) addBlockLogs(allLogs);

      const sortedContent = Array.from(lineMap.keys()).sort().map(t => lineMap.get(t)).join('\n');
      await renameFilesInGradeContent(sortedContent);

      const result = await window.electronAPI.saveGradeFile({ folder: config.gradeFolder, filename, content: sortedContent });
      if (result.success) {
        console.log(`[AUTO-GRADE] ✅ Grade salva na pasta destino: ${result.filePath}`);
        addGradeHistory({
          id: `grade-${Date.now()}`, timestamp: new Date(), blockTime: currentTimeKey,
          songsProcessed: defaultSequence.length * 2,
          songsFound: defaultSequence.length * 2 - stats.missing,
          songsMissing: stats.missing, programName: getProgramForHour(blocks.current.hour),
        });
        setState(prev => ({
          ...prev, isBuilding: false, lastBuildTime: new Date(),
          currentBlock: currentTimeKey, nextBlock: nextTimeKey,
          lastSavedFile: filename, blocksGenerated: prev.blocksGenerated + (currentLocked ? 0 : 1) + (nextLocked ? 0 : 1),
          skippedSongs: stats.skipped, substitutedSongs: stats.substituted, missingSongs: stats.missing,
        }));
        if (!currentLocked || !nextLocked) {
          toast({ title: '✅ Grade Atualizada', description: `Blocos ${currentTimeKey} e ${nextTimeKey} atualizados em ${filename}` });
        }
      } else {
        throw new Error(result.error || 'Erro ao salvar');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logSystemError('GRADE', 'error', 'Erro ao atualizar grade', errorMessage);
      setState(prev => ({ ...prev, isBuilding: false, error: errorMessage }));
      toast({ title: '❌ Erro', description: errorMessage, variant: 'destructive' });
    }
  }, [
    getBlockTimes, fetchSongsForBlock, fetchAllRecentSongs, generateBlockLine, renameFilesInGradeContent,
    getDayCode, config.gradeFolder, addGradeHistory, defaultSequence.length, getProgramForHour, toast, addBlockLogs,
  ]);

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

  // Auto-build effect
  useEffect(() => {
    if (!isElectronEnv || !state.isAutoEnabled) return;
    console.log(`[AUTO-GRADE] ⏰ Modo automático ATIVO - atualiza ${state.minutesBeforeBlock} min antes de cada bloco`);
    let lastBuiltBlock = '';

    buildIntervalRef.current = setInterval(() => {
      const { isRunning } = useRadioStore.getState();
      if (!isRunning) return;
      const now = new Date();
      const currentMinute = now.getMinutes();
      const currentHour = now.getHours();
      let targetBlockHour = currentHour;
      let targetBlockMinute = 0;
      if (currentMinute < 30) targetBlockMinute = 30;
      else { targetBlockHour = (currentHour + 1) % 24; targetBlockMinute = 0; }
      const minutesUntilBlock = currentMinute < 30 ? 30 - currentMinute : 60 - currentMinute;
      const blockKey = `${targetBlockHour.toString().padStart(2, '0')}:${targetBlockMinute.toString().padStart(2, '0')}`;

      // Clear locks when we transition to a new block cycle
      if (lastBuiltBlock && lastBuiltBlock !== blockKey) {
        console.log(`[AUTO-GRADE] 🔓 Novo ciclo de blocos (${lastBuiltBlock} → ${blockKey}), limpando locks antigos`);
        builtBlocksRef.current.clear();
      }

      const shouldBuild = minutesUntilBlock <= state.minutesBeforeBlock && lastBuiltBlock !== blockKey;

      if (shouldBuild) {
        console.log(`[AUTO-GRADE] 🔄 Atualizando grade para bloco ${blockKey}`);
        lastBuiltBlock = blockKey;
        buildGrade();
      }
      // Removed: periodic 10-min save that was causing unwanted block regeneration
    }, 60 * 1000);

    const { isRunning } = useRadioStore.getState();
    if (isRunning) {
      console.log(`[AUTO-GRADE] 🚀 Build inicial`);
      buildGrade();
    }

    return () => { if (buildIntervalRef.current) clearInterval(buildIntervalRef.current); };
  }, [state.isAutoEnabled, state.minutesBeforeBlock, buildGrade]);

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
    isElectron: isElectronEnv,
  };
}
