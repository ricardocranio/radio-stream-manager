import { useState } from 'react';
import { Radio, Music, TrendingUp, Timer, History, Trash2, Database, Clock, Zap, RefreshCw, Loader2, AlertTriangle, FileText, Play, FolderOpen, CheckCircle2, Calendar, SkipForward, Replace, Settings2, Minus, Plus, HardDrive, RotateCcw } from 'lucide-react';
import { useRadioStore, GradeHistoryEntry } from '@/store/radioStore';
import { useCountdown } from '@/hooks/useCountdown';
import { useRealtimeStats } from '@/hooks/useRealtimeStats';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';
import { useMusicLibraryStats } from '@/hooks/useMusicLibraryStats';
import { useGlobalServices } from '@/contexts/GlobalServicesContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { GradePreviewCard } from '@/components/dashboard/GradePreviewCard';
import { GradeScheduleCard } from '@/components/dashboard/GradeScheduleCard';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

export function DashboardView() {
  const { stations, isRunning, config, gradeHistory, clearGradeHistory, rankingSongs, missingSongs, resetAllCounts } = useRadioStore();
  const { nextGradeCountdown, autoCleanCountdown, nextGradeSeconds, autoCleanSeconds, nextBlockTime, buildTime } = useCountdown();
  const { stats: realtimeStats, refresh: refreshStats } = useRealtimeStats();
  const { stats: libraryStats } = useMusicLibraryStats();
  // All services from global context - runs from boot, independent of navigation
  const { gradeBuilder, downloads, scraping } = useGlobalServices();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Realtime notifications hook
  const { requestPermission } = useRealtimeNotifications({
    enableBrowserNotifications: notificationsEnabled,
    enableToastNotifications: notificationsEnabled,
  });

  // Handle open grade folder
  const handleOpenGradeFolder = async () => {
    if (window.electronAPI?.openFolder) {
      await window.electronAPI.openFolder(config.gradeFolder);
    }
  };

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

  // Handle reset all counts
  const handleResetAll = () => {
    resetAllCounts();
    toast.success('Todas as contagens foram zeradas!');
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

  // Get unique stations from stationCounts (deduplicated)
  const uniqueStationCounts = Object.entries(realtimeStats.stationCounts)
    .reduce((acc, [station, count]) => {
      // Normalize station name to prevent duplicates
      const normalizedName = station.trim();
      if (!acc[normalizedName]) {
        acc[normalizedName] = 0;
      }
      acc[normalizedName] += count;
      return acc;
    }, {} as Record<string, number>);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
      {/* Realtime Stats from Supabase */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <Card className="glass-card border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground truncate">Total Capturadas</p>
                <p className="text-lg md:text-2xl font-bold text-foreground">
                  {realtimeStats.isLoading ? '...' : realtimeStats.totalSongs.toLocaleString()}
                </p>
                <p className="text-[10px] md:text-xs text-primary flex items-center gap-1">
                  <Database className="w-3 h-3" />
                  <span className="hidden sm:inline">Supabase</span>
                </p>
              </div>
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                <Music className="w-4 h-4 md:w-5 md:h-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-green-500/20 bg-gradient-to-br from-green-500/10 to-green-500/5">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground truncate">Últimas 24h</p>
                <p className="text-lg md:text-2xl font-bold text-foreground">
                  {realtimeStats.isLoading ? '...' : realtimeStats.songsLast24h.toLocaleString()}
                </p>
                <p className="text-[10px] md:text-xs text-green-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span className="hidden sm:inline">Tempo real</span>
                </p>
              </div>
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-orange-500/20 bg-gradient-to-br from-orange-500/10 to-orange-500/5">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground truncate">Última Hora</p>
                <p className="text-lg md:text-2xl font-bold text-foreground">
                  {realtimeStats.isLoading ? '...' : realtimeStats.songsLastHour.toLocaleString()}
                </p>
                <p className="text-[10px] md:text-xs text-orange-500 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  <span className="hidden sm:inline">Ativo</span>
                </p>
              </div>
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-orange-500/20 flex items-center justify-center shrink-0">
                <Radio className="w-4 h-4 md:w-5 md:h-5 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-purple-500/20 bg-gradient-to-br from-purple-500/10 to-purple-500/5">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground truncate">No Ranking</p>
                <p className="text-lg md:text-2xl font-bold text-foreground">{localStats.rankingTotal}</p>
                <p className="text-[10px] md:text-xs text-purple-500 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  TOP50
                </p>
              </div>
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-cyan-500/5">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground truncate">Emissoras</p>
                <p className="text-lg md:text-2xl font-bold text-foreground">
                  {realtimeStats.isLoading ? '...' : realtimeStats.activeStations}
                </p>
                <p className="text-[10px] md:text-xs text-cyan-500 flex items-center gap-1">
                  <Radio className="w-3 h-3" />
                  <span className="hidden sm:inline">Monitorando</span>
                </p>
              </div>
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center shrink-0">
                <Radio className="w-4 h-4 md:w-5 md:h-5 text-cyan-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`glass-card border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-amber-500/5 ${libraryStats.unavailable ? 'opacity-60' : ''}`}>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground truncate">Banco Musical</p>
                {libraryStats.unavailable ? (
                  <p className="text-xs md:text-sm font-medium text-amber-500">Desktop Only</p>
                ) : (
                  <p className="text-lg md:text-2xl font-bold text-foreground">
                    {libraryStats.isLoading ? '...' : libraryStats.count.toLocaleString()}
                  </p>
                )}
                <p className="text-[10px] md:text-xs text-amber-500 flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />
                  <span className="hidden sm:inline">{libraryStats.unavailable ? 'Indisponível' : 'Local'}</span>
                </p>
              </div>
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                <HardDrive className="w-4 h-4 md:w-5 md:h-5 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-red-500/20 bg-gradient-to-br from-red-500/10 to-red-500/5">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] md:text-xs text-muted-foreground truncate">Faltando</p>
                <p className="text-lg md:text-2xl font-bold text-foreground">{missingSongs.length}</p>
                <p className="text-[10px] md:text-xs text-red-500 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span className="hidden sm:inline">No Banco</span>
                </p>
              </div>
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 md:w-5 md:h-5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Reset All Counts Button */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Card className="glass-card border-destructive/20 bg-gradient-to-br from-destructive/10 to-destructive/5 cursor-pointer hover:border-destructive/40 transition-colors">
              <CardContent className="p-3 md:p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] md:text-xs text-muted-foreground truncate">Zerar Tudo</p>
                    <p className="text-sm md:text-base font-medium text-destructive">Reset Total</p>
                    <p className="text-[10px] md:text-xs text-destructive/70 flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" />
                      <span className="hidden sm:inline">Limpar</span>
                    </p>
                  </div>
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-destructive/20 flex items-center justify-center shrink-0">
                    <RotateCcw className="w-4 h-4 md:w-5 md:h-5 text-destructive" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                Zerar Todas as Contagens?
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>Esta ação irá zerar completamente:</p>
                <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                  <li>Músicas capturadas locais</li>
                  <li>Lista de músicas faltando</li>
                  <li>Histórico de downloads</li>
                  <li>Histórico de grade</li>
                  <li>Ranking TOP50</li>
                  <li>Blocos montados</li>
                </ul>
                <p className="text-destructive font-medium mt-3">Esta ação não pode ser desfeita!</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleResetAll}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Zerar Tudo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Station Distribution - Filled grid without gaps */}
      {Object.keys(uniqueStationCounts).length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-2 md:pb-3">
            <CardTitle className="text-sm md:text-base flex items-center gap-2">
              <Radio className="w-4 h-4 text-primary" />
              Distribuição por Emissora (24h)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {(() => {
              const stationEntries = Object.entries(uniqueStationCounts).sort((a, b) => b[1] - a[1]);
              const maxCount = Math.max(...Object.values(uniqueStationCounts));
              
              return (
                <div className="flex flex-wrap gap-2">
                  {stationEntries.map(([station, count], index) => (
                    <div
                      key={station}
                      className={`flex-1 min-w-[100px] max-w-[180px] p-2 md:p-3 rounded-lg ${colorPalette[index % colorPalette.length].bg} ${colorPalette[index % colorPalette.length].border} border`}
                    >
                      <p className={`text-[10px] md:text-xs ${colorPalette[index % colorPalette.length].text} truncate font-medium`} title={station}>
                        {station}
                      </p>
                      <p className="text-lg md:text-xl font-bold text-foreground">{count}</p>
                      <div className="h-1 bg-background/50 rounded-full mt-1 overflow-hidden">
                        <div
                          className={`h-full transition-all ${colorPalette[index % colorPalette.length].text.replace('text-', 'bg-')}`}
                          style={{ width: `${(count / maxCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Auto Grade Builder Status */}
      {gradeBuilder.isElectron && (
        <Card className="glass-card border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 to-transparent">
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${gradeBuilder.isBuilding ? 'bg-amber-500/20' : gradeBuilder.isAutoEnabled ? 'bg-emerald-500/20' : 'bg-muted'}`}>
                  {gradeBuilder.isBuilding ? (
                    <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                  ) : (
                    <FileText className={`w-5 h-5 ${gradeBuilder.isAutoEnabled ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground">Geração Automática de Grade</span>
                    <Switch 
                      checked={gradeBuilder.isAutoEnabled}
                      onCheckedChange={gradeBuilder.toggleAutoGeneration}
                    />
                    {gradeBuilder.isAutoEnabled && (
                      <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Automático
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-2">
                    <p className="text-sm text-muted-foreground">
                      Bloco Atual: <span className="font-mono text-emerald-400">{gradeBuilder.currentBlock}</span>
                      {' → '}
                      Próximo: <span className="font-mono text-amber-400">{gradeBuilder.nextBlock}</span>
                    </p>
                    {gradeBuilder.isAutoEnabled && gradeBuilder.nextBuildIn > 0 && (
                      <Badge variant="outline" className="text-xs w-fit">
                        <Clock className="w-3 h-3 mr-1" />
                        Próxima em <span className="font-mono ml-1">{Math.floor(gradeBuilder.nextBuildIn / 60)}:{(gradeBuilder.nextBuildIn % 60).toString().padStart(2, '0')}</span>
                      </Badge>
                    )}
                  </div>
                </div>
                {/* Minutes Before Block Config */}
                <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border">
                  <Settings2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Atualizar</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => gradeBuilder.setMinutesBeforeBlock(gradeBuilder.minutesBeforeBlock - 1)}
                      disabled={gradeBuilder.minutesBeforeBlock <= 1}
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    <span className="font-mono text-sm w-5 text-center text-primary font-bold">{gradeBuilder.minutesBeforeBlock}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => gradeBuilder.setMinutesBeforeBlock(gradeBuilder.minutesBeforeBlock + 1)}
                      disabled={gradeBuilder.minutesBeforeBlock >= 10}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">min antes</span>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="text-left sm:text-right">
                  {gradeBuilder.lastBuildTime && (
                    <p className="text-xs text-muted-foreground">
                      Última: {format(gradeBuilder.lastBuildTime, 'HH:mm:ss', { locale: ptBR })}
                    </p>
                  )}
                  {gradeBuilder.lastSavedFile && (
                    <p className="text-sm font-medium text-foreground">
                      {gradeBuilder.lastSavedFile}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {gradeBuilder.blocksGenerated} blocos gerados
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={gradeBuilder.buildGrade}
                    disabled={gradeBuilder.isBuilding}
                    className="gap-2"
                  >
                    {gradeBuilder.isBuilding && gradeBuilder.fullDayTotal === 0 ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    Atual/Próximo
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={gradeBuilder.buildFullDayGrade}
                    disabled={gradeBuilder.isBuilding}
                    className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                  >
                    {gradeBuilder.isBuilding && gradeBuilder.fullDayTotal > 0 ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Calendar className="w-4 h-4" />
                    )}
                    Grade Completa
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenGradeFolder}
                    className="gap-2"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Progress bar for full day generation */}
            {gradeBuilder.isBuilding && gradeBuilder.fullDayTotal > 0 && (
              <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-border">
                {/* Progress header */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                    <span className="text-foreground font-medium">
                      Bloco {gradeBuilder.currentProcessingBlock || '...'}
                    </span>
                  </div>
                  <span className="font-mono text-primary font-bold">
                    {gradeBuilder.fullDayProgress}/{gradeBuilder.fullDayTotal} blocos
                  </span>
                </div>
                
                {/* Progress bar */}
                <Progress 
                  value={(gradeBuilder.fullDayProgress / gradeBuilder.fullDayTotal) * 100} 
                  className="h-3"
                />

                {/* Current song being processed */}
                {gradeBuilder.currentProcessingSong && (
                  <div className="flex items-center gap-2 text-xs">
                    <Music className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span className="text-muted-foreground truncate">
                      Processando: <span className="text-foreground">{gradeBuilder.currentProcessingSong}</span>
                    </span>
                  </div>
                )}

                {/* Progressive save indicator */}
                {gradeBuilder.lastSaveProgress > 0 && gradeBuilder.lastSaveProgress < 48 && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Salvamento progressivo: {gradeBuilder.lastSaveProgress} blocos salvos</span>
                  </div>
                )}
              </div>
            )}

            {/* Stats row */}
            {(gradeBuilder.skippedSongs > 0 || gradeBuilder.substitutedSongs > 0 || gradeBuilder.missingSongs > 0) && (
              <div className="flex items-center gap-4 text-xs flex-wrap">
                {gradeBuilder.skippedSongs > 0 && (
                  <div className="flex items-center gap-1 text-amber-500">
                    <SkipForward className="w-3 h-3" />
                    <span>{gradeBuilder.skippedSongs} puladas</span>
                  </div>
                )}
                {gradeBuilder.substitutedSongs > 0 && (
                  <div className="flex items-center gap-1 text-blue-500">
                    <Replace className="w-3 h-3" />
                    <span>{gradeBuilder.substitutedSongs} substituídas</span>
                  </div>
                )}
                {gradeBuilder.missingSongs > 0 && (
                  <div className="flex items-center gap-1 text-destructive">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{gradeBuilder.missingSongs} faltando</span>
                  </div>
                )}
              </div>
            )}

            {gradeBuilder.error && (
              <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                ⚠️ {gradeBuilder.error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Preview da Próxima Grade & Grades Montadas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <GradePreviewCard recentSongsByStation={realtimeStats.recentSongsByStation} />
        <GradeScheduleCard />
      </div>

      {/* Ranking Integration Banner */}
      <Card className="glass-card border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">Ranking TOP50 Integrado</p>
                <p className="text-sm text-muted-foreground truncate">
                  Músicas capturadas são automaticamente adicionadas ao ranking
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-2xl font-bold text-primary">{localStats.rankingTotal}</p>
                <p className="text-xs text-muted-foreground">músicas no ranking</p>
              </div>
              <Badge variant="outline" className="border-green-500/50 text-green-500 shrink-0">
                <Zap className="w-3 h-3 mr-1" />
                Sincronizado
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Radio Stations Windows */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="text-sm md:text-base flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
              Captura em Tempo Real
              <Badge variant="secondary" className="text-[10px]">
                {stations.filter(s => s.enabled).length} emissoras
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Auto-refresh countdown */}
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-secondary/50 border border-border">
                <div className="relative w-4 h-4">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 20 20">
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
                  <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-primary">
                    {realtimeStats.nextRefreshIn}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">próx. atualização</span>
              </div>
              
              {realtimeStats.lastUpdated && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                  <Clock className="w-3 h-3 shrink-0" />
                  {format(realtimeStats.lastUpdated, 'HH:mm:ss', { locale: ptBR })}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="gap-1 h-7 text-xs"
              >
                {isRefreshing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
        
        {stations.filter(s => s.enabled).length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {stations.filter(s => s.enabled).map((station, stationIndex) => {
              const colors = colorPalette[stationIndex % colorPalette.length];
              const songs = realtimeStats.recentSongsByStation[station.name] || [];
              const count24h = realtimeStats.stationCounts[station.name] || 0;
              
              return (
                <Card key={station.id} className={`glass-card ${colors.border} flex flex-col`}>
                  <CardHeader className={`py-2 px-3 border-b border-border ${colors.bg} shrink-0`}>
                    <CardTitle className="flex items-center justify-between text-sm gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Radio className={`w-4 h-4 ${colors.text} shrink-0`} />
                        <span className={`${colors.text} truncate font-medium`}>{station.name}</span>
                      </div>
                      <Badge variant="outline" className={`${colors.border} ${colors.text} text-[10px] shrink-0 whitespace-nowrap`}>
                        {count24h} (24h)
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 flex-1">
                    <ScrollArea className="h-[140px]">
                      {songs.length > 0 ? (
                        <div className="divide-y divide-border">
                          {songs.map((song, index) => (
                            <div key={`${song.timestamp}-${index}`} className="p-2 hover:bg-secondary/30 transition-colors">
                              <div className="flex items-start gap-2">
                                <Music className={`w-3.5 h-3.5 ${colors.text} shrink-0 mt-0.5`} />
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-foreground text-xs leading-tight truncate">{song.title}</p>
                                  <p className="text-[10px] text-muted-foreground truncate">{song.artist}</p>
                                  <p className="text-[9px] text-muted-foreground/70 mt-0.5 whitespace-nowrap">
                                    há {formatDistanceToNow(new Date(song.timestamp), { locale: ptBR })}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground p-4">
                          <div className="text-center">
                            <Music className="w-6 h-6 mx-auto mb-2 opacity-30" />
                            <p className="text-[10px]">Aguardando capturas...</p>
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
            <CardContent className="p-6 md:p-8 text-center text-muted-foreground">
              <Radio className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-4 opacity-50" />
              <p className="text-base md:text-lg font-medium">Nenhuma emissora ativa</p>
              <p className="text-xs md:text-sm mt-2">Ative emissoras na seção "Emissoras" para começar o monitoramento.</p>
            </CardContent>
          </Card>
        )}
        </CardContent>
      </Card>

      {/* Status Panel and Grade History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Status Panel */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border py-3">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-primary" />
              Status do Sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4 space-y-3 md:space-y-4">
            <div className="space-y-2 md:space-y-3">
              <div className="flex items-center justify-between p-2 md:p-3 rounded-lg bg-secondary/50">
                <span className="text-xs md:text-sm text-muted-foreground">Status</span>
                <Badge className={isRunning ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}>
                  {isRunning ? 'Ativo' : 'Parado'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between p-2 md:p-3 rounded-lg bg-secondary/50">
                <span className="text-xs md:text-sm text-muted-foreground">Intervalo</span>
                <span className="text-xs md:text-sm font-mono text-foreground">{config.updateIntervalMinutes} min</span>
              </div>

              <div className="p-2 md:p-3 rounded-lg bg-secondary/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
                    <Timer className="w-3 h-3 md:w-4 md:h-4" />
                    Próxima Grade
                  </span>
                  <div className="text-right">
                    <span className={`text-xs md:text-sm font-mono ${nextGradeSeconds <= 60 ? 'text-amber-500 animate-pulse' : 'text-primary'}`}>
                      {nextGradeCountdown}
                    </span>
                    {isRunning && (
                      <p className="text-[10px] md:text-xs text-muted-foreground">
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

              <div className="p-2 md:p-3 rounded-lg bg-secondary/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs md:text-sm text-muted-foreground">🧹 Auto-Clean</span>
                  <span className={`text-xs md:text-sm font-mono ${autoCleanSeconds <= 60 ? 'text-amber-500 animate-pulse' : 'text-foreground'}`}>
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
            <div className="pt-3 md:pt-4 border-t border-border">
              <p className="text-[10px] md:text-xs text-muted-foreground mb-2 md:mb-3">Atividade</p>
              <div className="flex items-end justify-center gap-1 h-10 md:h-12">
                {[...Array(16)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1.5 md:w-2 bg-primary rounded-full animate-wave"
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
          <CardHeader className="border-b border-border py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <History className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                Histórico de Grades
              </CardTitle>
              {gradeHistory.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearGradeHistory}
                  className="text-muted-foreground hover:text-destructive h-7 md:h-8 text-xs"
                >
                  <Trash2 className="w-3 h-3 md:w-4 md:h-4 mr-1" />
                  Limpar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[240px] md:h-[280px]">
              {displayGradeHistory.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  <History className="w-6 h-6 md:w-8 md:h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nenhuma grade gerada ainda</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {displayGradeHistory.slice(0, 10).map((entry) => (
                    <div
                      key={entry.id}
                      className="p-2 md:p-3 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                    >
                      <div className="flex items-center gap-2 md:gap-3 min-w-0">
                        <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-xs md:text-sm font-bold text-primary">{entry.blockTime}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground text-xs md:text-sm truncate">{entry.programName}</p>
                          <p className="text-[10px] md:text-xs text-muted-foreground">
                            {format(new Date(entry.timestamp), "HH:mm:ss", { locale: ptBR })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 md:gap-2 shrink-0">
                        <Badge variant="outline" className="font-mono text-[10px] md:text-xs border-success/40 text-success bg-success/10">
                          ✓ {entry.songsFound}
                        </Badge>
                        {entry.songsMissing > 0 && (
                          <Badge variant="outline" className="font-mono text-[10px] md:text-xs border-destructive/40 text-destructive bg-destructive/10">
                            ✗ {entry.songsMissing}
                          </Badge>
                        )}
                        <span className="text-[10px] md:text-xs text-muted-foreground ml-1">
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
