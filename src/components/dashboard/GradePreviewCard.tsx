import { useState, useMemo, useEffect, useCallback } from 'react';
import { Eye, Music, TrendingUp, Radio, Clock, Sparkles, Flame, RefreshCw, Loader2, CheckCircle, XCircle, HardDrive } from 'lucide-react';
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

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

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
  originalArtist?: string;
  originalTitle?: string;
}

type LibraryStatus = 'checking' | 'found' | 'missing' | 'unavailable';

export function GradePreviewCard() {
  const { stations, rankingSongs, gradeHistory, scheduledSequences, sequence, config } = useRadioStore();
  const [songsByStation, setSongsByStation] = useState<Record<string, SongPool[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [libraryStatus, setLibraryStatus] = useState<Record<string, LibraryStatus>>({});
  const [isCheckingLibrary, setIsCheckingLibrary] = useState(false);
  
  // Timer to keep block times in sync with local PC clock
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setClockTick(t => t + 1), 30000); // every 30s
    return () => clearInterval(interval);
  }, []);

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
    
    // Subscribe to realtime changes on scraped_songs
    const channel = supabase
      .channel('grade-preview-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scraped_songs' },
        () => {
          console.log('[GradePreview] Nova captura detectada, atualizando preview...');
          fetchSongs();
        }
      )
      .subscribe();

    // Fallback polling every 60s (in case realtime hiccups)
    const interval = setInterval(fetchSongs, 60000);
    
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nextBlock = useMemo(() => getNextBlockTime(), [clockTick]);
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
      let dbName = stationIdToDbName[seq.radioSource] || seq.radioSource;
      let pool = songsByStation[dbName] || [];

      // Fuzzy fallback: try matching pool keys if direct lookup failed
      if (pool.length === 0) {
        const normalized = dbName.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const [poolKey, poolSongs] of Object.entries(songsByStation)) {
          const normalizedPool = poolKey.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (normalizedPool.includes(normalized) || normalized.includes(normalizedPool)) {
            dbName = poolKey;
            pool = poolSongs;
            break;
          }
        }
      }

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
        originalArtist: picked.artist,
        originalTitle: picked.title,
      });
    });

    return songs;
  }, [songsByStation, stationIdToDbName, rankingSongs, sequence, scheduledSequences]);

  // Check library availability for preview songs
  const checkLibrary = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.findSongMatch) {
      // In web mode, mark all as unavailable
      const newStatus: Record<string, LibraryStatus> = {};
      previewSongs.forEach(s => {
        if (s.originalArtist && s.originalTitle) {
          const key = `${s.originalArtist.toLowerCase()}|${s.originalTitle.toLowerCase()}`;
          newStatus[key] = 'unavailable';
        }
      });
      setLibraryStatus(newStatus);
      return;
    }

    setIsCheckingLibrary(true);
    const newStatus: Record<string, LibraryStatus> = {};
    const musicFolders = config.musicFolders || [];
    const threshold = config.similarityThreshold || 0.75;

    // Mark all as checking first
    previewSongs.forEach(s => {
      if (s.originalArtist && s.originalTitle) {
        const key = `${s.originalArtist.toLowerCase()}|${s.originalTitle.toLowerCase()}`;
        newStatus[key] = 'checking';
      }
    });
    setLibraryStatus({ ...newStatus });

    // Check in parallel batches of 3
    const songsToCheck = previewSongs.filter(s => s.originalArtist && s.originalTitle);
    for (let i = 0; i < songsToCheck.length; i += 3) {
      const batch = songsToCheck.slice(i, i + 3);
      const results = await Promise.all(
        batch.map(async (song) => {
          const key = `${song.originalArtist!.toLowerCase()}|${song.originalTitle!.toLowerCase()}`;
          try {
            const result = await Promise.race([
              window.electronAPI!.findSongMatch({
                artist: song.originalArtist!,
                title: song.originalTitle!,
                musicFolders,
                threshold,
              } as any),
              new Promise<{ exists: false }>((resolve) => setTimeout(() => resolve({ exists: false }), 10000)),
            ]);
            return { key, status: (result.exists ? 'found' : 'missing') as LibraryStatus };
          } catch {
            return { key, status: 'missing' as LibraryStatus };
          }
        })
      );
      
      for (const { key, status } of results) {
        newStatus[key] = status;
      }
      setLibraryStatus({ ...newStatus });
    }

    setIsCheckingLibrary(false);

    // Log diagnostic summary
    const found = Object.values(newStatus).filter(s => s === 'found').length;
    const missing = Object.values(newStatus).filter(s => s === 'missing').length;
    console.log(`[GradePreview] 🔍 Biblioteca: ${found} encontradas, ${missing} faltando de ${songsToCheck.length} verificadas`);
    
    if (missing > 0) {
      const missingSongs = songsToCheck.filter(s => {
        const key = `${s.originalArtist!.toLowerCase()}|${s.originalTitle!.toLowerCase()}`;
        return newStatus[key] === 'missing';
      });
      console.log('[GradePreview] ❌ Músicas faltando na biblioteca:');
      missingSongs.forEach(s => console.log(`  - ${s.originalArtist} - ${s.originalTitle}`));
      console.log(`[GradePreview] 📁 Pastas configuradas: ${musicFolders.join(', ')}`);
      console.log(`[GradePreview] 🎯 Threshold: ${Math.round(threshold * 100)}%`);
    }
  }, [previewSongs, config.musicFolders, config.similarityThreshold]);

  // Auto-check library when preview songs change
  useEffect(() => {
    if (previewSongs.length > 0) {
      checkLibrary();
    }
  }, [previewSongs, checkLibrary]);

  const getLibraryIcon = (song: PreviewSong) => {
    if (!song.originalArtist || !song.originalTitle) return null;
    const key = `${song.originalArtist.toLowerCase()}|${song.originalTitle.toLowerCase()}`;
    const status = libraryStatus[key];
    
    if (!status || status === 'unavailable') return null;
    if (status === 'checking') return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
    if (status === 'found') return <CheckCircle className="w-3 h-3 text-green-400" />;
    if (status === 'missing') return <XCircle className="w-3 h-3 text-red-400" />;
    return null;
  };

  const songsFromRanking = previewSongs.filter(s => s.isFromRanking).length;
  const freshSongs = previewSongs.filter(s => s.freshness).length;
  const totalPool = Object.values(songsByStation).reduce((acc, arr) => acc + arr.length, 0);

  const foundCount = Object.values(libraryStatus).filter(s => s === 'found').length;
  const missingCount = Object.values(libraryStatus).filter(s => s === 'missing').length;

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
              onClick={() => { fetchSongs(); }}
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
        <div className="grid grid-cols-4 gap-2">
          <div className="p-2 rounded-lg bg-secondary/50 text-center">
            <p className="text-lg font-bold text-primary">{totalPool}</p>
            <p className="text-[10px] text-muted-foreground">Pool Total</p>
          </div>
          <div className="p-2 rounded-lg bg-secondary/50 text-center">
            <p className="text-lg font-bold text-orange-400">{freshSongs}</p>
            <p className="text-[10px] text-muted-foreground">🔥 Frescas</p>
          </div>
          <div className="p-2 rounded-lg bg-secondary/50 text-center">
            <p className="text-lg font-bold text-green-400">{foundCount}</p>
            <p className="text-[10px] text-muted-foreground">✅ Na Lib</p>
          </div>
          <div className="p-2 rounded-lg bg-secondary/50 text-center">
            <p className="text-lg font-bold text-red-400">{missingCount}</p>
            <p className="text-[10px] text-muted-foreground">❌ Faltando</p>
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
            {isElectron && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1"
                onClick={checkLibrary}
                disabled={isCheckingLibrary}
              >
                <HardDrive className="w-3 h-3" />
                {isCheckingLibrary ? 'Verificando...' : 'Verificar Lib'}
              </Button>
            )}
          </div>

          <ScrollArea className="h-[300px]">
            <div className="space-y-1">
              {previewSongs.map((song, index) => (
                <div
                  key={index}
                  className={`p-2 rounded-lg flex items-center gap-2 ${
                    song.originalArtist && libraryStatus[`${song.originalArtist.toLowerCase()}|${song.originalTitle?.toLowerCase()}`] === 'missing'
                      ? 'bg-red-500/10 border border-red-500/20'
                      : song.isFromRanking
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
                    {getLibraryIcon(song)}
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
