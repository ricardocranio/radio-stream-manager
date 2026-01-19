import { useState, useEffect, useMemo } from 'react';
import { Music, Radio, Calendar, Filter, RefreshCw, Download, TrendingUp, Clock, Search, Loader2, Database } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore } from '@/store/radioStore';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays, subHours } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ScrapedSong {
  id: string;
  title: string;
  artist: string;
  station_name: string;
  scraped_at: string;
  is_now_playing: boolean;
  source: string | null;
}

export function CapturedSongsView() {
  const { toast } = useToast();
  const { addOrUpdateRankingSong, rankingSongs } = useRadioStore();
  const [songs, setSongs] = useState<ScrapedSong[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStation, setSelectedStation] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('24h');
  const [stations, setStations] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Load songs from Supabase
  const loadSongs = async () => {
    setIsLoading(true);
    try {
      // Calculate date threshold
      let dateThreshold: Date;
      switch (dateRange) {
        case '1h':
          dateThreshold = subHours(new Date(), 1);
          break;
        case '6h':
          dateThreshold = subHours(new Date(), 6);
          break;
        case '24h':
          dateThreshold = subDays(new Date(), 1);
          break;
        case '7d':
          dateThreshold = subDays(new Date(), 7);
          break;
        case '30d':
          dateThreshold = subDays(new Date(), 30);
          break;
        default:
          dateThreshold = subDays(new Date(), 1);
      }

      // Build query
      let query = supabase
        .from('scraped_songs')
        .select('*')
        .gte('scraped_at', dateThreshold.toISOString())
        .order('scraped_at', { ascending: false })
        .limit(500);

      if (selectedStation !== 'all') {
        query = query.eq('station_name', selectedStation);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      setSongs(data || []);
      
      // Get total count
      const { count: totalCount } = await supabase
        .from('scraped_songs')
        .select('*', { count: 'exact', head: true });
      
      setTotalCount(totalCount || 0);

      // Get unique stations
      const { data: stationsData } = await supabase
        .from('radio_stations')
        .select('name')
        .order('name');
      
      if (stationsData) {
        setStations(stationsData.map(s => s.name));
      }

    } catch (error) {
      console.error('Error loading songs:', error);
      toast({
        title: 'Erro ao carregar',
        description: 'Não foi possível carregar as músicas capturadas.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadSongs();
  }, [selectedStation, dateRange]);

  // Refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadSongs();
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedStation, dateRange]);

  // Handle manual refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadSongs();
    setIsRefreshing(false);
    toast({
      title: '🔄 Atualizado',
      description: `${songs.length} músicas carregadas.`,
    });
  };

  // Sync captured songs to ranking
  const handleSyncToRanking = async () => {
    setIsSyncing(true);
    try {
      let synced = 0;
      for (const song of songs) {
        // Determine style based on station (simplified)
        let style = 'POP/VARIADO';
        const stationLower = song.station_name.toLowerCase();
        if (stationLower.includes('bh') || stationLower.includes('sertanejo')) {
          style = 'SERTANEJO';
        } else if (stationLower.includes('band') || stationLower.includes('pagode')) {
          style = 'PAGODE';
        } else if (stationLower.includes('globo')) {
          style = 'POP/VARIADO';
        }

        addOrUpdateRankingSong(song.title, song.artist, style);
        synced++;
      }

      toast({
        title: '✓ Sincronizado com Ranking',
        description: `${synced} músicas adicionadas/atualizadas no TOP50.`,
      });
    } catch (error) {
      toast({
        title: 'Erro na sincronização',
        description: 'Não foi possível sincronizar com o ranking.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Filter songs by search term
  const filteredSongs = useMemo(() => {
    if (!searchTerm) return songs;
    const term = searchTerm.toLowerCase();
    return songs.filter(
      song =>
        song.title.toLowerCase().includes(term) ||
        song.artist.toLowerCase().includes(term) ||
        song.station_name.toLowerCase().includes(term)
    );
  }, [songs, searchTerm]);

  // Group songs by station for stats
  const stationStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const song of songs) {
      stats[song.station_name] = (stats[song.station_name] || 0) + 1;
    }
    return Object.entries(stats).sort((a, b) => b[1] - a[1]);
  }, [songs]);

  // Export songs as JSON
  const handleExport = () => {
    const exportData = {
      exportDate: new Date().toISOString(),
      filters: { station: selectedStation, dateRange, searchTerm },
      totalSongs: filteredSongs.length,
      songs: filteredSongs.map(s => ({
        title: s.title,
        artist: s.artist,
        station: s.station_name,
        capturedAt: s.scraped_at,
        isNowPlaying: s.is_now_playing,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `musicas_capturadas_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: '📥 Exportado!',
      description: `${filteredSongs.length} músicas exportadas.`,
    });
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Músicas Capturadas</h2>
          <p className="text-muted-foreground">Histórico de músicas detectadas pelo monitoramento</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncToRanking}
            disabled={isSyncing || songs.length === 0}
            className="gap-2"
          >
            {isSyncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <TrendingUp className="w-4 h-4" />
            )}
            Sincronizar com Ranking
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download className="w-4 h-4" />
            Exportar
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            {isRefreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Atualizar
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Database className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total no Banco</p>
                <p className="text-2xl font-bold text-foreground">{totalCount.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <Music className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Período Atual</p>
                <p className="text-2xl font-bold text-foreground">{songs.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border-orange-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                <Radio className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Emissoras</p>
                <p className="text-2xl font-bold text-foreground">{stationStats.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">No Ranking</p>
                <p className="text-2xl font-bold text-foreground">{rankingSongs.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar música, artista ou emissora..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Station Filter */}
            <Select value={selectedStation} onValueChange={setSelectedStation}>
              <SelectTrigger className="w-[180px]">
                <Radio className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Emissora" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Emissoras</SelectItem>
                {stations.map(station => (
                  <SelectItem key={station} value={station}>{station}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Date Range Filter */}
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[150px]">
                <Calendar className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Última hora</SelectItem>
                <SelectItem value="6h">Últimas 6 horas</SelectItem>
                <SelectItem value="24h">Últimas 24 horas</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>

            {/* Clear Filters */}
            {(searchTerm || selectedStation !== 'all' || dateRange !== '24h') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchTerm('');
                  setSelectedStation('all');
                  setDateRange('24h');
                }}
              >
                Limpar filtros
              </Button>
            )}
          </div>

          {/* Station Stats */}
          {stationStats.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
              {stationStats.slice(0, 6).map(([station, count]) => (
                <Badge
                  key={station}
                  variant={selectedStation === station ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => setSelectedStation(station)}
                >
                  {station}: {count}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Songs List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Music className="w-5 h-5" />
            Histórico de Músicas ({filteredSongs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredSongs.length === 0 ? (
            <div className="text-center py-12">
              <Music className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Nenhuma música encontrada</h3>
              <p className="text-muted-foreground">
                {songs.length === 0
                  ? 'Execute o script Python para começar a capturar músicas.'
                  : 'Tente ajustar os filtros de busca.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {filteredSongs.map((song, index) => (
                <div
                  key={song.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-sm font-mono text-muted-foreground w-8">
                      {index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{song.title}</p>
                      <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="hidden sm:flex">
                      <Radio className="w-3 h-3 mr-1" />
                      {song.station_name}
                    </Badge>
                    {song.is_now_playing && (
                      <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
                        AO VIVO
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {format(new Date(song.scraped_at), 'dd/MM HH:mm', { locale: ptBR })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
