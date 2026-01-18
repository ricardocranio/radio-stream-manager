import { AlertTriangle, Download, Trash2, RefreshCw, Music, Search, ExternalLink, Loader2, CheckCircle, XCircle, PlayCircle, StopCircle, FolderOpen, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useRadioStore, MissingSong } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
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
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';

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
  } = useRadioStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({});
  const [deemixInstalled, setDeemixInstalled] = useState<boolean | null>(null);
  const [isCheckingDeemix, setIsCheckingDeemix] = useState(false);
  const { toast } = useToast();

  // Check if deemix is installed on mount
  useEffect(() => {
    if (isElectron && deezerConfig.enabled) {
      checkDeemixStatus();
    }
  }, [deezerConfig.enabled]);

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
    }
  };

  const handleDeezerDownload = async (songId: string, artist: string, title: string) => {
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
        description: 'Download automático só funciona no app desktop (Electron).',
        variant: 'destructive',
      });
      return;
    }

    setDownloadStatus((prev) => ({ ...prev, [songId]: 'downloading' }));
    updateMissingSong(songId, { status: 'downloading' });

    try {
      const result = await window.electronAPI?.downloadFromDeezer({
        artist,
        title,
        arl: deezerConfig.arl,
        outputFolder: deezerConfig.downloadFolder,
        quality: deezerConfig.quality,
      });

      if (result?.needsInstall) {
        setDeemixInstalled(false);
        throw new Error('deemix não está instalado');
      }

      if (result?.success) {
        setDownloadStatus((prev) => ({ ...prev, [songId]: 'success' }));
        updateMissingSong(songId, { status: 'downloaded' });
        toast({
          title: 'Download concluído!',
          description: `${artist} - ${title} baixado com sucesso.`,
        });
      } else {
        throw new Error(result?.error || 'Erro desconhecido');
      }
    } catch (error) {
      setDownloadStatus((prev) => ({ ...prev, [songId]: 'error' }));
      updateMissingSong(songId, { status: 'error' });
      toast({
        title: 'Erro no download',
        description: error instanceof Error ? error.message : 'Falha ao baixar do Deezer.',
        variant: 'destructive',
      });
    }
  };

  // Batch download all missing songs
  const handleBatchDownload = async () => {
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
        description: 'Download em lote só funciona no app desktop (Electron).',
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

      try {
        const result = await window.electronAPI?.downloadFromDeezer({
          artist: song.artist,
          title: song.title,
          arl: deezerConfig.arl,
          outputFolder: deezerConfig.downloadFolder,
          quality: deezerConfig.quality,
        });

        if (result?.success) {
          completed++;
          setDownloadStatus((prev) => ({ ...prev, [song.id]: 'success' }));
          updateMissingSong(song.id, { status: 'downloaded' });
        } else {
          failed++;
          setDownloadStatus((prev) => ({ ...prev, [song.id]: 'error' }));
          updateMissingSong(song.id, { status: 'error' });
        }
      } catch {
        failed++;
        setDownloadStatus((prev) => ({ ...prev, [song.id]: 'error' }));
        updateMissingSong(song.id, { status: 'error' });
      }

      setBatchDownloadProgress({ completed, failed });

      // 30 second delay between downloads to avoid Deezer rate limiting
      await new Promise(resolve => setTimeout(resolve, 30000));
    }

    setBatchDownloadProgress({ isRunning: false, current: '' });

    // Send Windows notification
    if (isElectron && window.electronAPI?.notifyBatchComplete) {
      window.electronAPI.notifyBatchComplete({
        completed,
        failed,
        total: songsToDownload.length,
        outputFolder: deezerConfig.downloadFolder,
      });
    }

    toast({
      title: shouldStop ? 'Download interrompido' : 'Download em lote concluído',
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

      {/* deemix Installation Instructions */}
      {isElectron && deezerConfig.enabled && (
        <Card className={`glass-card ${deemixInstalled === false ? 'border-destructive/50 bg-destructive/5' : deemixInstalled === true ? 'border-green-500/30 bg-green-500/5' : 'border-muted'}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {deemixInstalled === false && <AlertCircle className="h-5 w-5 text-destructive" />}
              {deemixInstalled === true && <CheckCircle className="h-5 w-5 text-green-500" />}
              {deemixInstalled === null && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
              Configuração do deemix
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <p className="font-medium text-foreground">1. Instalar deemix:</p>
                <code className="block bg-muted/50 px-3 py-2 rounded text-xs font-mono">
                  pip install deemix
                </code>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground">2. Rebuild do app:</p>
                <code className="block bg-muted/50 px-3 py-2 rounded text-xs font-mono">
                  npm run electron:build
                </code>
              </div>
            </div>
            
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Status:</span>
                {deemixInstalled === true && <Badge className="bg-green-500/20 text-green-500 border-green-500/30">Instalado ✓</Badge>}
                {deemixInstalled === false && <Badge variant="destructive">Não encontrado</Badge>}
                {deemixInstalled === null && <Badge variant="outline">Verificando...</Badge>}
              </div>
              <Button variant="outline" size="sm" onClick={checkDeemixStatus} disabled={isCheckingDeemix}>
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
      {deezerConfig.enabled && deezerConfig.arl && (
        <Card className="glass-card border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Music className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Download em Lote via deemix</h3>
                  <p className="text-sm text-muted-foreground">
                    Baixar todas as {filteredSongs.filter(s => s.status === 'missing' || s.status === 'error').length} músicas faltantes do Deezer
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
                  disabled={deemixInstalled === false}
                >
                  <PlayCircle className="w-4 h-4" />
                  Iniciar Download em Lote
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
                      {deezerConfig.enabled && deezerConfig.arl && song.status !== 'downloaded' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-primary hover:text-primary"
                          onClick={() => handleDeezerDownload(song.id, song.artist, song.title)}
                          disabled={downloadStatus[song.id] === 'downloading' || batchDownloadProgress.isRunning || deemixInstalled === false}
                          title="Baixar do Deezer"
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
    </div>
  );
}
