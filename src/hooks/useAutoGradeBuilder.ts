import { useState, useEffect, useCallback, useRef } from 'react';
import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { useGradeLogStore, logSystemError } from '@/store/gradeLogStore';
import { sanitizeFilename, processFixedContentTemplate } from '@/lib/sanitizeFilename';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { WeekDay, ScheduledSequence, SequenceConfig } from '@/types/radio';

/**
 * Sanitize all quoted filenames in a grade line for radio automation compatibility.
 * Removes accents, &→e, removes (), [], forces UPPERCASE, ensures single .MP3 extension.
 */
function sanitizeGradeLine(line: string): string {
  return line.replace(/"([^"]+)"/g, (_match, filename: string) => {
    let sanitized = sanitizeFilename(filename);
    // Clean up space before extension (artifact from parentheses removal)
    sanitized = sanitized.replace(/\s+\./g, '.');
    // Remove any double extensions
    sanitized = sanitized.replace(/\.mp3\.mp3/gi, '.mp3');
    // Force UPPERCASE for radio automation
    sanitized = sanitized.toUpperCase();
    return `"${sanitized}"`;
  });
}

interface SongEntry {
  title: string;
  artist: string;
  station: string;
  style: string;
  filename: string;
  existsInLibrary?: boolean;
}

interface UsedSong {
  title: string;
  artist: string;
  usedAt: Date;
  blockTime: string;
}

// Songs that were missing but queued for download - will be available in next block
interface CarryOverSong {
  title: string;
  artist: string;
  station: string;
  style: string;
  addedAt: Date;
  targetBlock: string; // Block where this song should be used (after download)
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
  // Full day generation stats
  fullDayProgress: number;
  fullDayTotal: number;
  skippedSongs: number;
  substitutedSongs: number;
  missingSongs: number;
  // Current processing info
  currentProcessingSong: string | null;
  currentProcessingBlock: string | null;
  lastSaveProgress: number;
}

const isElectronEnv = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
const ARTIST_REPETITION_MINUTES = 60;
const DEFAULT_MINUTES_BEFORE_BLOCK = 10; // Build 10 minutes before each block

// Mapeamento explícito de IDs da store local para nomes no banco de dados
// Isso garante que TODAS as estações funcionem corretamente na sequência
const STATION_ID_TO_DB_NAME: Record<string, string> = {
  'bh': 'BH FM',
  'band': 'Band FM',
  'clube': 'Clube FM',
  'showfm': 'Show FM 101.1',
  'globo': 'Rádio Globo RJ',
  'blink': 'Blink 102 FM',
  'positiva': 'Positiva FM',
  'liberdade': 'Liberdade FM',
  'mix': 'Mix FM',
};

export function useAutoGradeBuilder() {
  const { toast } = useToast();
  const {
    programs,
    sequence: defaultSequence,
    scheduledSequences,
    stations,
    config,
    fixedContent,
    rankingSongs,
    addGradeHistory,
    addMissingSong,
    missingSongs: existingMissingSongs,
  } = useRadioStore();
  
  const { addBlockLogs } = useGradeLogStore();

  const [state, setState] = useState<AutoGradeState>({
    isBuilding: false,
    lastBuildTime: null,
    currentBlock: '--:--',
    nextBlock: '--:--',
    lastSavedFile: null,
    error: null,
    blocksGenerated: 0,
    isAutoEnabled: true,
    nextBuildIn: 0,
    minutesBeforeBlock: DEFAULT_MINUTES_BEFORE_BLOCK,
    fullDayProgress: 0,
    fullDayTotal: 0,
    skippedSongs: 0,
    substitutedSongs: 0,
    missingSongs: 0,
    currentProcessingSong: null,
    currentProcessingBlock: null,
    lastSaveProgress: 0,
  });

  const lastBuildRef = useRef<string | null>(null);
  const buildIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const usedSongsRef = useRef<UsedSong[]>([]);
  // Carry-over: songs that were missing but queued for download
  // These will be prioritized in the next block since downloads are fast (~1 min)
  const carryOverSongsRef = useRef<CarryOverSong[]>([]);

  // Get day code for filename - abbreviated (SEG, TER, etc.) for file naming convention
  // Can receive targetDay for full-day generation (e.g., 'seg', 'ter', etc.)
  const getDayCode = useCallback((targetDay?: WeekDay) => {
    const dayMap: Record<WeekDay, string> = {
      'dom': 'DOM',
      'seg': 'SEG',
      'ter': 'TER',
      'qua': 'QUA',
      'qui': 'QUI',
      'sex': 'SEX',
      'sab': 'SAB',
    };
    
    if (targetDay) {
      return dayMap[targetDay] || 'SEG';
    }
    
    const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
    return days[new Date().getDay()];
  }, []);

  // Get FULL day name for fixed content filenames (SEGUNDA, TERCA, etc.) - NO abbreviation
  const getFullDayName = useCallback((targetDay?: WeekDay) => {
    const dayMap: Record<WeekDay, string> = {
      'dom': 'DOMINGO',
      'seg': 'SEGUNDA',
      'ter': 'TERCA',
      'qua': 'QUARTA',
      'qui': 'QUINTA',
      'sex': 'SEXTA',
      'sab': 'SABADO',
    };
    
    if (targetDay) {
      return dayMap[targetDay] || 'SEGUNDA';
    }
    
    const days = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];
    return days[new Date().getDay()];
  }, []);

  // Check if it's a weekday (optionally for a specific targetDay)
  const isWeekday = useCallback((targetDay?: WeekDay) => {
    if (targetDay) {
      return ['seg', 'ter', 'qua', 'qui', 'sex'].includes(targetDay);
    }
    const day = new Date().getDay();
    return day >= 1 && day <= 5;
  }, []);

  // Get program name for a given hour
  const getProgramForHour = useCallback((hour: number) => {
    for (const prog of programs) {
      const [start, end] = prog.timeRange.split('-').map(Number);
      if (hour >= start && hour <= end) {
        return prog.programName;
      }
    }
    return 'PROGRAMA';
  }, [programs]);

  // Get fixed content for a specific time slot
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

  // Get station style/DNA
  const getStationStyle = useCallback((stationId: string): string => {
    const station = stations.find(s => s.id === stationId);
    return station?.styles?.[0] || 'POP/VARIADO';
  }, [stations]);

  // Get active sequence based on specific hour/minute/day (for scheduled sequences)
  const getActiveSequenceForBlock = useCallback((hour: number, minute: number, targetDay?: WeekDay): SequenceConfig[] => {
    const timeMinutes = hour * 60 + minute;
    const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
    const currentDay = targetDay || dayMap[new Date().getDay()];
    
    // Find active scheduled sequence for this specific time
    const activeScheduled = scheduledSequences
      .filter((s) => s.enabled)
      .filter((s) => s.weekDays.length === 0 || s.weekDays.includes(currentDay))
      .filter((s) => {
        const startMinutes = s.startHour * 60 + s.startMinute;
        const endMinutes = s.endHour * 60 + s.endMinute;
        
        // Handle overnight ranges
        if (endMinutes <= startMinutes) {
          return timeMinutes >= startMinutes || timeMinutes < endMinutes;
        }
        return timeMinutes >= startMinutes && timeMinutes < endMinutes;
      })
      .sort((a, b) => b.priority - a.priority);
    
    if (activeScheduled.length > 0) {
      console.log(`[SEQUENCE] Usando sequência agendada "${activeScheduled[0].name}" para ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (${currentDay})`);
      return activeScheduled[0].sequence;
    }
    
    return defaultSequence;
  }, [scheduledSequences, defaultSequence]);

  // Check if song/artist was used recently
  // For full day generation, use shorter window (30 min) to allow more variety
  const isRecentlyUsed = useCallback((title: string, artist: string, currentBlockTime: string, isFullDay: boolean = false): boolean => {
    // Use shorter repetition time for full day generation
    const artistRepetitionMinutes = isFullDay ? 30 : (config.artistRepetitionMinutes || ARTIST_REPETITION_MINUTES);
    const normalizedTitle = title.toLowerCase().trim();
    const normalizedArtist = artist.toLowerCase().trim();

    const [currentHour, currentMinute] = currentBlockTime.split(':').map(Number);
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    for (const used of usedSongsRef.current) {
      const [usedHour, usedMinute] = used.blockTime.split(':').map(Number);
      const usedTotalMinutes = usedHour * 60 + usedMinute;

      let diffMinutes = currentTotalMinutes - usedTotalMinutes;
      if (diffMinutes < 0) diffMinutes += 24 * 60;

      if (diffMinutes < artistRepetitionMinutes) {
        if (used.title.toLowerCase().trim() === normalizedTitle) {
          return true;
        }
        if (used.artist.toLowerCase().trim() === normalizedArtist) {
          return true;
        }
      }
    }
    return false;
  }, [config.artistRepetitionMinutes]);

  // Mark song as used
  const markSongAsUsed = useCallback((title: string, artist: string, blockTime: string) => {
    usedSongsRef.current.push({
      title,
      artist,
      usedAt: new Date(),
      blockTime,
    });
    if (usedSongsRef.current.length > 100) {
      usedSongsRef.current = usedSongsRef.current.slice(-100);
    }
  }, []);

  // Clear used songs (for new day)
  const clearUsedSongs = useCallback(() => {
    usedSongsRef.current = [];
    carryOverSongsRef.current = []; // Also clear carry-over for new day
  }, []);

  // Add song to carry-over queue (will be used in next block after download)
  const addCarryOverSong = useCallback((song: Omit<CarryOverSong, 'addedAt'>) => {
    // Avoid duplicates
    const exists = carryOverSongsRef.current.some(
      s => s.title.toLowerCase() === song.title.toLowerCase() && 
           s.artist.toLowerCase() === song.artist.toLowerCase()
    );
    if (!exists) {
      carryOverSongsRef.current.push({
        ...song,
        addedAt: new Date(),
      });
      console.log(`[CARRY-OVER] Adicionado para próximo bloco: ${song.artist} - ${song.title}`);
    }
    // Limit to last 50 songs
    if (carryOverSongsRef.current.length > 50) {
      carryOverSongsRef.current = carryOverSongsRef.current.slice(-50);
    }
  }, []);

  // Get carry-over songs for current block and remove them from queue
  const getCarryOverSongs = useCallback((blockTime: string): CarryOverSong[] => {
    const validSongs = carryOverSongsRef.current.filter(song => {
      // Song is valid if it was added at least 1 minute ago (download time)
      const ageMs = Date.now() - song.addedAt.getTime();
      return ageMs >= 60000; // 1 minute minimum
    });
    // Remove used songs from carry-over
    carryOverSongsRef.current = carryOverSongsRef.current.filter(song => {
      const ageMs = Date.now() - song.addedAt.getTime();
      return ageMs < 60000;
    });
    console.log(`[CARRY-OVER] ${validSongs.length} músicas disponíveis do bloco anterior`);
    return validSongs;
  }, []);

  // Check if song exists in music library and get the correct filename
  const findSongInLibrary = useCallback(async (artist: string, title: string): Promise<{ exists: boolean; filename?: string }> => {
    if (!isElectronEnv || !window.electronAPI?.findSongMatch) {
      return { exists: true }; // Web mode: assume exists
    }
    try {
      const result = await window.electronAPI.findSongMatch({
        artist,
        title,
        musicFolders: config.musicFolders,
      });
      if (result.exists && result.baseName) {
        // Return the actual filename from the library (without extension, we add .mp3)
        return { exists: true, filename: `${result.baseName}.mp3` };
      }
      return { exists: result.exists };
    } catch (error) {
      console.error('[GRADE] Error finding song match:', error);
      return { exists: true }; // On error, assume exists to avoid blocking
    }
  }, [config.musicFolders]);

  // Fallback check if song exists (for backwards compatibility)
  const checkSongInLibrary = useCallback(async (artist: string, title: string): Promise<boolean> => {
    const result = await findSongInLibrary(artist, title);
    return result.exists;
  }, [findSongInLibrary]);

  // Check if song is already in missing list
  const isSongAlreadyMissing = useCallback((artist: string, title: string): boolean => {
    return existingMissingSongs.some(
      s => s.artist.toLowerCase() === artist.toLowerCase() && 
           s.title.toLowerCase() === title.toLowerCase()
    );
  }, [existingMissingSongs]);

  // Fetch songs from Supabase for a specific 30-minute window BEFORE the block time
  // Block 17:30 → uses songs from 17:00-17:30
  // Block 18:00 → uses songs from 17:30-18:00
  const fetchSongsForBlock = useCallback(async (blockHour: number, blockMinute: number, targetDate?: Date): Promise<Record<string, SongEntry[]>> => {
    try {
      // Calculate the 30-minute window BEFORE this block
      const baseDate = targetDate || new Date();
      const blockTime = new Date(baseDate);
      blockTime.setHours(blockHour, blockMinute, 0, 0);
      
      // Window: 30 minutes before block start
      const windowEnd = blockTime.toISOString();
      const windowStart = new Date(blockTime.getTime() - 30 * 60 * 1000).toISOString();
      
      console.log(`[AUTO-GRADE] 🕐 Buscando músicas para bloco ${blockHour.toString().padStart(2, '0')}:${blockMinute.toString().padStart(2, '0')}`);
      console.log(`[AUTO-GRADE] 📅 Janela: ${windowStart.slice(11, 16)} → ${windowEnd.slice(11, 16)} UTC`);
      
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .gte('scraped_at', windowStart)
        .lte('scraped_at', windowEnd)
        .order('scraped_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      const songsByStation: Record<string, SongEntry[]> = {};
      const stationNameToStyle: Record<string, string> = {};
      const seenSongs = new Set<string>(); // Avoid duplicates

      // Build style mapping for all stations (by name AND by ID)
      stations.forEach(s => {
        stationNameToStyle[s.name] = s.styles?.[0] || 'POP/VARIADO';
        stationNameToStyle[s.name.toLowerCase()] = s.styles?.[0] || 'POP/VARIADO';
        stationNameToStyle[s.id] = s.styles?.[0] || 'POP/VARIADO';
      });

      data?.forEach(song => {
        // Skip duplicates (same title + artist)
        const songKey = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
        if (seenSongs.has(songKey)) return;
        seenSongs.add(songKey);

        if (!songsByStation[song.station_name]) {
          songsByStation[song.station_name] = [];
        }
        if (songsByStation[song.station_name].length < 50) {
          const style = stationNameToStyle[song.station_name] || stationNameToStyle[song.station_name.toLowerCase()] || 'POP/VARIADO';
          songsByStation[song.station_name].push({
            title: song.title,
            artist: song.artist,
            station: song.station_name,
            style,
            filename: sanitizeFilename(`${song.artist} - ${song.title}.mp3`),
          });
        }
      });

      // Log available stations for debugging
      const stationList = Object.keys(songsByStation).map(name => `${name}(${songsByStation[name].length})`).join(', ');
      console.log(`[AUTO-GRADE] Pool (janela 30min): ${stationList}`);

      return songsByStation;
    } catch (error) {
      console.error('[AUTO-GRADE] Error fetching songs for block:', error);
      logSystemError('GRADE', 'error', 'Erro ao buscar músicas do Supabase', String(error));
      return {};
    }
  }, [stations]);

  // Fallback: Fetch ALL recent songs (used for full day generation or when window is empty)
  const fetchAllRecentSongs = useCallback(async (): Promise<Record<string, SongEntry[]>> => {
    try {
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .order('scraped_at', { ascending: false })
        .limit(2000);

      if (error) throw error;

      const songsByStation: Record<string, SongEntry[]> = {};
      const stationNameToStyle: Record<string, string> = {};
      const seenSongs = new Set<string>();

      stations.forEach(s => {
        stationNameToStyle[s.name] = s.styles?.[0] || 'POP/VARIADO';
        stationNameToStyle[s.name.toLowerCase()] = s.styles?.[0] || 'POP/VARIADO';
        stationNameToStyle[s.id] = s.styles?.[0] || 'POP/VARIADO';
      });

      data?.forEach(song => {
        const songKey = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
        if (seenSongs.has(songKey)) return;
        seenSongs.add(songKey);

        if (!songsByStation[song.station_name]) {
          songsByStation[song.station_name] = [];
        }
        if (songsByStation[song.station_name].length < 150) {
          const style = stationNameToStyle[song.station_name] || stationNameToStyle[song.station_name.toLowerCase()] || 'POP/VARIADO';
          songsByStation[song.station_name].push({
            title: song.title,
            artist: song.artist,
            station: song.station_name,
            style,
            filename: sanitizeFilename(`${song.artist} - ${song.title}.mp3`),
          });
        }
      });

      const stationList = Object.keys(songsByStation).map(name => `${name}(${songsByStation[name].length})`).join(', ');
      console.log(`[AUTO-GRADE] Pool (completo): ${stationList}`);

      return songsByStation;
    } catch (error) {
      console.error('[AUTO-GRADE] Error fetching all songs:', error);
      logSystemError('GRADE', 'error', 'Erro ao buscar músicas do Supabase', String(error));
      return {};
    }
  }, [stations]);

  // Find substitute song with same DNA/style
  const findSubstitute = useCallback((
    style: string,
    songsByStation: Record<string, SongEntry[]>,
    blockTime: string,
    excludeTitles: Set<string>
  ): SongEntry | null => {
    // First, try from ranking songs with same style
    const rankingWithStyle = rankingSongs
      .filter(s => s.style === style)
      .sort((a, b) => b.plays - a.plays);

    for (const rs of rankingWithStyle) {
      const key = `${rs.title.toLowerCase()}-${rs.artist.toLowerCase()}`;
      if (!excludeTitles.has(key) && !isRecentlyUsed(rs.title, rs.artist, blockTime)) {
        return {
          title: rs.title,
          artist: rs.artist,
          station: 'RANKING',
          style: rs.style,
          filename: sanitizeFilename(`${rs.artist} - ${rs.title}.mp3`),
        };
      }
    }

    // Then, try from all stations with same style
    for (const [, songs] of Object.entries(songsByStation)) {
      for (const song of songs) {
        const key = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
        if (song.style === style && !excludeTitles.has(key) && !isRecentlyUsed(song.title, song.artist, blockTime)) {
          return song;
        }
      }
    }

    // Fallback: any song not recently used
    for (const [, songs] of Object.entries(songsByStation)) {
      for (const song of songs) {
        const key = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
        if (!excludeTitles.has(key) && !isRecentlyUsed(song.title, song.artist, blockTime)) {
          return song;
        }
      }
    }

    return null;
  }, [rankingSongs, isRecentlyUsed]);

  // Get TOP50 songs for grade - returns REAL song names, not position placeholders
  const getTop50Songs = useCallback((count: number, blockTime: string, startPosition: number = 0): string[] => {
    const sorted = [...rankingSongs].sort((a, b) => b.plays - a.plays);
    const result: string[] = [];

    // Start from the specified position (for 19:30 block, start from position 11)
    for (let i = startPosition; i < sorted.length && result.length < count; i++) {
      const song = sorted[i];
      
      if (!isRecentlyUsed(song.title, song.artist, blockTime)) {
        // Use REAL song name, not position placeholder
        const realFilename = sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
        result.push(realFilename);
        markSongAsUsed(song.title, song.artist, blockTime);
      }
    }

    return result;
  }, [rankingSongs, isRecentlyUsed, markSongAsUsed]);

  // Process fixed content filename placeholders
  // {HH} → 2-digit hour, {DIA} → FULL day name (SEGUNDA, TERCA, etc.) - NO abbreviation, {ED} → edition number
  const processFixedContentFilename = useCallback((
    fileName: string,
    hour: number,
    minute: number,
    editionIndex: number,
    targetDay?: WeekDay
  ): string => {
    // Use FULL day name (SEGUNDA, TERCA, etc.) - NOT abbreviated (SEG, TER)
    const fullDayName = getFullDayName(targetDay);
    const hourStr = hour.toString().padStart(2, '0');
    const edition = (editionIndex + 1).toString().padStart(2, '0');
    
    let result = fileName
      .replace(/\{HH\}/gi, hourStr)
      .replace(/\{DIA\}/gi, fullDayName)
      .replace(/\{ED\}/gi, edition);
    
    // CRITICAL: Always append _{DIA} (full name) if the filename doesn't already have it
    // This ensures all fixed content files are identified by day
    const hasFullDayName = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO']
      .some(day => result.toUpperCase().includes(`_${day}`));
    
    if (!result.toLowerCase().includes('_{dia}') && !hasFullDayName) {
      // Remove .mp3 extension if present, add full day name, then re-add extension
      if (result.toLowerCase().endsWith('.mp3')) {
        result = result.slice(0, -4) + `_${fullDayName}.mp3`;
      } else {
        result = result + `_${fullDayName}`;
      }
    } else {
      // Replace any remaining {DIA} placeholder (case insensitive)
      result = result.replace(/\{DIA\}/gi, fullDayName);
    }
    
    // Ensure uppercase and proper formatting
    // Use processFixedContentTemplate for final sanitization
    return processFixedContentTemplate(result, hour, fullDayName);
  }, [getFullDayName]);

  // Generate a single block line with format: "musica1.mp3",vht,"musica2.mp3",vht,...
  // isFullDay = true uses shorter repetition window (30 min instead of 60)
  // targetDay allows specifying which day of the week for full-day generation
  const generateBlockLine = useCallback(async (
    hour: number,
    minute: number,
    songsByStation: Record<string, SongEntry[]>,
    stats: { skipped: number; substituted: number; missing: number },
    isFullDay: boolean = false,
    targetDay?: WeekDay
  ): Promise<{ line: string; logs: Parameters<typeof addBlockLogs>[0] }> => {
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const programName = getProgramForHour(hour);
    const fixedItems = getFixedContentForTime(hour, minute);
    const blockLogs: Parameters<typeof addBlockLogs>[0] = [];

    // Voz do Brasil (21:00 weekdays) - Fixed block with EXACT format (no sanitization needed)
    if (hour === 21 && minute === 0 && isWeekday(targetDay)) {
      blockLogs.push({
        blockTime: timeStr,
        type: 'fixed',
        title: 'A Voz do Brasil',
        artist: 'Governo Federal',
        station: 'EBC',
        reason: 'Conteúdo fixo obrigatório - sem montagem do sistema',
      });
      // HARDCODED format - never goes through sanitizeGradeLine to prevent any corruption
      return { 
        line: '21:00 (FIXO ID=VOZ DO BRASIL) vht,VOZ_DO_BRASIL',
        logs: blockLogs,
      };
    }

    // MISTURADAO blocks - Special format for 20:00 and 20:30 (Monday to Friday only)
    // 20:00: MISTURADAO_BLOCO01_{DIA}.mp3, posicao05, MISTURADAO_BLOCO02_{DIA}.mp3, posicao02
    // 20:30: MISTURADAO_BLOCO03_{DIA}.mp3, posicao08, MISTURADAO_BLOCO04_{DIA}.mp3, posicao09
    if ((hour === 20 && (minute === 0 || minute === 30)) && isWeekday(targetDay)) {
      const dayName = getFullDayName(targetDay);
      const sortedRanking = [...rankingSongs].sort((a, b) => b.plays - a.plays);
      
      // Helper to get ranking filename by position (1-indexed)
      const getRankingFilename = (position: number): string => {
        if (position <= sortedRanking.length && position > 0) {
          const song = sortedRanking[position - 1];
          return sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
        }
        // Fallback to position placeholder if ranking not available
        return `posicao${position.toString().padStart(2, '0')}.mp3`;
      };
      
      if (minute === 0) {
        // 20:00 block format
        const misturadao01 = `MISTURADAO_BLOCO01_${dayName}.mp3`;
        const posicao05 = getRankingFilename(5);
        const misturadao02 = `MISTURADAO_BLOCO02_${dayName}.mp3`;
        const posicao02 = getRankingFilename(2);
        
        blockLogs.push({
          blockTime: timeStr,
          type: 'fixed',
          title: 'MISTURADÃO Bloco 20:00',
          artist: `${misturadao01}, ${misturadao02}`,
          station: 'FIXO',
          reason: `Formato especial com ranking posições 2 e 5`,
        });
        
        return {
          line: sanitizeGradeLine(`${timeStr} (ID=MISTURADAO) "${misturadao01}",vht,"${posicao05}",vht,"${misturadao02}",vht,"${posicao02}"`),
          logs: blockLogs,
        };
      } else {
        // 20:30 block format
        const misturadao03 = `MISTURADAO_BLOCO03_${dayName}.mp3`;
        const posicao08 = getRankingFilename(8);
        const misturadao04 = `MISTURADAO_BLOCO04_${dayName}.mp3`;
        const posicao09 = getRankingFilename(9);
        
        blockLogs.push({
          blockTime: timeStr,
          type: 'fixed',
          title: 'MISTURADÃO Bloco 20:30',
          artist: `${misturadao03}, ${misturadao04}`,
          station: 'FIXO',
          reason: `Formato especial com ranking posições 8 e 9`,
        });
        
        return {
          line: sanitizeGradeLine(`${timeStr} (ID=MISTURADAO) "${misturadao03}",vht,"${posicao08}",vht,"${misturadao04}",vht,"${posicao09}"`),
          logs: blockLogs,
        };
      }
    }

    // TOP50 blocks - USE REAL SONG NAMES from ranking, not position placeholders
    const top50Item = fixedItems.find(fc => fc.type === 'top50');
    if (top50Item) {
      const top50Count = top50Item.top50Count || 10;
      
      // For 19:00 block: positions 1-10, for 19:30: positions 11-20
      const blockIndex = (hour - 19) * 2 + (minute === 30 ? 1 : 0);
      const startPosition = Math.max(0, blockIndex * 10);
      
      // Get REAL song names from ranking (not POSICAO01.mp3 placeholders!)
      const top50Songs = getTop50Songs(top50Count, timeStr, startPosition);
      if (top50Songs.length > 0) {
        blockLogs.push({
          blockTime: timeStr,
          type: 'fixed',
          title: `TOP50 - Posições ${startPosition + 1} a ${startPosition + top50Songs.length}`,
          artist: 'Ranking',
          station: 'TOP50',
          reason: `Bloco TOP50 com músicas reais do ranking (posições ${startPosition + 1}-${startPosition + top50Songs.length})`,
        });
        // Songs are already real filenames like "Shallow - Lady Gaga.mp3"
        return { 
          line: sanitizeGradeLine(`${timeStr} (ID=TOP50) ${top50Songs.map(s => `"${s}"`).join(',vht,')}`),
          logs: blockLogs,
        };
      }
    }

    // Fixed content block (not TOP50 or vozbrasil) - Process placeholders and add _{DIA}
    const fixedItem = fixedItems.find(fc => fc.type !== 'top50' && fc.type !== 'vozbrasil');
    let fixedContentFile: string | null = null;
    let fixedPosition: 'start' | 'middle' | 'end' | number = 'start';
    
    // Track edition index for multiple fixed content in same time slot
    let editionIndex = 0;
    
    if (fixedItem) {
      // Process filename with placeholders: {HH}, {DIA}, {ED}
      const processedFileName = processFixedContentFilename(
        fixedItem.fileName,
        hour,
        minute,
        editionIndex,
        targetDay
      );
      editionIndex++;
      
      // Ensure it ends with .mp3 (case-insensitive check since processFixedContentTemplate returns UPPERCASE)
      const finalFileName = processedFileName.toLowerCase().endsWith('.mp3') 
        ? processedFileName 
        : `${processedFileName}.mp3`;
      
      fixedContentFile = `"${finalFileName}"`;
      fixedPosition = fixedItem.position || 'start';
      
      blockLogs.push({
        blockTime: timeStr,
        type: 'fixed',
        title: fixedItem.name,
        artist: finalFileName,
        station: 'FIXO',
        reason: `Conteúdo fixo com dia: ${getDayCode(targetDay)}`,
      });
    }

    // Normal block with 10 songs following the configured SEQUENCE
    const songs: string[] = [];
    const usedInBlock = new Set<string>(); // song keys (title-artist)
    const usedArtistsInBlock = new Set<string>(); // artist names - prevent same artist in same block
    
    // Build station ID to name mapping - include normalized variants for flexible matching
    const stationIdToName: Record<string, string> = {};
    const stationNameToId: Record<string, string> = {};
    
    stations.forEach(s => {
      stationIdToName[s.id] = s.name;
      stationIdToName[s.id.toLowerCase()] = s.name;
      // Also map normalized name back to name
      stationNameToId[s.name.toLowerCase().replace(/[^a-z0-9]/g, '')] = s.name;
      stationNameToId[s.name.toLowerCase()] = s.name;
    });

    // Create a flattened pool of all songs for fallback
    const allSongsPool: SongEntry[] = [];
    for (const stationName of Object.keys(songsByStation)) {
      const stationSongs = songsByStation[stationName];
      for (const song of stationSongs) {
        allSongsPool.push(song);
      }
    }

    // PRIORITY 0: Check carry-over songs from previous block (already downloaded)
    const carryOverAvailable = getCarryOverSongs(timeStr);
    const carryOverByStation: Record<string, SongEntry[]> = {};
    
    for (const carryOver of carryOverAvailable) {
      // Verify that carry-over song now exists in library
      const libraryResult = await findSongInLibrary(carryOver.artist, carryOver.title);
      if (libraryResult.exists) {
        const correctFilename = libraryResult.filename || sanitizeFilename(`${carryOver.artist} - ${carryOver.title}.mp3`);
        const songEntry: SongEntry = {
          title: carryOver.title,
          artist: carryOver.artist,
          station: carryOver.station,
          style: carryOver.style,
          filename: correctFilename,
          existsInLibrary: true,
        };
        if (!carryOverByStation[carryOver.station]) {
          carryOverByStation[carryOver.station] = [];
        }
        carryOverByStation[carryOver.station].push(songEntry);
        console.log(`[CARRY-OVER] ✅ Música agora disponível: ${carryOver.artist} - ${carryOver.title}`);
      }
    }

    // Track song index per station to avoid repeating from start
    const stationSongIndex: Record<string, number> = {};

    // Helper to get the next fixed content for this block (with _{DIA} suffix)
    let fixoIndexUsed = 0;
    const getNextFixoContent = (): string | null => {
      const availableFixed = fixedContent.filter(fc => 
        fc.enabled && 
        fc.type !== 'top50' && 
        fc.type !== 'vozbrasil'
      );
      if (availableFixed.length === 0) return null;
      
      // Use round-robin for multiple FIXO in sequence
      const selectedFixed = availableFixed[fixoIndexUsed % availableFixed.length];
      
      // Process filename with placeholders and add _{DIA}
      const processedFileName = processFixedContentFilename(
        selectedFixed.fileName,
        hour,
        minute,
        fixoIndexUsed,
        targetDay
      );
      fixoIndexUsed++;
      
      // Ensure .mp3 extension (case-insensitive check)
      const finalFileName = processedFileName.toLowerCase().endsWith('.mp3') 
        ? processedFileName 
        : `${processedFileName}.mp3`;
      
      blockLogs.push({
        blockTime: timeStr,
        type: 'fixed',
        title: selectedFixed.name,
        artist: finalFileName,
        station: 'FIXO',
        reason: `Conteúdo fixo da sequência (${getDayCode(targetDay)})`,
      });
      return `"${finalFileName}"`;
    };

    // Helper to get TOP50 song for sequence position
    let top50IndexUsed = 0;
    const getNextTop50Song = (): string | null => {
      const sortedRanking = [...rankingSongs].sort((a, b) => b.plays - a.plays);
      
      while (top50IndexUsed < sortedRanking.length) {
        const rankSong = sortedRanking[top50IndexUsed];
        const key = `${rankSong.title.toLowerCase()}-${rankSong.artist.toLowerCase()}`;
        top50IndexUsed++;
        
        const normalizedArtist = rankSong.artist.toLowerCase().trim();
        if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !isRecentlyUsed(rankSong.title, rankSong.artist, timeStr, isFullDay)) {
          usedInBlock.add(key);
          usedArtistsInBlock.add(normalizedArtist);
          markSongAsUsed(rankSong.title, rankSong.artist, timeStr);
          
          blockLogs.push({
            blockTime: timeStr,
            type: 'used',
            title: rankSong.title,
            artist: rankSong.artist,
            station: 'TOP50',
            style: rankSong.style,
            reason: `TOP50 posição ${top50IndexUsed}`,
          });
          
          return `"${sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`)}"`;
        }
      }
      return null;
    };

    // Get active sequence for this specific block time
    const activeSequence = getActiveSequenceForBlock(hour, minute);
    
    // Log which sequence is being used (helps debug)
    const seqSummary = activeSequence.slice(0, 3).map(s => s.radioSource).join(', ');
    console.log(`[GRADE] Bloco ${timeStr}: usando sequência [${seqSummary}...] (${activeSequence.length} posições)`);
    
    // Follow the user-configured SEQUENCE (position 1 = Band FM, position 2 = Clube FM, etc.)
    for (const seq of activeSequence) {
      if (songs.length >= activeSequence.length) break; // Use sequence length as max

      // Handle special sequence types - check for specific fixed content (fixo_ID)
      if (seq.radioSource.startsWith('fixo_')) {
        // Specific FIXO content selected by ID
        const contentId = seq.radioSource.replace('fixo_', '');
        const specificContent = fixedContent.find(fc => fc.id === contentId && fc.enabled);
        
        if (specificContent) {
          // Use customFileName if set, otherwise use the default from the content
          const fileNameToUse = seq.customFileName || specificContent.fileName;
          
          // Process filename with placeholders and add _{DIA}
          const processedFileName = processFixedContentFilename(
            fileNameToUse,
            hour,
            minute,
            0, // edition index
            targetDay
          );
          
          // Ensure .mp3 extension (case-insensitive check)
          const finalFileName = processedFileName.toLowerCase().endsWith('.mp3') 
            ? processedFileName 
            : `${processedFileName}.mp3`;
          
          blockLogs.push({
            blockTime: timeStr,
            type: 'fixed',
            title: specificContent.name,
            artist: finalFileName,
            station: 'FIXO',
            reason: seq.customFileName 
              ? `Conteúdo fixo personalizado (${getDayCode(targetDay)})` 
              : `Conteúdo fixo da sequência (${getDayCode(targetDay)})`,
          });
          songs.push(`"${finalFileName}"`);
        } else {
          // Specific content not found or disabled, use coringa
          const coringaCode = (config.coringaCode || 'mus').replace('.mp3', '');
          songs.push(coringaCode);
          blockLogs.push({
            blockTime: timeStr,
            type: 'substituted',
            title: 'FIXO',
            artist: 'CORINGA',
            station: 'FALLBACK',
            reason: `Conteúdo fixo ID ${contentId} não encontrado ou desabilitado`,
          });
        }
        continue;
      }
      
      // Handle generic 'fixo' (backwards compatibility)
      if (seq.radioSource === 'fixo') {
        // FIXO in sequence - insert fixed content (round-robin)
        const fixoContent = getNextFixoContent();
        if (fixoContent) {
          songs.push(fixoContent);
        } else {
          // No fixed content available, use coringa
          const coringaCode = (config.coringaCode || 'mus').replace('.mp3', '');
          songs.push(coringaCode);
          blockLogs.push({
            blockTime: timeStr,
            type: 'substituted',
            title: 'FIXO',
            artist: 'CORINGA',
            station: 'FALLBACK',
            reason: 'Nenhum conteúdo fixo disponível',
          });
        }
        continue;
      }

      if (seq.radioSource === 'top50') {
        // TOP50 in sequence - insert top ranked song
        const top50Song = getNextTop50Song();
        if (top50Song) {
          songs.push(top50Song);
        } else {
          // No TOP50 available, use coringa
          const coringaCode = (config.coringaCode || 'mus').replace('.mp3', '');
          songs.push(coringaCode);
          blockLogs.push({
            blockTime: timeStr,
            type: 'substituted',
            title: 'TOP50',
            artist: 'CORINGA',
            station: 'FALLBACK',
            reason: 'Ranking TOP50 vazio',
          });
        }
        continue;
      }

      if (seq.radioSource === 'random_pop') {
        // Random from any station
        let foundRandom = false;
        for (const candidate of allSongsPool) {
          const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
          
          const normalizedArtist = candidate.artist.toLowerCase().trim();
          if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
            const libraryResult = await findSongInLibrary(candidate.artist, candidate.title);
            
            if (libraryResult.exists) {
              const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
              songs.push(`"${correctFilename}"`);
              usedInBlock.add(key);
              usedArtistsInBlock.add(normalizedArtist);
              markSongAsUsed(candidate.title, candidate.artist, timeStr);
              
              blockLogs.push({
                blockTime: timeStr,
                type: 'used',
                title: candidate.title,
                artist: candidate.artist,
                station: candidate.station,
                style: candidate.style,
                reason: 'Aleatório',
              });
              foundRandom = true;
              break;
            }
          }
        }
        
        if (!foundRandom) {
          const coringaCode = (config.coringaCode || 'mus').replace('.mp3', '');
          songs.push(coringaCode);
          blockLogs.push({
            blockTime: timeStr,
            type: 'substituted',
            title: 'RANDOM',
            artist: 'CORINGA',
            station: 'FALLBACK',
            reason: 'Nenhuma música aleatória disponível',
          });
        }
        continue;
      }

      // Normal station logic - flexible station name resolution
      // The seq.radioSource is the station ID (e.g., 'bh', 'band', 'globo', 'mix', etc.)
      // We need to map it to the actual station_name in songsByStation (e.g., 'BH FM', 'Band FM', etc.)
      
      // Step 1: Use explicit mapping first (most reliable)
      let stationName = STATION_ID_TO_DB_NAME[seq.radioSource] || STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()] || '';
      
      // Step 2: Fallback to station config if explicit mapping not found
      if (!stationName) {
        const stationConfig = stations.find(s => s.id === seq.radioSource || s.id.toLowerCase() === seq.radioSource.toLowerCase());
        stationName = stationConfig?.name || '';
      }
      
      // Step 3: Get songs for this station from the pool
      let stationSongs: SongEntry[] = [];
      
      if (stationName && songsByStation[stationName]) {
        // Direct match by name
        stationSongs = songsByStation[stationName];
      } else {
        // Try flexible matching - the station_name in database might be slightly different
        const normalizedConfigName = stationName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normalizedSource = seq.radioSource.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        for (const [poolStationName, poolSongs] of Object.entries(songsByStation)) {
          const normalizedPool = poolStationName.toLowerCase().replace(/[^a-z0-9]/g, '');
          
          // Match by: exact ID, config name, or partial match
          if (normalizedPool === normalizedSource || 
              normalizedPool === normalizedConfigName ||
              normalizedPool.includes(normalizedSource) || 
              normalizedSource.includes(normalizedPool)) {
            stationName = poolStationName;
            stationSongs = poolSongs;
            break;
          }
        }
      }
      
      const stationStyle = getStationStyle(seq.radioSource);
      
      // Log if no songs found for this station (helps debug)
      if (stationSongs.length === 0) {
        console.log(`[GRADE] ⚠️ Sem músicas para ${seq.radioSource} (${stationName || 'não mapeado'})`);
      }
      
      // Initialize index for this station
      if (stationName && stationSongIndex[stationName] === undefined) {
        stationSongIndex[stationName] = 0;
      }

      let selectedSong: SongEntry | null = null;
      let startIndex = stationSongIndex[stationName] || 0;
      let checkedCount = 0;

      // PRIORITY 0: Check carry-over songs for this station first (already downloaded!)
      const carryOverForStation = carryOverByStation[stationName] || [];
      for (const carryOverSong of carryOverForStation) {
        const key = `${carryOverSong.title.toLowerCase()}-${carryOverSong.artist.toLowerCase()}`;
        const normalizedArtist = carryOverSong.artist.toLowerCase().trim();
        if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !isRecentlyUsed(carryOverSong.title, carryOverSong.artist, timeStr, isFullDay)) {
          selectedSong = carryOverSong;
          usedInBlock.add(key);
          usedArtistsInBlock.add(normalizedArtist);
          blockLogs.push({
            blockTime: timeStr,
            type: 'used',
            title: carryOverSong.title,
            artist: carryOverSong.artist,
            station: carryOverSong.station,
            style: carryOverSong.style,
            reason: '✅ Carry-over do bloco anterior (já baixada)',
          });
          console.log(`[CARRY-OVER] ✅ Usando música recuperada: ${carryOverSong.artist} - ${carryOverSong.title}`);
          break;
        }
      }

      // PRIORITY 1: Try to find a song from the configured station that EXISTS in library
      if (!selectedSong) {
        while (checkedCount < (stationSongs?.length || 0) && !selectedSong) {
          const songIdx = (startIndex + checkedCount) % stationSongs.length;
          const candidate = stationSongs[songIdx];
          const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;

          const normalizedArtist = candidate.artist.toLowerCase().trim();
          // Check if not used in this block, artist not already used, and not recently used
          if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
            const libraryResult = await findSongInLibrary(candidate.artist, candidate.title);
            
            if (libraryResult.exists) {
              // Found a song that EXISTS - use the filename from library for correct spelling
              const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
              selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
              stationSongIndex[stationName] = (songIdx + 1) % stationSongs.length;
              break;
            } else {
              // Mark as missing for download AND add to carry-over for next block
              if (!isSongAlreadyMissing(candidate.artist, candidate.title)) {
                addMissingSong({
                  id: `missing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  title: candidate.title,
                  artist: candidate.artist,
                  station: stationName || 'UNKNOWN',
                  timestamp: new Date(),
                  status: 'missing',
                  dna: stationStyle,
                });
              }
              
              // Add to carry-over queue for next block (downloads are fast ~1 min)
              addCarryOverSong({
                title: candidate.title,
                artist: candidate.artist,
                station: stationName || 'UNKNOWN',
                style: stationStyle,
                targetBlock: timeStr,
              });
            }
          }
          checkedCount++;
        }
      }

      // PRIORITY 2: Substitute with TOP50 song that EXISTS
      if (!selectedSong) {
        const sortedRanking = [...rankingSongs].sort((a, b) => b.plays - a.plays);
        
        for (const rankSong of sortedRanking) {
          const key = `${rankSong.title.toLowerCase()}-${rankSong.artist.toLowerCase()}`;
          
          const normalizedArtist = rankSong.artist.toLowerCase().trim();
          if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !isRecentlyUsed(rankSong.title, rankSong.artist, timeStr, isFullDay)) {
            const libraryResult = await findSongInLibrary(rankSong.artist, rankSong.title);
            
            if (libraryResult.exists) {
              const correctFilename = libraryResult.filename || sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`);
              selectedSong = {
                title: rankSong.title,
                artist: rankSong.artist,
                station: 'TOP50',
                style: rankSong.style,
                filename: correctFilename,
                existsInLibrary: true,
              };
              stats.substituted++;
              blockLogs.push({
                blockTime: timeStr,
                type: 'substituted',
                title: rankSong.title,
                artist: rankSong.artist,
                station: 'TOP50',
                style: rankSong.style,
                reason: `TOP50 substituto (posição ${sortedRanking.indexOf(rankSong) + 1})`,
                substituteFor: stationName || 'UNKNOWN',
              });
              break;
            }
          }
        }
      }

      // PRIORITY 3: Substitute with same DNA/style song that EXISTS
      if (!selectedSong) {
        // Try songs from other stations with same style
        for (const [otherStation, songs] of Object.entries(songsByStation)) {
          if (otherStation === stationName) continue; // Skip same station
          
          for (const candidate of songs) {
            if (candidate.style !== stationStyle) continue; // Must match DNA
            
            const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
            
            const normalizedArtist = candidate.artist.toLowerCase().trim();
            if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
              const libraryResult = await findSongInLibrary(candidate.artist, candidate.title);
              
              if (libraryResult.exists) {
                const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
                selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
                stats.substituted++;
                blockLogs.push({
                  blockTime: timeStr,
                  type: 'substituted',
                  title: candidate.title,
                  artist: candidate.artist,
                  station: candidate.station,
                  style: candidate.style,
                  reason: `DNA similar: ${stationStyle}`,
                  substituteFor: stationName || 'UNKNOWN',
                });
                break;
              }
            }
          }
          if (selectedSong) break;
        }
      }

      // PRIORITY 4: Any song from pool that EXISTS
      if (!selectedSong) {
        for (const candidate of allSongsPool) {
          const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
          
          const normalizedArtist = candidate.artist.toLowerCase().trim();
          if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
            const libraryResult = await findSongInLibrary(candidate.artist, candidate.title);
            
            if (libraryResult.exists) {
              const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
              selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
              stats.substituted++;
              blockLogs.push({
                blockTime: timeStr,
                type: 'substituted',
                title: candidate.title,
                artist: candidate.artist,
                station: candidate.station,
                style: candidate.style,
                reason: 'Pool geral (última opção)',
              });
              break;
            }
          }
        }
      }

      // PRIORITY 5: CURADORIA - Try any song from ranking that exists in library
      if (!selectedSong) {
        // Use ALL ranking songs as curadoria pool (not just top ones)
        const shuffledRanking = [...rankingSongs].sort(() => Math.random() - 0.5);
        
        for (const rankSong of shuffledRanking) {
          const key = `${rankSong.title.toLowerCase()}-${rankSong.artist.toLowerCase()}`;
          
          const normalizedArtist = rankSong.artist.toLowerCase().trim();
          if (!usedInBlock.has(key) && !usedArtistsInBlock.has(normalizedArtist) && !isRecentlyUsed(rankSong.title, rankSong.artist, timeStr, isFullDay)) {
            const libraryResult = await findSongInLibrary(rankSong.artist, rankSong.title);
            
            if (libraryResult.exists) {
              const correctFilename = libraryResult.filename || sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`);
              selectedSong = {
                title: rankSong.title,
                artist: rankSong.artist,
                station: 'CURADORIA',
                style: rankSong.style,
                filename: correctFilename,
                existsInLibrary: true,
              };
              stats.substituted++;
              blockLogs.push({
                blockTime: timeStr,
                type: 'substituted',
                title: rankSong.title,
                artist: rankSong.artist,
                station: 'CURADORIA',
                style: rankSong.style,
                reason: 'Curadoria automática do ranking',
              });
              break;
            }
          }
        }
      }

      if (selectedSong) {
        // Format: "Artista - Musica.mp3" (already sanitized via filename property)
        songs.push(`"${selectedSong.filename}"`);
        usedInBlock.add(`${selectedSong.title.toLowerCase()}-${selectedSong.artist.toLowerCase()}`);
        usedArtistsInBlock.add(selectedSong.artist.toLowerCase().trim());
        markSongAsUsed(selectedSong.title, selectedSong.artist, timeStr);
        
        blockLogs.push({
          blockTime: timeStr,
          type: 'used',
          title: selectedSong.title,
          artist: selectedSong.artist,
          station: selectedSong.station,
          style: selectedSong.style,
        });
      } else {
        // Ultimate fallback: coringa code (NO quotes, NO .mp3)
        const coringaCode = (config.coringaCode || 'mus').replace('.mp3', '');
        songs.push(coringaCode);
        stats.missing++;
        blockLogs.push({
          blockTime: timeStr,
          type: 'substituted',
          title: coringaCode,
          artist: 'CORINGA',
          station: 'FALLBACK',
          reason: 'Nenhuma música válida encontrada, usando coringa para curadoria manual',
        });
      }
    }

    // Build line with format based on fixed content position
    // Insert fixed content at the configured position
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
        // Insert at specific position (1-indexed, so position 1 = index 0)
        const insertIndex = Math.max(0, Math.min(fixedPosition - 1, songs.length));
        allContent = [...songs.slice(0, insertIndex), fixedContentFile, ...songs.slice(insertIndex)];
      }
    }
    
    const lineContent = allContent.join(',vht,');
    return {
      line: sanitizeGradeLine(`${timeStr} (ID=${programName}) ${lineContent}`),
      logs: blockLogs,
    };
  }, [
    getProgramForHour, getFixedContentForTime, isWeekday, getTop50Songs,
    stations, getActiveSequenceForBlock, getStationStyle, isRecentlyUsed, findSubstitute,
    markSongAsUsed, config.coringaCode, checkSongInLibrary, isSongAlreadyMissing,
    addMissingSong, addCarryOverSong, getCarryOverSongs, findSongInLibrary,
    processFixedContentFilename, getDayCode, fixedContent, rankingSongs
  ]);

  // Calculate current and next block times
  const getBlockTimes = useCallback(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const currentBlockHour = currentHour;
    const currentBlockMinute = currentMinute < 30 ? 0 : 30;

    let nextBlockHour = currentBlockMinute === 30 ? (currentHour + 1) % 24 : currentHour;
    const nextBlockMinute = currentBlockMinute === 30 ? 0 : 30;

    return {
      current: { hour: currentBlockHour, minute: currentBlockMinute },
      next: { hour: nextBlockHour, minute: nextBlockMinute },
    };
  }, []);

  // Generate complete day's grade (48 blocks from 00:00 to 23:30) with PROGRESSIVE SAVING
  const buildFullDayGrade = useCallback(async () => {
    if (!isElectronEnv || !window.electronAPI?.saveGradeFile) {
      toast({
        title: '⚠️ Modo Web',
        description: 'Geração de grade disponível apenas no aplicativo desktop.',
      });
      return;
    }

    setState(prev => ({ 
      ...prev, 
      isBuilding: true, 
      error: null,
      fullDayProgress: 0,
      fullDayTotal: 48,
      skippedSongs: 0,
      substitutedSongs: 0,
      missingSongs: 0,
      currentProcessingSong: null,
      currentProcessingBlock: null,
      lastSaveProgress: 0,
    }));

    // Calculate target day for fixed content naming
    const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
    const targetDay = dayMap[new Date().getDay()];
    const dayCode = getDayCode(targetDay);
    const filename = `${dayCode}.txt`;

    try {
      console.log('[AUTO-GRADE] 🚀 Building full day grade with progressive saving...');
      logSystemError('GRADE', 'info', 'Iniciando geração da grade completa (salvamento progressivo)');
      
      clearUsedSongs();

      // For full day, use all recent songs (fallback pool)
      const songsByStation = await fetchAllRecentSongs();
      
      const stats = { skipped: 0, substituted: 0, missing: 0 };
      const lines: string[] = [];
      const allLogs: Parameters<typeof addBlockLogs>[0] = [];
      let blockCount = 0;

      // Generate all 48 blocks (00:00 to 23:30) with progressive saving
      for (let hour = 0; hour < 24; hour++) {
        for (const minute of [0, 30]) {
          const blockTimeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          
          // Update current processing block
          setState(prev => ({
            ...prev,
            currentProcessingBlock: blockTimeStr,
            currentProcessingSong: `Processando bloco ${blockTimeStr}...`,
          }));

          // Pass isFullDay=true for shorter repetition window, and targetDay for _{DIA} suffix
          const result = await generateBlockLine(hour, minute, songsByStation, stats, true, targetDay);
          lines.push(result.line);
          allLogs.push(...result.logs);
          blockCount++;
          
          // Extract last processed song from logs for display
          const lastLog = result.logs.filter(l => l.type === 'used' || l.type === 'substituted').pop();
          const currentSongInfo = lastLog 
            ? `${lastLog.artist} - ${lastLog.title}` 
            : 'Processando...';
          
          setState(prev => ({
            ...prev,
            fullDayProgress: blockCount,
            skippedSongs: stats.skipped,
            substitutedSongs: stats.substituted,
            missingSongs: stats.missing,
            currentProcessingSong: currentSongInfo,
          }));

          // PROGRESSIVE SAVE: Save every 4 blocks (2 hours of programming)
          if (blockCount % 4 === 0 || blockCount === 48) {
            const content = lines.join('\n');
            
            try {
              const saveResult = await window.electronAPI.saveGradeFile({
                folder: config.gradeFolder,
                filename,
                content,
              });
              
              if (saveResult.success) {
                console.log(`[AUTO-GRADE] 💾 Progressive save: ${blockCount}/48 blocos`);
                setState(prev => ({
                  ...prev,
                  lastSaveProgress: blockCount,
                  lastSavedFile: filename,
                }));
              }
            } catch (saveError) {
              console.error('[AUTO-GRADE] Progressive save error:', saveError);
            }
          }

          // Delay between blocks to prevent UI freeze and allow state updates (2 seconds)
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Add all logs to store
      addBlockLogs(allLogs);

      // Final save (redundant but ensures complete save)
      const finalContent = lines.join('\n');
      const result = await window.electronAPI.saveGradeFile({
        folder: config.gradeFolder,
        filename,
        content: finalContent,
      });

      if (result.success) {
        console.log(`[AUTO-GRADE] ✅ Full day grade saved: ${result.filePath}`);
        logSystemError('GRADE', 'info', `Grade completa salva: ${filename}`, `${lines.length} blocos, ${stats.skipped} puladas, ${stats.substituted} substituídas, ${stats.missing} faltando`);
        
        addGradeHistory({
          id: `grade-fullday-${Date.now()}`,
          timestamp: new Date(),
          blockTime: 'COMPLETA',
          songsProcessed: 48 * defaultSequence.length,
          songsFound: lines.length,
          songsMissing: stats.missing,
          programName: 'Grade Completa',
        });

        setState(prev => ({
          ...prev,
          isBuilding: false,
          lastBuildTime: new Date(),
          lastSavedFile: filename,
          blocksGenerated: prev.blocksGenerated + 48,
          fullDayProgress: 48,
          fullDayTotal: 0,
          skippedSongs: stats.skipped,
          substitutedSongs: stats.substituted,
          missingSongs: stats.missing,
          currentProcessingSong: null,
          currentProcessingBlock: null,
        }));

        toast({
          title: '✅ Grade Completa Gerada!',
          description: `${filename} salvo com 48 blocos. ${stats.skipped} puladas, ${stats.substituted} substituídas, ${stats.missing} faltando.`,
        });
      } else {
        throw new Error(result.error || 'Erro ao salvar grade');
      }
    } catch (error) {
      console.error('[AUTO-GRADE] Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logSystemError('GRADE', 'error', 'Erro na geração da grade completa', errorMessage);
      
      setState(prev => ({ 
        ...prev, 
        isBuilding: false, 
        error: errorMessage, 
        fullDayTotal: 0,
        currentProcessingSong: null,
        currentProcessingBlock: null,
      }));
      toast({
        title: '❌ Erro na Grade',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  }, [
    clearUsedSongs, fetchAllRecentSongs, generateBlockLine,
    getDayCode, config.gradeFolder, addGradeHistory, defaultSequence.length, toast, addBlockLogs
  ]);

  // Build current and next blocks (incremental update to existing file)
  // ALWAYS saves to destination folder - ensuring current time slot is updated
  const buildGrade = useCallback(async () => {
    if (!isElectronEnv || !window.electronAPI?.saveGradeFile) {
      console.log('[AUTO-GRADE] Not in Electron mode, skipping');
      return;
    }

    setState(prev => ({ ...prev, isBuilding: true, error: null }));

    try {
      const blocks = getBlockTimes();
      const currentTimeKey = `${blocks.current.hour.toString().padStart(2, '0')}:${blocks.current.minute.toString().padStart(2, '0')}`;
      const nextTimeKey = `${blocks.next.hour.toString().padStart(2, '0')}:${blocks.next.minute.toString().padStart(2, '0')}`;

      console.log(`[AUTO-GRADE] 🔄 Atualizando blocos: ${currentTimeKey}, ${nextTimeKey} -> salvando na pasta destino`);

      // Fetch songs from 30-minute window BEFORE each block (mirrors radio timing)
      const currentSongsByStation = await fetchSongsForBlock(blocks.current.hour, blocks.current.minute);
      const nextSongsByStation = await fetchSongsForBlock(blocks.next.hour, blocks.next.minute);
      
      // Fallback: if window is empty, use all recent songs
      const fallbackSongs = (Object.keys(currentSongsByStation).length === 0 || Object.keys(nextSongsByStation).length === 0) 
        ? await fetchAllRecentSongs() 
        : {};
      
      const currentPool = Object.keys(currentSongsByStation).length > 0 ? currentSongsByStation : fallbackSongs;
      const nextPool = Object.keys(nextSongsByStation).length > 0 ? nextSongsByStation : fallbackSongs;
      
      const stats = { skipped: 0, substituted: 0, missing: 0 };
      const allLogs: Parameters<typeof addBlockLogs>[0] = [];

      // Calculate target day for fixed content naming
      const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
      const targetDay = dayMap[new Date().getDay()];

      // Generate current and next blocks using their specific 30-min window
      const currentResult = await generateBlockLine(
        blocks.current.hour, blocks.current.minute, currentPool, stats, false, targetDay
      );
      const nextResult = await generateBlockLine(
        blocks.next.hour, blocks.next.minute, nextPool, stats, false, targetDay
      );
      
      allLogs.push(...currentResult.logs, ...nextResult.logs);
      addBlockLogs(allLogs);

      // Read existing file and update only the relevant lines
      const dayCode = getDayCode(targetDay);
      const filename = `${dayCode}.txt`;
      let existingContent = '';

      try {
        const readResult = await window.electronAPI.readGradeFile({
          folder: config.gradeFolder,
          filename,
        });
        if (readResult.success) {
          existingContent = readResult.content || '';
        }
      } catch {
        console.log('[AUTO-GRADE] No existing file, creating new');
      }

      // Parse existing lines into a map by time
      const lineMap = new Map<string, string>();
      existingContent.split('\n').filter(l => l.trim()).forEach(line => {
        const match = line.match(/^(\d{2}:\d{2})/);
        if (match) lineMap.set(match[1], line);
      });

      // Update the lines for current and next blocks
      lineMap.set(currentTimeKey, currentResult.line);
      lineMap.set(nextTimeKey, nextResult.line);

      // ALWAYS enforce correct 21:00 Voz do Brasil format on weekdays
      // This fixes stale lines from previous code versions or corrupted saves
      const VOZ_DO_BRASIL_LINE = '21:00 (FIXO ID=VOZ DO BRASIL) vht,VOZ_DO_BRASIL';
      if (isWeekday(targetDay)) {
        const existing2100 = lineMap.get('21:00');
        if (!existing2100 || existing2100 !== VOZ_DO_BRASIL_LINE) {
          console.log(`[AUTO-GRADE] 🔧 Corrigindo linha 21:00 Voz do Brasil (era: "${existing2100 || 'ausente'}")`);
          lineMap.set('21:00', VOZ_DO_BRASIL_LINE);
        }
      }

      // Sort all lines by time and join
      const sortedContent = Array.from(lineMap.keys())
        .sort()
        .map(t => lineMap.get(t))
        .join('\n');

      const result = await window.electronAPI.saveGradeFile({
        folder: config.gradeFolder,
        filename,
        content: sortedContent,
      });

      if (result.success) {
        console.log(`[AUTO-GRADE] ✅ Grade salva na pasta destino: ${result.filePath}`);

        addGradeHistory({
          id: `grade-${Date.now()}`,
          timestamp: new Date(),
          blockTime: currentTimeKey,
          songsProcessed: defaultSequence.length * 2,
          songsFound: defaultSequence.length * 2 - stats.missing,
          songsMissing: stats.missing,
          programName: getProgramForHour(blocks.current.hour),
        });

        setState(prev => ({
          ...prev,
          isBuilding: false,
          lastBuildTime: new Date(),
          currentBlock: currentTimeKey,
          nextBlock: nextTimeKey,
          lastSavedFile: filename,
          blocksGenerated: prev.blocksGenerated + 2,
          skippedSongs: stats.skipped,
          substitutedSongs: stats.substituted,
          missingSongs: stats.missing,
        }));

        toast({
          title: '✅ Grade Atualizada',
          description: `Blocos ${currentTimeKey} e ${nextTimeKey} atualizados em ${filename}`,
        });
      } else {
        throw new Error(result.error || 'Erro ao salvar');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logSystemError('GRADE', 'error', 'Erro ao atualizar grade', errorMessage);
      setState(prev => ({ ...prev, isBuilding: false, error: errorMessage }));
      toast({
        title: '❌ Erro',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  }, [
    getBlockTimes, fetchSongsForBlock, fetchAllRecentSongs, generateBlockLine,
    getDayCode, config.gradeFolder, addGradeHistory, defaultSequence.length,
    getProgramForHour, toast, addBlockLogs
  ]);

  // Calculate seconds until next build based on minutesBeforeBlock setting
  const getSecondsUntilNextBuild = useCallback(() => {
    const now = new Date();
    const minutesBefore = state.minutesBeforeBlock;
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();

    // Blocks are at :00 and :30
    // Build at :00 - minutesBefore and :30 - minutesBefore
    const buildAt1 = 30 - minutesBefore; // e.g., 25 for 5 min before :30
    const buildAt2 = 60 - minutesBefore; // e.g., 55 for 5 min before :00

    let targetMinute: number;
    if (currentMinute < buildAt1) {
      targetMinute = buildAt1;
    } else if (currentMinute < 30) {
      // Between buildAt1 and :30, next is buildAt2
      targetMinute = buildAt2;
    } else if (currentMinute < buildAt2) {
      targetMinute = buildAt2;
    } else {
      // After buildAt2, next cycle
      targetMinute = buildAt1 + 60;
    }

    const minutesUntil = targetMinute - currentMinute;
    return Math.max(0, (minutesUntil * 60) - currentSecond);
  }, [state.minutesBeforeBlock]);

  // Toggle auto-generation
  const toggleAutoGeneration = useCallback(() => {
    setState(prev => ({ ...prev, isAutoEnabled: !prev.isAutoEnabled }));
  }, []);

  // Set minutes before block
  const setMinutesBeforeBlock = useCallback((minutes: number) => {
    const validMinutes = Math.max(1, Math.min(10, minutes));
    setState(prev => ({ ...prev, minutesBeforeBlock: validMinutes }));
  }, []);

  // Auto-build effect - triggers based on minutesBeforeBlock setting
  // Builds automatically and saves to destination folder every time a new block starts
  // ALSO saves periodically to ensure file is always up to date
  useEffect(() => {
    if (!isElectronEnv || !state.isAutoEnabled) return;

    console.log(`[AUTO-GRADE] ⏰ Modo automático ATIVO - atualiza ${state.minutesBeforeBlock} min antes de cada bloco`);

    // Track the last block we built for to avoid duplicate builds within same minute
    let lastBuiltBlock = '';
    let lastPeriodicSave = Date.now();

    // Check every 60 seconds to ensure we catch block transitions
    buildIntervalRef.current = setInterval(() => {
      // RESPECT isRunning - skip if system is paused by user
      const { isRunning } = useRadioStore.getState();
      if (!isRunning) {
        return; // System paused by user - skip build
      }
      
      const now = new Date();
      const minutesBefore = state.minutesBeforeBlock;
      const currentMinute = now.getMinutes();
      const currentHour = now.getHours();

      // Determine the NEXT block we're preparing for
      // Blocks are at :00 and :30
      let targetBlockHour = currentHour;
      let targetBlockMinute = 0;

      if (currentMinute < 30) {
        // We're before :30, target is :30
        targetBlockMinute = 30;
      } else {
        // We're after :30, target is :00 of next hour
        targetBlockHour = (currentHour + 1) % 24;
        targetBlockMinute = 0;
      }

      // Calculate minutes until target block
      let minutesUntilBlock: number;
      if (currentMinute < 30) {
        minutesUntilBlock = 30 - currentMinute;
      } else {
        minutesUntilBlock = 60 - currentMinute;
      }

      // Create a unique key for this build cycle
      const blockKey = `${targetBlockHour.toString().padStart(2, '0')}:${targetBlockMinute.toString().padStart(2, '0')}`;

      // Build if we're within the configured window AND haven't built for this block yet
      const shouldBuild = minutesUntilBlock <= minutesBefore && lastBuiltBlock !== blockKey;

      if (shouldBuild) {
        console.log(`[AUTO-GRADE] 🔄 Atualizando grade para bloco ${blockKey} (faltam ${minutesUntilBlock} min)`);
        lastBuiltBlock = blockKey;
        buildGrade();
        lastPeriodicSave = Date.now();
      } else {
        // PERIODIC SAVE: Also save every 10 minutes to ensure file is always current
        // (was 5 min - reduced frequency for better performance)
        const timeSinceLastSave = Date.now() - lastPeriodicSave;
        if (timeSinceLastSave >= 10 * 60 * 1000) {
          console.log(`[AUTO-GRADE] 📁 Salvamento periódico (10 min) - garantindo arquivo atualizado`);
          buildGrade();
          lastPeriodicSave = Date.now();
        }
      }
    }, 60 * 1000); // Check every 60 seconds (was 30s) for better performance

    // Also run immediately on mount to catch current block
    // ONLY if system is running
    const { isRunning } = useRadioStore.getState();
    if (isRunning) {
      console.log(`[AUTO-GRADE] 🚀 Build inicial - salvando grade na pasta destino`);
      buildGrade();
    }

    return () => {
      if (buildIntervalRef.current) clearInterval(buildIntervalRef.current);
    };
  }, [state.isAutoEnabled, state.minutesBeforeBlock, buildGrade]);

  // Update countdown and block times every 30 seconds (reduced from 1s)
  useEffect(() => {
    const update = () => {
      const blocks = getBlockTimes();
      const currentTimeKey = `${blocks.current.hour.toString().padStart(2, '0')}:${blocks.current.minute.toString().padStart(2, '0')}`;
      const nextTimeKey = `${blocks.next.hour.toString().padStart(2, '0')}:${blocks.next.minute.toString().padStart(2, '0')}`;
      
      setState(prev => ({
        ...prev,
        currentBlock: currentTimeKey,
        nextBlock: nextTimeKey,
        nextBuildIn: getSecondsUntilNextBuild(),
      }));
    };

    update();
    const interval = setInterval(update, 60000); // Every 60 seconds (was 30s)
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
