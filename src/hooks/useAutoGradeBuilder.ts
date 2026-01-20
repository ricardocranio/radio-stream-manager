import { useState, useEffect, useCallback, useRef } from 'react';
import { useRadioStore, RankingSong } from '@/store/radioStore';
import { sanitizeFilename } from '@/lib/sanitizeFilename';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface GradeBlock {
  hour: number;
  minute: number;
  programName: string;
  songs: string[];
  isFixed: boolean;
  fixedType?: string;
}

interface AutoGradeState {
  isBuilding: boolean;
  lastBuildTime: Date | null;
  currentBlock: string;
  nextBlock: string;
  lastSavedFile: string | null;
  error: string | null;
  blocksGenerated: number;
}

const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

export function useAutoGradeBuilder() {
  const { toast } = useToast();
  const {
    programs,
    sequence,
    stations,
    config,
    fixedContent,
    rankingSongs,
    isRunning,
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
  });

  const lastBuildRef = useRef<string | null>(null);

  // Get day code for filename
  const getDayCode = useCallback(() => {
    const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'sáb'];
    return days[new Date().getDay()];
  }, []);

  // Check if it's a weekday (for Voz do Brasil)
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

      // Check day pattern
      if (fc.dayPattern === 'WEEKDAYS' && !isWeekdayNow) return false;
      if (fc.dayPattern === 'WEEKEND' && !isWeekendNow) return false;

      // Check time slots
      return fc.timeSlots.some(ts => ts.hour === hour && ts.minute === minute);
    });
  }, [fixedContent]);

  // Fetch recent songs from Supabase
  const fetchRecentSongs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .order('scraped_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      // Group by station
      const songsByStation: Record<string, { title: string; artist: string }[]> = {};
      data?.forEach(song => {
        if (!songsByStation[song.station_name]) {
          songsByStation[song.station_name] = [];
        }
        if (songsByStation[song.station_name].length < 20) {
          songsByStation[song.station_name].push({
            title: song.title,
            artist: song.artist,
          });
        }
      });

      return songsByStation;
    } catch (error) {
      console.error('[AUTO-GRADE] Error fetching songs:', error);
      return {};
    }
  }, []);

  // Get TOP50 songs for grade
  const getTop50Songs = useCallback((count: number): string[] => {
    const sorted = [...rankingSongs].sort((a, b) => b.plays - a.plays);
    const top = sorted.slice(0, Math.min(count, 50));
    
    return top.map((song, index) => {
      const position = index + 1;
      return sanitizeFilename(`POSICAO${position}.MP3`);
    });
  }, [rankingSongs]);

  // Generate a single block line
  const generateBlockLine = useCallback(async (
    hour: number,
    minute: number,
    songsByStation: Record<string, { title: string; artist: string }[]>
  ): Promise<string> => {
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const programName = getProgramForHour(hour);
    const fixedItems = getFixedContentForTime(hour, minute);

    // Check for Voz do Brasil (21:00 weekdays)
    if (hour === 21 && minute === 0 && isWeekday()) {
      return `${timeStr} 19:01 (FIXO ID=VOZ DO BRASIL)`;
    }

    // Check for TOP50 blocks
    const top50Item = fixedItems.find(fc => fc.type === 'top50');
    if (top50Item) {
      const top50Count = top50Item.top50Count || 10;
      const top50Songs = getTop50Songs(top50Count);
      if (top50Songs.length > 0) {
        const songsStr = top50Songs.map(s => `"${s}"`).join(',vht,');
        return `${timeStr} (ID=${programName}) ${songsStr}`;
      }
    }

    // Check for other fixed content
    const fixedItem = fixedItems.find(fc => fc.type !== 'top50');
    if (fixedItem) {
      return `${timeStr} (Fixo ID=${programName})`;
    }

    // Normal block with captured songs
    const songs: string[] = [];
    const stationIdToName: Record<string, string> = {};
    stations.forEach(s => {
      stationIdToName[s.id] = s.name;
    });

    // Use sequence to pick songs from stations
    for (const seq of sequence) {
      const stationName = stationIdToName[seq.radioSource];
      const stationSongs = stationName ? songsByStation[stationName] : [];

      if (stationSongs && stationSongs.length > 0) {
        // Pick a song based on position (rotate through available songs)
        const songIndex = (seq.position - 1) % stationSongs.length;
        const song = stationSongs[songIndex];
        const filename = sanitizeFilename(`${song.title} - ${song.artist}.mp3`);
        songs.push(`"${filename}"`);
      } else {
        // Fallback to coringa if no songs available
        songs.push(`"${config.coringaCode || 'mus'}"`);
      }
    }

    const songsStr = songs.join(',vht,');
    return `${timeStr} (ID=${programName}) ${songsStr}`;
  }, [getProgramForHour, getFixedContentForTime, isWeekday, getTop50Songs, stations, sequence, config.coringaCode]);

  // Calculate current and next block times
  const getBlockTimes = useCallback(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    let currentBlockHour = currentHour;
    let currentBlockMinute = currentMinute < 30 ? 0 : 30;

    let nextBlockHour = currentBlockMinute === 30 ? (currentHour + 1) % 24 : currentHour;
    let nextBlockMinute = currentBlockMinute === 30 ? 0 : 30;

    return {
      current: { hour: currentBlockHour, minute: currentBlockMinute },
      next: { hour: nextBlockHour, minute: nextBlockMinute },
    };
  }, []);

  // Build and save grade for current and next blocks
  const buildGrade = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.saveGradeFile) {
      console.log('[AUTO-GRADE] Not in Electron mode, skipping file save');
      return;
    }

    setState(prev => ({ ...prev, isBuilding: true, error: null }));

    try {
      const blocks = getBlockTimes();
      const currentTimeKey = `${blocks.current.hour.toString().padStart(2, '0')}:${blocks.current.minute.toString().padStart(2, '0')}`;
      const nextTimeKey = `${blocks.next.hour.toString().padStart(2, '0')}:${blocks.next.minute.toString().padStart(2, '0')}`;

      // Check if we already built for this time
      if (lastBuildRef.current === currentTimeKey) {
        console.log('[AUTO-GRADE] Already built for this block, skipping');
        setState(prev => ({ ...prev, isBuilding: false }));
        return;
      }

      console.log(`[AUTO-GRADE] Building grade for blocks: ${currentTimeKey}, ${nextTimeKey}`);

      // Fetch recent songs from Supabase
      const songsByStation = await fetchRecentSongs();

      // Generate lines for current and next blocks
      const currentLine = await generateBlockLine(blocks.current.hour, blocks.current.minute, songsByStation);
      const nextLine = await generateBlockLine(blocks.next.hour, blocks.next.minute, songsByStation);

      // Read existing grade file and update it
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
        console.log('[AUTO-GRADE] No existing grade file, creating new one');
      }

      // Parse existing lines and update/add new ones
      const existingLines = existingContent.split('\n').filter(line => line.trim());
      const lineMap = new Map<string, string>();

      existingLines.forEach(line => {
        const timeMatch = line.match(/^(\d{2}:\d{2})/);
        if (timeMatch) {
          lineMap.set(timeMatch[1], line);
        }
      });

      // Update current and next block
      lineMap.set(currentTimeKey, currentLine);
      lineMap.set(nextTimeKey, nextLine);

      // Sort and rebuild content
      const sortedTimes = Array.from(lineMap.keys()).sort();
      const newContent = sortedTimes.map(time => lineMap.get(time)).join('\n');

      // Save to file
      const result = await window.electronAPI.saveGradeFile({
        folder: config.gradeFolder,
        filename,
        content: newContent,
      });

      if (result.success) {
        console.log(`[AUTO-GRADE] ✅ Grade saved: ${result.filePath}`);
        
        lastBuildRef.current = currentTimeKey;

        // Add to grade history
        const programName = getProgramForHour(blocks.current.hour);
        addGradeHistory({
          id: `grade-${Date.now()}`,
          timestamp: new Date(),
          blockTime: currentTimeKey,
          songsProcessed: sequence.length,
          songsFound: Object.values(songsByStation).flat().length,
          songsMissing: 0,
          programName,
        });

        setState(prev => ({
          ...prev,
          isBuilding: false,
          lastBuildTime: new Date(),
          currentBlock: currentTimeKey,
          nextBlock: nextTimeKey,
          lastSavedFile: filename,
          blocksGenerated: prev.blocksGenerated + 1,
        }));

        toast({
          title: '✅ Grade Atualizada',
          description: `Blocos ${currentTimeKey} e ${nextTimeKey} salvos em ${filename}`,
        });
      } else {
        throw new Error(result.error || 'Erro ao salvar grade');
      }
    } catch (error) {
      console.error('[AUTO-GRADE] Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      
      setState(prev => ({
        ...prev,
        isBuilding: false,
        error: errorMessage,
      }));

      toast({
        title: '❌ Erro na Grade',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  }, [config.gradeFolder, fetchRecentSongs, generateBlockLine, getBlockTimes, getDayCode, getProgramForHour, addGradeHistory, sequence.length, toast]);

  // Calculate time until next build (safety margin before block)
  const getNextBuildTime = useCallback(() => {
    const now = new Date();
    const safetyMargin = Math.min(config.safetyMarginMinutes || 7, 7);
    const currentMinute = now.getMinutes();

    let nextBuildMinute: number;
    let nextBuildHour = now.getHours();

    if (currentMinute < 30 - safetyMargin) {
      nextBuildMinute = 30 - safetyMargin;
    } else if (currentMinute < 30) {
      nextBuildHour = (nextBuildHour + 1) % 24;
      nextBuildMinute = 60 - safetyMargin;
    } else if (currentMinute < 60 - safetyMargin) {
      nextBuildHour = (nextBuildHour + 1) % 24;
      nextBuildMinute = 60 - safetyMargin;
    } else {
      nextBuildHour = (nextBuildHour + 1) % 24;
      nextBuildMinute = 30 - safetyMargin;
    }

    const nextBuild = new Date(now);
    nextBuild.setHours(nextBuildHour, nextBuildMinute % 60, 0, 0);
    
    if (nextBuild <= now) {
      nextBuild.setHours(nextBuild.getHours() + 1);
    }

    return nextBuild;
  }, [config.safetyMarginMinutes]);

  // Auto-build effect
  useEffect(() => {
    if (!isRunning || !isElectron) {
      return;
    }

    // Build immediately on start
    buildGrade();

    // Set up interval to check every minute
    const interval = setInterval(() => {
      const now = new Date();
      const safetyMargin = Math.min(config.safetyMarginMinutes || 7, 7);
      const currentMinute = now.getMinutes();

      // Build at safetyMargin minutes before :00 or :30
      const shouldBuild = 
        currentMinute === 30 - safetyMargin ||
        currentMinute === 60 - safetyMargin ||
        currentMinute === 0;

      if (shouldBuild) {
        buildGrade();
      }
    }, 60 * 1000); // Check every minute

    return () => clearInterval(interval);
  }, [isRunning, buildGrade, config.safetyMarginMinutes]);

  // Update current/next block times periodically
  useEffect(() => {
    const updateBlockTimes = () => {
      const blocks = getBlockTimes();
      const currentTimeKey = `${blocks.current.hour.toString().padStart(2, '0')}:${blocks.current.minute.toString().padStart(2, '0')}`;
      const nextTimeKey = `${blocks.next.hour.toString().padStart(2, '0')}:${blocks.next.minute.toString().padStart(2, '0')}`;
      
      setState(prev => ({
        ...prev,
        currentBlock: currentTimeKey,
        nextBlock: nextTimeKey,
      }));
    };

    updateBlockTimes();
    const interval = setInterval(updateBlockTimes, 30000);

    return () => clearInterval(interval);
  }, [getBlockTimes]);

  return {
    ...state,
    buildGrade,
    isElectron,
  };
}
