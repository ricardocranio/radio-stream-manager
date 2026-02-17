import { useState, useMemo, useEffect } from 'react';
import { Eye, Music, TrendingUp, Radio, Clock, Sparkles, Flame, RefreshCw, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { sanitizeFilename } from '@/lib/sanitizeFilename';
import { STATION_ID_TO_DB_NAME } from '@/lib/gradeBuilder/constants';
import { supabase } from '@/integrations/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface SongPool {
  title: string;
  artist: string;
  station: string;
  timestamp: string;
  priority: 'P0' | 'P0.5' | 'P0.75' | 'P1' | 'P2';
}

interface PreviewSong {
  position: number;
  title: string;
  artist: string;
  source: string;
  priority: string;
  freshness?: string;
  isFromRanking: boolean;
}

export function GradePreviewCard() {
  const { stations, rankingSongs, gradeHistory, scheduledSequences, sequence } = useRadioStore();
  const [songsByStation, setSongsByStation] = useState<Record<string, SongPool[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  // Fetch real songs from both tables
  const fetchSongs = async () => {
    setIsLoading(true);
    try {
      const [scrapedResult, historicoResult] = await Promise.all([
        supabase
          .from('scraped_songs')
          .select('title, artist, station_name, scraped_at, is_now_playing')
          .order('scraped_at', { ascending: false })
          .limit(500),
        supabase
          .from('radio_historico')
          .select('title, artist, station_name, captured_at')
          .order('captured_at', { ascending: false })
          .limit(500),
      ]);

      const poolMap: Record<string, SongPool[]> = {};
      const seen = new Set<string>();
      const now = Date.now();
      const thirtyMinAgo = now - 30 * 60 * 1000;

      // Process scraped_songs first (higher priority)
      for (const song of scrapedResult.data || []) {
        const key = `${song.station_name}|${song.title.toLowerCase()}|${song.artist.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const ts = new Date(song.scraped_at).getTime();
        let priority: SongPool['priority'] = 'P1';
        if (song.is_now_playing) priority = 'P0';
        else if (ts >= thirtyMinAgo) priority = 'P0.5';

        if (!poolMap[song.station_name]) poolMap[song.station_name] = [];
        poolMap[song.station_name].push({
          title: song.title,
          artist: song.artist,
          station: song.station_name,
          timestamp: song.scraped_at,
          priority,
        });
      }

      // Process radio_historico (fill gaps)
      for (const song of historicoResult.data || []) {
        const key = `${song.station_name}|${song.title.toLowerCase()}|${song.artist.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (!poolMap[song.station_name]) poolMap[song.station_name] = [];
        poolMap[song.station_name].push({
          title: song.title,
          artist: song.artist,
          station: song.station_name,
          timestamp: song.captured_at,
          priority: 'P1',
        });
      }

      setSongsByStation(poolMap);
      setLastFetch(new Date());
    } catch (error) {
      console.error('[GradePreview] Error fetching songs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSongs();
    const interval = setInterval(fetchSongs, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

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

  // Map station IDs to DB names
  const stationIdToDbName = useMemo(() => {
    const map: Record<string, string> = { ...STATION_ID_TO_DB_NAME };
    stations.forEach(s => {
      map[s.id] = s.name;
      map[s.name.toLowerCase()] = s.name;
    });
    return map;
  }, [stations]);

  // Generate preview using real hierarchy
  const previewSongs = useMemo(() => {
    const activeSequence = getActiveSequence();
    if (activeSequence.length === 0) return [];

    const songs: PreviewSong[] = [];
    const usedArtists = new Set<string>();

    activeSequence.forEach((seq, index) => {
      // Resolve station name from sequence config
      const dbName = stationIdToDbName[seq.radioSource] || seq.radioSource;
      const pool = songsByStation[dbName] || [];

      if (pool.length === 0) {
        songs.push({
          position: seq.position,
          title: '(Aguardando captura)',
          artist: dbName,
          source: dbName,
          priority: '-',
          isFromRanking: false,
        });
        return;
      }

      // Sort by freshness first (most recent), then by priority
      const priorityOrder = { 'P0': 0, 'P0.5': 1, 'P0.75': 2, 'P1': 3, 'P2': 4 };
      const sorted = [...pool].sort((a, b) => {
        // Primary: most recent timestamp first (freshness)
        const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        if (timeDiff !== 0) return timeDiff;
        // Secondary: priority order
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      // Pick first song that doesn't repeat artist
      let picked: SongPool | null = null;
      for (const candidate of sorted) {
        const artistKey = candidate.artist.toLowerCase();
        if (!usedArtists.has(artistKey)) {
          picked = candidate;
          usedArtists.add(artistKey);
          break;
        }
      }

      // Fallback: if all artists used, just pick by priority
      if (!picked) picked = sorted[index % sorted.length];

      const sanitized = sanitizeFilename(`${picked.artist} - ${picked.title}.mp3`).replace(/\s+\./g, '.').toUpperCase();
      const parts = sanitized.replace(/\.MP3$/i, '').split(' - ');

      const isRanked = rankingSongs.some(
        r => r.title.toLowerCase() === picked!.title.toLowerCase() &&
             r.artist.toLowerCase() === picked!.artist.toLowerCase()
      );

      const ageMs = Date.now() - new Date(picked.timestamp).getTime();
      const isFresh = ageMs < 30 * 60 * 1000;

      songs.push({
        position: seq.position,
        title: parts.slice(1).join(' - ') || picked.title,
        artist: parts[0] || picked.artist,
        source: dbName,
        priority: picked.priority,
        freshness: isFresh ? formatDistanceToNow(new Date(picked.timestamp), { locale: ptBR, addSuffix: true }) : undefined,
        isFromRanking: isRanked,
      });
    });

    return songs;
  }, [songsByStation, stationIdToDbName, rankingSongs, sequence, scheduledSequences]);

  const songsFromRanking = previewSongs.filter(s => s.isFromRanking).length;
  const freshSongs = previewSongs.filter(s => s.freshness).length;
  const totalPool = Object.values(songsByStation).reduce((acc, arr) => acc + arr.length, 0);

  // Priority badge color mapping
  const priorityColor = (p: string) => {
    switch (p) {
      case 'P0': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'P0.5': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'P0.75': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'P1': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'P2': return 'bg-muted text-muted-foreground border-border';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  // Last grade TOP50 usage
  const lastGradeTop50Count = useMemo(() => {
    if (gradeHistory.length === 0) return 0;
    const top50Blocks = gradeHistory.filter(g => g.programName.includes('TOP'));
    if (top50Blocks.length > 0) return top50Blocks[0].songsFound || 0;
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
            <Badge variant="outline" className="border-amber-500/50 text-amber-500">
              <Clock className="w-3 h-3 mr-1" />
              {nextBlockTime}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={fetchSongs}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* Pool Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded-lg bg-secondary/50 text-center">
            <p className="text-lg font-bold text-primary">{totalPool}</p>
            <p className="text-[10px] text-muted-foreground">Pool Total</p>
          </div>
          <div className="p-2 rounded-lg bg-secondary/50 text-center">
            <p className="text-lg font-bold text-orange-400">{freshSongs}</p>
            <p className="text-[10px] text-muted-foreground">🔥 Frescas</p>
          </div>
          <div className="p-2 rounded-lg bg-secondary/50 text-center">
            <p className="text-lg font-bold text-purple-400">{songsFromRanking}</p>
            <p className="text-[10px] text-muted-foreground">📊 Ranking</p>
          </div>
        </div>

        {/* Pool per station */}
        <div className="flex flex-wrap gap-1">
          {Object.entries(songsByStation)
            .sort(([, a], [, b]) => b.length - a.length)
            .map(([station, pool]) => (
              <Badge key={station} variant="outline" className="text-[10px]">
                {station}: {pool.length}
              </Badge>
            ))}
        </div>

        {/* Songs Preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Próximo Bloco ({previewSongs.length} slots):
            </p>
          </div>

          <ScrollArea className="h-[300px]">
            <div className="space-y-1">
              {previewSongs.map((song, index) => (
                <div
                  key={index}
                  className={`p-2 rounded-lg flex items-center gap-2 ${
                    song.isFromRanking
                      ? 'bg-purple-500/10 border border-purple-500/20'
                      : song.freshness
                        ? 'bg-orange-500/5 border border-orange-500/10'
                        : 'bg-secondary/50'
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {song.position}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {song.title}
                      {song.isFromRanking && (
                        <TrendingUp className="w-3 h-3 inline ml-1 text-purple-400" />
                      )}
                      {song.freshness && (
                        <Flame className="w-3 h-3 inline ml-1 text-orange-400" />
                      )}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                      {song.freshness && (
                        <span className="text-[9px] text-orange-400 whitespace-nowrap">{song.freshness}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge className={`text-[9px] px-1 py-0 ${priorityColor(song.priority)}`}>
                      {song.priority}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] px-1">
                      <Radio className="w-2.5 h-2.5 mr-0.5" />
                      {song.source.replace(/ FM$/i, '').replace(/^Rádio /, '')}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {lastFetch && (
          <p className="text-[10px] text-muted-foreground text-right">
            Atualizado {format(lastFetch, 'HH:mm:ss', { locale: ptBR })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
