/**
 * MissingView - Slim orchestrator
 * Delegates to MissingTab, HistoryTab, DeezerStatusCards sub-components
 * and useMissingTabState, useHistoryTabState, useDeezerTabState hooks
 * 
 * Refactored from 1905-line monolith → ~350-line orchestrator
 */
import { useState, useCallback } from 'react';
import { AlertTriangle, Download, Trash2, RefreshCw, Music, FolderOpen, ExternalLink, History, RotateCw, Zap, Pause, PlayCircle, StopCircle, Loader2, FlaskConical, FileDown, CheckCircle, Wrench } from 'lucide-react';
import { useRadioStore, DownloadHistoryEntry } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// Sub-components
import { MissingTab } from '@/components/missing/MissingTab';
import { HistoryTab } from '@/components/missing/HistoryTab';
import { DeezerStatusCards } from '@/components/missing/DeezerStatusCards';

// Hooks
import { useMissingTabState } from '@/hooks/useMissingTabState';
import { useHistoryTabState } from '@/hooks/useHistoryTabState';
import { useDeezerTabState } from '@/hooks/useDeezerTabState';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

interface DownloadStatus {
  [songId: string]: 'idle' | 'downloading' | 'success' | 'error';
}

export function MissingView() {
  const {
    deezerConfig, config,
    batchDownloadProgress, setBatchDownloadProgress,
    updateMissingSong, clearMissingSongs,
    addDownloadHistory, clearDownloadHistory,
  } = useRadioStore();
  const { queueLength, isProcessing, resetQueue } = useAutoDownloadStore();
  const { toast } = useToast();

  // Hooks
  const missingState = useMissingTabState();
  const historyState = useHistoryTabState();
  const deezerState = useDeezerTabState();

  // Local state
  const [activeTab, setActiveTab] = useState('missing');
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({});
  const [simulationMode, setSimulationMode] = useState(!isElectron);
  const [simulationSuccessRate, setSimulationSuccessRate] = useState(80);

  // Download logic
  const simulateDownload = useCallback(async (): Promise<{ success: boolean; error?: string; duration: number }> => {
    const downloadTime = 1000 + Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, downloadTime));
    return {
      success: Math.random() * 100 < simulationSuccessRate,
      error: Math.random() * 100 >= simulationSuccessRate ? 'Simulação: Falha aleatória' : undefined,
      duration: downloadTime,
    };
  }, [simulationSuccessRate]);

  const handleDeezerDownload = useCallback(async (songId: string, artist: string, title: string, isRetry = false) => {
    if (!simulationMode) {
      if (!deezerConfig.enabled || !deezerConfig.arl) {
        toast({ title: 'Deezer não configurado', description: 'Configure seu ARL nas Configurações.', variant: 'destructive' });
        return;
      }
      if (!isElectron) {
        toast({ title: 'Apenas no Desktop', description: 'Ative o Modo Simulação para testar.', variant: 'destructive' });
        return;
      }
    }

    setDownloadStatus(prev => ({ ...prev, [songId]: 'downloading' }));
    if (!isRetry) updateMissingSong(songId, { status: 'downloading' });

    const startTime = Date.now();
    try {
      const result = simulationMode
        ? await simulateDownload()
        : await window.electronAPI?.downloadFromDeezer({
            artist, title, arl: deezerConfig.arl,
            outputFolder: deezerConfig.downloadFolder, quality: deezerConfig.quality,
          }) || { success: false, error: 'API não disponível' };

      const duration = Date.now() - startTime;

      if (result?.success) {
        setDownloadStatus(prev => ({ ...prev, [songId]: 'success' }));
        if (!isRetry) updateMissingSong(songId, { status: 'downloaded' });
        addDownloadHistory({ id: crypto.randomUUID(), songId, title, artist, timestamp: new Date(), status: 'success', duration });
        toast({ title: simulationMode ? '✅ Download Simulado!' : 'Download concluído!', description: `${artist} - ${title}` });
      } else {
        throw new Error(result?.error || 'Erro desconhecido');
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      setDownloadStatus(prev => ({ ...prev, [songId]: 'error' }));
      if (!isRetry) updateMissingSong(songId, { status: 'error' });
      addDownloadHistory({ id: crypto.randomUUID(), songId, title, artist, timestamp: new Date(), status: 'error', errorMessage: error instanceof Error ? error.message : 'Erro', duration });
      toast({ title: simulationMode ? '❌ Falha Simulada' : 'Erro no download', description: error instanceof Error ? error.message : 'Falha', variant: 'destructive' });
    }
  }, [simulationMode, deezerConfig, updateMissingSong, addDownloadHistory, toast, simulateDownload]);

  const handleRetryDownload = useCallback(async (entry: DownloadHistoryEntry) => {
    await handleDeezerDownload(entry.songId, entry.artist, entry.title, true);
  }, [handleDeezerDownload]);

  const handleRetryAllFailed = useCallback(async () => {
    if (historyState.failedDownloads.length === 0) return;
    toast({ title: 'Iniciando retry em lote', description: `Tentando ${historyState.failedDownloads.length} downloads...` });
    for (const entry of historyState.failedDownloads) {
      await handleDeezerDownload(entry.songId, entry.artist, entry.title, true);
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    toast({ title: 'Retry concluído' });
  }, [historyState.failedDownloads, handleDeezerDownload, toast]);

  const handleBatchDownload = useCallback(async () => {
    if (!simulationMode && (!deezerConfig.enabled || !deezerConfig.arl || !isElectron || deezerState.deemixInstalled === false)) return;

    const songsToDownload = missingState.filteredSongs.filter(s => s.status === 'missing' || s.status === 'error');
    if (songsToDownload.length === 0) { toast({ title: 'Nenhuma música para baixar' }); return; }

    setBatchDownloadProgress({ isRunning: true, total: songsToDownload.length, completed: 0, failed: 0, current: '' });
    let completed = 0, failed = 0;

    for (const song of songsToDownload) {
      const current = useRadioStore.getState().batchDownloadProgress;
      if (!current.isRunning) break;

      setBatchDownloadProgress({ current: `${song.artist} - ${song.title}` });
      setDownloadStatus(prev => ({ ...prev, [song.id]: 'downloading' }));
      updateMissingSong(song.id, { status: 'downloading' });

      const startTime = Date.now();
      try {
        const result = simulationMode
          ? await simulateDownload()
          : await window.electronAPI?.downloadFromDeezer({ artist: song.artist, title: song.title, arl: deezerConfig.arl, outputFolder: deezerConfig.downloadFolder, quality: deezerConfig.quality }) || { success: false, error: 'API não disponível' };

        const duration = Date.now() - startTime;
        if (result?.success) {
          completed++;
          setDownloadStatus(prev => ({ ...prev, [song.id]: 'success' }));
          updateMissingSong(song.id, { status: 'downloaded' });
          addDownloadHistory({ id: crypto.randomUUID(), songId: song.id, title: song.title, artist: song.artist, timestamp: new Date(), status: 'success', duration });
        } else {
          failed++;
          setDownloadStatus(prev => ({ ...prev, [song.id]: 'error' }));
          updateMissingSong(song.id, { status: 'error' });
          addDownloadHistory({ id: crypto.randomUUID(), songId: song.id, title: song.title, artist: song.artist, timestamp: new Date(), status: 'error', errorMessage: result?.error, duration });
        }
      } catch (err) {
        failed++;
        setDownloadStatus(prev => ({ ...prev, [song.id]: 'error' }));
        updateMissingSong(song.id, { status: 'error' });
        addDownloadHistory({ id: crypto.randomUUID(), songId: song.id, title: song.title, artist: song.artist, timestamp: new Date(), status: 'error', errorMessage: err instanceof Error ? err.message : 'Erro', duration: Date.now() - startTime });
      }

      setBatchDownloadProgress({ completed, failed });
      await new Promise(resolve => setTimeout(resolve, simulationMode ? 2000 : 30000));
    }

    setBatchDownloadProgress({ isRunning: false, current: '' });
    toast({ title: simulationMode ? '🧪 Simulação concluída' : 'Download em lote concluído', description: `${completed} baixadas, ${failed} falharam.` });
  }, [simulationMode, deezerConfig, deezerState.deemixInstalled, missingState.filteredSongs, setBatchDownloadProgress, updateMissingSong, addDownloadHistory, toast, simulateDownload]);

  const openDownloadFolder = useCallback(() => {
    if (isElectron && window.electronAPI?.openFolder) {
      window.electronAPI.openFolder(deezerConfig.downloadFolder);
    } else if (simulationMode) {
      toast({ title: '📁 Pasta de Downloads (Simulação)', description: `Abriria: ${deezerConfig.downloadFolder}` });
    }
  }, [deezerConfig.downloadFolder, simulationMode, toast]);

  const progressPercent = batchDownloadProgress.total > 0
    ? ((batchDownloadProgress.completed + batchDownloadProgress.failed) / batchDownloadProgress.total) * 100
    : 0;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Músicas Faltando</h2>
          <p className="text-muted-foreground">Músicas detectadas nas rádios que não foram encontradas no acervo local</p>
        </div>
        <div className="flex gap-2">
          {deezerConfig.enabled && deezerConfig.arl && (
            <>
              <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">Deezer Conectado</Badge>
              {deezerState.deemixInstalled === true && (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30 cursor-pointer hover:bg-blue-500/20" onClick={deezerState.testDeemix}>
                  {deezerState.isTestingDeemix ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                  deemix OK
                </Badge>
              )}
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline"><FileDown className="w-4 h-4 mr-2" />Exportar</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => missingState.handleExportMissing('txt')}>📄 Exportar TXT</DropdownMenuItem>
              <DropdownMenuItem onClick={() => missingState.handleExportMissing('csv')}>📊 Exportar CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={openDownloadFolder} disabled={!isElectron && !simulationMode}>
            <FolderOpen className="w-4 h-4 mr-2" />Abrir Pasta
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="secondary"><RotateCw className="w-4 h-4 mr-2" />Reset</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Resetar toda a base?</AlertDialogTitle>
                <AlertDialogDescription>Limpa lista de faltando, histórico, fila e status.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => {
                  clearMissingSongs(); clearDownloadHistory(); resetQueue();
                  setBatchDownloadProgress({ isRunning: false, total: 0, completed: 0, failed: 0, current: '' });
                  setDownloadStatus({});
                  toast({ title: '🔄 Base resetada' });
                }}>Resetar Tudo</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Auto-Download Status */}
      {deezerConfig.enabled && deezerConfig.autoDownload && (
        <Card className={`glass-card border-2 ${isProcessing ? 'border-green-500/50 bg-green-500/5' : queueLength > 0 ? 'border-amber-500/50 bg-amber-500/5' : 'border-muted bg-muted/5'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${isProcessing ? 'bg-green-500/20' : queueLength > 0 ? 'bg-amber-500/20' : 'bg-muted/20'}`}>
                  {isProcessing ? <Loader2 className="w-6 h-6 text-green-500 animate-spin" /> : queueLength > 0 ? <Pause className="w-6 h-6 text-amber-500" /> : <Zap className="w-6 h-6 text-muted-foreground" />}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    Download Automático
                    {isProcessing && <Badge className="bg-green-500 text-white animate-pulse">Processando</Badge>}
                    {!isProcessing && queueLength > 0 && <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">Aguardando</Badge>}
                    {!isProcessing && queueLength === 0 && <Badge variant="outline" className="text-muted-foreground">Ocioso</Badge>}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {isProcessing ? `Baixando música... (${queueLength} na fila)` : queueLength > 0 ? `${queueLength} músicas aguardando` : 'Nenhuma na fila'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="text-right">
                  <p className="text-muted-foreground">Na fila</p>
                  <p className="font-mono font-semibold text-lg">{queueLength}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deezer Status Cards */}
      <DeezerStatusCards
        isElectron={deezerState.isElectron}
        deezerEnabled={deezerConfig.enabled}
        deemixInstalled={deezerState.deemixInstalled}
        deemixCommand={deezerState.deemixCommand}
        deemixVersion={deezerState.deemixVersion}
        isTestingDeemix={deezerState.isTestingDeemix}
        isCheckingDeemix={deezerState.isCheckingDeemix}
        isInstallingDeemix={deezerState.isInstallingDeemix}
        deemixInstallMessage={deezerState.deemixInstallMessage}
        pythonStatus={deezerState.pythonStatus}
        isCheckingPython={deezerState.isCheckingPython}
        pythonMissingAlert={deezerState.pythonMissingAlert}
        onTestDeemix={deezerState.testDeemix}
        onTestSearch={deezerState.testDeemixSearch}
        onCheckDeemix={deezerState.checkDeemixStatus}
        onCheckPython={deezerState.checkPythonStatus}
        onInstallDeemix={deezerState.handleInstallDeemix}
      />

      {/* Music Library & Download Folder Cards */}
      <Card className="glass-card border-blue-500/30 bg-blue-500/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-blue-500/20">
              <Music className="w-6 h-6 text-blue-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                Banco Musical
                <Badge variant="outline" className="text-blue-500 border-blue-500/30">
                  {config.musicFolders.length} {config.musicFolders.length === 1 ? 'pasta' : 'pastas'}
                </Badge>
              </h3>
              <div className="text-sm text-muted-foreground space-y-1 mt-1">
                {config.musicFolders.length > 0 ? (
                  config.musicFolders.map((folder, idx) => (
                    <p key={idx} className="font-mono text-xs truncate max-w-lg">📁 {folder}</p>
                  ))
                ) : (
                  <p className="text-amber-500">⚠️ Nenhuma pasta configurada</p>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => toast({ title: '📁 Configurar Pastas', description: 'Vá para "Pastas" no menu lateral.' })}>
              <Wrench className="w-4 h-4 mr-2" />Configurar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Download Mode Toggle */}
      <Card className={`glass-card ${deezerConfig.autoDownload ? 'border-green-500/50 bg-green-500/5' : 'border-blue-500/50 bg-blue-500/5'}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${deezerConfig.autoDownload ? 'bg-green-500/20' : 'bg-blue-500/20'}`}>
                {deezerConfig.autoDownload ? <PlayCircle className="w-6 h-6 text-green-500" /> : <Download className="w-6 h-6 text-blue-500" />}
              </div>
              <div>
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  Modo de Download
                  <Badge className={deezerConfig.autoDownload ? 'bg-green-500/20 text-green-500 border-green-500/30' : 'bg-blue-500/20 text-blue-500 border-blue-500/30'}>
                    {deezerConfig.autoDownload ? 'Automático' : 'Manual'}
                  </Badge>
                </h3>
                <p className="text-sm text-muted-foreground">
                  {deezerConfig.autoDownload ? 'Downloads iniciam automaticamente' : 'Clique para iniciar cada download'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button onClick={handleBatchDownload} disabled={batchDownloadProgress.isRunning || missingState.filteredSongs.filter(s => s.status === 'missing' || s.status === 'error').length === 0} className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2" size="sm">
                {batchDownloadProgress.isRunning ? <><Loader2 className="w-4 h-4 animate-spin" />Baixando...</> : <><PlayCircle className="w-4 h-4" />Iniciar Downloads</>}
              </Button>
              <div className="flex items-center space-x-2">
                <Label htmlFor="auto-download" className="text-sm text-muted-foreground mr-2">Manual</Label>
                <Switch id="auto-download" checked={deezerConfig.autoDownload} onCheckedChange={(checked) => {
                  useRadioStore.getState().setDeezerConfig({ autoDownload: checked });
                  toast({ title: checked ? 'Download Automático Ativado' : 'Download Manual Ativado' });
                }} />
                <Label htmlFor="auto-download" className="text-sm text-muted-foreground ml-2">Auto</Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Batch Download Progress */}
      {batchDownloadProgress.isRunning && (
        <Card className="glass-card border-primary/30">
          <CardContent className="p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground truncate max-w-[60%]">Baixando: {batchDownloadProgress.current}</span>
              <span>{batchDownloadProgress.completed + batchDownloadProgress.failed} / {batchDownloadProgress.total}</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            <div className="flex justify-between">
              <div className="flex gap-4 text-xs">
                <span className="text-green-500">✓ {batchDownloadProgress.completed} baixadas</span>
                <span className="text-destructive">✗ {batchDownloadProgress.failed} falharam</span>
              </div>
              <Button variant="destructive" size="sm" onClick={() => { setBatchDownloadProgress({ isRunning: false }); toast({ title: 'Parando download...' }); }}>
                <StopCircle className="w-4 h-4 mr-1" />Parar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Simulation Mode */}
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
                  {simulationMode ? `Testando UI sem Electron (${simulationSuccessRate}% sucesso)` : 'Ative para testar downloads sem Electron'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {simulationMode && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="success-rate" className="text-xs text-muted-foreground">Taxa:</Label>
                  <select id="success-rate" value={simulationSuccessRate} onChange={(e) => setSimulationSuccessRate(Number(e.target.value))} className="bg-background border border-input rounded px-2 py-1 text-xs">
                    <option value={100}>100%</option>
                    <option value={80}>80%</option>
                    <option value={50}>50%</option>
                    <option value={20}>20%</option>
                    <option value={0}>0%</option>
                  </select>
                </div>
              )}
              <div className="flex items-center space-x-2">
                <Switch id="simulation-mode" checked={simulationMode} onCheckedChange={setSimulationMode} />
                <Label htmlFor="simulation-mode" className="text-sm">{simulationMode ? 'ON' : 'OFF'}</Label>
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

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="missing" className="gap-2">
            <AlertTriangle className="w-4 h-4" />
            Faltando ({missingState.filteredSongs.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="w-4 h-4" />
            Histórico ({historyState.downloadHistory.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="missing">
          <MissingTab
            searchTerm={missingState.searchTerm}
            setSearchTerm={missingState.setSearchTerm}
            filteredSongs={missingState.filteredSongs}
            groupedByStation={missingState.groupedByStation}
            getSearchUrl={missingState.getSearchUrl}
            openExternalLink={missingState.openExternalLink}
            downloadStatus={downloadStatus}
            onDownload={(id, artist, title) => handleDeezerDownload(id, artist, title)}
            batchIsRunning={batchDownloadProgress.isRunning}
            deemixInstalled={deezerState.deemixInstalled}
            simulationMode={simulationMode}
            deezerEnabled={deezerConfig.enabled}
            deezerArl={deezerConfig.arl}
          />
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab
            downloadHistory={historyState.downloadHistory}
            stats={historyState.stats}
            failedDownloads={historyState.failedDownloads}
            onRetry={handleRetryDownload}
            onRetryAll={handleRetryAllFailed}
            onClearHistory={historyState.handleClearHistory}
            batchIsRunning={batchDownloadProgress.isRunning}
            deemixInstalled={deezerState.deemixInstalled}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
