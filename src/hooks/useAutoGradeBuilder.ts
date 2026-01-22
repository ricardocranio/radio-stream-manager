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
const DEFAULT_MINUTES_BEFORE_BLOCK = 10; // Build 10 minutes before each block

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

  // Fetch recent songs from Supabase with styles
  // Increased limits to support full day generation (48 blocks x 10 songs = 480 songs needed)
  const fetchRecentSongs = useCallback(async (): Promise<Record<string, SongEntry[]>> => {
    try {
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .order('scraped_at', { ascending: false })
        .limit(2000); // Increased from 500 to 2000

      if (error) throw error;

      const songsByStation: Record<string, SongEntry[]> = {};
      const stationNameToStyle: Record<string, string> = {};
      const seenSongs = new Set<string>(); // Avoid duplicates

      stations.forEach(s => {
        stationNameToStyle[s.name] = s.styles?.[0] || 'POP/VARIADO';
      });

      data?.forEach(song => {
        // Skip duplicates (same title + artist)
        const songKey = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
        if (seenSongs.has(songKey)) return;
        seenSongs.add(songKey);

        if (!songsByStation[song.station_name]) {
          songsByStation[song.station_name] = [];
        }
        // Increased limit per station from 50 to 150
        if (songsByStation[song.station_name].length < 150) {
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

      const totalSongs = Object.values(songsByStation).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`[AUTO-GRADE] Pool de músicas: ${totalSongs} únicas de ${Object.keys(songsByStation).length} estações`);

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

  // Generate a single block line with format: "musica1.mp3",vht,"musica2.mp3",vht,...
  // isFullDay = true uses shorter repetition window (30 min instead of 60)
  const generateBlockLine = useCallback(async (
    hour: number,
    minute: number,
    songsByStation: Record<string, SongEntry[]>,
    stats: { skipped: number; substituted: number; missing: number },
    isFullDay: boolean = false
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

    // TOP50 blocks - calculate correct starting position based on time
    const top50Item = fixedItems.find(fc => fc.type === 'top50');
    if (top50Item) {
      const top50Count = top50Item.top50Count || 10;
      
      // For 19:30 block, start from position 11; for 20:00 start from 21, etc.
      // Each block shows 10 songs, so calculate offset based on block number
      const blockIndex = (hour - 19) * 2 + (minute === 30 ? 1 : 0);
      const startPosition = Math.max(0, blockIndex * 10);
      
      const top50Songs = getTop50Songs(top50Count, timeStr, startPosition);
      if (top50Songs.length > 0) {
        blockLogs.push({
          blockTime: timeStr,
          type: 'fixed',
          title: `TOP50 - Posições ${startPosition + 1} a ${startPosition + top50Songs.length}`,
          artist: 'Ranking',
          station: 'TOP50',
          reason: `Bloco TOP50 (posições ${startPosition + 1}-${startPosition + top50Songs.length})`,
        });
        return { 
          line: `${timeStr} (ID=TOP50) ${top50Songs.map(s => `"${s}"`).join(',vht,')}`,
          logs: blockLogs,
        };
      }
    }

    // Fixed content block (not TOP50) - ALWAYS include even if file doesn't exist
    const fixedItem = fixedItems.find(fc => fc.type !== 'top50');
    let fixedContentFile: string | null = null;
    let fixedPosition: 'start' | 'middle' | 'end' | number = 'start';
    
    if (fixedItem) {
      // Add fixed content file with quotes (always include regardless of existence)
      const fixedFileName = sanitizeFilename(fixedItem.fileName);
      fixedContentFile = `"${fixedFileName}"`;
      fixedPosition = fixedItem.position || 'start';
      
      blockLogs.push({
        blockTime: timeStr,
        type: 'fixed',
        title: fixedItem.name,
        artist: fixedItem.fileName,
        station: 'FIXO',
        reason: `Conteúdo fixo (posição: ${typeof fixedPosition === 'number' ? fixedPosition : fixedPosition})`,
      });
    }

    // Normal block with 10 songs following the configured SEQUENCE
    const songs: string[] = [];
    const usedInBlock = new Set<string>();
    const stationIdToName: Record<string, string> = {};
    
    stations.forEach(s => {
      stationIdToName[s.id] = s.name;
    });

    // Create a flattened pool of all songs for fallback
    const allSongsPool: SongEntry[] = [];
    for (const stationName of Object.keys(songsByStation)) {
      const stationSongs = songsByStation[stationName];
      for (const song of stationSongs) {
        allSongsPool.push(song);
      }
    }

    // Track song index per station to avoid repeating from start
    const stationSongIndex: Record<string, number> = {};

    // Helper to get the next fixed content for this block
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
      fixoIndexUsed++;
      
      const fixedFileName = sanitizeFilename(selectedFixed.fileName);
      blockLogs.push({
        blockTime: timeStr,
        type: 'fixed',
        title: selectedFixed.name,
        artist: selectedFixed.fileName,
        station: 'FIXO',
        reason: `Conteúdo fixo da sequência`,
      });
      return `"${fixedFileName}"`;
    };

    // Helper to get TOP50 song for sequence position
    let top50IndexUsed = 0;
    const getNextTop50Song = (): string | null => {
      const sortedRanking = [...rankingSongs].sort((a, b) => b.plays - a.plays);
      
      while (top50IndexUsed < sortedRanking.length) {
        const rankSong = sortedRanking[top50IndexUsed];
        const key = `${rankSong.title.toLowerCase()}-${rankSong.artist.toLowerCase()}`;
        top50IndexUsed++;
        
        if (!usedInBlock.has(key) && !isRecentlyUsed(rankSong.title, rankSong.artist, timeStr, isFullDay)) {
          usedInBlock.add(key);
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

    // Follow the user-configured SEQUENCE (position 1 = Band FM, position 2 = Clube FM, etc.)
    for (const seq of sequence) {
      if (songs.length >= sequence.length) break; // Use sequence length as max

      // Handle special sequence types - check for specific fixed content (fixo_ID)
      if (seq.radioSource.startsWith('fixo_')) {
        // Specific FIXO content selected by ID
        const contentId = seq.radioSource.replace('fixo_', '');
        const specificContent = fixedContent.find(fc => fc.id === contentId && fc.enabled);
        
        if (specificContent) {
          // Use customFileName if set, otherwise use the default from the content
          const fileNameToUse = seq.customFileName || specificContent.fileName;
          const fixedFileName = sanitizeFilename(fileNameToUse);
          blockLogs.push({
            blockTime: timeStr,
            type: 'fixed',
            title: specificContent.name,
            artist: fileNameToUse,
            station: 'FIXO',
            reason: seq.customFileName 
              ? `Conteúdo fixo com nome personalizado` 
              : `Conteúdo fixo específico da sequência`,
          });
          songs.push(`"${fixedFileName}"`);
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
          
          if (!usedInBlock.has(key) && !isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
            const libraryResult = await findSongInLibrary(candidate.artist, candidate.title);
            
            if (libraryResult.exists) {
              const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
              songs.push(`"${correctFilename}"`);
              usedInBlock.add(key);
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

      // Normal station logic
      const stationName = stationIdToName[seq.radioSource];
      const stationStyle = getStationStyle(seq.radioSource);
      const stationSongs = stationName ? songsByStation[stationName] : [];
      
      // Initialize index for this station
      if (stationSongIndex[stationName] === undefined) {
        stationSongIndex[stationName] = 0;
      }

      let selectedSong: SongEntry | null = null;
      let startIndex = stationSongIndex[stationName] || 0;
      let checkedCount = 0;

      // PRIORITY 1: Try to find a song from the configured station that EXISTS in library
      while (checkedCount < (stationSongs?.length || 0) && !selectedSong) {
        const songIdx = (startIndex + checkedCount) % stationSongs.length;
        const candidate = stationSongs[songIdx];
        const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;

        // Check if not used in this block and not recently used
        if (!usedInBlock.has(key) && !isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
          const libraryResult = await findSongInLibrary(candidate.artist, candidate.title);
          
          if (libraryResult.exists) {
            // Found a song that EXISTS - use the filename from library for correct spelling
            const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
            selectedSong = { ...candidate, filename: correctFilename, existsInLibrary: true };
            stationSongIndex[stationName] = (songIdx + 1) % stationSongs.length;
            break;
          } else {
            // Mark as missing for download later, but DON'T use it
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
        }
        checkedCount++;
      }

      // PRIORITY 2: Substitute with TOP50 song that EXISTS
      if (!selectedSong) {
        const sortedRanking = [...rankingSongs].sort((a, b) => b.plays - a.plays);
        
        for (const rankSong of sortedRanking) {
          const key = `${rankSong.title.toLowerCase()}-${rankSong.artist.toLowerCase()}`;
          
          if (!usedInBlock.has(key) && !isRecentlyUsed(rankSong.title, rankSong.artist, timeStr, isFullDay)) {
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
            
            if (!usedInBlock.has(key) && !isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
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
          
          if (!usedInBlock.has(key) && !isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) {
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
          
          if (!usedInBlock.has(key) && !isRecentlyUsed(rankSong.title, rankSong.artist, timeStr, isFullDay)) {
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
          // Pass isFullDay=true for shorter repetition window
          const result = await generateBlockLine(hour, minute, songsByStation, stats, true);
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

      // Generate current and next blocks (isFullDay=false for normal repetition rules)
      const currentResult = await generateBlockLine(
        blocks.current.hour, blocks.current.minute, songsByStation, stats, false
      );
      const nextResult = await generateBlockLine(
        blocks.next.hour, blocks.next.minute, songsByStation, stats, false
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
  // Only builds at specific times, not continuously
  useEffect(() => {
    if (!isElectronEnv || !state.isAutoEnabled) return;

    console.log(`[AUTO-GRADE] ⏰ Aguardando ${state.minutesBeforeBlock} min antes de cada bloco`);

    // Check every 60 seconds if we should build (reduced from 30s)
    buildIntervalRef.current = setInterval(() => {
      const now = new Date();
      const minutesBefore = state.minutesBeforeBlock;
      const currentMinute = now.getMinutes();
      const currentSecond = now.getSeconds();

      // Build times: (30 - minutesBefore) and (60 - minutesBefore)
      // Example: 10 min before means build at :20 and :50
      const buildMinute1 = 30 - minutesBefore; // e.g., 20 for 10 min before :30
      const buildMinute2 = 60 - minutesBefore; // e.g., 50 for 10 min before :00

      const shouldBuild = 
        (currentMinute === buildMinute1 && currentSecond < 60) ||
        (currentMinute === (buildMinute2 % 60) && currentSecond < 60);

      if (shouldBuild) {
        console.log(`[AUTO-GRADE] 🔄 Montando bloco (${currentMinute}:${currentSecond.toString().padStart(2, '0')})`);
        buildGrade();
      }
    }, 60 * 1000); // Check every 60 seconds

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
    const interval = setInterval(update, 30000); // Every 30 seconds
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
