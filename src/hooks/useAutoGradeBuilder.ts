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
  getIsElectronEnv,
} from '@/lib/gradeBuilder/constants';
import { sanitizeGradeFilename, sanitizeGradeLine, createLineSanitizer } from '@/lib/gradeBuilder/sanitize';
import {
  generateVozDoBrasil, generateMisturadao,
  generateTop50Block, generateTop10Block, generateMadrugada, generateSertanejoNossa,
} from '@/lib/gradeBuilder/specialPrograms';
import { selectSongForSlot, handleSpecialSequenceType } from '@/lib/gradeBuilder/songSelection';
import { batchFindSongsInLibrary, findSongInLibrary as findSongInLibraryFn } from '@/lib/gradeBuilder/batchLibrary';
import { isRomanceBlock, generateRomanceBlock } from '@/lib/gradeBuilder/folderPrograms';
import type {
  SongEntry, UsedSong, CarryOverSong, BlockStats, BlockLogItem, BlockResult, GradeContext,
} from '@/lib/gradeBuilder/types';
import { mergeGradeLinePreservingResolved } from '@/lib/gradeBuilder/lineMerge';
import { saveGradeToStorage, loadGradeFromStorage, clearGradeStorage } from '@/lib/gradeBuilder/gradePersistence';
import { resolveVinhetasInLine, resolveVinhetasInGrade, resetVinhetaPool } from '@/lib/gradeBuilder/vinhetaResolver';

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
    };
  });

  const lastBuildRef = useRef<string | null>(null);
  const buildIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const usedSongsRef = useRef<UsedSong[]>([]);
  const carryOverSongsRef = useRef<CarryOverSong[]>([]);
  /** Tracks which block time keys (e.g. "18:00") have already been assembled and locked */
  const builtBlocksRef = useRef<Set<string>>(
    (() => {
      const dc = DAY_CODES_BY_INDEX[new Date().getDay()];
      const p = loadGradeFromStorage(dc);
      return p?.lockedBlocks || new Set<string>();
    })()
  );

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
    clearGradeStorage();
    resetVinhetaPool();
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

  const similarityThreshold = config.similarityThreshold || 0.75;

  const findSongInLibrary = useCallback(async (artist: string, title: string) => {
    console.log(`[AUTO-GRADE] 🔍 Library check: "${artist} - ${title}" (folders: ${config.musicFolders.length}, threshold: ${Math.round(similarityThreshold * 100)}%, isElectron: ${!!window.electronAPI?.isElectron})`);
    const result = await findSongInLibraryFn(artist, title, config.musicFolders, similarityThreshold);
    if (!result.exists) {
      console.warn(`[AUTO-GRADE] ❌ NÃO encontrado na biblioteca: "${artist} - ${title}" → folders: [${config.musicFolders.join(', ')}]`);
    }
    return result;
  }, [config.musicFolders, similarityThreshold]);

  const batchFind = useCallback(async (songs: Array<{ artist: string; title: string }>) => {
    console.log(`[AUTO-GRADE] 📦 Batch library check: ${songs.length} músicas (folders: ${config.musicFolders.length}, threshold: ${Math.round(similarityThreshold * 100)}%)`);
    return batchFindSongsInLibrary(songs, config.musicFolders, similarityThreshold);
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
        .select('title, artist, station_name, scraped_at')
        .gte('scraped_at', windowStart)
        .lte('scraped_at', windowEnd)
        .order('scraped_at', { ascending: false })
        .limit(2000);
      if (error) throw error;

      return buildSongsByStation(data || [], 200);
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
      let scrapedData: Array<{ title: string; artist: string; station_name: string; scraped_at: string }> = [];
      let historicoData: Array<{ title: string; artist: string; station_name: string; captured_at: string }> = [];

      try {
        const scrapedResult = await supabase
          .from('scraped_songs')
          .select('title, artist, station_name, scraped_at')
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

      // If both failed, retry or report
      if (scrapedData.length === 0 && historicoData.length === 0) {
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
      const seen = new Map<string, typeof allData[0]>();
      for (const song of allData) {
        const key = `${song.title.toLowerCase().trim()}-${song.artist.toLowerCase().trim()}`;
        const existing = seen.get(key);
        if (!existing || new Date(song.scraped_at) > new Date(existing.scraped_at)) {
          seen.set(key, song);
        }
      }

      const deduplicated = Array.from(seen.values());
      console.log(`[AUTO-GRADE] Pool ampliado: ${scrapedData.length} scraped + ${historicoData.length} histórico = ${deduplicated.length} únicas`);

      return buildSongsByStation(deduplicated, 300);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
      console.error('[AUTO-GRADE] Error fetching all songs:', errorMsg);
      
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
  const buildSongsByStation = useCallback((data: Array<{ title: string; artist: string; station_name: string; scraped_at: string }>, maxPerStation = 50): Record<string, SongEntry[]> => {
    const songsByStation: Record<string, SongEntry[]> = {};
    const stationNameToStyle: Record<string, string> = {};
    const seenSongs = new Set<string>();

    // Build blocked songs matching with wildcard support
    const blockedList = (config.blockedSongs || []).map(s => s.toLowerCase().trim());
    const blockedExact = new Set<string>(blockedList.filter(s => !s.endsWith(' - *')));
    const blockedWildcardArtists = blockedList
      .filter(s => s.endsWith(' - *'))
      .map(s => s.replace(/ - \*$/, ''));
    
    const isBlocked = (artist: string, title: string): boolean => {
      const key = `${artist.trim()} - ${title.trim()}`.toLowerCase();
      if (blockedExact.has(key)) return true;
      const artistLower = artist.trim().toLowerCase();
      return blockedWildcardArtists.some(blocked => artistLower === blocked || artistLower.includes(blocked));
    };

    stations.forEach(s => {
      stationNameToStyle[s.name] = s.styles?.[0] || 'POP/VARIADO';
      stationNameToStyle[s.name.toLowerCase()] = s.styles?.[0] || 'POP/VARIADO';
      stationNameToStyle[s.id] = s.styles?.[0] || 'POP/VARIADO';
    });
    data.forEach(song => {
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
        });
      }
    });
    const stationList = Object.keys(songsByStation).map(name => `${name}(${songsByStation[name].length})`).join(', ');
    console.log(`[AUTO-GRADE] Pool: ${stationList}`);
    return songsByStation;
  }, [stations, config.blockedSongs]);

  // ==================== Weekend Template Generator ====================

  // Station rotation for Saturday monitoring-based music
  const SATURDAY_STATION_ROTATION = ['Mix FM', 'Metropolitana', 'Positividade', 'Clube', 'BH', 'Clube'];
  const saturdayStationIndexRef = useRef(0);

  /**
   * Replace 'mus' codes in a template line with real songs from the monitoring
   * station rotation: Mix FM → Metropolitana → Positividade → Clube → BH → Clube (cyclic).
   * Falls back to 'mus' if no song is available from the current station.
   */
  const replaceMusWithMonitoring = useCallback(async (
    templateLine: string,
    songsByStation: Record<string, SongEntry[]>,
    ctx: GradeContext,
    timeStr: string,
    logs: BlockLogItem[]
  ): Promise<string> => {
    // Split by comma, find 'mus' tokens (case-insensitive)
    const parts = templateLine.split(',');
    const usedKeys = new Set<string>();

    for (let i = 0; i < parts.length; i++) {
      if (parts[i].trim().toLowerCase() !== 'mus') continue;

      // Try stations in rotation order, cycling through
      let found = false;
      for (let attempt = 0; attempt < SATURDAY_STATION_ROTATION.length; attempt++) {
        const stationName = SATURDAY_STATION_ROTATION[saturdayStationIndexRef.current % SATURDAY_STATION_ROTATION.length];
        saturdayStationIndexRef.current++;

        // Find pool for this station (flexible matching)
        let pool: SongEntry[] = [];
        for (const [poolName, poolSongs] of Object.entries(songsByStation)) {
          const norm1 = poolName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const norm2 = stationName.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (norm1.includes(norm2) || norm2.includes(norm1)) {
            pool = poolSongs;
            break;
          }
        }

        if (pool.length === 0) continue;

        // Pick first available song not yet used
        for (const candidate of pool) {
          const key = `${candidate.artist.toLowerCase().trim()}|${candidate.title.toLowerCase().trim()}`;
          if (usedKeys.has(key)) continue;
          if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr)) continue;

          const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
          if (libraryResult.exists) {
            const realFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
            parts[i] = `"${realFilename}"`;
            usedKeys.add(key);
            ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);
            logs.push({
              blockTime: timeStr,
              type: 'used',
              title: candidate.title,
              artist: candidate.artist,
              station: stationName,
              style: candidate.style,
              reason: `Sábado monitoramento (${stationName})`,
            });
            found = true;
            break;
          }
        }
        if (found) break;
      }

      // If not found after trying all stations, keep 'mus' as fallback
      if (!found) {
        // Advance rotation anyway to avoid getting stuck
        saturdayStationIndexRef.current++;
      }
    }

    return parts.join(',');
  }, []);

  /**
   * Generates weekend (SAB/DOM) blocks using predefined templates.
   * Returns null if no template matches (falls through to normal logic).
   * Now async: replaces 'mus' codes with real monitoring songs (except Mega Funk which uses 'fun').
   */
  const generateWeekendTemplateBlock = useCallback(async (
    hour: number,
    minute: number,
    timeStr: string,
    songsByStation: Record<string, SongEntry[]>,
    ctx: GradeContext
  ): Promise<BlockResult | null> => {
    const musLine = 'mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus';

    // Helper to build result and replace mus with monitoring
    const buildWithMonitoring = async (line: string, logs: BlockLogItem[]): Promise<BlockResult> => {
      const resolvedLine = await replaceMusWithMonitoring(line, songsByStation, ctx, timeStr, logs);
      return { line: resolvedLine, logs };
    };

    // 00:00-07:30 — Regular music blocks
    if (hour >= 0 && hour <= 7) {
      const logs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: 'Weekend Music', artist: '', station: 'TEMPLATE', reason: 'Bloco musical FDS' }];
      return buildWithMonitoring(`${timeStr} (ID=SABADO) ${musLine}`, logs);
    }

    // 08:00-11:30 — Shake Mix (8 blocks)
    if (hour >= 8 && hour <= 11) {
      const blockMap: Record<string, number> = { '08:00': 1, '08:30': 2, '09:00': 3, '09:30': 4, '10:00': 5, '10:30': 6, '11:00': 7, '11:30': 8 };
      const blockNum = blockMap[timeStr] || 1;
      const ed = blockNum.toString().padStart(2, '0');
      const fixedFile = `"SHAKE_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3"`;
      const musicSlots = ',vht,mus'.repeat(10);
      const logs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: `Shake Mix Bloco ${ed}`, artist: `SHAKE_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3`, station: 'FIXO', reason: 'Shake Mix FDS' }];
      return buildWithMonitoring(`${timeStr} (ID=SABADO) ${fixedFile}${musicSlots}`, logs);
    }

    // 12:00-15:30 — Mega Mix (8 blocks) + music
    if (hour >= 12 && hour <= 15) {
      const blockMap: Record<string, number> = {
        '12:00': 1, '12:30': 2, '13:00': 3, '13:30': 4,
        '14:00': 5, '14:30': 6, '15:00': 7, '15:30': 8,
      };
      const blockNum = blockMap[timeStr] || 1;
      const ed = blockNum.toString().padStart(2, '0');
      const suffix = blockNum === 1
        ? ',VHTN,mus,vht,mus,vht,mus,vht,mus'
        : ',VHTN,VHTN,mus,vht,mus,vht,mus,vht,mus';
      const logs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: `Mega Mix Bloco ${ed}`, artist: `MEGA_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3`, station: 'FIXO', reason: 'Mega Mix FDS' }];
      return buildWithMonitoring(`${timeStr} (ID=SABADO) "MEGA_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3"${suffix}`, logs);
    }

    // 16:00-17:30 — Sem Parar (4 blocks)
    if (hour >= 16 && hour <= 17) {
      const blockMap: Record<string, number> = { '16:00': 1, '16:30': 2, '17:00': 3, '17:30': 4 };
      const blockNum = blockMap[timeStr] || 1;
      const ed = blockNum.toString().padStart(2, '0');
      const logs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: `Sem Parar Bloco ${ed}`, artist: `SEM_PARAR_BLOCO${ed}_FINAL_DE_SEMANA.MP3`, station: 'FIXO', reason: 'Sem Parar FDS' }];
      return buildWithMonitoring(`${timeStr} (ID=SABADO) VHTN,"SEM_PARAR_BLOCO${ed}_FINAL_DE_SEMANA.MP3",VHTN,mus,vht,mus,vht,mus,vht,mus`, logs);
    }

    // 18:00-19:30 — Mega Funk (4 blocks) — NÃO substitui, mantém 'fun'
    if (hour >= 18 && hour <= 19) {
      const blockMap: Record<string, number> = { '18:00': 1, '18:30': 2, '19:00': 3, '19:30': 4 };
      const blockNum = blockMap[timeStr] || 1;
      const ed = blockNum.toString().padStart(2, '0');
      const programId = hour === 18 ? 'TOP10' : 'TOP50';
      return {
        line: `${timeStr} (ID=${programId}) VHTN,"MEGA_FUNK_BLOCO${ed}_FINAL_DE_SEMANA.MP3",VHTN,FUN,VHT,FUN,VHTN,FUN,VHT,FUN,VHTN`,
        logs: [{ blockTime: timeStr, type: 'fixed', title: `Mega Funk Bloco ${ed}`, artist: `MEGA_FUNK_BLOCO${ed}_FINAL_DE_SEMANA.MP3`, station: 'FIXO', reason: `Mega Funk FDS (${programId})` }],
      };
    }

    // 20:00 — TOP50 FDS (positions 20 down to 11) - com músicas reais do ranking
    if (hour === 20 && minute === 0) {
      const sorted = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays);
      const blockSongs: string[] = [];
      const blockLogs: BlockLogItem[] = [];
      
      for (let i = 19; i >= 10 && blockSongs.length < 10; i--) {
        if (i >= sorted.length) {
          blockSongs.push(ctx.coringaCode);
          continue;
        }
        const song = sorted[i];
        const libraryResult = await ctx.findSongInLibrary(song.artist, song.title);
        if (libraryResult.exists) {
          const realFilename = libraryResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
          blockSongs.push(`"${realFilename}"`);
          ctx.markSongAsUsed(song.title, song.artist, timeStr);
          blockLogs.push({ blockTime: timeStr, type: 'used', title: song.title, artist: song.artist, station: 'RANKING', reason: `TOP50 FDS posição ${i + 1}` });
        } else {
          blockSongs.push(ctx.coringaCode);
          blockLogs.push({ blockTime: timeStr, type: 'substituted', title: ctx.coringaCode, artist: song.artist, station: 'RANKING', reason: `TOP50 FDS posição ${i + 1} - não encontrada` });
        }
      }
      while (blockSongs.length < 10) blockSongs.push(ctx.coringaCode);
      
      return {
        line: ctx.sanitizeGradeLine(`${timeStr} (ID=SABADO) ${blockSongs.join(',vht,')}`),
        logs: blockLogs,
      };
    }

    // 20:30 — TOP50 FDS (positions 10 down to 01, posição 01 é a ÚLTIMA)
    if (hour === 20 && minute === 30) {
      const sorted = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays);
      const blockSongs: string[] = [];
      const blockLogs: BlockLogItem[] = [];
      
      for (let i = 9; i >= 0 && blockSongs.length < 10; i--) {
        if (i >= sorted.length) {
          blockSongs.push(ctx.coringaCode);
          continue;
        }
        const song = sorted[i];
        const libraryResult = await ctx.findSongInLibrary(song.artist, song.title);
        if (libraryResult.exists) {
          const realFilename = libraryResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
          blockSongs.push(`"${realFilename}"`);
          ctx.markSongAsUsed(song.title, song.artist, timeStr);
          blockLogs.push({ blockTime: timeStr, type: 'used', title: song.title, artist: song.artist, station: 'RANKING', reason: `TOP50 FDS posição ${i + 1}` });
        } else {
          blockSongs.push(ctx.coringaCode);
          blockLogs.push({ blockTime: timeStr, type: 'substituted', title: ctx.coringaCode, artist: song.artist, station: 'RANKING', reason: `TOP50 FDS posição ${i + 1} - não encontrada` });
        }
      }
      while (blockSongs.length < 10) blockSongs.push(ctx.coringaCode);
      
      return {
        line: ctx.sanitizeGradeLine(`${timeStr} (ID=SABADO) ${blockSongs.join(',vht,')}`),
        logs: blockLogs,
      };
    }

    // 21:00-23:30 — Conexão Mix (6 blocks, numbered 01-05 then 08)
    if (hour >= 21 && hour <= 23) {
      const blockMap: Record<string, number> = { '21:00': 1, '21:30': 2, '22:00': 3, '22:30': 4, '23:00': 5, '23:30': 8 };
      const blockNum = blockMap[timeStr] || 1;
      const ed = blockNum.toString().padStart(2, '0');
      const content = timeStr === '21:30'
        ? `VHTN,"CONEXAO_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3",MUS,VHTN,MUS,VHTN,MUS,VHTN,MUS,VHTN,MUS`
        : `VHTN,"CONEXAO_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3",VHTN,MUS,VHTN,MUS,VHTN,MUS,VHTN,MUS`;
      const logs: BlockLogItem[] = [{ blockTime: timeStr, type: 'fixed', title: `Conexão Mix Bloco ${ed}`, artist: `CONEXAO_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3`, station: 'FIXO', reason: 'Conexão Mix FDS' }];
      return buildWithMonitoring(`${timeStr} (ID=SABADO) ${content}`, logs);
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
    const ctx = buildGradeContext();

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

    // === Special Programs (only when NO scheduled sequence overrides) ===

    // Saturday template blocks ALWAYS apply (predefined templates)
    if (targetDay === 'sab') {
      const weekendResult = await generateWeekendTemplateBlock(hour, minute, timeStr, songsByStation, ctx);
      if (weekendResult) return weekendResult;
    }

    // Voz do Brasil (21:00-21:30 weekdays) - ALWAYS applies, 60min program
    // Both 21:00 and 21:30 blocks are consumed by Voz do Brasil
    if (hour === 21 && (minute === 0 || minute === 30) && isWeekday(targetDay)) {
      if (minute === 0) {
        return generateVozDoBrasil(timeStr);
      }
      // 21:30 — continuation of Voz do Brasil, skip block generation
      return {
        line: '21:30 (FIXO ID=VOZ DO BRASIL) vht,vozbrasil',
        logs: [{
          blockTime: '21:30',
          type: 'fixed' as const,
          title: 'A Voz do Brasil (continuação)',
          artist: 'Governo Federal',
          station: 'EBC',
          reason: 'Programa de 60 minutos — bloco 21:30 absorvido',
        }],
      };
    }

    // If a scheduled sequence is active, skip ALL other special programs
    // and go straight to normal sequence-based block generation
    if (hasScheduledSequence) {
      console.log(`[GRADE] 📅 Sequência agendada ativa às ${timeStr} — sobrepondo programas especiais`);
    } else {
      // TOP10 (18:30 weekdays) - fixed template with sports + mix
      if (hour === 18 && minute === 30 && isWeekday(targetDay)) {
        return await generateTop10Block(hour, minute, ctx, targetDay);
      }

      // TOP50 Ranking (19:00/19:30 weekdays) - positions 20→01 from ranking
      if (hour === 19 && (minute === 0 || minute === 30) && isWeekday(targetDay)) {
        return await generateTop50Block(hour, minute, 10, ctx);
      }

      // Misturadão (20:00, 20:30 weekdays)
      if ((hour === 20 && (minute === 0 || minute === 30)) && isWeekday(targetDay)) {
        return await generateMisturadao(hour, minute, ctx, targetDay);
      }

      // Romance blocks (22:00-00:00) - folder-based with fixed content
      if (isRomanceBlock(hour, minute) && isWeekday(targetDay)) {
        return generateRomanceBlock(hour, minute, stats, isFullDay, ctx, targetDay);
      }

      // TOP50 blocks
      const top50Item = fixedItems.find(fc => fc.type === 'top50');
      if (top50Item) {
        return await generateTop50Block(hour, minute, top50Item.top50Count || 10, ctx);
      }

      // Madrugada (00:00-04:30) - weekdays only
      if (hour >= 0 && hour <= 4 && isWeekday(targetDay)) {
        return generateMadrugada(hour, minute, songsByStation, stats, isFullDay, ctx, programName);
      }

      // Sertanejo Nossa (05:00-07:30) - weekdays only
      if (hour >= 5 && hour <= 7 && isWeekday(targetDay)) {
        return generateSertanejoNossa(hour, minute, songsByStation, stats, isFullDay, ctx);
      }
    }

    // === Normal Block Logic ===

    const blockLogs: BlockLogItem[] = [];

    // Fixed content handling — SKIPPED when a scheduled sequence is active
    const fixedItem = hasScheduledSequence ? undefined : fixedItems.find(fc => fc.type !== 'top50' && fc.type !== 'vozbrasil');
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
          const resolvedLine = await resolveVinhetasInLine(result.line);
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

  // ==================== Pending Grade (in-memory buffer) ====================

  /** Holds the latest generated grade content in memory, ready to be flushed to disk */
  const pendingGradeRef = useRef<{ lineMap: Map<string, string>; filename: string; blockKey: string } | null>(null);

  // ==================== Incremental Build (silent, in-memory) ====================

  const buildGrade = useCallback(async (forceWrite: boolean = false, forceRegenerate: boolean = false) => {
    const isWebOnly = !getIsElectronEnv() || !window.electronAPI?.saveGradeFile;

    try {
      const blocks = getBlockTimes();
      const currentTimeKey = `${blocks.current.hour.toString().padStart(2, '0')}:${blocks.current.minute.toString().padStart(2, '0')}`;
      const nextTimeKey = `${blocks.next.hour.toString().padStart(2, '0')}:${blocks.next.minute.toString().padStart(2, '0')}`;
      const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
      const targetDay = dayMap[new Date().getDay()];
      const dayCode = getDayCode(targetDay);
      const filename = `${dayCode}.txt`;

      // If forceRegenerate (manual refresh), clear locks so blocks are rebuilt
      if (forceRegenerate) {
        builtBlocksRef.current.delete(currentTimeKey);
        builtBlocksRef.current.delete(nextTimeKey);
        console.log(`[AUTO-GRADE] 🔓 Force regenerate: locks limpos para ${currentTimeKey} e ${nextTimeKey}`);
      }

      // Check lock state first (in-memory cycle lock)
      const currentLocked = builtBlocksRef.current.has(currentTimeKey);
      const nextLocked = builtBlocksRef.current.has(nextTimeKey);

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

      // Detect legacy weekday lines that should never persist on Saturday
      const hasSaturdayMismatch = (line?: string | null) => {
        if (targetDay !== 'sab' || !line) return false;
        return /(VOZ[_\s]?BRASIL|\(ID=TOP10\)|\(ID=TOP50\)|\(ID=MISTURADAO\)|\(ID=ROMANCE\)|\bROMANCE\b|HAPPY\s*HOUR)/i.test(line);
      };

      const currentSaturdayMismatch = hasSaturdayMismatch(currentExistingLine);
      const nextSaturdayMismatch = hasSaturdayMismatch(nextExistingLine);

      // Manual refresh should force regeneration of current/next blocks
      // Also force regeneration when a Saturday block still has weekday content
      const shouldBuildCurrent = forceRegenerate
        ? true
        : !currentLocked || currentSaturdayMismatch;
      const shouldBuildNext = forceRegenerate
        ? true
        : !nextLocked || nextSaturdayMismatch;

      if (!shouldBuildCurrent && !shouldBuildNext) {
        console.log(`[AUTO-GRADE] ⏭️ Blocos ${currentTimeKey} e ${nextTimeKey} já resolvidos, pulando`);
        builtBlocksRef.current.add(currentTimeKey);
        builtBlocksRef.current.add(nextTimeKey);
        setState(prev => ({
          ...prev,
          isBuilding: false,
          lastBuildTime: new Date(),
          currentBlock: currentTimeKey,
          nextBlock: nextTimeKey,
          pendingGradeLines: new Map(lineMap),
        }));
        return;
      }

      setState(prev => ({ ...prev, isBuilding: true, error: null }));

      const stats: BlockStats = { skipped: 0, substituted: 0, missing: 0 };
      const allLogs: BlockLogItem[] = [];

      // Always use the FULL song pool from monitoring (scraped_songs + radio_historico)
      // A narrow 1h window misses songs captured earlier, causing unnecessary Coringas
      const fullPool = await fetchAllRecentSongs();

      if (shouldBuildCurrent) {
        const currentResult = await generateBlockLine(blocks.current.hour, blocks.current.minute, fullPool, stats, false, targetDay);
        const resolvedCurrentLine = await resolveVinhetasInLine(currentResult.line);
        const forceReplaceCurrent = forceRegenerate || currentSaturdayMismatch;
        const mergedCurrentLine = currentExistingLine && !forceReplaceCurrent
          ? mergeGradeLinePreservingResolved(currentExistingLine, resolvedCurrentLine, coringaCode)
          : resolvedCurrentLine;
        lineMap.set(currentTimeKey, mergedCurrentLine);
        allLogs.push(...currentResult.logs);
        builtBlocksRef.current.add(currentTimeKey);
        console.log(`[AUTO-GRADE] 🔒 Bloco ${currentTimeKey} atualizado (somente faltantes quando aplicável)`);
      }

      if (shouldBuildNext) {
        const nextResult = await generateBlockLine(blocks.next.hour, blocks.next.minute, fullPool, stats, false, targetDay);
        const resolvedNextLine = await resolveVinhetasInLine(nextResult.line);
        const forceReplaceNext = forceRegenerate || nextSaturdayMismatch;
        const mergedNextLine = nextExistingLine && !forceReplaceNext
          ? mergeGradeLinePreservingResolved(nextExistingLine, resolvedNextLine, coringaCode)
          : resolvedNextLine;
        lineMap.set(nextTimeKey, mergedNextLine);
        allLogs.push(...nextResult.logs);
        builtBlocksRef.current.add(nextTimeKey);
        console.log(`[AUTO-GRADE] 🔒 Bloco ${nextTimeKey} atualizado (somente faltantes quando aplicável)`);
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
      pendingGradeRef.current = { lineMap, filename, blockKey: nextTimeKey };

      // Persist to localStorage for refresh survival
      saveGradeToStorage(lineMap, builtBlocksRef.current, dayCode);

      // Update state for UI preview (silent - no file write)
      setState(prev => ({
        ...prev, isBuilding: false, lastBuildTime: new Date(),
        currentBlock: currentTimeKey, nextBlock: nextTimeKey,
        blocksGenerated: prev.blocksGenerated + (shouldBuildCurrent ? 1 : 0) + (shouldBuildNext ? 1 : 0),
        skippedSongs: stats.skipped, substitutedSongs: stats.substituted, missingSongs: stats.missing,
        pendingGradeLines: new Map(lineMap),
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
      const sortedContent = Array.from(pending.lineMap.keys()).sort().map(t => pending.lineMap.get(t)).join('\n');
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

  // Auto-build effect: builds silently in memory every 6 min, writes TXT only at 10 min before block
  useEffect(() => {
    if (!state.isAutoEnabled) return;
    const isWebOnly = !getIsElectronEnv();
    console.log(`[AUTO-GRADE] ⏰ Modo automático ATIVO - monta silenciosamente, escreve ${state.minutesBeforeBlock} min antes do bloco`);
    let lastBuiltBlock = '';
    let lastWrittenBlock = '';

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

      // Clear only the NEXT block lock when transitioning to a new cycle
      // The current block (already playing) stays locked unless it has unresolved fallbacks
      if (lastBuiltBlock && lastBuiltBlock !== blockKey) {
        console.log(`[AUTO-GRADE] 🔓 Novo ciclo de blocos (${lastBuiltBlock} → ${blockKey}), limpando lock do próximo bloco`);
        builtBlocksRef.current.delete(blockKey);
        // Keep current block locked — it's already playing and should not change
        lastBuiltBlock = '';
      }

      // Silent build: mount in memory (every cycle if not yet locked)
      if (lastBuiltBlock !== blockKey) {
        console.log(`[AUTO-GRADE] 🔄 Montando grade em memória para bloco ${blockKey} (silencioso)`);
        lastBuiltBlock = blockKey;
        buildGrade(false); // silent, no file write
      }

      // Disk write: only exactly at the minutesBeforeBlock window (Electron only)
      const shouldWrite = !isWebOnly && minutesUntilBlock <= state.minutesBeforeBlock && lastWrittenBlock !== blockKey;
      if (shouldWrite) {
        console.log(`[AUTO-GRADE] 📝 Janela de ${state.minutesBeforeBlock}min atingida! Escrevendo grade no disco para bloco ${blockKey}`);
        lastWrittenBlock = blockKey;
        flushGradeToDisk();
      }
    }, 60 * 1000);

    // Initial build (silent)
    const { isRunning } = useRadioStore.getState();
    if (isRunning || isWebOnly) {
      console.log(`[AUTO-GRADE] 🚀 Build inicial (silencioso em memória)`);
      
      // Check if we're already within the write window
      const now = new Date();
      const currentMinute = now.getMinutes();
      const minutesUntilBlock = currentMinute < 30 ? 30 - currentMinute : 60 - currentMinute;
      const shouldWriteNow = !isWebOnly && minutesUntilBlock <= state.minutesBeforeBlock;
      
      buildGrade(shouldWriteNow);
    }

    return () => { if (buildIntervalRef.current) clearInterval(buildIntervalRef.current); };
  }, [state.isAutoEnabled, state.minutesBeforeBlock, buildGrade, flushGradeToDisk]);

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
