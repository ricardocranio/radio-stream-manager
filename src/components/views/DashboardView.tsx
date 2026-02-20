import { useState } from 'react';
import { Radio, Music, TrendingUp, Timer, History, Trash2, Database, Clock, Zap, RefreshCw, Loader2, AlertTriangle, FileText, Play, FolderOpen, CheckCircle2, Calendar, SkipForward, Replace, Settings2, Minus, Plus, HardDrive, RotateCcw, Shield } from 'lucide-react';
import { useRadioStore, GradeHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useSimilarityLogStore } from '@/store/similarityLogStore';
import { useCountdown } from '@/hooks/useCountdown';
import { useRealtimeStats } from '@/hooks/useRealtimeStats';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';
import { useMusicLibraryStats, invalidateMusicLibraryCache } from '@/hooks/useMusicLibraryStats';
import { useGlobalServices } from '@/contexts/GlobalServicesContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { GradePreviewCard } from '@/components/dashboard/GradePreviewCard';
import { GradeScheduleCard } from '@/components/dashboard/GradeScheduleCard';

export function DashboardView() {
  const { 
    stations, isRunning, config, gradeHistory, clearGradeHistory, rankingSongs, missingSongs,
    clearCapturedSongs, clearMissingSongs, clearDownloadHistory, clearRanking,
    setBatchDownloadProgress
  } = useRadioStore();
  const { resetQueue } = useAutoDownloadStore();
  const resetSimilarityStats = useSimilarityLogStore((state) => state.resetStats);
  const { toast } = useToast();
  
  const { nextGradeCountdown, autoCleanCountdown, nextGradeSeconds, autoCleanSeconds, nextBlockTime, buildTime } = useCountdown();
  const { stats: realtimeStats, refresh: refreshStats } = useRealtimeStats();
  const { stats: libraryStats, refreshStats: refreshLibraryStats } = useMusicLibraryStats();
  // All services from global context - runs from boot, independent of navigation
  const { gradeBuilder, downloads, scraping } = useGlobalServices();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  
  // Reset options
  const [resetOptions, setResetOptions] = useState({
    clearSupabase: true,
    clearSchedules: false,
    resetStations: false,
  });
  
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

  // FULL SYSTEM RESET - Local + Supabase
  const handleFullSystemReset = async () => {
    console.log('[RESET] Starting full system reset...');
    setIsResetting(true);
    
    try {
      // 1. Clear all local data in Zustand stores
      console.log('[RESET] Clearing local data...');
      clearCapturedSongs();
      clearMissingSongs();
      clearDownloadHistory();
      clearGradeHistory();
      clearRanking();
      resetQueue();
      resetSimilarityStats();
      setBatchDownloadProgress({
        isRunning: false,
        total: 0,
        completed: 0,
        failed: 0,
        current: '',
      });
      console.log('[RESET] Local data cleared');

      // 2. Clear Supabase data via Edge Function
      if (resetOptions.clearSupabase) {
        console.log('[RESET] Clearing Supabase data...', resetOptions);
        try {
          const { data, error } = await supabase.functions.invoke('manage-special-monitoring', {
            body: {
              action: 'full-system-reset',
              data: {
                clearSchedules: resetOptions.clearSchedules,
                resetStations: resetOptions.resetStations,
              },
            },
          });

          if (error) {
            console.error('[RESET] Supabase Edge Function error:', error);
            toast({
              title: '⚠️ Reset parcial',
              description: `Dados locais limpos. Erro no banco remoto: ${error.message || 'Erro desconhecido'}`,
              variant: 'destructive',
            });
          } else {
            console.log('[RESET] Supabase cleared successfully:', data);
          }
        } catch (supaError) {
          console.error('[RESET] Supabase call exception:', supaError);
          // Don't block the rest of the reset if Supabase fails
        }
      }

      // 3. Clear localStorage keys related to the system
      console.log('[RESET] Clearing localStorage...');
      const keysToPreserve = ['vozBrasilConfig', 'theme', 'supabase.auth.token']; 
      const allKeys = Object.keys(localStorage);
      let clearedKeys = 0;
      
      allKeys.forEach(key => {
        // Preserve Supabase auth and user preferences
        if (key.startsWith('supabase') || keysToPreserve.some(k => key.includes(k))) {
          return;
        }
        // Clear app-specific keys - INCLUDING the main Zustand store
        if (key.includes('radio') || key.includes('grade') || key.includes('similarity') || 
            key.includes('stats') || key.includes('ranking') || key.includes('download') ||
            key.includes('missing') || key.includes('captured') || key.includes('pgm-') ||
            key === 'pgm-radio-storage' || key === 'auto-download-storage' || 
            key === 'realtime-stats-storage' || key === 'similarity-log-storage') {
          localStorage.removeItem(key);
          clearedKeys++;
        }
      });
      console.log(`[RESET] Cleared ${clearedKeys} localStorage keys`);

      // 4. Clear the realtime stats store
      try {
        const { useRealtimeStatsStore } = await import('@/store/realtimeStatsStore');
        useRealtimeStatsStore.getState().reset();
        console.log('[RESET] Realtime stats store cleared');
      } catch (e) {
        console.log('[RESET] Could not clear realtime stats store:', e);
      }

      // 5. Invalidate music library cache - forces fresh read from filesystem
      console.log('[RESET] Invalidating music library cache...');
      invalidateMusicLibraryCache();
      
      // 6. Force refresh of music library stats
      console.log('[RESET] Refreshing music library stats...');
      await refreshLibraryStats();

      toast({
        title: '✅ Sistema Resetado',
        description: 'Todos os dados foram limpos. O sistema está pronto para uma nova instalação.',
      });

      // Refresh stats to reflect changes
      console.log('[RESET] Refreshing stats...');
      await refreshStats();
      
      console.log('[RESET] Full system reset completed successfully!');

    } catch (error) {
      console.error('[RESET] Error:', error);
      toast({
        title: '❌ Erro no Reset',
        description: error instanceof Error ? error.message : 'Erro desconhecido ao resetar o sistema.',
        variant: 'destructive',
      });
    } finally {
      setIsResetting(false);
    }
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
    .reduce<Record<string, number>>((acc, [station, count]) => {
      // Normalize station name to prevent duplicates
      const normalizedName = station.trim();
      if (!acc[normalizedName]) {
        acc[normalizedName] = 0;
      }
      acc[normalizedName] += typeof count === 'number' ? count : 0;
      return acc;
    }, {});

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
      {/* Realtime Stats from Supabase */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
        {/* Row 1: 4 main stats */}
        <Card className="glass-card border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Capturadas</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {realtimeStats.isLoading ? '...' : realtimeStats.totalSongs.toLocaleString()}
                </p>
                <p className="text-xs text-primary flex items-center gap-1 mt-1">
                  <Database className="w-3 h-3" />
                  Banco de dados
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
                <p className="text-2xl font-bold text-foreground mt-1">
                  {realtimeStats.isLoading ? '...' : realtimeStats.songsLast24h.toLocaleString()}
                </p>
                <p className="text-xs text-green-500 flex items-center gap-1 mt-1">
                  <Clock className="w-3 h-3" />
                  Tempo real
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-cyan-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Emissoras Ativas</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {realtimeStats.isLoading ? '...' : realtimeStats.activeStations}
                </p>
                <p className="text-xs text-cyan-500 flex items-center gap-1 mt-1">
                  <Radio className="w-3 h-3" />
                  Monitorando
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                <Radio className="w-5 h-5 text-cyan-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-red-500/20 bg-gradient-to-br from-red-500/10 to-red-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Faltando</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {missingSongs.filter(s => s.status === 'missing').length}
                </p>
                <p className="text-xs text-red-500 flex items-center gap-1 mt-1">
                  <AlertTriangle className="w-3 h-3" />
                  No Banco Musical
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Secondary stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="glass-card border-orange-500/20">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Última Hora</p>
              <p className="text-lg font-bold text-foreground">
                {realtimeStats.isLoading ? '...' : realtimeStats.songsLastHour.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-amber-500/20">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
              <HardDrive className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Banco Musical</p>
              <p className="text-lg font-bold text-foreground">
                {libraryStats.isLoading ? '...' : libraryStats.count.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-purple-500/20">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4 text-purple-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ranking TOP25</p>
              <p className="text-lg font-bold text-foreground">{localStats.rankingTotal}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Station Distribution removed for cleaner UI */}

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
                    onClick={() => gradeBuilder.buildGrade(true)}
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
        <GradePreviewCard />
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
                <p className="font-medium text-foreground">Ranking TOP25 Integrado</p>
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
                    <ScrollArea className="h-[280px]">
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

      {/* System Reset Card */}
      <Card className="glass-card border-destructive/30 bg-gradient-to-r from-destructive/5 to-transparent">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">Zerar Sistema Completo</p>
                <p className="text-sm text-muted-foreground">
                  Limpa todos os dados locais e do banco de dados para novas instalações
                </p>
              </div>
            </div>
            
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  variant="destructive" 
                  size="sm" 
                  className="gap-2 shrink-0"
                  disabled={isResetting}
                >
                  {isResetting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Zerar Tudo
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                    <Shield className="w-5 h-5" />
                    Reset Completo do Sistema
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-3">
                    <p>Esta ação irá limpar <strong>TODOS</strong> os dados do sistema:</p>
                    
                    <div className="space-y-2 p-3 rounded-lg bg-muted/50 text-sm">
                      <p>✓ Músicas capturadas (local)</p>
                      <p>✓ Ranking TOP25</p>
                      <p>✓ Músicas faltando</p>
                      <p>✓ Histórico de downloads</p>
                      <p>✓ Histórico de grades</p>
                      <p>✓ Estatísticas de similaridade</p>
                    </div>

                    <div className="space-y-3 pt-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="clearSupabase" 
                          checked={resetOptions.clearSupabase}
                          onCheckedChange={(checked) => 
                            setResetOptions(prev => ({ ...prev, clearSupabase: checked === true }))
                          }
                        />
                        <Label htmlFor="clearSupabase" className="text-sm font-medium cursor-pointer">
                          Limpar banco de dados remoto (Supabase)
                        </Label>
                      </div>
                      
                      {resetOptions.clearSupabase && (
                        <>
                          <div className="flex items-center space-x-2 ml-6">
                            <Checkbox 
                              id="clearSchedules" 
                              checked={resetOptions.clearSchedules}
                              onCheckedChange={(checked) => 
                                setResetOptions(prev => ({ ...prev, clearSchedules: checked === true }))
                              }
                            />
                            <Label htmlFor="clearSchedules" className="text-sm cursor-pointer">
                              Limpar monitoramentos especiais
                            </Label>
                          </div>
                          
                          <div className="flex items-center space-x-2 ml-6">
                            <Checkbox 
                              id="resetStations" 
                              checked={resetOptions.resetStations}
                              onCheckedChange={(checked) => 
                                setResetOptions(prev => ({ ...prev, resetStations: checked === true }))
                              }
                            />
                            <Label htmlFor="resetStations" className="text-sm cursor-pointer">
                              Desativar todas as emissoras
                            </Label>
                          </div>
                        </>
                      )}
                    </div>

                    <p className="text-destructive text-xs font-medium pt-2">
                      ⚠️ Esta ação é irreversível!
                    </p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={handleFullSystemReset}
                    className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  >
                    Confirmar Reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
