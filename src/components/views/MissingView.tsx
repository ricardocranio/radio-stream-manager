import { AlertTriangle, Download, Trash2, RefreshCw, Music, Search, ExternalLink, Loader2, CheckCircle, XCircle, PlayCircle, StopCircle, FolderOpen, AlertCircle, History, RotateCcw, TrendingUp, Clock, FlaskConical, Wrench } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useRadioStore, MissingSong, DownloadHistoryEntry, getDownloadStats } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

interface DownloadStatus {
  [songId: string]: 'idle' | 'downloading' | 'success' | 'error';
}

export function MissingView() {
  const { 
    missingSongs, 
    deezerConfig, 
    batchDownloadProgress,
    setBatchDownloadProgress,
    updateMissingSong,
    removeMissingSong,
    clearMissingSongs,
    downloadHistory,
    addDownloadHistory,
    clearDownloadHistory,
  } = useRadioStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({});
  const [deemixInstalled, setDeemixInstalled] = useState<boolean | null>(null);
  const [isCheckingDeemix, setIsCheckingDeemix] = useState(false);
  const [activeTab, setActiveTab] = useState('missing');
  const [simulationMode, setSimulationMode] = useState(!isElectron); // Auto-enable in web
  const [simulationSuccessRate, setSimulationSuccessRate] = useState(80); // 80% success rate
  const [isInstallingDeemix, setIsInstallingDeemix] = useState(false);
  const [deemixInstallMessage, setDeemixInstallMessage] = useState<string | null>(null);
  const [pythonStatus, setPythonStatus] = useState<{ available: boolean; command: string | null } | null>(null);
  const [isCheckingPython, setIsCheckingPython] = useState(false);
  const { toast } = useToast();

  // Listen for deemix install progress
  useEffect(() => {
    if (isElectron && window.electronAPI?.onDeemixInstallProgress) {
      window.electronAPI.onDeemixInstallProgress((progress) => {
        setDeemixInstallMessage(progress.message);
        if (progress.status === 'success' || progress.status === 'error') {
          setIsInstallingDeemix(false);
          if (progress.status === 'success') {
            setDeemixInstalled(true);
          }
        }
      });
    }
  }, []);

  // Check if deemix is installed on mount
  useEffect(() => {
    if (isElectron && deezerConfig.enabled) {
      checkDeemixStatus();
      checkPythonStatus();
    }
  }, [deezerConfig.enabled]);

  const checkPythonStatus = async () => {
    if (!isElectron || !window.electronAPI?.checkPython) return;
    setIsCheckingPython(true);
    try {
      const status = await window.electronAPI.checkPython();
      setPythonStatus(status);
    } catch {
      setPythonStatus({ available: false, command: null });
    }
    setIsCheckingPython(false);
  };

  const checkDeemixStatus = async () => {
    if (!isElectron) return;
    setIsCheckingDeemix(true);
    try {
      const installed = await window.electronAPI?.checkDeemix();
      setDeemixInstalled(installed ?? false);
    } catch {
      setDeemixInstalled(false);
    }
    setIsCheckingDeemix(false);
  };

  const handleInstallDeemix = async () => {
    if (!isElectron || !window.electronAPI?.installDeemix) return;
    
    setIsInstallingDeemix(true);
    setDeemixInstallMessage('Iniciando instalação...');
    
    try {
      const result = await window.electronAPI.installDeemix();
      
      if (result.success) {
        toast({
          title: '✅ deemix Instalado!',
          description: result.message || 'Instalação concluída com sucesso.',
        });
        setDeemixInstalled(true);
      } else {
        toast({
          title: '❌ Erro na instalação',
          description: result.error || 'Falha ao instalar deemix.',
          variant: 'destructive',
        });
        
        if (result.needsPython) {
          // Open Python download page
          window.electronAPI?.openExternal('https://www.python.org/downloads/');
        }
        
        if (result.needsRestart) {
          toast({
            title: '🔄 Reinicie o aplicativo',
            description: 'O deemix foi instalado. Reinicie o aplicativo para detectá-lo.',
          });
        }
      }
    } catch (err) {
      toast({
        title: 'Erro',
        description: err instanceof Error ? err.message : 'Erro desconhecido',
        variant: 'destructive',
      });
    } finally {
      setIsInstallingDeemix(false);
      setDeemixInstallMessage(null);
    }
  };

  // Demo missing songs for display
  const demoMissing: MissingSong[] = [
    { id: '1', title: 'Bohemian Rhapsody', artist: 'Queen', station: 'BH FM', timestamp: new Date(), status: 'missing' },
    { id: '2', title: 'Shallow', artist: 'Lady Gaga', station: 'Band FM', timestamp: new Date(), status: 'missing' },
    { id: '3', title: 'Blinding Lights', artist: 'The Weeknd', station: 'Clube FM', timestamp: new Date(), status: 'missing' },
    { id: '4', title: 'Dance Monkey', artist: 'Tones and I', station: 'Band FM', timestamp: new Date(), status: 'missing' },
    { id: '5', title: 'Watermelon Sugar', artist: 'Harry Styles', station: 'BH FM', timestamp: new Date(), status: 'missing' },
  ];

  const displaySongs = missingSongs.length > 0 ? missingSongs : demoMissing;

  const filteredSongs = displaySongs.filter(
    (song) =>
      song.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      song.artist.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const groupedByStation = filteredSongs.reduce((acc, song) => {
    if (!acc[song.station]) acc[song.station] = [];
    acc[song.station].push(song);
    return acc;
  }, {} as Record<string, typeof filteredSongs>);

  // Compute download stats
  const stats = useMemo(() => getDownloadStats(), [downloadHistory]);

  // Get failed downloads for retry
  const failedDownloads = useMemo(() => 
    downloadHistory.filter(e => e.status === 'error'),
    [downloadHistory]
  );

  // External search URLs
  const getSearchUrl = (artist: string, title: string, service: 'deezer' | 'tidal' | 'youtube' | 'spotify') => {
    const query = encodeURIComponent(`${artist} ${title}`);
    switch (service) {
      case 'deezer':
        return `https://www.deezer.com/search/${query}`;
      case 'tidal':
        return `https://listen.tidal.com/search?q=${query}`;
      case 'youtube':
        return `https://www.youtube.com/results?search_query=${query}`;
      case 'spotify':
        return `https://open.spotify.com/search/${query}`;
    }
  };

  const openExternalLink = (url: string) => {
    if (isElectron && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const openDownloadFolder = () => {
    if (isElectron && window.electronAPI?.openFolder) {
      window.electronAPI.openFolder(deezerConfig.downloadFolder);
    } else if (simulationMode) {
      toast({
        title: '📁 Pasta de Downloads (Simulação)',
        description: `Abriria: ${deezerConfig.downloadFolder}`,
      });
    }
  };

  // Simulated download function for testing UI
  const simulateDownload = async (songId: string, artist: string, title: string, isRetry = false): Promise<{ success: boolean; error?: string; duration: number }> => {
    // Simulate download time (1-3 seconds)
    const downloadTime = 1000 + Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, downloadTime));
    
    // Determine success based on success rate
    const isSuccess = Math.random() * 100 < simulationSuccessRate;
    
    return {
      success: isSuccess,
      error: isSuccess ? undefined : 'Simulação: Falha aleatória no download',
      duration: downloadTime,
    };
  };

  const handleDeezerDownload = async (songId: string, artist: string, title: string, isRetry = false) => {
    // In simulation mode, skip Deezer checks
    if (!simulationMode) {
      if (!deezerConfig.enabled || !deezerConfig.arl) {
        toast({
          title: 'Deezer não configurado',
          description: 'Configure seu ARL nas Configurações para baixar do Deezer.',
          variant: 'destructive',
        });
        return;
      }

      if (!isElectron) {
        toast({
          title: 'Apenas no Desktop',
          description: 'Download automático só funciona no app desktop (Electron). Ative o Modo Simulação para testar.',
          variant: 'destructive',
        });
        return;
      }
    }

    setDownloadStatus((prev) => ({ ...prev, [songId]: 'downloading' }));
    if (!isRetry) {
      updateMissingSong(songId, { status: 'downloading' });
    }

    const startTime = Date.now();

    try {
      let result: { success: boolean; error?: string; duration?: number; needsInstall?: boolean };
      
      if (simulationMode) {
        // Use simulated download
        result = await simulateDownload(songId, artist, title, isRetry);
      } else {
        // Use real Electron API
        result = await window.electronAPI?.downloadFromDeezer({
          artist,
          title,
          arl: deezerConfig.arl,
          outputFolder: deezerConfig.downloadFolder,
          quality: deezerConfig.quality,
        }) || { success: false, error: 'API não disponível' };
      }

      if (result?.needsInstall) {
        setDeemixInstalled(false);
        throw new Error('deemix não está instalado');
      }

      const duration = Date.now() - startTime;

      if (result?.success) {
        setDownloadStatus((prev) => ({ ...prev, [songId]: 'success' }));
        if (!isRetry) {
          updateMissingSong(songId, { status: 'downloaded' });
        }
        
        // Add to history
        addDownloadHistory({
          id: crypto.randomUUID(),
          songId,
          title,
          artist,
          timestamp: new Date(),
          status: 'success',
          duration,
        });

        toast({
          title: simulationMode ? '✅ Download Simulado!' : 'Download concluído!',
          description: `${artist} - ${title} ${simulationMode ? '(simulação)' : 'baixado com sucesso'}.`,
        });
      } else {
        throw new Error(result?.error || 'Erro desconhecido');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      setDownloadStatus((prev) => ({ ...prev, [songId]: 'error' }));
      if (!isRetry) {
        updateMissingSong(songId, { status: 'error' });
      }

      // Add to history
      addDownloadHistory({
        id: crypto.randomUUID(),
        songId,
        title,
        artist,
        timestamp: new Date(),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
        duration,
      });

      toast({
        title: simulationMode ? '❌ Falha Simulada' : 'Erro no download',
        description: error instanceof Error ? error.message : 'Falha ao baixar do Deezer.',
        variant: 'destructive',
      });
    }
  };

  // Retry a failed download
  const handleRetryDownload = async (entry: DownloadHistoryEntry) => {
    await handleDeezerDownload(entry.songId, entry.artist, entry.title, true);
  };

  // Retry all failed downloads
  const handleRetryAllFailed = async () => {
    if (failedDownloads.length === 0) {
      toast({
        title: 'Nenhuma falha para tentar novamente',
        description: 'Não há downloads com erro no histórico.',
      });
      return;
    }

    toast({
      title: 'Iniciando retry em lote',
      description: `Tentando novamente ${failedDownloads.length} downloads...`,
    });

    for (const entry of failedDownloads) {
      await handleDeezerDownload(entry.songId, entry.artist, entry.title, true);
      // 30 second delay between retries
      await new Promise(resolve => setTimeout(resolve, 30000));
    }

    toast({
      title: 'Retry concluído',
      description: 'Todos os downloads com falha foram tentados novamente.',
    });
  };

  // Batch download all missing songs
  const handleBatchDownload = async () => {
    // Skip checks in simulation mode
    if (!simulationMode) {
      if (!deezerConfig.enabled || !deezerConfig.arl) {
        toast({
          title: 'Deezer não configurado',
          description: 'Configure seu ARL nas Configurações para baixar do Deezer.',
          variant: 'destructive',
        });
        return;
      }

      if (!isElectron) {
        toast({
          title: 'Apenas no Desktop',
          description: 'Download em lote só funciona no app desktop (Electron). Ative o Modo Simulação para testar.',
          variant: 'destructive',
        });
        return;
      }

      if (deemixInstalled === false) {
        toast({
          title: 'deemix não instalado',
          description: 'Instale o deemix primeiro: pip install deemix',
          variant: 'destructive',
        });
        return;
      }
    }

    const songsToDownload = filteredSongs.filter(s => s.status === 'missing' || s.status === 'error');
    
    if (songsToDownload.length === 0) {
      toast({
        title: 'Nenhuma música para baixar',
        description: 'Todas as músicas já foram baixadas.',
      });
      return;
    }

    setBatchDownloadProgress({
      isRunning: true,
      total: songsToDownload.length,
      completed: 0,
      failed: 0,
      current: '',
    });

    let completed = 0;
    let failed = 0;
    let shouldStop = false;

    for (const song of songsToDownload) {
      // Check if user requested stop
      const currentProgress = useRadioStore.getState().batchDownloadProgress;
      if (!currentProgress.isRunning) {
        shouldStop = true;
        break;
      }
      
      setBatchDownloadProgress({
        current: `${song.artist} - ${song.title}`,
      });

      setDownloadStatus((prev) => ({ ...prev, [song.id]: 'downloading' }));
      updateMissingSong(song.id, { status: 'downloading' });

      const startTime = Date.now();

      try {
        let result: { success: boolean; error?: string; duration?: number };
        
        if (simulationMode) {
          result = await simulateDownload(song.id, song.artist, song.title);
        } else {
          result = await window.electronAPI?.downloadFromDeezer({
            artist: song.artist,
            title: song.title,
            arl: deezerConfig.arl,
            outputFolder: deezerConfig.downloadFolder,
            quality: deezerConfig.quality,
          }) || { success: false, error: 'API não disponível' };
        }

        const duration = Date.now() - startTime;

        if (result?.success) {
          completed++;
          setDownloadStatus((prev) => ({ ...prev, [song.id]: 'success' }));
          updateMissingSong(song.id, { status: 'downloaded' });
          
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
          failed++;
          setDownloadStatus((prev) => ({ ...prev, [song.id]: 'error' }));
          updateMissingSong(song.id, { status: 'error' });
          
          addDownloadHistory({
            id: crypto.randomUUID(),
            songId: song.id,
            title: song.title,
            artist: song.artist,
            timestamp: new Date(),
            status: 'error',
            errorMessage: result?.error || 'Erro desconhecido',
            duration,
          });
        }
      } catch (err) {
        const duration = Date.now() - startTime;
        failed++;
        setDownloadStatus((prev) => ({ ...prev, [song.id]: 'error' }));
        updateMissingSong(song.id, { status: 'error' });
        
        addDownloadHistory({
          id: crypto.randomUUID(),
          songId: song.id,
          title: song.title,
          artist: song.artist,
          timestamp: new Date(),
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Erro desconhecido',
          duration,
        });
      }

      setBatchDownloadProgress({ completed, failed });

      // Shorter delay in simulation mode (2s), longer for real downloads (30s)
      const delayMs = simulationMode ? 2000 : 30000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    setBatchDownloadProgress({ isRunning: false, current: '' });

    // Send Windows notification (only in Electron)
    if (!simulationMode && isElectron && window.electronAPI?.notifyBatchComplete) {
      window.electronAPI.notifyBatchComplete({
        completed,
        failed,
        total: songsToDownload.length,
        outputFolder: deezerConfig.downloadFolder,
      });
    }

    toast({
      title: shouldStop ? 'Download interrompido' : (simulationMode ? '🧪 Simulação concluída' : 'Download em lote concluído'),
      description: `${completed} baixadas, ${failed} falharam de ${songsToDownload.length} músicas.`,
    });
  };

  const handleStopBatchDownload = () => {
    setBatchDownloadProgress({ isRunning: false });
    toast({
      title: 'Parando download...',
      description: 'Aguardando o download atual terminar.',
    });
  };

  const getStatusIcon = (songId: string) => {
    const status = downloadStatus[songId];
    switch (status) {
      case 'downloading':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-destructive" />;
      default:
        return <Download className="w-4 h-4" />;
    }
  };

  const progressPercent = batchDownloadProgress.total > 0 
    ? ((batchDownloadProgress.completed + batchDownloadProgress.failed) / batchDownloadProgress.total) * 100 
    : 0;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Músicas Faltando</h2>
          <p className="text-muted-foreground">
            Músicas detectadas nas rádios que não foram encontradas no acervo local
          </p>
        </div>
        <div className="flex gap-2">
          {deezerConfig.enabled && deezerConfig.arl && (
            <>
              <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
                Deezer Conectado
              </Badge>
              {deemixInstalled === true && (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30">
                  deemix OK
                </Badge>
              )}
            </>
          )}
          <Button variant="outline" onClick={openDownloadFolder} disabled={!isElectron}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Abrir Pasta
          </Button>
          <Button variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Verificar
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="w-4 h-4 mr-2" />
                Limpar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Limpar todas as músicas faltando?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação não pode ser desfeita. Todas as {filteredSongs.length} músicas serão removidas da lista.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={clearMissingSongs}>Limpar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Download Folder Selection Card */}
      <Card className="glass-card border-primary/30 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/20">
                <FolderOpen className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  Pasta de Downloads
                  {!isElectron && (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
                      Desktop Only
                    </Badge>
                  )}
                </h3>
                <p className="text-sm text-muted-foreground font-mono">
                  {deezerConfig.downloadFolder || 'Nenhuma pasta selecionada'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  if (isElectron && window.electronAPI?.selectFolder) {
                    try {
                      const folder = await window.electronAPI.selectFolder();
                      if (folder) {
                        useRadioStore.getState().setDeezerConfig({ downloadFolder: folder });
                        toast({
                          title: '📁 Pasta selecionada',
                          description: `Downloads serão salvos em: ${folder}`,
                        });
                      }
                    } catch (err) {
                      toast({
                        title: 'Erro',
                        description: 'Não foi possível abrir o seletor de pastas.',
                        variant: 'destructive',
                      });
                    }
                  } else {
                    toast({
                      title: '🖥️ Recurso Desktop',
                      description: 'A seleção de pasta com árvore de diretórios só funciona no aplicativo desktop (Electron).',
                      variant: 'destructive',
                    });
                  }
                }}
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                Selecionar Pasta
              </Button>
              <Button
                variant="ghost"
                onClick={openDownloadFolder}
                disabled={!deezerConfig.downloadFolder}
                title="Abrir pasta no explorador"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {!isElectron && (
            <p className="text-xs text-amber-500/80 mt-3 pt-3 border-t border-amber-500/20">
              ⚠️ No navegador web, a seleção de pasta com árvore de diretórios não está disponível. Use o app desktop para essa funcionalidade.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Download Mode Toggle Card */}
      <Card className={`glass-card ${deezerConfig.autoDownload ? 'border-green-500/50 bg-green-500/5' : 'border-blue-500/50 bg-blue-500/5'}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${deezerConfig.autoDownload ? 'bg-green-500/20' : 'bg-blue-500/20'}`}>
                {deezerConfig.autoDownload ? (
                  <PlayCircle className="w-6 h-6 text-green-500" />
                ) : (
                  <Download className="w-6 h-6 text-blue-500" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  Modo de Download
                  <Badge className={deezerConfig.autoDownload ? 'bg-green-500/20 text-green-500 border-green-500/30' : 'bg-blue-500/20 text-blue-500 border-blue-500/30'}>
                    {deezerConfig.autoDownload ? 'Automático' : 'Manual'}
                  </Badge>
                </h3>
                <p className="text-sm text-muted-foreground">
                  {deezerConfig.autoDownload 
                    ? 'Downloads iniciarão automaticamente para novas músicas faltantes'
                    : 'Você precisa clicar para iniciar o download de cada música'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Force Start Download Button */}
              <Button
                onClick={handleBatchDownload}
                disabled={batchDownloadProgress.isRunning || filteredSongs.filter(s => s.status === 'missing' || s.status === 'error').length === 0}
                className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
                size="sm"
              >
                {batchDownloadProgress.isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Baixando...
                  </>
                ) : (
                  <>
                    <PlayCircle className="w-4 h-4" />
                    Iniciar Downloads
                  </>
                )}
              </Button>
              
              <div className="flex items-center space-x-2">
                <Label htmlFor="auto-download" className="text-sm text-muted-foreground mr-2">
                  Manual
                </Label>
                <Switch
                  id="auto-download"
                  checked={deezerConfig.autoDownload}
                  onCheckedChange={(checked) => {
                    useRadioStore.getState().setDeezerConfig({ autoDownload: checked });
                    toast({
                      title: checked ? 'Download Automático Ativado' : 'Download Manual Ativado',
                      description: checked 
                        ? 'Novas músicas faltantes serão baixadas automaticamente'
                        : 'Você controla quando cada música é baixada',
                    });
                  }}
                />
                <Label htmlFor="auto-download" className="text-sm text-muted-foreground ml-2">
                  Auto
                </Label>
              </div>
            </div>
          </div>
          
          {/* Progress bar when downloading */}
          {batchDownloadProgress.isRunning && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground truncate max-w-[60%]">
                  {batchDownloadProgress.current || 'Preparando...'}
                </span>
                <span className="text-sm font-mono">
                  {batchDownloadProgress.completed + batchDownloadProgress.failed}/{batchDownloadProgress.total}
                </span>
              </div>
              <Progress 
                value={((batchDownloadProgress.completed + batchDownloadProgress.failed) / batchDownloadProgress.total) * 100} 
                className="h-2"
              />
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span className="text-green-500">✅ {batchDownloadProgress.completed} baixadas</span>
                <span className="text-red-500">❌ {batchDownloadProgress.failed} erros</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Simulation Mode Card */}
      <Card className={`glass-card ${simulationMode ? 'border-amber-500/50 bg-amber-500/5' : 'border-muted'}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${simulationMode ? 'bg-amber-500/20' : 'bg-muted/50'}`}>
                <FlaskConical className={`w-6 h-6 ${simulationMode ? 'text-amber-500' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  Modo Simulação
                  {simulationMode && <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">Ativo</Badge>}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {simulationMode 
                    ? `Testando UI sem Electron (${simulationSuccessRate}% taxa de sucesso)`
                    : 'Ative para testar downloads sem precisar do Electron'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {simulationMode && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="success-rate" className="text-xs text-muted-foreground">Taxa:</Label>
                  <select
                    id="success-rate"
                    value={simulationSuccessRate}
                    onChange={(e) => setSimulationSuccessRate(Number(e.target.value))}
                    className="bg-background border border-input rounded px-2 py-1 text-xs"
                  >
                    <option value={100}>100%</option>
                    <option value={80}>80%</option>
                    <option value={50}>50%</option>
                    <option value={20}>20%</option>
                    <option value={0}>0%</option>
                  </select>
                </div>
              )}
              <div className="flex items-center space-x-2">
                <Switch
                  id="simulation-mode"
                  checked={simulationMode}
                  onCheckedChange={setSimulationMode}
                />
                <Label htmlFor="simulation-mode" className="text-sm">
                  {simulationMode ? 'ON' : 'OFF'}
                </Label>
              </div>
            </div>
          </div>
          {simulationMode && (
            <p className="text-xs text-amber-500/80 mt-3 pt-3 border-t border-amber-500/20">
              ⚠️ Modo simulação ativo: Downloads são simulados com delay de 1-3s. Nenhum arquivo é realmente baixado.
            </p>
          )}
        </CardContent>
      </Card>

      {/* deemix Installation Instructions */}
      {!simulationMode && isElectron && deezerConfig.enabled && (
        <Card className={`glass-card ${deemixInstalled === false ? 'border-destructive/50 bg-destructive/5' : deemixInstalled === true ? 'border-green-500/30 bg-green-500/5' : 'border-muted'}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {isInstallingDeemix && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
              {!isInstallingDeemix && deemixInstalled === false && <AlertCircle className="h-5 w-5 text-destructive" />}
              {!isInstallingDeemix && deemixInstalled === true && <CheckCircle className="h-5 w-5 text-green-500" />}
              {!isInstallingDeemix && deemixInstalled === null && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
              Configuração do deemix
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Python Status Check */}
            {deemixInstalled === false && pythonStatus !== null && !pythonStatus.available && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground flex items-center gap-2">
                      Python não encontrado
                      <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">Requisito</Badge>
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      O Python é necessário para instalar e executar o deemix
                    </p>
                  </div>
                  <Button
                    onClick={() => window.electronAPI?.openExternal('https://www.python.org/downloads/')}
                    variant="outline"
                    className="gap-2 border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Baixar Python
                  </Button>
                </div>
                
                <div className="bg-background/50 rounded-lg p-3 space-y-2 text-sm">
                  <p className="font-medium text-foreground">📋 Instruções de instalação do Python:</p>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Baixe o instalador do Python em <span className="text-primary">python.org/downloads</span></li>
                    <li>Execute o instalador e <strong className="text-foreground">marque "Add Python to PATH"</strong></li>
                    <li>Complete a instalação e <strong className="text-foreground">reinicie este aplicativo</strong></li>
                    <li>Após reiniciar, clique em "Instalar deemix"</li>
                  </ol>
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkPythonStatus}
                  disabled={isCheckingPython}
                  className="w-full"
                >
                  {isCheckingPython ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Verificar Python novamente
                </Button>
              </div>
            )}

            {/* Python OK Badge */}
            {deemixInstalled === false && pythonStatus?.available && (
              <div className="flex items-center gap-2 text-sm bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-green-500">Python detectado:</span>
                <code className="text-xs bg-background/50 px-2 py-0.5 rounded">{pythonStatus.command}</code>
              </div>
            )}

            {/* Auto Install Section - only show if Python is available */}
            {deemixInstalled === false && (pythonStatus === null || pythonStatus.available) && (
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Wrench className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Instalação Automática</h4>
                    <p className="text-sm text-muted-foreground">
                      {pythonStatus?.available 
                        ? 'Python detectado! Clique para instalar o deemix automaticamente'
                        : 'Verificando Python... Clique para instalar o deemix'}
                    </p>
                  </div>
                  <Button
                    onClick={handleInstallDeemix}
                    disabled={isInstallingDeemix || (pythonStatus !== null && !pythonStatus.available)}
                    className="gap-2"
                  >
                    {isInstallingDeemix ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Instalando...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Instalar deemix
                      </>
                    )}
                  </Button>
                </div>
                
                {isInstallingDeemix && deemixInstallMessage && (
                  <div className="bg-background/50 rounded px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {deemixInstallMessage}
                  </div>
                )}
              </div>
            )}

            {/* Manual instructions (collapsed if not installed) */}
            {deemixInstalled === false && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                  📋 Ou instale manualmente via terminal
                </summary>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="font-medium text-foreground">1. Instalar deemix:</p>
                    <code className="block bg-muted/50 px-3 py-2 rounded text-xs font-mono">
                      pip install deemix
                    </code>
                  </div>
                  <div className="space-y-2">
                    <p className="font-medium text-foreground">2. Rebuild do app:</p>
                    <code className="block bg-muted/50 px-3 py-2 rounded text-xs font-mono">
                      npm run build
                    </code>
                  </div>
                </div>
              </details>
            )}
            
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Status:</span>
                {deemixInstalled === true && <Badge className="bg-green-500/20 text-green-500 border-green-500/30">Instalado ✓</Badge>}
                {deemixInstalled === false && !isInstallingDeemix && <Badge variant="destructive">Não encontrado</Badge>}
                {isInstallingDeemix && <Badge className="bg-primary/20 text-primary border-primary/30">Instalando...</Badge>}
                {deemixInstalled === null && !isInstallingDeemix && <Badge variant="outline">Verificando...</Badge>}
              </div>
              <Button variant="outline" size="sm" onClick={checkDeemixStatus} disabled={isCheckingDeemix || isInstallingDeemix}>
                {isCheckingDeemix ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Verificar deemix
              </Button>
            </div>
            
            <p className="text-xs text-muted-foreground">
              ⏱️ Delay de 30s entre downloads para evitar rate limiting do Deezer
            </p>
          </CardContent>
        </Card>
      )}

      {/* Batch Download Section */}
      {(simulationMode || (deezerConfig.enabled && deezerConfig.arl)) && (
        <Card className="glass-card border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Music className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    Download em Lote {simulationMode ? '(Simulação)' : 'via deemix'}
                    {simulationMode && <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">🧪</Badge>}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {simulationMode ? 'Simular download de' : 'Baixar'} {filteredSongs.filter(s => s.status === 'missing' || s.status === 'error').length} músicas faltantes
                  </p>
                </div>
              </div>
              
              {batchDownloadProgress.isRunning ? (
                <Button variant="destructive" onClick={handleStopBatchDownload}>
                  <StopCircle className="w-4 h-4 mr-2" />
                  Parar Download
                </Button>
              ) : (
                <Button 
                  onClick={handleBatchDownload} 
                  className="gap-2"
                  disabled={!simulationMode && deemixInstalled === false}
                >
                  <PlayCircle className="w-4 h-4" />
                  {simulationMode ? '🧪 Simular Download em Lote' : 'Iniciar Download em Lote'}
                </Button>
              )}
            </div>

            {batchDownloadProgress.isRunning && (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground truncate max-w-[60%]">
                    Baixando: {batchDownloadProgress.current}
                  </span>
                  <span className="text-foreground">
                    {batchDownloadProgress.completed + batchDownloadProgress.failed} / {batchDownloadProgress.total}
                  </span>
                </div>
                <Progress value={progressPercent} className="h-2" />
                <div className="flex gap-4 text-xs">
                  <span className="text-green-500">✓ {batchDownloadProgress.completed} baixadas</span>
                  <span className="text-destructive">✗ {batchDownloadProgress.failed} falharam</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs: Missing Songs / Download History */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="missing" className="gap-2">
            <AlertTriangle className="w-4 h-4" />
            Músicas Faltando ({filteredSongs.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="w-4 h-4" />
            Histórico ({downloadHistory.length})
          </TabsTrigger>
        </TabsList>

        {/* Missing Songs Tab */}
        <TabsContent value="missing" className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar música ou artista..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="glass-card border-destructive/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-8 h-8 text-destructive" />
                  <div>
                    <p className="text-2xl font-bold">{filteredSongs.length}</p>
                    <p className="text-xs text-muted-foreground">Total Faltando</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            {Object.entries(groupedByStation)
              .slice(0, 3)
              .map(([station, songs]) => (
                <Card key={station} className="glass-card">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <Music className="w-8 h-8 text-primary" />
                      <div>
                        <p className="text-2xl font-bold">{songs.length}</p>
                        <p className="text-xs text-muted-foreground">{station}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>

          {/* Grouped Lists */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Object.entries(groupedByStation).map(([station, songs]) => (
              <Card key={station} className="glass-card">
                <CardHeader className="border-b border-border">
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-destructive" />
                      {station}
                    </span>
                    <Badge variant="destructive">{songs.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
                    {songs.map((song) => (
                      <div
                        key={song.id}
                        className={`p-4 flex items-center justify-between hover:bg-secondary/30 transition-colors ${
                          song.status === 'downloaded' ? 'bg-green-500/5' : 
                          song.status === 'error' ? 'bg-destructive/5' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            song.status === 'downloaded' ? 'bg-green-500/10' :
                            song.status === 'error' ? 'bg-destructive/10' :
                            'bg-destructive/10'
                          }`}>
                            {song.status === 'downloaded' ? (
                              <CheckCircle className="w-5 h-5 text-green-500" />
                            ) : song.status === 'downloading' ? (
                              <Loader2 className="w-5 h-5 text-primary animate-spin" />
                            ) : (
                              <Music className={`w-5 h-5 ${song.status === 'error' ? 'text-destructive' : 'text-destructive'}`} />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{song.title}</p>
                            <p className="text-sm text-muted-foreground">{song.artist}</p>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {/* Deezer Download Button */}
                          {(simulationMode || (deezerConfig.enabled && deezerConfig.arl)) && song.status !== 'downloaded' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-primary hover:text-primary"
                              onClick={() => handleDeezerDownload(song.id, song.artist, song.title)}
                              disabled={downloadStatus[song.id] === 'downloading' || batchDownloadProgress.isRunning || (!simulationMode && deemixInstalled === false)}
                              title={simulationMode ? 'Simular download' : 'Baixar do Deezer'}
                            >
                              {getStatusIcon(song.id)}
                            </Button>
                          )}
                          
                          {/* Remove from list */}
                          {song.status === 'downloaded' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-green-500 hover:text-green-600"
                              onClick={() => removeMissingSong(song.id)}
                              title="Remover da lista"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                          )}
                          
                          {/* External Search Dropdown */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" title="Buscar em serviços">
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-popover border-border">
                              <DropdownMenuItem
                                onClick={() => openExternalLink(getSearchUrl(song.artist, song.title, 'deezer'))}
                              >
                                🎵 Buscar no Deezer
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openExternalLink(getSearchUrl(song.artist, song.title, 'tidal'))}
                              >
                                🌊 Buscar no Tidal
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openExternalLink(getSearchUrl(song.artist, song.title, 'youtube'))}
                              >
                                ▶️ Buscar no YouTube
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openExternalLink(getSearchUrl(song.artist, song.title, 'spotify'))}
                              >
                                💚 Buscar no Spotify
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredSongs.length === 0 && (
            <Card className="glass-card">
              <CardContent className="p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                  <Music className="w-8 h-8 text-success" />
                </div>
                <h3 className="text-lg font-medium">Nenhuma música faltando!</h3>
                <p className="text-muted-foreground mt-2">
                  Todas as músicas detectadas foram encontradas no acervo.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Download History Tab */}
        <TabsContent value="history" className="space-y-4">
          {/* History Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="glass-card">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Download className="w-8 h-8 text-primary" />
                  <div>
                    <p className="text-2xl font-bold">{stats.total}</p>
                    <p className="text-xs text-muted-foreground">Total Downloads</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card border-green-500/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold">{stats.success}</p>
                    <p className="text-xs text-muted-foreground">Sucesso</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card border-destructive/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <XCircle className="w-8 h-8 text-destructive" />
                  <div>
                    <p className="text-2xl font-bold">{stats.failed}</p>
                    <p className="text-xs text-muted-foreground">Falhas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card border-blue-500/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-8 h-8 text-blue-500" />
                  <div>
                    <p className="text-2xl font-bold">{stats.successRate}%</p>
                    <p className="text-xs text-muted-foreground">Taxa de Sucesso</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Retry Actions */}
          {failedDownloads.length > 0 && (
            <Card className="glass-card border-destructive/30 bg-destructive/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-destructive/20 flex items-center justify-center">
                      <RotateCcw className="w-6 h-6 text-destructive" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Downloads com Falha</h3>
                      <p className="text-sm text-muted-foreground">
                        {failedDownloads.length} downloads falharam. Tente novamente.
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={handleRetryAllFailed}
                    disabled={batchDownloadProgress.isRunning || deemixInstalled === false}
                    className="gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Retry Todos ({failedDownloads.length})
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* History List */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <History className="w-5 h-5" />
                Histórico de Downloads
              </CardTitle>
              {downloadHistory.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Limpar Histórico
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Limpar histórico de downloads?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação não pode ser desfeita. Todo o histórico de {downloadHistory.length} downloads será removido.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={clearDownloadHistory}>Limpar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {downloadHistory.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                    <History className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium">Nenhum download ainda</h3>
                  <p className="text-muted-foreground mt-2">
                    O histórico de downloads aparecerá aqui.
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="divide-y divide-border">
                    {downloadHistory.map((entry) => (
                      <div
                        key={entry.id}
                        className={`p-4 flex items-center justify-between hover:bg-secondary/30 transition-colors ${
                          entry.status === 'success' ? 'bg-green-500/5' : 'bg-destructive/5'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            entry.status === 'success' ? 'bg-green-500/10' : 'bg-destructive/10'
                          }`}>
                            {entry.status === 'success' ? (
                              <CheckCircle className="w-5 h-5 text-green-500" />
                            ) : (
                              <XCircle className="w-5 h-5 text-destructive" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{entry.title}</p>
                            <p className="text-sm text-muted-foreground truncate">{entry.artist}</p>
                            {entry.errorMessage && (
                              <p className="text-xs text-destructive truncate mt-1">{entry.errorMessage}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(entry.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div>
                              {new Date(entry.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                            </div>
                            {entry.duration && (
                              <div className="text-[10px]">
                                {Math.round(entry.duration / 1000)}s
                              </div>
                            )}
                          </div>
                          {entry.status === 'error' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRetryDownload(entry)}
                              disabled={batchDownloadProgress.isRunning || deemixInstalled === false}
                              title="Tentar novamente"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
