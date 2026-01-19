import { useState, useMemo, useEffect } from 'react';
import { Radio, Music, CheckCircle, XCircle, TrendingUp, Timer, History, Trash2, ExternalLink, Filter, X, Bell, BellOff, Database, Clock, Zap, RefreshCw, Loader2 } from 'lucide-react';
import { useRadioStore, GradeHistoryEntry } from '@/store/radioStore';
import { useCountdown } from '@/hooks/useCountdown';
import { useRealtimeStats } from '@/hooks/useRealtimeStats';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function DashboardView() {
  const { stations, capturedSongs, missingSongs, isRunning, config, gradeHistory, clearGradeHistory, rankingSongs } = useRadioStore();
  const { nextGradeCountdown, autoCleanCountdown, nextGradeSeconds, autoCleanSeconds, nextBlockTime, buildTime } = useCountdown();
  const { stats: realtimeStats, refresh: refreshStats } = useRealtimeStats();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Realtime notifications hook
  const { requestPermission, hasPermission } = useRealtimeNotifications({
    enableBrowserNotifications: notificationsEnabled,
    enableToastNotifications: notificationsEnabled,
  });
  
  // Filter state
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  // Handle notification toggle
  const handleToggleNotifications = async () => {
    if (!notificationsEnabled) {
      const granted = await requestPermission();
      setNotificationsEnabled(granted);
    } else {
      setNotificationsEnabled(false);
    }
  };

  // Handle manual refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshStats();
    setIsRefreshing(false);
  };

  const localStats = {
    activeStations: stations.filter((s) => s.enabled).length,
    totalCaptured: capturedSongs.length,
    foundSongs: capturedSongs.filter((s) => s.status === 'found').length,
    missingSongsCount: missingSongs.length,
    rankingTotal: rankingSongs.length,
  };

  // Demo grade history if empty
  const displayGradeHistory: GradeHistoryEntry[] = gradeHistory.length > 0 
    ? gradeHistory
    : [
        { id: '1', timestamp: new Date(Date.now() - 30 * 60000), blockTime: '21:00', songsProcessed: 10, songsFound: 9, songsMissing: 1, programName: 'Noite NOSSA' },
        { id: '2', timestamp: new Date(Date.now() - 60 * 60000), blockTime: '20:30', songsProcessed: 10, songsFound: 10, songsMissing: 0, programName: 'FIXO' },
        { id: '3', timestamp: new Date(Date.now() - 90 * 60000), blockTime: '20:00', songsProcessed: 10, songsFound: 8, songsMissing: 2, programName: 'FIXO' },
        { id: '4', timestamp: new Date(Date.now() - 120 * 60000), blockTime: '19:30', songsProcessed: 10, songsFound: 10, songsMissing: 0, programName: 'TOP10' },
      ];

  // Simulated captured songs grouped by station for demo
  const demoSongs = [
    { id: '1', title: 'Evidências', artist: 'Chitãozinho & Xororó', station: 'BH FM', timestamp: new Date(), status: 'found' as const, source: 'https://mytuner-radio.com/pt/radio/radio-bh-fm-ao-vivo-402270/' },
    { id: '2', title: 'Atrasadinha', artist: 'Felipe Araújo', station: 'BH FM', timestamp: new Date(), status: 'found' as const, source: 'https://mytuner-radio.com/pt/radio/radio-bh-fm-ao-vivo-402270/' },
    { id: '3', title: 'Medo Bobo', artist: 'Maiara & Maraisa', station: 'BH FM', timestamp: new Date(), status: 'found' as const, source: 'https://mytuner-radio.com/pt/radio/radio-bh-fm-ao-vivo-402270/' },
    { id: '4', title: 'Shallow', artist: 'Lady Gaga', station: 'Band FM', timestamp: new Date(), status: 'missing' as const },
    { id: '5', title: 'Propaganda', artist: 'Jorge & Mateus', station: 'Band FM', timestamp: new Date(), status: 'found' as const, source: 'https://mytuner-radio.com/pt/radio/band-fm-sao-paulo-485671/' },
  ];

  const displaySongs = capturedSongs.length > 0 ? capturedSongs : demoSongs;

  // Helper to extract domain from URL for display
  const getDomainFromUrl = (url: string): string => {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace('www.', '').split('.')[0];
    } catch {
      return url.slice(0, 20);
    }
  };

  // Get unique sources from songs
  const uniqueSources = useMemo(() => {
    const sources = new Set<string>();
    displaySongs.forEach(song => {
      if (song.source) {
        sources.add(getDomainFromUrl(song.source));
      }
    });
    return Array.from(sources);
  }, [displaySongs]);

  // Get unique stations
  const uniqueStations = useMemo(() => {
    const stationSet = new Set<string>();
    displaySongs.forEach(song => stationSet.add(song.station));
    return Array.from(stationSet);
  }, [displaySongs]);

  // Filter songs based on selected source and station
  const filteredSongs = useMemo(() => {
    return displaySongs.filter(song => {
      if (selectedStation && song.station !== selectedStation) return false;
      if (selectedSource && song.source) {
        const songSourceDomain = getDomainFromUrl(song.source);
        if (songSourceDomain !== selectedSource) return false;
      } else if (selectedSource && !song.source) {
        return false;
      }
      return true;
    });
  }, [displaySongs, selectedSource, selectedStation]);

  // Get enabled stations from store
  const enabledStations = stations.filter(s => s.enabled);

  // Group filtered songs by station
  const songsByStation = useMemo(() => {
    const grouped: Record<string, typeof displaySongs> = {};
    
    enabledStations.forEach(station => {
      grouped[station.name] = filteredSongs.filter(song => song.station === station.name);
    });
    
    filteredSongs.forEach(song => {
      if (!grouped[song.station]) {
        grouped[song.station] = [song];
      }
    });
    
    return grouped;
  }, [enabledStations, filteredSongs]);

  // Dynamic color palette for stations
  const colorPalette = [
    { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400' },
    { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400' },
    { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400' },
    { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400' },
    { bg: 'bg-pink-500/10', border: 'border-pink-500/30', text: 'text-pink-400' },
    { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400' },
  ];

  const stationColorMap = new Map<string, typeof colorPalette[0]>();
  Object.keys(songsByStation).forEach((stationName, index) => {
    stationColorMap.set(stationName, colorPalette[index % colorPalette.length]);
  });

  const getStationColor = (station: string) => {
    return stationColorMap.get(station) || colorPalette[0];
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Realtime Stats from Supabase */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="glass-card border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Capturadas</p>
                <p className="text-2xl font-bold text-foreground">
                  {realtimeStats.isLoading ? '...' : realtimeStats.totalSongs.toLocaleString()}
                </p>
                <p className="text-xs text-primary">
                  <Database className="w-3 h-3 inline mr-1" />
                  Supabase
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Music className="w-5 h-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-green-500/20 bg-gradient-to-br from-green-500/10 to-green-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Últimas 24h</p>
                <p className="text-2xl font-bold text-foreground">
                  {realtimeStats.isLoading ? '...' : realtimeStats.songsLast24h.toLocaleString()}
                </p>
                <p className="text-xs text-green-500">
                  <Clock className="w-3 h-3 inline mr-1" />
                  Tempo real
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-orange-500/20 bg-gradient-to-br from-orange-500/10 to-orange-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Última Hora</p>
                <p className="text-2xl font-bold text-foreground">
                  {realtimeStats.isLoading ? '...' : realtimeStats.songsLastHour.toLocaleString()}
                </p>
                <p className="text-xs text-orange-500">
                  <Zap className="w-3 h-3 inline mr-1" />
                  Ativo
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                <Radio className="w-5 h-5 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-purple-500/20 bg-gradient-to-br from-purple-500/10 to-purple-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">No Ranking</p>
                <p className="text-2xl font-bold text-foreground">{localStats.rankingTotal}</p>
                <p className="text-xs text-purple-500">
                  <TrendingUp className="w-3 h-3 inline mr-1" />
                  TOP50
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-cyan-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Emissoras</p>
                <p className="text-2xl font-bold text-foreground">
                  {realtimeStats.isLoading ? '...' : realtimeStats.activeStations}
                </p>
                <p className="text-xs text-cyan-500">
                  <Radio className="w-3 h-3 inline mr-1" />
                  Monitorando
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                <Radio className="w-5 h-5 text-cyan-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Last Song + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Last Captured Song */}
        <Card className="glass-card border-primary/30 lg:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                  <Music className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Última música capturada</p>
                  {realtimeStats.lastSong ? (
                    <>
                      <p className="text-lg font-bold text-foreground">{realtimeStats.lastSong.title}</p>
                      <p className="text-sm text-muted-foreground">{realtimeStats.lastSong.artist}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          <Radio className="w-3 h-3 mr-1" />
                          {realtimeStats.lastSong.station}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(realtimeStats.lastSong.timestamp), { addSuffix: true, locale: ptBR })}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Aguardando captura...</p>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
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
          </CardContent>
        </Card>

        {/* Notifications Control */}
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between h-full">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${notificationsEnabled ? 'bg-green-500/20' : 'bg-muted'}`}>
                  {notificationsEnabled ? (
                    <Bell className="w-5 h-5 text-green-500" />
                  ) : (
                    <BellOff className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-foreground">Notificações Push</p>
                  <p className="text-xs text-muted-foreground">
                    {notificationsEnabled ? 'Ativas - você será notificado' : 'Desativadas'}
                  </p>
                </div>
              </div>
              <Switch
                checked={notificationsEnabled}
                onCheckedChange={handleToggleNotifications}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Station Distribution */}
      {Object.keys(realtimeStats.stationCounts).length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Radio className="w-5 h-5 text-primary" />
              Distribuição por Emissora (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Object.entries(realtimeStats.stationCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([station, count], index) => (
                  <div
                    key={station}
                    className={`p-3 rounded-lg ${colorPalette[index % colorPalette.length].bg} ${colorPalette[index % colorPalette.length].border} border`}
                  >
                    <p className={`text-xs ${colorPalette[index % colorPalette.length].text} truncate`}>{station}</p>
                    <p className="text-xl font-bold text-foreground">{count}</p>
                    <div className="h-1 bg-background/50 rounded-full mt-2 overflow-hidden">
                      <div
                        className={`h-full ${colorPalette[index % colorPalette.length].text.replace('text-', 'bg-')}`}
                        style={{ width: `${(count / Math.max(...Object.values(realtimeStats.stationCounts))) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ranking Integration Banner */}
      <Card className="glass-card border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Ranking TOP50 Integrado</p>
                <p className="text-sm text-muted-foreground">
                  Músicas capturadas são automaticamente adicionadas ao ranking em tempo real
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-2xl font-bold text-primary">{localStats.rankingTotal}</p>
                <p className="text-xs text-muted-foreground">músicas no ranking</p>
              </div>
              <Badge variant="outline" className="border-green-500/50 text-green-500">
                <Zap className="w-3 h-3 mr-1" />
                Sincronizado
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Radio Stations Windows */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            Captura Local (Simulação)
            {(selectedSource || selectedStation) && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {filteredSongs.length} de {displaySongs.length}
              </Badge>
            )}
          </h3>
          
          {/* Filters */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            
            <div className="flex flex-wrap gap-1">
              {uniqueStations.slice(0, 4).map(station => (
                <Button
                  key={station}
                  variant={selectedStation === station ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => setSelectedStation(selectedStation === station ? null : station)}
                >
                  {station}
                </Button>
              ))}
            </div>
            
            {(selectedSource || selectedStation) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 text-muted-foreground"
                onClick={() => {
                  setSelectedSource(null);
                  setSelectedStation(null);
                }}
              >
                <X className="w-3 h-3 mr-1" />
                Limpar
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(songsByStation).slice(0, 3).map(([stationName, songs]) => {
            const colors = getStationColor(stationName);
            const foundCount = songs.filter(s => s.status === 'found').length;
            const missingCount = songs.filter(s => s.status === 'missing').length;
            
            return (
              <Card key={stationName} className={`glass-card ${colors.border}`}>
                <CardHeader className={`py-3 px-4 border-b border-border ${colors.bg}`}>
                  <CardTitle className="flex items-center justify-between text-base">
                    <div className="flex items-center gap-2">
                      <Radio className={`w-4 h-4 ${colors.text}`} />
                      <span className={colors.text}>{stationName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-success/40 text-success bg-success/10 text-xs">
                        ✓ {foundCount}
                      </Badge>
                      {missingCount > 0 && (
                        <Badge variant="outline" className="border-destructive/40 text-destructive bg-destructive/10 text-xs">
                          ✗ {missingCount}
                        </Badge>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[150px]">
                    <div className="divide-y divide-border">
                      {songs.slice(0, 4).map((song, index) => (
                        <div key={song.id} className="p-3 hover:bg-secondary/30 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <Music className={`w-4 h-4 ${colors.text}`} />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-foreground text-sm truncate">{song.title}</p>
                                <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className={`ml-2 text-xs ${
                                song.status === 'found'
                                  ? 'border-success/40 text-success bg-success/10'
                                  : 'border-destructive/40 text-destructive bg-destructive/10'
                              }`}
                            >
                              {song.status === 'found' ? '✓' : '✗'}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Status Panel and Grade History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Panel */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="w-5 h-5 text-primary" />
              Status do Sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge className={isRunning ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}>
                  {isRunning ? 'Ativo' : 'Parado'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm text-muted-foreground">Intervalo</span>
                <span className="text-sm font-mono text-foreground">{config.updateIntervalMinutes} min</span>
              </div>

              <div className="p-3 rounded-lg bg-secondary/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <Timer className="w-4 h-4" />
                    Próxima Grade
                  </span>
                  <div className="text-right">
                    <span className={`text-sm font-mono ${nextGradeSeconds <= 60 ? 'text-amber-500 animate-pulse' : 'text-primary'}`}>
                      {nextGradeCountdown}
                    </span>
                    {isRunning && (
                      <p className="text-xs text-muted-foreground">
                        Bloco {nextBlockTime} (monta às {buildTime})
                      </p>
                    )}
                  </div>
                </div>
                {isRunning && (
                  <Progress 
                    value={Math.max(0, 100 - (nextGradeSeconds / 600) * 100)} 
                    className="h-1"
                  />
                )}
              </div>

              <div className="p-3 rounded-lg bg-secondary/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">🧹 Auto-Clean</span>
                  <span className={`text-sm font-mono ${autoCleanSeconds <= 60 ? 'text-amber-500 animate-pulse' : 'text-foreground'}`}>
                    {autoCleanCountdown}
                  </span>
                </div>
                {isRunning && (
                  <Progress 
                    value={Math.max(0, 100 - (autoCleanSeconds / 3600) * 100)} 
                    className="h-1"
                  />
                )}
              </div>
            </div>

            {/* Audio Visualizer */}
            <div className="pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-3">Atividade</p>
              <div className="flex items-end justify-center gap-1 h-12">
                {[...Array(16)].map((_, i) => (
                  <div
                    key={i}
                    className="w-2 bg-primary rounded-full animate-wave"
                    style={{
                      height: `${Math.random() * 100}%`,
                      animationDelay: `${i * 0.1}s`,
                      opacity: isRunning ? 1 : 0.3,
                    }}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Grade History */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <History className="w-5 h-5 text-primary" />
                Histórico de Grades
              </CardTitle>
              {gradeHistory.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearGradeHistory}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Limpar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[280px]">
              {displayGradeHistory.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Nenhuma grade gerada ainda</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {displayGradeHistory.slice(0, 10).map((entry, index) => (
                    <div
                      key={entry.id}
                      className="p-3 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <span className="text-sm font-bold text-primary">{entry.blockTime}</span>
                        </div>
                        <div>
                          <p className="font-medium text-foreground text-sm">{entry.programName}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(entry.timestamp), "HH:mm:ss", { locale: ptBR })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs border-success/40 text-success bg-success/10">
                          ✓ {entry.songsFound}
                        </Badge>
                        {entry.songsMissing > 0 && (
                          <Badge variant="outline" className="font-mono text-xs border-destructive/40 text-destructive bg-destructive/10">
                            ✗ {entry.songsMissing}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-1">
                          / {entry.songsProcessed}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
