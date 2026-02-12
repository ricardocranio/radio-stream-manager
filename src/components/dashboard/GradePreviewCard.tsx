import { useState, useMemo, useEffect, useCallback } from 'react';
import { Eye, Music, TrendingUp, Radio, Clock, Sparkles, Loader2, FileText, Flame, AlertTriangle, Snowflake } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { sanitizeGradeFilename } from '@/lib/gradeBuilder/sanitize';
import { STATION_ID_TO_DB_NAME, DAY_CODES_BY_INDEX, isElectronEnv } from '@/lib/gradeBuilder/constants';
import { supabase } from '@/integrations/supabase/client';
import type { SequenceConfig } from '@/types/radio';

interface SongPool {
  title: string;
  artist: string;
  station_name: string;
  scraped_at: string;
}

interface PreviewSong {
  position: number;
  title: string;
  artist: string;
  source: string;
  isFromRanking: boolean;
  isFixed: boolean;
  filename: string;
  scrapedAt?: string; // ISO timestamp for freshness
}

/** Get freshness icon and label based on minutes since capture */
function getFreshnessInfo(scrapedAt?: string): { icon: 'fire' | 'alert' | 'cold' | null; label: string; minutes: number } {
  if (!scrapedAt) return { icon: null, label: '', minutes: -1 };
  const diffMs = Date.now() - new Date(scrapedAt).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes <= 20) return { icon: 'fire', label: `há ${minutes} min`, minutes };
  if (minutes <= 39) return { icon: 'alert', label: `há ${minutes} min`, minutes };
  if (minutes < 60) return { icon: 'cold', label: `há ${minutes} min`, minutes };
  const hours = Math.floor(minutes / 60);
  return { icon: 'cold', label: `há ${hours}h${minutes % 60 > 0 ? `${(minutes % 60).toString().padStart(2, '0')}` : ''}`, minutes };
}

/** Parse a grade TXT block line into individual song entries */
function parseTxtBlockLine(line: string, blockTime: string): PreviewSong[] {
  const results: PreviewSong[] = [];
  // Line format: "HH:MM (ID=ProgramName) "ARTIST - TITLE.mp3",vht,"ARTIST - TITLE.mp3",vht,FIXED.MP3"
  const timeMatch = line.match(/^(\d{2}:\d{2})\s+(.+)$/);
  if (!timeMatch) return results;

  let content = timeMatch[2];
  // Strip (ID=...) prefix if present
  content = content.replace(/^\(ID=[^)]*\)\s*/, '');

  // Split by comma to get individual tokens
  const tokens = content.split(',');
  let position = 1;

  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    const lower = token.toLowerCase();

    // Skip vht separators
    if (lower === 'vht') continue;

    // Coringa codes
    if (['mus', 'rom', 'clas'].includes(lower)) {
      results.push({ position, title: token.toUpperCase(), artist: 'CORINGA', source: 'CORINGA', isFromRanking: false, isFixed: true, filename: token });
      position++;
      continue;
    }

    // Quoted filename: "ARTIST - TITLE.mp3"
    const quotedMatch = token.match(/^"([^"]+)"$/);
    if (quotedMatch) {
      const filename = quotedMatch[1];
      const cleanName = filename.replace(/\.mp3$/i, '');
      const dashIdx = cleanName.indexOf(' - ');
      const artist = dashIdx >= 0 ? cleanName.substring(0, dashIdx) : '';
      const title = dashIdx >= 0 ? cleanName.substring(dashIdx + 3) : cleanName;
      results.push({ position, title: title || cleanName, artist: artist || 'ARQUIVO', source: 'TXT', isFromRanking: false, isFixed: false, filename });
      position++;
      continue;
    }

    // Unquoted file (fixed content)
    if (lower.endsWith('.mp3')) {
      const cleanName = token.replace(/\.mp3$/i, '');
      results.push({ position, title: cleanName, artist: 'CONTEÚDO FIXO', source: 'FIXO', isFromRanking: false, isFixed: true, filename: token });
      position++;
    } else if (token.length > 3) {
      // Bare name without extension (fixed content)
      results.push({ position, title: token, artist: 'CONTEÚDO FIXO', source: 'FIXO', isFromRanking: false, isFixed: true, filename: token });
      position++;
    }
  }

  return results;
}

export function GradePreviewCard() {
  const { stations, rankingSongs, gradeHistory, scheduledSequences, sequence: defaultSequence, fixedContent, config } = useRadioStore();
  const [songs, setSongs] = useState<SongPool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [txtSongs, setTxtSongs] = useState<PreviewSong[] | null>(null);
  const [txtSource, setTxtSource] = useState<string>('');
  const filterChars = config.filterCharacters;

  // Calculate next block time
  const getNextBlockTime = () => {
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentHour = now.getHours();
    if (currentMinute < 30) {
      return { hour: currentHour, minute: 30 };
    } else {
      return { hour: (currentHour + 1) % 24, minute: 0 };
    }
  };

  const nextBlock = getNextBlockTime();
  const nextBlockTime = `${nextBlock.hour.toString().padStart(2, '0')}:${nextBlock.minute.toString().padStart(2, '0')}`;

  // === PRIMARY: Read real TXT file (Electron only) ===
  const readTxtGrade = useCallback(async () => {
    if (!isElectronEnv || !window.electronAPI?.readGradeFile || !config.gradeFolder) return;

    try {
      const dayCode = DAY_CODES_BY_INDEX[new Date().getDay()];
      const filename = `${dayCode}.txt`;

      const result = await window.electronAPI.readGradeFile({
        folder: config.gradeFolder,
        filename,
      });

      if (!result.success || !result.content) {
        setTxtSongs(null);
        return;
      }

      // Find the line matching the next block time
      const lines = result.content.split('\n');
      const targetLine = lines.find(l => l.trim().startsWith(nextBlockTime));

      if (targetLine) {
        const parsed = parseTxtBlockLine(targetLine.trim(), nextBlockTime);
        if (parsed.length > 0) {
          // Enrich with ranking + scraped_at + station from pool
          const enriched = parsed.map(song => {
            if (song.isFixed) return song;
            // Try to find matching song in supabase pool to get scraped_at and station
            const poolMatch = songs.find(
              s => s.title.toLowerCase() === song.title.toLowerCase() && 
                   s.artist.toLowerCase() === song.artist.toLowerCase()
            );
            // Also try matching by filename pattern (artist - title)
            const filenameMatch = !poolMatch ? songs.find(s => {
              const expected = sanitizeGradeFilename(`${s.artist} - ${s.title}.MP3`, filterChars).toLowerCase();
              return expected === song.filename.toLowerCase();
            }) : null;
            const match = poolMatch || filenameMatch;
            return {
              ...song,
              source: match?.station_name || song.source,
              isFromRanking: rankingSongs.some(
                r => sanitizeGradeFilename(`${r.artist} - ${r.title}.MP3`, filterChars).toLowerCase() === song.filename.toLowerCase()
              ),
              scrapedAt: match?.scraped_at,
            };
          });
          setTxtSongs(enriched);
          setTxtSource(filename);
          return;
        }
      }

      // No matching block found in the TXT
      setTxtSongs(null);
    } catch (err) {
      console.warn('[PREVIEW] Could not read TXT file:', err);
      setTxtSongs(null);
    }
  }, [config.gradeFolder, nextBlockTime, rankingSongs, filterChars, songs]);

  // Read TXT on mount and periodically
  useEffect(() => {
    readTxtGrade();
    const interval = setInterval(readTxtGrade, 30 * 1000); // Every 30s
    return () => clearInterval(interval);
  }, [readTxtGrade]);

  // === FALLBACK: Fetch songs from Supabase for simulation ===
  useEffect(() => {
    const fetchSongs = async () => {
      setIsLoading(true);
      try {
        const blockTime = new Date();
        blockTime.setHours(nextBlock.hour, nextBlock.minute, 0, 0);
        const windowEnd = blockTime.toISOString();
        const windowStart = new Date(blockTime.getTime() - 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
          .from('scraped_songs')
          .select('title, artist, station_name, scraped_at')
          .gte('scraped_at', windowStart)
          .lte('scraped_at', windowEnd)
          .order('scraped_at', { ascending: false })
          .limit(500);

        if (error) throw error;

        if (!data || data.length === 0) {
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('scraped_songs')
            .select('title, artist, station_name, scraped_at')
            .order('scraped_at', { ascending: false })
            .limit(500);
          if (!fallbackError && fallbackData) {
            setSongs(fallbackData);
          }
        } else {
          setSongs(data);
        }
      } catch (err) {
        console.error('[PREVIEW] Error fetching songs:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSongs();
    const interval = setInterval(fetchSongs, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [nextBlock.hour, nextBlock.minute]);

  // Build songs by station (for simulation fallback)
  const songsByStation = useMemo(() => {
    const result: Record<string, SongPool[]> = {};
    const seen = new Set<string>();
    for (const song of songs) {
      const key = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!result[song.station_name]) result[song.station_name] = [];
      if (result[song.station_name].length < 50) {
        result[song.station_name].push(song);
      }
    }
    return result;
  }, [songs]);

  // Get active sequence for the next block
  const activeSequence = useMemo((): SequenceConfig[] => {
    const timeMinutes = nextBlock.hour * 60 + nextBlock.minute;
    const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
    const currentDay = dayMap[new Date().getDay()];

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
      return activeScheduled[0].sequence;
    }
    return defaultSequence;
  }, [nextBlock.hour, nextBlock.minute, scheduledSequences, defaultSequence]);

  // Simulation fallback preview (same logic as before)
  const simulatedSongs = useMemo((): PreviewSong[] => {
    const result: PreviewSong[] = [];
    const usedInBlock = new Set<string>();
    const usedArtistsInBlock = new Set<string>();
    const stationSongIndex: Record<string, number> = {};

    for (const seq of activeSequence) {
      if (seq.radioSource.startsWith('fixo_') || seq.radioSource === 'fixo') {
        let fixedName = seq.radioSource;
        if (seq.radioSource.startsWith('fixo_')) {
          const contentId = seq.radioSource.replace('fixo_', '');
          const fc = fixedContent.find(f => f.id === contentId && f.enabled);
          fixedName = fc ? fc.name : 'FIXO';
        }
        result.push({
          position: seq.position,
          title: seq.customFileName || fixedName,
          artist: 'CONTEÚDO FIXO',
          source: 'FIXO',
          isFromRanking: false,
          isFixed: true,
          filename: seq.customFileName || fixedName,
        });
        continue;
      }

      if (seq.radioSource === 'top50') {
        const sortedRanking = [...rankingSongs].sort((a, b) => b.plays - a.plays);
        let found = false;
        for (const r of sortedRanking) {
          const key = `${r.title.toLowerCase()}-${r.artist.toLowerCase()}`;
          const artistKey = r.artist.toLowerCase().trim();
          if (!usedInBlock.has(key) && !usedArtistsInBlock.has(artistKey)) {
            usedInBlock.add(key);
            usedArtistsInBlock.add(artistKey);
            const filename = sanitizeGradeFilename(`${r.artist} - ${r.title}.MP3`, filterChars);
            const parts = filename.replace(/\.MP3$/i, '').split(' - ');
            result.push({
              position: seq.position,
              title: parts.slice(1).join(' - ') || r.title,
              artist: parts[0] || r.artist,
              source: 'TOP25',
              isFromRanking: true,
              isFixed: false,
              filename,
            });
            found = true;
            break;
          }
        }
        if (!found) {
          result.push({
            position: seq.position,
            title: '(Sem música do ranking)',
            artist: 'TOP25',
            source: 'TOP25',
            isFromRanking: true,
            isFixed: false,
            filename: '',
          });
        }
        continue;
      }

      const stationDbName = STATION_ID_TO_DB_NAME[seq.radioSource] || STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()] || '';
      let stationName = stationDbName;
      if (!stationName) {
        const stationConfig = stations.find(s => s.id === seq.radioSource || s.id.toLowerCase() === seq.radioSource.toLowerCase());
        stationName = stationConfig?.name || '';
      }

      let poolSongs: SongPool[] = songsByStation[stationName] || [];
      if (poolSongs.length === 0) {
        const normalizedSource = seq.radioSource.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const [poolName, poolData] of Object.entries(songsByStation)) {
          const normalizedPool = poolName.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (normalizedPool.includes(normalizedSource) || normalizedSource.includes(normalizedPool)) {
            stationName = poolName;
            poolSongs = poolData;
            break;
          }
        }
      }

      const startIdx = stationSongIndex[stationName] || 0;
      let selected = false;
      for (let i = 0; i < poolSongs.length; i++) {
        const idx = (startIdx + i) % poolSongs.length;
        const song = poolSongs[idx];
        const key = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
        const artistKey = song.artist.toLowerCase().trim();
        if (!usedInBlock.has(key) && !usedArtistsInBlock.has(artistKey)) {
          usedInBlock.add(key);
          usedArtistsInBlock.add(artistKey);
          stationSongIndex[stationName] = (idx + 1) % poolSongs.length;
          const filename = sanitizeGradeFilename(`${song.artist} - ${song.title}.MP3`, filterChars);
          const parts = filename.replace(/\.MP3$/i, '').split(' - ');
          result.push({
            position: seq.position,
            title: parts.slice(1).join(' - ') || song.title,
            artist: parts[0] || song.artist,
            source: stationName || seq.radioSource,
            isFromRanking: rankingSongs.some(
              r => r.title.toLowerCase() === song.title.toLowerCase() &&
                   r.artist.toLowerCase() === song.artist.toLowerCase()
            ),
            isFixed: false,
            filename,
            scrapedAt: song.scraped_at,
          });
          selected = true;
          break;
        }
      }

      if (!selected) {
        result.push({
          position: seq.position,
          title: '(Aguardando captura)',
          artist: stationName || seq.radioSource,
          source: stationName || seq.radioSource,
          isFromRanking: false,
          isFixed: false,
          filename: '',
        });
      }
    }

    return result;
  }, [activeSequence, songsByStation, rankingSongs, stations, fixedContent, filterChars]);

  // Use TXT data when available, otherwise fall back to simulation
  const rawPreviewSongs = txtSongs || simulatedSongs;
  const isFromTxt = txtSongs !== null;

  // Sort: for TXT data, sort monitoring songs by freshness; for simulation, keep sequence order
  const previewSongs = useMemo(() => {
    if (!isFromTxt) {
      // Simulation: keep sequence order as-is (already built following activeSequence)
      return rawPreviewSongs;
    }
    // TXT: sort monitoring songs by freshness, keep fixed at original positions
    const fixed = rawPreviewSongs.filter(s => s.isFixed);
    const monitoring = rawPreviewSongs.filter(s => !s.isFixed).sort((a, b) => {
      if (!a.scrapedAt && !b.scrapedAt) return 0;
      if (!a.scrapedAt) return 1;
      if (!b.scrapedAt) return -1;
      return new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
    });
    const result: PreviewSong[] = [];
    let monIdx = 0;
    for (let pos = 1; pos <= rawPreviewSongs.length; pos++) {
      const fixedItem = fixed.find(f => f.position === pos);
      if (fixedItem) {
        result.push(fixedItem);
      } else if (monIdx < monitoring.length) {
        result.push({ ...monitoring[monIdx], position: pos });
        monIdx++;
      }
    }
    while (monIdx < monitoring.length) {
      result.push({ ...monitoring[monIdx], position: result.length + 1 });
      monIdx++;
    }
    return result;
  }, [rawPreviewSongs, isFromTxt]);

  const songsFromRanking = previewSongs.filter(s => s.isFromRanking).length;

  const lastGradeTop50Count = useMemo(() => {
    if (gradeHistory.length === 0) return 0;
    const top50Blocks = gradeHistory.filter(g => g.programName.includes('TOP'));
    if (top50Blocks.length > 0) {
      return top50Blocks[0].songsFound || 0;
    }
    return Math.min(rankingSongs.length, 20);
  }, [gradeHistory, rankingSongs]);

  return (
    <Card className="glass-card border-amber-500/20">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="w-5 h-5 text-amber-500" />
            Preview da Próxima Grade
          </CardTitle>
          <div className="flex items-center gap-2">
            {isLoading && !isFromTxt && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {isFromTxt && (
              <Badge variant="outline" className="border-green-500/50 text-green-500 text-xs">
                <FileText className="w-3 h-3 mr-1" />
                {txtSource}
              </Badge>
            )}
            {!isFromTxt && (
              <Badge variant="outline" className="border-orange-500/50 text-orange-500 text-xs">
                <Radio className="w-3 h-3 mr-1" />
                Simulação
              </Badge>
            )}
            <Badge variant="outline" className="border-amber-500/50 text-amber-500">
              <Clock className="w-3 h-3 mr-1" />
              {nextBlockTime}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* TOP50 Usage Indicator */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-transparent border border-purple-500/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Músicas do TOP25 na Grade</p>
              <p className="text-xs text-muted-foreground">Última grade usou músicas do ranking</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-purple-500">{lastGradeTop50Count}</p>
            <p className="text-xs text-muted-foreground">de {Math.min(rankingSongs.length, 25)}</p>
          </div>
        </div>

        {/* Songs Preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              {isFromTxt ? 'Grade real (do arquivo TXT):' : 'Músicas que serão usadas:'}
            </p>
            <Badge variant="secondary" className="text-xs">
              {songsFromRanking} no ranking
            </Badge>
          </div>
          
          <ScrollArea className="h-[200px]">
            <div className="space-y-1">
              {previewSongs.map((song, index) => {
                const freshness = !song.isFixed ? getFreshnessInfo(song.scrapedAt) : null;
                return (
                <div
                  key={index}
                  className={`p-2 rounded-lg flex items-center gap-3 transition-all ${
                    song.isFixed
                      ? 'bg-amber-500/10 border border-amber-500/20'
                      : song.isFromRanking 
                        ? 'bg-gradient-to-r from-purple-500/15 via-purple-500/5 to-transparent border border-purple-500/30 shadow-[inset_0_0_12px_rgba(168,85,247,0.08)]' 
                        : 'bg-secondary/50'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    song.isFromRanking 
                      ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40' 
                      : 'bg-primary/10 text-primary'
                  }`}>
                    {song.position}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {song.title}
                      {song.isFromRanking && (
                        <TrendingUp className="w-3 h-3 inline ml-1 text-purple-500" />
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {song.artist}
                      {!song.isFixed && song.source && song.source !== 'CORINGA' && (
                        <span className="ml-1 opacity-60">· {song.source}</span>
                      )}
                    </p>
                  </div>
                  {/* Freshness indicator */}
                  {freshness && freshness.icon && (
                    <div className={`flex items-center gap-1 shrink-0 text-xs font-medium ${
                      freshness.icon === 'fire' ? 'text-green-400' :
                      freshness.icon === 'alert' ? 'text-amber-400' :
                      'text-blue-400'
                    }`}>
                      {freshness.icon === 'fire' && <Flame className="w-3.5 h-3.5" />}
                      {freshness.icon === 'alert' && <AlertTriangle className="w-3.5 h-3.5" />}
                      {freshness.icon === 'cold' && <Snowflake className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">{freshness.label}</span>
                    </div>
                  )}
                  {song.isFixed && (
                    <Badge variant="outline" className="text-xs shrink-0 border-amber-500/50 text-amber-500">
                      FIXO
                    </Badge>
                  )}
                </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
