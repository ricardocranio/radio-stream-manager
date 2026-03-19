import { useState, useMemo } from 'react';
  import { Radio, Music, TrendingUp, Timer, History, Trash2, Database, Clock, Zap, RefreshCw, Loader2, AlertTriangle, FileText, Play, FolderOpen, CheckCircle2, Calendar, SkipForward, Replace, Settings2, Minus, Plus, HardDrive, RotateCcw, Shield, Download, XCircle, ChevronDown, Eye, Tags, ArrowRightLeft } from 'lucide-react';
import { useRadioStore, GradeHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useSimilarityLogStore } from '@/store/similarityLogStore';
import { useCapturedDownloadStore } from '@/store/capturedDownloadStore';
import { useGradeLogStore } from '@/store/gradeLogStore';
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
import { SmartNotificationsCard } from '@/components/dashboard/SmartNotificationsCard';
import { ServiceHealthCard } from '@/components/dashboard/ServiceHealthCard';
import { Id3ActivityCard } from '@/components/dashboard/Id3ActivityCard';

export function DashboardView() {
  const { 
    stations, isRunning, config, gradeHistory, clearGradeHistory, rankingSongs, missingSongs,
    clearCapturedSongs, clearMissingSongs, clearDownloadHistory, clearRanking,
    setBatchDownloadProgress
  } = useRadioStore();
  const { resetQueue, vozBrasilDownloading, vozBrasilProgress } = useAutoDownloadStore();
  const capturedDownloads = useCapturedDownloadStore();
  const resetSimilarityStats = useSimilarityLogStore((state) => state.resetStats);
  const blockLogs = useGradeLogStore((state) => state.blockLogs);
  const { toast } = useToast();

  // Compute last grade quality stats from block logs
  const gradeQuality = useMemo(() => {
    if (blockLogs.length === 0) return { substituted: 0, coringas: 0, used: 0, total: 0 };
    // Find the most recent timestamp and get all logs from that batch (within 2 min window)
    const latestTime = new Date(blockLogs[0]?.timestamp || 0).getTime();
    const recentLogs = blockLogs.filter(l => {
      const t = new Date(l.timestamp).getTime();
      return latestTime - t < 120_000; // 2 min window = same build
    });
    const substituted = recentLogs.filter(l => l.type === 'substituted' && l.station !== 'FALLBACK').length;
    const coringas = recentLogs.filter(l => l.type === 'substituted' && l.station === 'FALLBACK').length;
    const used = recentLogs.filter(l => l.type === 'used').length;
    return { substituted, coringas, used, total: used + substituted + coringas };
  }, [blockLogs]);
  
  const { nextGradeCountdown, autoCleanCountdown, nextGradeSeconds, autoCleanSeconds, nextBlockTime, buildTime } = useCountdown();
  const { stats: realtimeStats, refresh: refreshStats } = useRealtimeStats();
  const { stats: libraryStats, refreshStats: refreshLibraryStats } = useMusicLibraryStats();
  // All services from global context - runs from boot, independent of navigation
  const { gradeBuilder, downloads, scraping } = useGlobalServices();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isCatalogingTop, setIsCatalogingTop] = useState(false);
  const [realtimeCollapsed, setRealtimeCollapsed] = useState(false);
  const [statusCollapsed, setStatusCollapsed] = useState(true);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [scheduleCollapsed, setScheduleCollapsed] = useState(false);

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

  // Quick catalog from top strip
  const handleQuickCatalog = async () => {
    if (!window.electronAPI?.scanLibraryMetadata) {
      toast({ title: '⚠️ Disponível apenas no desktop', variant: 'destructive' });
      return;
    }
    setIsCatalogingTop(true);
    try {
      const allFolders = [
        ...(config.musicFolders || []),
        (config as any).deezerDownloadFolder,
      ].filter(Boolean) as string[];

      if (allFolders.length === 0) {
        toast({ title: '⚠️ Nenhuma pasta configurada', variant: 'destructive' });
        return;
      }

      toast({ title: '🔍 Catalogando acervo...' });
      const result = await window.electronAPI.scanLibraryMetadata({ musicFolders: allFolders });
      if (!result?.success || !result.songs?.length) {
        toast({ title: '⚠️ Nenhum arquivo encontrado', variant: 'destructive' });
        return;
      }

      const libraryMap = new Map<string, { genre: string | null; year: string | null }>();
      for (const song of result.songs as any[]) {
        const key = `${(song.artist || '').toLowerCase().trim()}|${(song.title || '').toLowerCase().trim()}`;
        if (key === '|' || key.startsWith('desconhecido|')) continue;
        const { normalizeId3Genre } = await import('@/lib/id3GenreUtils');
        libraryMap.set(key, { genre: song.genre ? normalizeId3Genre(song.genre) : null, year: song.year || null });
      }

      const { data: dbSongs } = await supabase
        .from('scraped_songs')
        .select('id, artist, title, ai_genre, year')
        .or('ai_genre.is.null,year.is.null')
        .limit(5000);

      let enriched = 0;
      if (dbSongs?.length) {
        const { genreToEnergy } = await import('@/lib/id3GenreUtils');
        for (const dbSong of dbSongs) {
          const key = `${dbSong.artist.toLowerCase().trim()}|${dbSong.title.toLowerCase().trim()}`;
          const libData = libraryMap.get(key);
          if (!libData) continue;
          const updates: Record<string, string> = {};
          if (!dbSong.ai_genre && libData.genre && libData.genre !== 'OUTRO') {
            updates.ai_genre = libData.genre;
            updates.ai_energy = genreToEnergy(libData.genre);
          }
          if (!dbSong.year && libData.year) updates.year = libData.year;
          if (Object.keys(updates).length > 0) {
            await supabase.from('scraped_songs').update(updates).eq('id', dbSong.id);
            enriched++;
          }
        }
      }

      toast({ title: '✅ Catalogação Completa', description: `${result.songs.length} lidos · ${enriched} atualizados` });
    } catch (err) {
      toast({ title: '❌ Erro', description: String(err), variant: 'destructive' });
    } finally {
      setIsCatalogingTop(false);
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
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      {/* === METRICS — Compact Strip === */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Faltando', value: missingSongs.filter(s => s.status === 'missing').length, icon: AlertTriangle, glow: '0 80% 55%' },
          { label: 'Banco Musical', value: libraryStats.isLoading ? null : libraryStats.count.toLocaleString(), icon: HardDrive, glow: '42 100% 50%' },
          { label: 'Ranking TOP25', value: localStats.rankingTotal, icon: TrendingUp, glow: '280 80% 60%' },
          { label: 'Downloads Hoje', value: useAutoDownloadStore.getState().dailyStats.downloaded, icon: Download, glow: '210 100% 60%' },
          { label: 'Substituições', value: gradeQuality.substituted, icon: ArrowRightLeft, glow: '45 100% 55%' },
          { label: 'Coringas', value: gradeQuality.coringas, icon: AlertTriangle, glow: gradeQuality.coringas > 0 ? '0 80% 55%' : '160 70% 45%' },
        ].map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="metric-card p-3 flex items-center gap-3">
              <div className="metric-icon w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `hsl(${stat.glow} / 0.1)` }}
              >
                <Icon className="w-4 h-4" style={{ color: `hsl(${stat.glow})` }} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                {stat.value === null ? (
                  <div className="h-6 w-12 rounded bg-muted/60 animate-pulse mt-0.5" />
                ) : (
                  <p className="text-lg font-bold text-foreground font-mono tabular-nums">{stat.value}</p>
                )}
              </div>
            </div>
          );
        })}
        {/* Zerar Sistema — compact card with AlertDialog */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <div className="glass-card p-3 flex items-center gap-3 cursor-pointer hover:border-destructive/40 transition-colors border border-transparent">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'hsl(0 70% 50% / 0.1)' }}>
                <RotateCcw className="w-4 h-4" style={{ color: 'hsl(0 70% 50%)' }} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Zerar</p>
                <p className="text-xs font-bold text-destructive">Sistema</p>
              </div>
            </div>
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
                    <Checkbox id="clearSupabase" checked={resetOptions.clearSupabase} onCheckedChange={(checked) => setResetOptions(prev => ({ ...prev, clearSupabase: checked === true }))} />
                    <Label htmlFor="clearSupabase" className="text-sm font-medium cursor-pointer">Limpar banco de dados remoto (Supabase)</Label>
                  </div>
                  {resetOptions.clearSupabase && (
                    <>
                      <div className="flex items-center space-x-2 ml-6">
                        <Checkbox id="clearSchedules" checked={resetOptions.clearSchedules} onCheckedChange={(checked) => setResetOptions(prev => ({ ...prev, clearSchedules: checked === true }))} />
                        <Label htmlFor="clearSchedules" className="text-sm cursor-pointer">Limpar monitoramentos especiais</Label>
                      </div>
                      <div className="flex items-center space-x-2 ml-6">
                        <Checkbox id="resetStations" checked={resetOptions.resetStations} onCheckedChange={(checked) => setResetOptions(prev => ({ ...prev, resetStations: checked === true }))} />
                        <Label htmlFor="resetStations" className="text-sm cursor-pointer">Desativar todas as emissoras</Label>
                      </div>
                    </>
                  )}
                </div>
                <p className="text-destructive text-xs font-medium pt-2">⚠️ Esta ação é irreversível!</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleFullSystemReset} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                {isResetting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Confirmar Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Voz do Brasil Alert */}
      {useAutoDownloadStore.getState().vozBrasilFailed && (
        <Card className="glass-card border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-destructive" />
              <span className="text-sm font-bold text-destructive">⚠️ Voz do Brasil — Falha!</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {useAutoDownloadStore.getState().vozBrasilLastError || 'Download falhou. Verifique a conexão e tente manualmente.'}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={() => useAutoDownloadStore.getState().setVozBrasilFailed(false)}
            >
              Dispensar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* === ACTIVE PROGRESS BARS === */}
      {(vozBrasilDownloading || capturedDownloads.isProcessing) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Voz do Brasil Download Progress */}
          {vozBrasilDownloading && (
            <Card className="glass-card border-cyan-500/20 bg-gradient-to-r from-cyan-500/5 to-transparent">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
                    <span className="text-sm font-medium text-foreground">Voz do Brasil</span>
                  </div>
                  <Badge variant="outline" className="text-xs border-cyan-500/30 text-cyan-400">
                    <Download className="w-3 h-3 mr-1" />
                    Baixando...
                  </Badge>
                </div>
                <Progress value={vozBrasilProgress} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {vozBrasilProgress > 0 ? `${vozBrasilProgress}%` : 'Conectando ao servidor EBC...'}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Captured Downloads Progress */}
          {capturedDownloads.isProcessing && (
            <Card className="glass-card border-purple-500/20 bg-gradient-to-r from-purple-500/5 to-transparent">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Music className="w-4 h-4 text-purple-400 animate-pulse" />
                    <span className="text-sm font-medium text-foreground">Downloads Capturadas</span>
                  </div>
                  <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400">
                    {capturedDownloads.processedCount}/{capturedDownloads.queueLength}
                  </Badge>
                </div>
                <Progress 
                  value={capturedDownloads.queueLength > 0 
                    ? (capturedDownloads.processedCount / capturedDownloads.queueLength) * 100 
                    : 0} 
                  className="h-2" 
                />
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="text-emerald-400">✓ {capturedDownloads.processedCount}</span>
                  {capturedDownloads.existsCount > 0 && <span className="text-amber-400">⊘ {capturedDownloads.existsCount} já existe</span>}
                  {capturedDownloads.errorCount > 0 && <span className="text-destructive">✗ {capturedDownloads.errorCount}</span>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

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

      {/* Preview da Próxima Grade — Collapsible */}
      <Card className="glass-card">
        <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setPreviewCollapsed(!previewCollapsed)}>
          <CardTitle className="text-sm md:text-base flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-500" />
            Preview da Próxima Grade
            <ChevronDown className={`w-4 h-4 text-muted-foreground ml-auto transition-transform duration-300 ${!previewCollapsed ? 'rotate-180' : ''}`} />
          </CardTitle>
        </CardHeader>
        <div className="collapsible-content" data-open={!previewCollapsed}>
          <div>
            <CardContent className="pt-0">
              <GradePreviewCard />
            </CardContent>
          </div>
        </div>
      </Card>

      {/* Grades Montadas — Collapsible */}
      <Card className="glass-card">
        <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setScheduleCollapsed(!scheduleCollapsed)}>
          <CardTitle className="text-sm md:text-base flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-500" />
            Grades Montadas
            <ChevronDown className={`w-4 h-4 text-muted-foreground ml-auto transition-transform duration-300 ${!scheduleCollapsed ? 'rotate-180' : ''}`} />
          </CardTitle>
        </CardHeader>
        <div className="collapsible-content" data-open={!scheduleCollapsed}>
          <div>
            <CardContent className="pt-0">
              <GradeScheduleCard />
            </CardContent>
          </div>
        </div>
      </Card>

      {/* Ranking and ID3 moved to footer area below */}

      {/* Radio Stations Windows */}
      <Card className="glass-card">
        <CardHeader className="pb-3 cursor-pointer select-none" onClick={() => setRealtimeCollapsed(!realtimeCollapsed)}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="text-sm md:text-base flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
              Captura em Tempo Real
              <Badge variant="secondary" className="text-[10px]">
                {stations.filter(s => s.enabled).length} emissoras
              </Badge>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${!realtimeCollapsed ? 'rotate-180' : ''}`} />
            </CardTitle>
            {!realtimeCollapsed && (
            <div className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
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
            )}
          </div>
        </CardHeader>
        <div className="collapsible-content" data-open={!realtimeCollapsed}>
          <div>
            <CardContent className="pt-0">
        
        {stations.filter(s => s.enabled).length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
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
          </div>
        </div>

      </Card>

      {/* Status Panel - Collapsible */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border py-3 cursor-pointer select-none" onClick={() => setStatusCollapsed(!statusCollapsed)}>
          <CardTitle className="flex items-center justify-between text-base md:text-lg">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-primary" />
              Status do Sistema
              <Badge className={isRunning ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'} variant="secondary">
                {isRunning ? 'Ativo' : 'Parado'}
              </Badge>
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${!statusCollapsed ? 'rotate-180' : ''}`} />
          </CardTitle>
        </CardHeader>
        <div className="collapsible-content" data-open={!statusCollapsed}><div>
        <CardContent className="p-3 md:p-4 space-y-3 md:space-y-4">
          <div className="space-y-2 md:space-y-3">
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
        </div></div>
      </Card>



      {/* Phase 5: Service Health Dashboard */}
      <ServiceHealthCard />
    </div>
  );
}
