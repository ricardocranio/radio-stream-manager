import { useState } from 'react';
import { Radio, Music, TrendingUp, Timer, History, Trash2, Bell, BellOff, Database, Clock, Zap, RefreshCw, Loader2 } from 'lucide-react';
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
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { GradePreviewCard } from '@/components/dashboard/GradePreviewCard';
import { MonitoringScheduleCard } from '@/components/dashboard/MonitoringScheduleCard';

export function DashboardView() {
  const { stations, isRunning, config, gradeHistory, clearGradeHistory, rankingSongs } = useRadioStore();
  const { nextGradeCountdown, autoCleanCountdown, nextGradeSeconds, autoCleanSeconds, nextBlockTime, buildTime } = useCountdown();
  const { stats: realtimeStats, refresh: refreshStats } = useRealtimeStats();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Realtime notifications hook
  const { requestPermission } = useRealtimeNotifications({
    enableBrowserNotifications: notificationsEnabled,
    enableToastNotifications: notificationsEnabled,
  });

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

  // Dynamic color palette for stations
  const colorPalette = [
    { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400' },
    { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400' },
    { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400' },
    { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400' },
    { bg: 'bg-pink-500/10', border: 'border-pink-500/30', text: 'text-pink-400' },
    { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400' },
  ];

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

      {/* Preview da Próxima Grade & Horários de Monitoramento */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GradePreviewCard recentSongsByStation={realtimeStats.recentSongsByStation} />
        <MonitoringScheduleCard />
      </div>

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

      {/* Radio Stations Windows - Using local store stations (for grade building) */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            Captura em Tempo Real
            <Badge variant="secondary" className="ml-2 text-xs">
              <Radio className="w-3 h-3 mr-1" />
              {stations.filter(s => s.enabled).length} emissoras
            </Badge>
          </h3>
          <div className="flex items-center gap-4">
            {/* Auto-refresh countdown */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border border-border">
              <div className="relative w-5 h-5">
                <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                  <circle
                    cx="10"
                    cy="10"
                    r="8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-muted-foreground/20"
                  />
                  <circle
                    cx="10"
                    cy="10"
                    r="8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={2 * Math.PI * 8}
                    strokeDashoffset={2 * Math.PI * 8 * (1 - realtimeStats.nextRefreshIn / 30)}
                    className="text-primary transition-all duration-1000"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-primary">
                  {realtimeStats.nextRefreshIn}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">próx. atualização</span>
            </div>
            
            {realtimeStats.lastUpdated && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {format(realtimeStats.lastUpdated, 'HH:mm:ss', { locale: ptBR })}
              </span>
            )}
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
        </div>
        
        {stations.filter(s => s.enabled).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stations.filter(s => s.enabled).map((station, stationIndex) => {
              const colors = colorPalette[stationIndex % colorPalette.length];
              const songs = realtimeStats.recentSongsByStation[station.name] || [];
              const count24h = realtimeStats.stationCounts[station.name] || 0;
              
              return (
                <Card key={station.id} className={`glass-card ${colors.border}`}>
                  <CardHeader className={`py-3 px-4 border-b border-border ${colors.bg}`}>
                    <CardTitle className="flex items-center justify-between text-base">
                      <div className="flex items-center gap-2">
                        <Radio className={`w-4 h-4 ${colors.text}`} />
                        <span className={colors.text}>{station.name}</span>
                      </div>
                      <Badge variant="outline" className={`${colors.border} ${colors.text} text-xs`}>
                        {count24h} (24h)
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[150px]">
                      {songs.length > 0 ? (
                        <div className="divide-y divide-border">
                          {songs.map((song, index) => (
                            <div key={`${song.timestamp}-${index}`} className="p-3 hover:bg-secondary/30 transition-colors">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <Music className={`w-4 h-4 ${colors.text}`} />
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-foreground text-sm truncate">{song.title}</p>
                                    <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                                  </div>
                                </div>
                                <span className="text-xs text-muted-foreground ml-2 shrink-0">
                                  {formatDistanceToNow(new Date(song.timestamp), { addSuffix: true, locale: ptBR })}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground p-4">
                          <div className="text-center">
                            <Music className="w-6 h-6 mx-auto mb-2 opacity-30" />
                            <p className="text-xs">Aguardando capturas...</p>
                          </div>
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="glass-card border-dashed">
            <CardContent className="p-8 text-center text-muted-foreground">
              <Radio className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Nenhuma emissora ativa</p>
              <p className="text-sm mt-2">Ative emissoras na seção "Emissoras" para começar o monitoramento.</p>
            </CardContent>
          </Card>
        )}
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
