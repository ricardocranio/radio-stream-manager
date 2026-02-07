import { useState, useEffect } from 'react';
import { Wrench, Music, Search, Loader2, BarChart3, FolderOpen, Plus, X, Database, RefreshCw, Trash2 } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { useBpmScanStore, loadBpmCacheFromDisk, saveBpmCacheToDisk } from '@/store/bpmScanStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

export function ToolsView() {
  const { config } = useRadioStore();
  const { toast } = useToast();
  
  const { isScanning, scanResult, error, cacheSize, cacheLoaded, lastCacheUpdate, startScan, finishScan, failScan, updateCache, clearCache, getCacheStats } = useBpmScanStore();
  
  const [scanFolders, setScanFolders] = useState<string[]>(() => {
    const folders = config.musicFolders?.filter(Boolean) || [];
    return folders.length > 0 ? folders : ['C:\\Playlist\\Músicas'];
  });
  const [newFolder, setNewFolder] = useState('');

  // Load cache on mount
  useEffect(() => {
    if (isElectron && config.gradeFolder) {
      loadBpmCacheFromDisk(config.gradeFolder);
    }
  }, [config.gradeFolder]);

  const handleAddFolder = (folderPath?: string) => {
    const folder = folderPath || newFolder.trim();
    if (!folder) return;
    if (scanFolders.includes(folder)) {
      toast({ title: 'Pasta já adicionada', variant: 'destructive' });
      return;
    }
    setScanFolders(prev => [...prev, folder]);
    setNewFolder('');
  };

  const handleSelectFolder = async () => {
    if (!isElectron || !window.electronAPI?.selectFolder) {
      toast({ title: '🖥️ Recurso Desktop', description: 'A seleção de pasta só funciona no app desktop.', variant: 'destructive' });
      return;
    }
    try {
      const folder = await window.electronAPI.selectFolder();
      if (folder) handleAddFolder(folder);
    } catch (err) {
      console.error('Error selecting folder:', err);
    }
  };

  const handleRemoveFolder = (index: number) => {
    setScanFolders(prev => prev.filter((_, i) => i !== index));
  };

  const handleScanBpm = () => {
    if (!isElectron) {
      toast({ title: '🖥️ Recurso Desktop', description: 'O scanner de BPM só funciona no app desktop (Electron).', variant: 'destructive' });
      return;
    }
    if (!window.electronAPI?.scanBpmTags) {
      toast({ title: 'Atualização necessária', description: 'Atualize o app Electron para usar o scanner de BPM.', variant: 'destructive' });
      return;
    }
    if (scanFolders.length === 0) {
      toast({ title: 'Nenhuma pasta', description: 'Adicione pelo menos uma pasta para escanear.', variant: 'destructive' });
      return;
    }

    startScan();
    toast({
      title: '🔍 Scanner iniciado',
      description: `Escaneando ${scanFolders.length} pasta${scanFolders.length !== 1 ? 's' : ''} em segundo plano...`,
    });

    window.electronAPI.scanBpmTags({ folders: scanFolders })
      .then((result) => {
        if (result.success) {
          finishScan(result);

          // Build cache entries from scan samples
          const newEntries: Record<string, { bpm: number; scannedAt: string }> = {};
          if (result.samples) {
            result.samples.forEach((s) => {
              newEntries[s.filename] = { bpm: s.bpm, scannedAt: new Date().toISOString() };
            });
          }
          
          // Update in-memory cache
          if (Object.keys(newEntries).length > 0) {
            updateCache(newEntries);
          }

          // Persist to disk
          if (config.gradeFolder) {
            saveBpmCacheToDisk(config.gradeFolder);
          }

          console.log(`[BPM-SCAN] ✅ Concluído: ${result.withBpm}/${result.total} com BPM`);
        } else {
          failScan(result.error || 'Erro desconhecido');
        }
      })
      .catch((err) => {
        console.error('[BPM-SCAN] ❌ Falha:', err);
        failScan('Falha ao escanear as pastas.');
      });
  };

  const handleClearCache = async () => {
    clearCache();
    if (isElectron && config.gradeFolder) {
      await saveBpmCacheToDisk(config.gradeFolder);
    }
    toast({ title: 'Cache limpo', description: 'O cache de BPM foi removido.' });
  };

  const bpmPercentage = scanResult && scanResult.total > 0
    ? Math.round((scanResult.withBpm / scanResult.total) * 100)
    : 0;

  const cacheStats = getCacheStats();

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Wrench className="w-6 h-6 text-primary" />
          Ferramentas
        </h2>
        <p className="text-muted-foreground">Utilitários e diagnósticos do sistema</p>
      </div>

      {/* BPM Cache Status Card */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="w-4 h-4 text-primary" />
            Cache de BPM
            {cacheSize > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-green-500/10 text-green-500 rounded-full">
                {cacheSize} músicas
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {cacheSize > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-secondary/30 border border-border text-center">
                  <p className="text-lg font-bold text-foreground">{cacheStats.total}</p>
                  <p className="text-xs text-muted-foreground">Músicas no cache</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-border text-center">
                  <p className="text-lg font-bold text-primary">{cacheStats.avgBpm}</p>
                  <p className="text-xs text-muted-foreground">BPM médio</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-border text-center">
                  <p className="text-lg font-bold text-foreground">{cacheStats.minBpm}–{cacheStats.maxBpm}</p>
                  <p className="text-xs text-muted-foreground">Faixa de BPM</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-border text-center">
                  <p className="text-lg font-bold text-foreground">
                    {useBpmScanStore.getState().getAgitadas(120).length}
                  </p>
                  <p className="text-xs text-muted-foreground">Agitadas (≥120)</p>
                </div>
              </div>
              {lastCacheUpdate && (
                <p className="text-xs text-muted-foreground">
                  Última atualização: {new Date(lastCacheUpdate).toLocaleString('pt-BR')}
                </p>
              )}
              <Button variant="outline" size="sm" onClick={handleClearCache} className="gap-2">
                <Trash2 className="w-3 h-3" />
                Limpar Cache
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {cacheLoaded 
                ? 'Nenhum dado de BPM em cache. Execute o scanner abaixo para popular.'
                : 'Carregando cache...'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* BPM Scanner Card */}
      <Card className="glass-card border-primary/20">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Scanner de BPM (Tags ID3)
            {isScanning && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full animate-pulse">
                Em andamento...
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            Escaneia arquivos MP3 nas pastas em segundo plano e salva os BPMs no cache local. 
            O cache é carregado automaticamente na inicialização e usado pelo montador de grade.
          </p>

          {/* Folders list */}
          <div className="space-y-3">
            <Label>Pastas para escanear ({scanFolders.length})</Label>
            
            {scanFolders.length > 0 && (
              <div className="space-y-2">
                {scanFolders.map((folder, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30 border border-border">
                    <FolderOpen className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-sm text-foreground truncate flex-1">{folder}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => handleRemoveFolder(index)} disabled={isScanning}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="Adicionar pasta..."
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()}
                disabled={isScanning}
              />
              <Button variant="outline" onClick={() => handleAddFolder()} disabled={!newFolder.trim() || isScanning} title="Adicionar pasta digitada">
                <Plus className="w-4 h-4" />
              </Button>
              <Button variant="outline" onClick={handleSelectFolder} title="Selecionar pasta" disabled={isScanning}>
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Scan button */}
          <Button onClick={handleScanBpm} disabled={isScanning || scanFolders.length === 0} className="w-full">
            {isScanning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Escaneando em segundo plano...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                {cacheSize > 0 ? 'Atualizar Cache de BPM' : 'Escanear BPM'} ({scanFolders.length} pasta{scanFolders.length !== 1 ? 's' : ''})
              </>
            )}
          </Button>

          {isScanning && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
                <span className="text-sm text-primary font-medium">Analisando tags ID3 em segundo plano...</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Você pode navegar para outras telas. Os resultados serão salvos no cache automaticamente.
              </p>
            </div>
          )}

          {error && !isScanning && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <p className="text-sm text-destructive">❌ {error}</p>
            </div>
          )}

          {/* Results */}
          {scanResult && !isScanning && (
            <div className="space-y-4 animate-fade-in">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-secondary/30 border border-border text-center">
                  <p className="text-2xl font-bold text-foreground">{scanResult.total}</p>
                  <p className="text-xs text-muted-foreground">Total de Arquivos</p>
                </div>
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
                  <p className="text-2xl font-bold text-green-500">{scanResult.withBpm}</p>
                  <p className="text-xs text-muted-foreground">Com BPM</p>
                </div>
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-center">
                  <p className="text-2xl font-bold text-amber-500">{scanResult.withoutBpm}</p>
                  <p className="text-xs text-muted-foreground">Sem BPM</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cobertura de BPM</span>
                  <span className="font-bold text-foreground">{bpmPercentage}%</span>
                </div>
                <Progress value={bpmPercentage} className="h-3" />
                <p className="text-xs text-muted-foreground">
                  {bpmPercentage >= 70
                    ? '✅ Boa cobertura! Vale a pena usar BPM para filtrar músicas.'
                    : bpmPercentage >= 40
                    ? '⚠️ Cobertura parcial. Pode funcionar como critério complementar.'
                    : '❌ Pouca cobertura. Recomenda-se usar pastas separadas por estilo.'}
                </p>
              </div>

              {scanResult.bpmDistribution && scanResult.bpmDistribution.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Distribuição de BPM</Label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {scanResult.bpmDistribution.map((item) => (
                      <div key={item.range} className="p-3 rounded-lg bg-secondary/30 border border-border text-center">
                        <p className="text-sm font-bold text-primary">{item.count}</p>
                        <p className="text-xs text-muted-foreground">{item.range}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {scanResult.samples && scanResult.samples.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Exemplos encontrados</Label>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="max-h-48 overflow-y-auto">
                      {scanResult.samples.map((sample, idx) => (
                        <div key={idx} className="flex items-center justify-between px-4 py-2 text-sm border-b border-border last:border-0 hover:bg-secondary/30">
                          <span className="text-foreground truncate flex-1 flex items-center gap-2">
                            <Music className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            {sample.filename}
                          </span>
                          <span className="text-primary font-mono font-bold ml-4">{sample.bpm} BPM</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Placeholder for future tools */}
      <Card className="glass-card border-dashed border-muted-foreground/30">
        <CardContent className="p-8 text-center">
          <Wrench className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Mais ferramentas serão adicionadas aqui no futuro.</p>
        </CardContent>
      </Card>
    </div>
  );
}
