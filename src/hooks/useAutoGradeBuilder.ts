import { useState, useEffect, useCallback, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { sanitizeFilename } from '@/lib/sanitizeFilename';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface SongEntry {
  title: string;
  artist: string;
  station: string;
  style: string;
  filename: string;
}

interface UsedSong {
  title: string;
  artist: string;
  usedAt: Date;
  blockTime: string;
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
  // Full day generation stats
  fullDayProgress: number;
  fullDayTotal: number;
  skippedSongs: number;
  substitutedSongs: number;
}

const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
const ARTIST_REPETITION_MINUTES = 60; // Don't repeat artist within 60 minutes

export function useAutoGradeBuilder() {
  const { toast } = useToast();
  const {
    programs,
    sequence,
    stations,
    config,
    fixedContent,
    rankingSongs,
    addGradeHistory,
  } = useRadioStore();

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
    fullDayProgress: 0,
    fullDayTotal: 0,
    skippedSongs: 0,
    substitutedSongs: 0,
  });

  const lastBuildRef = useRef<string | null>(null);
  const buildIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const usedSongsRef = useRef<UsedSong[]>([]);

  // Get day code for filename
  const getDayCode = useCallback(() => {
    const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'sáb'];
    return days[new Date().getDay()];
  }, []);

  // Check if it's a weekday
  const isWeekday = useCallback(() => {
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

  // Check if song/artist was used recently (within 60 minutes)
  const isRecentlyUsed = useCallback((title: string, artist: string, currentBlockTime: string): boolean => {
    const artistRepetitionMinutes = config.artistRepetitionMinutes || ARTIST_REPETITION_MINUTES;
    const normalizedTitle = title.toLowerCase().trim();
    const normalizedArtist = artist.toLowerCase().trim();

    // Parse current block time to compare
    const [currentHour, currentMinute] = currentBlockTime.split(':').map(Number);
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    for (const used of usedSongsRef.current) {
      const [usedHour, usedMinute] = used.blockTime.split(':').map(Number);
      const usedTotalMinutes = usedHour * 60 + usedMinute;

      // Handle day wrap (e.g., 23:30 to 00:30)
      let diffMinutes = currentTotalMinutes - usedTotalMinutes;
      if (diffMinutes < 0) diffMinutes += 24 * 60;

      if (diffMinutes < artistRepetitionMinutes) {
        // Check if same song
        if (used.title.toLowerCase().trim() === normalizedTitle) {
          console.log(`[GRADE] ⚠️ Song "${title}" already used at ${used.blockTime}`);
          return true;
        }
        // Check if same artist
        if (used.artist.toLowerCase().trim() === normalizedArtist) {
          console.log(`[GRADE] ⚠️ Artist "${artist}" already used at ${used.blockTime}`);
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
    // Keep only last 100 entries to prevent memory issues
    if (usedSongsRef.current.length > 100) {
      usedSongsRef.current = usedSongsRef.current.slice(-100);
    }
  }, []);

  // Clear used songs (for new day)
  const clearUsedSongs = useCallback(() => {
    usedSongsRef.current = [];
  }, []);

  // Fetch recent songs from Supabase with styles
  const fetchRecentSongs = useCallback(async (): Promise<Record<string, SongEntry[]>> => {
    try {
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .order('scraped_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      // Group by station with style info
      const songsByStation: Record<string, SongEntry[]> = {};
      const stationIdToName: Record<string, string> = {};
      const stationNameToStyle: Record<string, string> = {};

      stations.forEach(s => {
        stationIdToName[s.id] = s.name;
        stationNameToStyle[s.name] = s.styles?.[0] || 'POP/VARIADO';
      });

      data?.forEach(song => {
        if (!songsByStation[song.station_name]) {
          songsByStation[song.station_name] = [];
        }
        if (songsByStation[song.station_name].length < 50) {
          const style = stationNameToStyle[song.station_name] || 'POP/VARIADO';
          songsByStation[song.station_name].push({
            title: song.title,
            artist: song.artist,
            station: song.station_name,
            style,
            filename: sanitizeFilename(`${song.title} - ${song.artist}.mp3`),
          });
        }
      });

      return songsByStation;
    } catch (error) {
      console.error('[AUTO-GRADE] Error fetching songs:', error);
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
          filename: sanitizeFilename(`${rs.title} - ${rs.artist}.mp3`),
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

  // Get TOP50 songs for grade
  const getTop50Songs = useCallback((count: number, blockTime: string): string[] => {
    const sorted = [...rankingSongs].sort((a, b) => b.plays - a.plays);
    const result: string[] = [];
    const usedTitles = new Set<string>();

    for (const song of sorted) {
      if (result.length >= count) break;
      
      if (!isRecentlyUsed(song.title, song.artist, blockTime)) {
        result.push(sanitizeFilename(`POSICAO${result.length + 1}.MP3`));
        markSongAsUsed(song.title, song.artist, blockTime);
        usedTitles.add(`${song.title.toLowerCase()}-${song.artist.toLowerCase()}`);
      }
    }

    return result;
  }, [rankingSongs, isRecentlyUsed, markSongAsUsed]);

  // Generate a single block with all validation rules
  const generateBlockWithValidation = useCallback((
    hour: number,
    minute: number,
    songsByStation: Record<string, SongEntry[]>,
    stats: { skipped: number; substituted: number }
  ): string => {
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const programName = getProgramForHour(hour);
    const fixedItems = getFixedContentForTime(hour, minute);

    // Voz do Brasil (21:00 weekdays)
    if (hour === 21 && minute === 0 && isWeekday()) {
      return `${timeStr} 19:01 (FIXO ID=VOZ DO BRASIL)`;
    }

    // TOP50 blocks
    const top50Item = fixedItems.find(fc => fc.type === 'top50');
    if (top50Item) {
      const top50Count = top50Item.top50Count || 10;
      const top50Songs = getTop50Songs(top50Count, timeStr);
      if (top50Songs.length > 0) {
        return `${timeStr} (ID=${programName}) ${top50Songs.map(s => `"${s}"`).join(',vht,')}`;
      }
    }

    // Fixed content
    const fixedItem = fixedItems.find(fc => fc.type !== 'top50');
    if (fixedItem) {
      return `${timeStr} (Fixo ID=${programName})`;
    }

    // Normal block with validation
    const songs: string[] = [];
    const usedInBlock = new Set<string>();
    const stationIdToName: Record<string, string> = {};
    
    stations.forEach(s => {
      stationIdToName[s.id] = s.name;
    });

    for (const seq of sequence) {
      const stationName = stationIdToName[seq.radioSource];
      const stationStyle = getStationStyle(seq.radioSource);
      const stationSongs = stationName ? songsByStation[stationName] : [];

      let selectedSong: SongEntry | null = null;
      let songIndex = 0;

      // Try to find a valid song from the station
      while (songIndex < (stationSongs?.length || 0)) {
        const candidate = stationSongs[songIndex];
        const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;

        // Check if not used in this block and not recently used
        if (!usedInBlock.has(key) && !isRecentlyUsed(candidate.title, candidate.artist, timeStr)) {
          selectedSong = candidate;
          break;
        }

        songIndex++;
        stats.skipped++;
      }

      // If no valid song found, find substitute with same DNA
      if (!selectedSong) {
        selectedSong = findSubstitute(stationStyle, songsByStation, timeStr, usedInBlock);
        if (selectedSong) {
          stats.substituted++;
          console.log(`[GRADE] 🔄 Substituted with ${selectedSong.title} - ${selectedSong.artist} (${selectedSong.style})`);
        }
      }

      if (selectedSong) {
        songs.push(`"${selectedSong.filename}"`);
        usedInBlock.add(`${selectedSong.title.toLowerCase()}-${selectedSong.artist.toLowerCase()}`);
        markSongAsUsed(selectedSong.title, selectedSong.artist, timeStr);
      } else {
        // Ultimate fallback: coringa
        songs.push(`"${config.coringaCode || 'mus'}"`);
      }
    }

    return `${timeStr} (ID=${programName}) ${songs.join(',vht,')}`;
  }, [
    getProgramForHour, getFixedContentForTime, isWeekday, getTop50Songs,
    stations, sequence, getStationStyle, isRecentlyUsed, findSubstitute,
    markSongAsUsed, config.coringaCode
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

  // Generate complete day's grade
  const buildFullDayGrade = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.saveGradeFile) {
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
      fullDayTotal: 48, // 24 hours * 2 blocks
      skippedSongs: 0,
      substitutedSongs: 0,
    }));

    try {
      console.log('[AUTO-GRADE] 🚀 Building full day grade...');
      
      // Clear used songs for fresh start
      clearUsedSongs();

      // Fetch all songs
      const songsByStation = await fetchRecentSongs();
      
      const stats = { skipped: 0, substituted: 0 };
      const lines: string[] = [];

      // Generate all 48 blocks (00:00 to 23:30)
      for (let hour = 0; hour < 24; hour++) {
        for (const minute of [0, 30]) {
          const line = generateBlockWithValidation(hour, minute, songsByStation, stats);
          lines.push(line);
          
          setState(prev => ({
            ...prev,
            fullDayProgress: prev.fullDayProgress + 1,
            skippedSongs: stats.skipped,
            substitutedSongs: stats.substituted,
          }));
        }
      }

      // Save to file
      const dayCode = getDayCode();
      const filename = `${dayCode}.txt`;
      const content = lines.join('\n');

      const result = await window.electronAPI.saveGradeFile({
        folder: config.gradeFolder,
        filename,
        content,
      });

      if (result.success) {
        console.log(`[AUTO-GRADE] ✅ Full day grade saved: ${result.filePath}`);
        
        addGradeHistory({
          id: `grade-fullday-${Date.now()}`,
          timestamp: new Date(),
          blockTime: 'COMPLETA',
          songsProcessed: 48 * sequence.length,
          songsFound: lines.length,
          songsMissing: stats.substituted,
          programName: 'Grade Completa',
        });

        setState(prev => ({
          ...prev,
          isBuilding: false,
          lastBuildTime: new Date(),
          lastSavedFile: filename,
          blocksGenerated: prev.blocksGenerated + 48,
          skippedSongs: stats.skipped,
          substitutedSongs: stats.substituted,
        }));

        toast({
          title: '✅ Grade Completa Gerada!',
          description: `${filename} salvo com 48 blocos. ${stats.skipped} pulados, ${stats.substituted} substituídos.`,
        });
      } else {
        throw new Error(result.error || 'Erro ao salvar grade');
      }
    } catch (error) {
      console.error('[AUTO-GRADE] Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      
      setState(prev => ({ ...prev, isBuilding: false, error: errorMessage }));
      toast({
        title: '❌ Erro na Grade',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  }, [
    clearUsedSongs, fetchRecentSongs, generateBlockWithValidation,
    getDayCode, config.gradeFolder, addGradeHistory, sequence.length, toast
  ]);

  // Build current and next blocks (incremental update)
  const buildGrade = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.saveGradeFile) {
      console.log('[AUTO-GRADE] Not in Electron mode, skipping');
      return;
    }

    setState(prev => ({ ...prev, isBuilding: true, error: null }));

    try {
      const blocks = getBlockTimes();
      const currentTimeKey = `${blocks.current.hour.toString().padStart(2, '0')}:${blocks.current.minute.toString().padStart(2, '0')}`;
      const nextTimeKey = `${blocks.next.hour.toString().padStart(2, '0')}:${blocks.next.minute.toString().padStart(2, '0')}`;

      if (lastBuildRef.current === currentTimeKey) {
        setState(prev => ({ ...prev, isBuilding: false }));
        return;
      }

      console.log(`[AUTO-GRADE] Building blocks: ${currentTimeKey}, ${nextTimeKey}`);

      const songsByStation = await fetchRecentSongs();
      const stats = { skipped: 0, substituted: 0 };

      const currentLine = generateBlockWithValidation(
        blocks.current.hour, blocks.current.minute, songsByStation, stats
      );
      const nextLine = generateBlockWithValidation(
        blocks.next.hour, blocks.next.minute, songsByStation, stats
      );

      // Read existing and update
      const dayCode = getDayCode();
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

      const lineMap = new Map<string, string>();
      existingContent.split('\n').filter(l => l.trim()).forEach(line => {
        const match = line.match(/^(\d{2}:\d{2})/);
        if (match) lineMap.set(match[1], line);
      });

      lineMap.set(currentTimeKey, currentLine);
      lineMap.set(nextTimeKey, nextLine);

      const sortedContent = Array.from(lineMap.keys()).sort().map(t => lineMap.get(t)).join('\n');

      const result = await window.electronAPI.saveGradeFile({
        folder: config.gradeFolder,
        filename,
        content: sortedContent,
      });

      if (result.success) {
        lastBuildRef.current = currentTimeKey;

        addGradeHistory({
          id: `grade-${Date.now()}`,
          timestamp: new Date(),
          blockTime: currentTimeKey,
          songsProcessed: sequence.length * 2,
          songsFound: sequence.length * 2 - stats.substituted,
          songsMissing: stats.substituted,
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
        }));

        toast({
          title: '✅ Grade Atualizada',
          description: `Blocos ${currentTimeKey} e ${nextTimeKey} salvos`,
        });
      } else {
        throw new Error(result.error || 'Erro ao salvar');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      setState(prev => ({ ...prev, isBuilding: false, error: errorMessage }));
      toast({
        title: '❌ Erro',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  }, [
    getBlockTimes, fetchRecentSongs, generateBlockWithValidation,
    getDayCode, config.gradeFolder, addGradeHistory, sequence.length,
    getProgramForHour, toast
  ]);

  // Calculate seconds until next build
  const getSecondsUntilNextBuild = useCallback(() => {
    const now = new Date();
    const safetyMargin = Math.min(config.safetyMarginMinutes || 7, 7);
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();

    const buildAt1 = 30 - safetyMargin;
    const buildAt2 = 60 - safetyMargin;

    let targetMinute: number;
    if (currentMinute < buildAt1) {
      targetMinute = buildAt1;
    } else if (currentMinute < buildAt2) {
      targetMinute = buildAt2;
    } else {
      targetMinute = buildAt1 + 60;
    }

    const minutesUntil = targetMinute - currentMinute;
    return Math.max(0, (minutesUntil * 60) - currentSecond);
  }, [config.safetyMarginMinutes]);

  // Toggle auto-generation
  const toggleAutoGeneration = useCallback(() => {
    setState(prev => ({ ...prev, isAutoEnabled: !prev.isAutoEnabled }));
  }, []);

  // Auto-build effect
  useEffect(() => {
    if (!isElectron || !state.isAutoEnabled) return;

    console.log('[AUTO-GRADE] 🚀 Starting automatic generation...');

    const initialBuild = setTimeout(() => buildGrade(), 2000);

    buildIntervalRef.current = setInterval(() => {
      const now = new Date();
      const safetyMargin = Math.min(config.safetyMarginMinutes || 7, 7);
      const currentMinute = now.getMinutes();
      const currentSecond = now.getSeconds();

      const buildMinute1 = 30 - safetyMargin;
      const buildMinute2 = 60 - safetyMargin;

      const shouldBuild = 
        (currentMinute === buildMinute1 && currentSecond < 30) ||
        (currentMinute === buildMinute2 % 60 && currentSecond < 30);

      if (shouldBuild) {
        buildGrade();
      }
    }, 30 * 1000);

    return () => {
      clearTimeout(initialBuild);
      if (buildIntervalRef.current) clearInterval(buildIntervalRef.current);
    };
  }, [state.isAutoEnabled, buildGrade, config.safetyMarginMinutes]);

  // Update countdown every second
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
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [getBlockTimes, getSecondsUntilNextBuild]);

  return {
    ...state,
    buildGrade,
    buildFullDayGrade,
    toggleAutoGeneration,
    clearUsedSongs,
    isElectron,
  };
}
