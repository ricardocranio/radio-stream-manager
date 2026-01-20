import { useState, useEffect, useCallback, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { useGradeLogStore, logSystemError } from '@/store/gradeLogStore';
import { sanitizeFilename } from '@/lib/sanitizeFilename';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

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
}

const isElectronEnv = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
const ARTIST_REPETITION_MINUTES = 60;
const DEFAULT_MINUTES_BEFORE_BLOCK = 5;

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
  });

  const lastBuildRef = useRef<string | null>(null);
  const buildIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const usedSongsRef = useRef<UsedSong[]>([]);

  // Get day code for filename
  const getDayCode = useCallback(() => {
    const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
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
  }, []);

  // Check if song exists in music library
  const checkSongInLibrary = useCallback(async (artist: string, title: string): Promise<boolean> => {
    if (!isElectronEnv || !window.electronAPI?.checkSongExists) {
      return true; // Web mode: assume exists
    }
    try {
      const result = await window.electronAPI.checkSongExists({
        artist,
        title,
        musicFolders: config.musicFolders,
      });
      return result.exists;
    } catch (error) {
      console.error('[GRADE] Error checking library:', error);
      return true; // On error, assume exists to avoid blocking
    }
  }, [config.musicFolders]);

  // Check if song is already in missing list
  const isSongAlreadyMissing = useCallback((artist: string, title: string): boolean => {
    return existingMissingSongs.some(
      s => s.artist.toLowerCase() === artist.toLowerCase() && 
           s.title.toLowerCase() === title.toLowerCase()
    );
  }, [existingMissingSongs]);

  // Fetch recent songs from Supabase with styles
  const fetchRecentSongs = useCallback(async (): Promise<Record<string, SongEntry[]>> => {
    try {
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .order('scraped_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      const songsByStation: Record<string, SongEntry[]> = {};
      const stationNameToStyle: Record<string, string> = {};

      stations.forEach(s => {
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
            filename: sanitizeFilename(`${song.artist} - ${song.title}.mp3`),
          });
        }
      });

      return songsByStation;
    } catch (error) {
      console.error('[AUTO-GRADE] Error fetching songs:', error);
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

  // Get TOP50 songs for grade
  const getTop50Songs = useCallback((count: number, blockTime: string): string[] => {
    const sorted = [...rankingSongs].sort((a, b) => b.plays - a.plays);
    const result: string[] = [];

    for (const song of sorted) {
      if (result.length >= count) break;
      
      if (!isRecentlyUsed(song.title, song.artist, blockTime)) {
        result.push(sanitizeFilename(`POSICAO${result.length + 1}.MP3`));
        markSongAsUsed(song.title, song.artist, blockTime);
      }
    }

    return result;
  }, [rankingSongs, isRecentlyUsed, markSongAsUsed]);

  // Generate a single block line with format: "musica1.mp3",vht,"musica2.mp3",vht,...
  const generateBlockLine = useCallback(async (
    hour: number,
    minute: number,
    songsByStation: Record<string, SongEntry[]>,
    stats: { skipped: number; substituted: number; missing: number }
  ): Promise<{ line: string; logs: Parameters<typeof addBlockLogs>[0] }> => {
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const programName = getProgramForHour(hour);
    const fixedItems = getFixedContentForTime(hour, minute);
    const blockLogs: Parameters<typeof addBlockLogs>[0] = [];

    // Voz do Brasil (21:00 weekdays)
    if (hour === 21 && minute === 0 && isWeekday()) {
      blockLogs.push({
        blockTime: timeStr,
        type: 'fixed',
        title: 'A Voz do Brasil',
        artist: 'Governo Federal',
        station: 'EBC',
        reason: 'Conteúdo fixo obrigatório',
      });
      return { 
        line: `${timeStr} 19:01 (FIXO ID=VOZ DO BRASIL)`,
        logs: blockLogs,
      };
    }

    // TOP50 blocks
    const top50Item = fixedItems.find(fc => fc.type === 'top50');
    if (top50Item) {
      const top50Count = top50Item.top50Count || 10;
      const top50Songs = getTop50Songs(top50Count, timeStr);
      if (top50Songs.length > 0) {
        blockLogs.push({
          blockTime: timeStr,
          type: 'fixed',
          title: `TOP50 - ${top50Count} músicas`,
          artist: 'Ranking',
          station: 'TOP50',
          reason: 'Bloco TOP50',
        });
        return { 
          line: `${timeStr} (ID=${programName}) ${top50Songs.map(s => `"${s}"`).join(',vht,')}`,
          logs: blockLogs,
        };
      }
    }

    // Fixed content block (not TOP50)
    const fixedItem = fixedItems.find(fc => fc.type !== 'top50');
    if (fixedItem) {
      blockLogs.push({
        blockTime: timeStr,
        type: 'fixed',
        title: fixedItem.name,
        artist: fixedItem.fileName,
        station: 'FIXO',
        reason: 'Conteúdo fixo',
      });
      // Fixed content still needs music around it
      // Continue to generate songs
    }

    // Normal block with 10 songs + 11 VHTs
    const songs: string[] = [];
    const usedInBlock = new Set<string>();
    const stationIdToName: Record<string, string> = {};
    
    stations.forEach(s => {
      stationIdToName[s.id] = s.name;
    });

    for (const seq of sequence) {
      if (songs.length >= 10) break; // Max 10 songs per block
      
      const stationName = stationIdToName[seq.radioSource];
      const stationStyle = getStationStyle(seq.radioSource);
      const stationSongs = stationName ? songsByStation[stationName] : [];

      let selectedSong: SongEntry | null = null;
      let songIndex = 0;
      let skipCount = 0;

      // Try to find a valid song from the station
      while (songIndex < (stationSongs?.length || 0)) {
        const candidate = stationSongs[songIndex];
        const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;

        // Check if not used in this block and not recently used
        if (!usedInBlock.has(key) && !isRecentlyUsed(candidate.title, candidate.artist, timeStr)) {
          // Check if exists in library (Electron only)
          const existsInLibrary = await checkSongInLibrary(candidate.artist, candidate.title);
          
          if (existsInLibrary) {
            selectedSong = { ...candidate, existsInLibrary: true };
            break;
          } else {
            // Song is missing from library
            stats.missing++;
            blockLogs.push({
              blockTime: timeStr,
              type: 'missing',
              title: candidate.title,
              artist: candidate.artist,
              station: stationName || 'UNKNOWN',
              style: stationStyle,
              reason: 'Não encontrada no acervo local',
            });
            
            // Add to missing songs list if not already there
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
          }
        } else if (usedInBlock.has(key) || isRecentlyUsed(candidate.title, candidate.artist, timeStr)) {
          skipCount++;
          blockLogs.push({
            blockTime: timeStr,
            type: 'skipped',
            title: candidate.title,
            artist: candidate.artist,
            station: stationName || 'UNKNOWN',
            style: stationStyle,
            reason: usedInBlock.has(key) ? 'Já usada neste bloco' : 'Repetição dentro de 60 min',
          });
        }

        songIndex++;
      }

      stats.skipped += skipCount;

      // If no valid song found, find substitute with same DNA
      if (!selectedSong) {
        const substitute = findSubstitute(stationStyle, songsByStation, timeStr, usedInBlock);
        if (substitute) {
          // Verify substitute exists in library
          const substituteExists = await checkSongInLibrary(substitute.artist, substitute.title);
          
          if (substituteExists) {
            selectedSong = { ...substitute, existsInLibrary: true };
            stats.substituted++;
            blockLogs.push({
              blockTime: timeStr,
              type: 'substituted',
              title: substitute.title,
              artist: substitute.artist,
              station: substitute.station,
              style: substitute.style,
              reason: `Substituição DNA: ${stationStyle}`,
              substituteFor: stationName || 'UNKNOWN',
            });
          } else {
            // Even substitute is missing
            stats.missing++;
            blockLogs.push({
              blockTime: timeStr,
              type: 'missing',
              title: substitute.title,
              artist: substitute.artist,
              station: substitute.station,
              style: substitute.style,
              reason: 'Substituto também não encontrado no acervo',
            });
          }
        }
      }

      if (selectedSong) {
        songs.push(`"${selectedSong.filename}"`);
        usedInBlock.add(`${selectedSong.title.toLowerCase()}-${selectedSong.artist.toLowerCase()}`);
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
        // Ultimate fallback: coringa
        songs.push(`"${config.coringaCode || 'mus'}"`);
        blockLogs.push({
          blockTime: timeStr,
          type: 'substituted',
          title: config.coringaCode || 'mus',
          artist: 'CORINGA',
          station: 'FALLBACK',
          reason: 'Nenhuma música válida encontrada, usando coringa',
        });
      }
    }

    // Build line with format: HH:MM (ID=PROGRAMA) "musica1.mp3",vht,"musica2.mp3",vht,...
    const lineContent = songs.join(',vht,');
    return {
      line: `${timeStr} (ID=${programName}) ${lineContent}`,
      logs: blockLogs,
    };
  }, [
    getProgramForHour, getFixedContentForTime, isWeekday, getTop50Songs,
    stations, sequence, getStationStyle, isRecentlyUsed, findSubstitute,
    markSongAsUsed, config.coringaCode, checkSongInLibrary, isSongAlreadyMissing,
    addMissingSong
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

  // Generate complete day's grade (48 blocks from 00:00 to 23:30)
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
    }));

    try {
      console.log('[AUTO-GRADE] 🚀 Building full day grade...');
      logSystemError('GRADE', 'info', 'Iniciando geração da grade completa do dia');
      
      clearUsedSongs();

      const songsByStation = await fetchRecentSongs();
      
      const stats = { skipped: 0, substituted: 0, missing: 0 };
      const lines: string[] = [];
      const allLogs: Parameters<typeof addBlockLogs>[0] = [];

      // Generate all 48 blocks (00:00 to 23:30)
      for (let hour = 0; hour < 24; hour++) {
        for (const minute of [0, 30]) {
          const result = await generateBlockLine(hour, minute, songsByStation, stats);
          lines.push(result.line);
          allLogs.push(...result.logs);
          
          setState(prev => ({
            ...prev,
            fullDayProgress: prev.fullDayProgress + 1,
            skippedSongs: stats.skipped,
            substitutedSongs: stats.substituted,
            missingSongs: stats.missing,
          }));
        }
      }

      // Add all logs to store
      addBlockLogs(allLogs);

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
        logSystemError('GRADE', 'info', `Grade completa salva: ${filename}`, `${lines.length} blocos, ${stats.skipped} puladas, ${stats.substituted} substituídas, ${stats.missing} faltando`);
        
        addGradeHistory({
          id: `grade-fullday-${Date.now()}`,
          timestamp: new Date(),
          blockTime: 'COMPLETA',
          songsProcessed: 48 * sequence.length,
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
      
      setState(prev => ({ ...prev, isBuilding: false, error: errorMessage, fullDayTotal: 0 }));
      toast({
        title: '❌ Erro na Grade',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  }, [
    clearUsedSongs, fetchRecentSongs, generateBlockLine,
    getDayCode, config.gradeFolder, addGradeHistory, sequence.length, toast, addBlockLogs
  ]);

  // Build current and next blocks (incremental update to existing file)
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

      // Skip if we already built this block recently
      if (lastBuildRef.current === currentTimeKey) {
        setState(prev => ({ ...prev, isBuilding: false }));
        return;
      }

      console.log(`[AUTO-GRADE] 🔄 Updating blocks: ${currentTimeKey}, ${nextTimeKey}`);

      const songsByStation = await fetchRecentSongs();
      const stats = { skipped: 0, substituted: 0, missing: 0 };
      const allLogs: Parameters<typeof addBlockLogs>[0] = [];

      // Generate current and next blocks
      const currentResult = await generateBlockLine(
        blocks.current.hour, blocks.current.minute, songsByStation, stats
      );
      const nextResult = await generateBlockLine(
        blocks.next.hour, blocks.next.minute, songsByStation, stats
      );
      
      allLogs.push(...currentResult.logs, ...nextResult.logs);
      addBlockLogs(allLogs);

      // Read existing file and update only the relevant lines
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

      // Parse existing lines into a map by time
      const lineMap = new Map<string, string>();
      existingContent.split('\n').filter(l => l.trim()).forEach(line => {
        const match = line.match(/^(\d{2}:\d{2})/);
        if (match) lineMap.set(match[1], line);
      });

      // Update the lines for current and next blocks
      lineMap.set(currentTimeKey, currentResult.line);
      lineMap.set(nextTimeKey, nextResult.line);

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
        lastBuildRef.current = currentTimeKey;

        addGradeHistory({
          id: `grade-${Date.now()}`,
          timestamp: new Date(),
          blockTime: currentTimeKey,
          songsProcessed: sequence.length * 2,
          songsFound: sequence.length * 2 - stats.missing,
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
    getBlockTimes, fetchRecentSongs, generateBlockLine,
    getDayCode, config.gradeFolder, addGradeHistory, sequence.length,
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
  useEffect(() => {
    if (!isElectronEnv || !state.isAutoEnabled) return;

    console.log('[AUTO-GRADE] 🚀 Starting automatic generation...');
    console.log(`[AUTO-GRADE] Will build ${state.minutesBeforeBlock} minutes before each block`);

    // Initial build after 2 seconds
    const initialBuild = setTimeout(() => buildGrade(), 2000);

    // Check every 30 seconds if we should build
    buildIntervalRef.current = setInterval(() => {
      const now = new Date();
      const minutesBefore = state.minutesBeforeBlock;
      const currentMinute = now.getMinutes();
      const currentSecond = now.getSeconds();

      // Build times: (30 - minutesBefore) and (60 - minutesBefore)
      const buildMinute1 = 30 - minutesBefore; // e.g., 25 for 5 min before :30
      const buildMinute2 = 60 - minutesBefore; // e.g., 55 for 5 min before :00

      const shouldBuild = 
        (currentMinute === buildMinute1 && currentSecond < 30) ||
        (currentMinute === (buildMinute2 % 60) && currentSecond < 30);

      if (shouldBuild) {
        console.log(`[AUTO-GRADE] ⏰ Trigger build at ${currentMinute}:${currentSecond}`);
        buildGrade();
      }
    }, 30 * 1000);

    return () => {
      clearTimeout(initialBuild);
      if (buildIntervalRef.current) clearInterval(buildIntervalRef.current);
    };
  }, [state.isAutoEnabled, state.minutesBeforeBlock, buildGrade]);

  // Update countdown and block times every second
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
    setMinutesBeforeBlock,
    clearUsedSongs,
    isElectron: isElectronEnv,
  };
}
