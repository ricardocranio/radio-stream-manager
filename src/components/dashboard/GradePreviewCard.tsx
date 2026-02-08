import { useState, useMemo, useEffect } from 'react';
import { Eye, Music, TrendingUp, Radio, Clock, Sparkles, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { sanitizeGradeFilename } from '@/lib/gradeBuilder/sanitize';
import { STATION_ID_TO_DB_NAME } from '@/lib/gradeBuilder/constants';
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
}

export function GradePreviewCard() {
  const { stations, rankingSongs, gradeHistory, scheduledSequences, sequence: defaultSequence, fixedContent, config } = useRadioStore();
  const [songs, setSongs] = useState<SongPool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

  // Fetch songs from Supabase - same source as grade builder
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

        // If no songs in the 1h window, fetch the most recent ones (like the grade builder fallback)
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
    // Refresh every 2 minutes
    const interval = setInterval(fetchSongs, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [nextBlock.hour, nextBlock.minute]);

  // Build songs by station - same logic as grade builder's buildSongsByStation
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

  // Get active sequence for the next block - same as getActiveSequenceForBlock
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

  // Generate preview using same logic as grade builder
  const previewSongs = useMemo((): PreviewSong[] => {
    const result: PreviewSong[] = [];
    const usedInBlock = new Set<string>();
    const usedArtistsInBlock = new Set<string>();
    const stationSongIndex: Record<string, number> = {};

    for (const seq of activeSequence) {
      // Handle fixo items
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

      // Handle top50
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

      // Normal station: resolve via STATION_ID_TO_DB_NAME (same as grade builder)
      const stationDbName = STATION_ID_TO_DB_NAME[seq.radioSource] || STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()] || '';
      let stationName = stationDbName;

      // Fallback: find in stations config
      if (!stationName) {
        const stationConfig = stations.find(s => s.id === seq.radioSource || s.id.toLowerCase() === seq.radioSource.toLowerCase());
        stationName = stationConfig?.name || '';
      }

      // Find matching pool (with fuzzy matching like the grade builder)
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

      // Select song with anti-repetition (no same title or artist in this block)
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

  // Count songs from ranking
  const songsFromRanking = previewSongs.filter(s => s.isFromRanking).length;

  // Last grade TOP50 usage
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
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
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
              Músicas que serão usadas:
            </p>
            <Badge variant="secondary" className="text-xs">
              {songsFromRanking} no ranking
            </Badge>
          </div>
          
          <ScrollArea className="h-[200px]">
            <div className="space-y-1">
              {previewSongs.map((song, index) => (
                <div
                  key={index}
                  className={`p-2 rounded-lg flex items-center gap-3 ${
                    song.isFixed
                      ? 'bg-amber-500/10 border border-amber-500/20'
                      : song.isFromRanking 
                        ? 'bg-purple-500/10 border border-purple-500/20' 
                        : 'bg-secondary/50'
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {song.position}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {song.title}
                      {song.isFromRanking && (
                        <TrendingUp className="w-3 h-3 inline ml-1 text-purple-500" />
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    <Radio className="w-3 h-3 mr-1" />
                    {song.source}
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
