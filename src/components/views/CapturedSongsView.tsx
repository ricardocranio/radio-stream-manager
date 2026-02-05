import { useState, useEffect, useMemo, useCallback } from 'react';
import { Music, Radio, Calendar, Filter, RefreshCw, Download, TrendingUp, Clock, Search, Loader2, Database, BarChart3, PieChart as PieChartIcon, Zap, PlayCircle, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore, DownloadHistoryEntry } from '@/store/radioStore';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays, subHours, parseISO, getHours } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { checkSongInLibrary } from '@/hooks/useCheckMusicLibrary';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Legend,
} from 'recharts';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

interface ScrapedSong {
  id: string;
  title: string;
  artist: string;
  station_name: string;
  scraped_at: string;
  is_now_playing: boolean;
  source: string | null;
}

interface DownloadStatus {
  [songId: string]: 'idle' | 'downloading' | 'success' | 'error' | 'exists';
}

// Colors for charts
const CHART_COLORS = [
  'hsl(190, 95%, 50%)',
  'hsl(25, 95%, 55%)',
  'hsl(150, 80%, 45%)',
  'hsl(280, 70%, 55%)',
  'hsl(40, 95%, 55%)',
  'hsl(340, 80%, 55%)',
  'hsl(200, 90%, 50%)',
  'hsl(60, 85%, 50%)',
];

export function CapturedSongsView() {
  const { toast } = useToast();
  const { addOrUpdateRankingSong, rankingSongs, deezerConfig, config, addDownloadHistory } = useRadioStore();
  const [songs, setSongs] = useState<ScrapedSong[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStation, setSelectedStation] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('24h');
  const [stations, setStations] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true); // Always enabled by default
  const [lastAutoSync, setLastAutoSync] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState('list');
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({});
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [autoDownloadMode, setAutoDownloadMode] = useState<'manual' | 'auto'>('manual');

  // Load songs from Supabase
  const loadSongs = useCallback(async () => {
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
        .limit(1000);

      if (selectedStation !== 'all') {
        query = query.eq('station_name', selectedStation);
      }

      const { data, error } = await query;

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
    }
  }, [selectedStation, dateRange]);

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    loadSongs().finally(() => setIsLoading(false));
  }, [loadSongs]);

  // Refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadSongs();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadSongs]);

  // Sync captured songs to ranking
  const syncToRanking = useCallback(async (silent = false) => {
    if (songs.length === 0) return;
    
    setIsSyncing(true);
    try {
      let synced = 0;
      for (const song of songs) {
        // Determine style based on station
        let style = 'POP/VARIADO';
        const stationLower = song.station_name.toLowerCase();
        if (stationLower.includes('bh') || stationLower.includes('sertanejo') || stationLower.includes('clube')) {
          style = 'SERTANEJO';
        } else if (stationLower.includes('band') || stationLower.includes('pagode')) {
          style = 'PAGODE';
        } else if (stationLower.includes('globo')) {
          style = 'POP/VARIADO';
        } else if (stationLower.includes('dance') || stationLower.includes('mix')) {
          style = 'DANCE';
        }

        addOrUpdateRankingSong(song.title, song.artist, style);
        synced++;
      }

      setLastAutoSync(new Date());

      if (!silent) {
        toast({
          title: '✓ Sincronizado com Ranking',
          description: `${synced} músicas adicionadas/atualizadas no TOP50.`,
        });
      } else {
        console.log(`[AUTO-SYNC] ${synced} músicas sincronizadas com o ranking`);
      }
    } catch (error) {
      if (!silent) {
        toast({
          title: 'Erro na sincronização',
          description: 'Não foi possível sincronizar com o ranking.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsSyncing(false);
    }
  }, [songs, addOrUpdateRankingSong, toast]);

  // Auto-sync every 30 minutes
  useEffect(() => {
    if (!autoSyncEnabled) return;

    // Sync immediately when enabled
    syncToRanking(true);

    // Then sync every 30 minutes
    const interval = setInterval(() => {
      console.log('[AUTO-SYNC] Executando sincronização automática...');
      loadSongs().then(() => syncToRanking(true));
    }, 30 * 60 * 1000); // 30 minutes

    return () => clearInterval(interval);
  }, [autoSyncEnabled, syncToRanking, loadSongs]);

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

  // Toggle auto-sync
  const handleToggleAutoSync = () => {
    setAutoSyncEnabled(!autoSyncEnabled);
    toast({
      title: autoSyncEnabled ? 'Sincronização automática desativada' : 'Sincronização automática ativada',
      description: autoSyncEnabled 
        ? 'As músicas não serão mais sincronizadas automaticamente.' 
        : 'Músicas serão sincronizadas com o ranking a cada 5 minutos.',
    });
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

  // Chart data: Songs per station (Pie Chart)
  const stationChartData = useMemo(() => {
    return stationStats.map(([name, value], index) => ({
      name: name.length > 15 ? name.substring(0, 15) + '...' : name,
      fullName: name,
      value,
      fill: CHART_COLORS[index % CHART_COLORS.length],
    }));
  }, [stationStats]);

  // Chart data: Songs per hour (Bar Chart)
  const hourlyChartData = useMemo(() => {
    const hourCounts: Record<number, number> = {};
    for (let i = 0; i < 24; i++) {
      hourCounts[i] = 0;
    }
    
    for (const song of songs) {
      const hour = getHours(parseISO(song.scraped_at));
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }
    
    return Object.entries(hourCounts).map(([hour, count]) => ({
      hour: `${hour}h`,
      count,
    }));
  }, [songs]);

  // Chart data: Songs over time (Area Chart)
  const timelineChartData = useMemo(() => {
    const dateCounts: Record<string, Record<string, number>> = {};
    
    for (const song of songs) {
      const date = format(parseISO(song.scraped_at), 'dd/MM');
      const station = song.station_name;
      
      if (!dateCounts[date]) {
        dateCounts[date] = {};
      }
      dateCounts[date][station] = (dateCounts[date][station] || 0) + 1;
    }
    
    const uniqueStations = [...new Set(songs.map(s => s.station_name))];
    
    return Object.entries(dateCounts)
      .map(([date, stations]) => ({
        date,
        ...uniqueStations.reduce((acc, station) => ({
          ...acc,
          [station]: stations[station] || 0,
        }), {}),
        total: Object.values(stations).reduce((a, b) => a + b, 0),
      }))
      .reverse();
  }, [songs]);

  // Top artists
  const topArtists = useMemo(() => {
    const artistCounts: Record<string, number> = {};
    for (const song of songs) {
      artistCounts[song.artist] = (artistCounts[song.artist] || 0) + 1;
    }
    return Object.entries(artistCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [songs]);

  // Download a single song
  const handleDownloadSong = useCallback(async (song: ScrapedSong) => {
    if (!isElectron) {
      toast({
        title: 'Apenas no Desktop',
        description: 'Download só funciona no app Electron.',
        variant: 'destructive',
      });
      return;
    }

    if (!deezerConfig.enabled || !deezerConfig.arl) {
      toast({
        title: 'Deezer não configurado',
        description: 'Configure o ARL do Deezer nas Configurações.',
        variant: 'destructive',
      });
      return;
    }

    // Check if song already exists in library
    if (config.musicFolders?.length > 0) {
      try {
        const existsResult = await checkSongInLibrary(
          song.artist,
          song.title,
          config.musicFolders,
          config.similarityThreshold || 0.75
        );
        if (existsResult.exists) {
          setDownloadStatus(prev => ({ ...prev, [song.id]: 'exists' }));
          toast({
            title: '✓ Já existe na biblioteca',
            description: `${song.artist} - ${song.title}`,
          });
          return;
        }
      } catch (err) {
        // Continue with download if check fails
      }
    }

    setDownloadStatus(prev => ({ ...prev, [song.id]: 'downloading' }));
    const startTime = Date.now();

    try {
      const result = await window.electronAPI?.downloadFromDeezer({
        artist: song.artist,
        title: song.title,
        arl: deezerConfig.arl,
        outputFolder: deezerConfig.downloadFolder,
        quality: deezerConfig.quality,
        stationName: song.station_name,
      });

      const duration = Date.now() - startTime;

      if (result?.success) {
        setDownloadStatus(prev => ({ ...prev, [song.id]: 'success' }));
        
        const historyEntry: DownloadHistoryEntry = {
          id: crypto.randomUUID(),
          songId: song.id,
          title: song.title,
          artist: song.artist,
          timestamp: new Date(),
          status: 'success',
          duration,
        };
        addDownloadHistory(historyEntry);

        toast({
          title: '✅ Download concluído!',
          description: `${song.artist} - ${song.title}`,
        });
      } else {
        throw new Error(result?.error || 'Falha no download');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      setDownloadStatus(prev => ({ ...prev, [song.id]: 'error' }));
      
      const historyEntry: DownloadHistoryEntry = {
        id: crypto.randomUUID(),
        songId: song.id,
        title: song.title,
        artist: song.artist,
        timestamp: new Date(),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
        duration,
      };
      addDownloadHistory(historyEntry);

      toast({
        title: '❌ Erro no download',
        description: error instanceof Error ? error.message : 'Falha ao baixar.',
        variant: 'destructive',
      });
    }
  }, [deezerConfig, config, toast, addDownloadHistory]);

  // Download all filtered songs (with deduplication)
  const handleDownloadAll = useCallback(async () => {
    if (!isElectron) {
      toast({
        title: 'Apenas no Desktop',
        description: 'Download só funciona no app Electron.',
        variant: 'destructive',
      });
      return;
    }

    if (!deezerConfig.enabled || !deezerConfig.arl) {
      toast({
        title: 'Deezer não configurado',
        description: 'Configure o ARL do Deezer nas Configurações.',
        variant: 'destructive',
      });
      return;
    }

    // Deduplicate songs by artist+title (case insensitive)
    const seenSongs = new Set<string>();
    const uniqueSongs = filteredSongs.filter(song => {
      const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
      if (seenSongs.has(key)) return false;
      seenSongs.add(key);
      return true;
    });

    setIsDownloadingAll(true);
    setDownloadProgress({ current: 0, total: uniqueSongs.length });

    let successCount = 0;
    let existsCount = 0;
    let errorCount = 0;

    for (let i = 0; i < uniqueSongs.length; i++) {
      const song = uniqueSongs[i];
      setDownloadProgress({ current: i + 1, total: uniqueSongs.length });

      // Check if already exists in library
      if (config.musicFolders?.length > 0) {
        try {
          const existsResult = await checkSongInLibrary(
            song.artist,
            song.title,
            config.musicFolders,
            config.similarityThreshold || 0.75
          );
          if (existsResult.exists) {
            setDownloadStatus(prev => ({ ...prev, [song.id]: 'exists' }));
            existsCount++;
            continue;
          }
        } catch (err) {
          // Continue with download if check fails
        }
      }

      setDownloadStatus(prev => ({ ...prev, [song.id]: 'downloading' }));
      const startTime = Date.now();

      try {
        const result = await window.electronAPI?.downloadFromDeezer({
          artist: song.artist,
          title: song.title,
          arl: deezerConfig.arl,
          outputFolder: deezerConfig.downloadFolder,
          quality: deezerConfig.quality,
          stationName: song.station_name,
        });

        const duration = Date.now() - startTime;

        if (result?.success) {
          setDownloadStatus(prev => ({ ...prev, [song.id]: 'success' }));
          successCount++;
          
          addDownloadHistory({
            id: crypto.randomUUID(),
            songId: song.id,
            title: song.title,
            artist: song.artist,
            timestamp: new Date(),
            status: 'success',
            duration,
          });
        } else {
          throw new Error(result?.error || 'Falha');
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        setDownloadStatus(prev => ({ ...prev, [song.id]: 'error' }));
        errorCount++;
        
        addDownloadHistory({
          id: crypto.randomUUID(),
          songId: song.id,
          title: song.title,
          artist: song.artist,
          timestamp: new Date(),
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Erro',
          duration,
        });
      }

      // Delay between downloads (2 minutes for auto mode, 5 seconds for manual)
      const delayMs = autoDownloadMode === 'auto' ? 120000 : 5000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    setIsDownloadingAll(false);
    toast({
      title: '📥 Download em lote concluído!',
      description: `✅ ${successCount} baixadas | ⏭️ ${existsCount} já existiam | ❌ ${errorCount} erros`,
    });
  }, [filteredSongs, deezerConfig, config, toast, addDownloadHistory, autoDownloadMode]);

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

  // Unique stations for timeline chart
  const uniqueStations = useMemo(() => [...new Set(songs.map(s => s.station_name))], [songs]);

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Músicas Capturadas</h2>
          <p className="text-muted-foreground">Histórico de músicas detectadas pelo monitoramento</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Auto-sync toggle */}
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/50 border border-border">
            <Zap className={`w-3.5 h-3.5 ${autoSyncEnabled ? 'text-green-500' : 'text-muted-foreground'}`} />
            <Label htmlFor="auto-sync" className="text-xs cursor-pointer whitespace-nowrap">
              Auto-sync
            </Label>
            <Switch
              id="auto-sync"
              checked={autoSyncEnabled}
              onCheckedChange={handleToggleAutoSync}
              className="scale-90"
            />
            {lastAutoSync && (
              <span className="text-[10px] text-muted-foreground">
                {format(lastAutoSync, 'HH:mm')}
              </span>
            )}
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncToRanking(false)}
            disabled={isSyncing || songs.length === 0}
            className="gap-1.5"
          >
            {isSyncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <TrendingUp className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Sync Ranking</span>
          </Button>
          
          {/* Download Mode Toggle - Always visible, disabled in browser */}
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/50 border border-border">
            <Download className="w-3.5 h-3.5 text-muted-foreground" />
            <Select 
              value={autoDownloadMode} 
              onValueChange={(v: 'manual' | 'auto') => setAutoDownloadMode(v)}
              disabled={!isElectron}
            >
              <SelectTrigger className="h-6 w-[90px] text-xs border-0 bg-transparent p-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="auto">Automático</SelectItem>
              </SelectContent>
            </Select>
            {!isElectron && (
              <Badge variant="outline" className="text-[9px] px-1 py-0">Desktop</Badge>
            )}
          </div>
          
          {/* Baixar Todas - Always visible, disabled in browser */}
          <Button
            variant="default"
            size="sm"
            onClick={handleDownloadAll}
            disabled={!isElectron || isDownloadingAll || filteredSongs.length === 0}
            className="gap-1.5 bg-primary"
            title={!isElectron ? 'Disponível apenas no app Desktop' : undefined}
          >
            {isDownloadingAll ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="hidden sm:inline">{downloadProgress.current}/{downloadProgress.total}</span>
              </>
            ) : (
              <>
                <PlayCircle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Baixar Todas</span>
              </>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Exportar</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-1.5"
          >
            {isRefreshing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>
      </div>

      {/* Auto-sync status banner */}
      {autoSyncEnabled && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm text-foreground">
            Sincronização automática ativa - Músicas são enviadas ao ranking TOP50 a cada 30 minutos
          </span>
          {lastAutoSync && (
            <Badge variant="secondary" className="ml-auto">
              Último: {format(lastAutoSync, 'HH:mm:ss')}
            </Badge>
          )}
        </div>
      )}

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
              {stationStats.map(([station, count]) => (
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

      {/* Tabs: List / Charts */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="list" className="gap-2">
            <Music className="w-4 h-4" />
            Lista
          </TabsTrigger>
          <TabsTrigger value="charts" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            Gráficos
          </TabsTrigger>
          <TabsTrigger value="artists" className="gap-2">
            <TrendingUp className="w-4 h-4" />
            Top Artistas
          </TabsTrigger>
        </TabsList>

        {/* List Tab */}
        <TabsContent value="list" className="mt-4">
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
                      ? 'Aguardando captura de músicas. Verifique se o monitoramento está ativo.'
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
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="hidden sm:flex">
                          <Radio className="w-3 h-3 mr-1" />
                          {song.station_name}
                        </Badge>
                        {song.is_now_playing && (
                          <Badge className="bg-success/20 text-success border-success/30">
                            AO VIVO
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground whitespace-nowrap hidden md:flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          {format(new Date(song.scraped_at), 'dd/MM HH:mm', { locale: ptBR })}
                        </span>
                        {/* Download button - Always visible, disabled in browser */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDownloadSong(song)}
                          disabled={!isElectron || downloadStatus[song.id] === 'downloading'}
                          title={!isElectron ? 'Disponível no Desktop' : 'Baixar música'}
                        >
                          {downloadStatus[song.id] === 'downloading' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : downloadStatus[song.id] === 'success' ? (
                            <CheckCircle className="w-3.5 h-3.5 text-success" />
                          ) : downloadStatus[song.id] === 'exists' ? (
                            <CheckCircle className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : downloadStatus[song.id] === 'error' ? (
                            <XCircle className="w-3.5 h-3.5 text-destructive" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Charts Tab */}
        <TabsContent value="charts" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Songs per Station (Pie Chart) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <PieChartIcon className="w-5 h-5" />
                  Músicas por Emissora
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stationChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={stationChartData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={100}
                        dataKey="value"
                      >
                        {stationChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value: number, name: string, props: any) => [value, props.payload.fullName]}
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    Sem dados para exibir
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Songs per Hour (Bar Chart) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Músicas por Hora
                </CardTitle>
              </CardHeader>
              <CardContent>
                {hourlyChartData.some(d => d.count > 0) ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={hourlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="hour" 
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                        interval={2}
                      />
                      <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        formatter={(value: number) => [value, 'Músicas']}
                      />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    Sem dados para exibir
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Timeline Chart (Area) */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Evolução por Dia e Emissora
                </CardTitle>
              </CardHeader>
              <CardContent>
                {timelineChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={timelineChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      />
                      <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                      />
                      <Legend />
                      {uniqueStations.slice(0, 5).map((station, index) => (
                        <Area
                          key={station}
                          type="monotone"
                          dataKey={station}
                          stackId="1"
                          stroke={CHART_COLORS[index % CHART_COLORS.length]}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                          fillOpacity={0.6}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    Sem dados para exibir
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Top Artists Tab */}
        <TabsContent value="artists" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Top 10 Artistas Mais Tocados
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topArtists.length > 0 ? (
                <div className="space-y-3">
                  {topArtists.map((artist, index) => (
                    <div key={artist.name} className="flex items-center gap-4">
                      <span className="text-lg font-bold text-muted-foreground w-8">
                        #{index + 1}
                      </span>
                      <div className="flex-1">
                        <p className="font-medium">{artist.name}</p>
                        <div className="h-2 bg-secondary rounded-full mt-1 overflow-hidden">
                          <div 
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${(artist.count / topArtists[0].count) * 100}%` }}
                          />
                        </div>
                      </div>
                      <Badge variant="secondary">{artist.count} músicas</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  Sem dados para exibir
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
