import { useState } from 'react';
import { Wrench, Music, Search, Loader2, BarChart3, FolderOpen, Plus, X } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { useBpmScanStore } from '@/store/bpmScanStore';
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
  
  const { isScanning, scanResult, error, startScan, finishScan, failScan } = useBpmScanStore();
  
  // Local folder management state
  const [scanFolders, setScanFolders] = useState<string[]>(() => {
    const folders = config.musicFolders?.filter(Boolean) || [];
    return folders.length > 0 ? folders : ['C:\\Playlist\\Músicas'];
  });
  const [newFolder, setNewFolder] = useState('');

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
      toast({
        title: '🖥️ Recurso Desktop',
        description: 'A seleção de pasta só funciona no app desktop.',
        variant: 'destructive',
      });
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
      toast({
        title: '🖥️ Recurso Desktop',
        description: 'O scanner de BPM só funciona no app desktop (Electron).',
        variant: 'destructive',
      });
      return;
    }

    if (!window.electronAPI?.scanBpmTags) {
      toast({
        title: 'Atualização necessária',
        description: 'Atualize o app Electron para usar o scanner de BPM.',
        variant: 'destructive',
      });
      return;
    }

    if (scanFolders.length === 0) {
      toast({
        title: 'Nenhuma pasta',
        description: 'Adicione pelo menos uma pasta para escanear.',
        variant: 'destructive',
      });
      return;
    }

    // Start scan in background (fire-and-forget)
    startScan();
    toast({
      title: '🔍 Scanner iniciado',
      description: `Escaneando ${scanFolders.length} pasta${scanFolders.length !== 1 ? 's' : ''} em segundo plano...`,
    });

    // Run async without blocking
    window.electronAPI.scanBpmTags({ folders: scanFolders })
      .then((result) => {
        if (result.success) {
          finishScan(result);
          // Only toast if still on this view - user may have navigated away
          console.log(`[BPM-SCAN] ✅ Concluído: ${result.withBpm}/${result.total} com BPM`);
        } else {
          failScan(result.error || 'Erro desconhecido');
          console.error('[BPM-SCAN] ❌ Erro:', result.error);
        }
      })
      .catch((err) => {
        console.error('[BPM-SCAN] ❌ Falha:', err);
        failScan('Falha ao escanear as pastas.');
      });
  };

  const bpmPercentage = scanResult && scanResult.total > 0
    ? Math.round((scanResult.withBpm / scanResult.total) * 100)
    : 0;

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Wrench className="w-6 h-6 text-primary" />
          Ferramentas
        </h2>
        <p className="text-muted-foreground">Utilitários e diagnósticos do sistema</p>
      </div>

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
            {scanResult && !isScanning && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-green-500/10 text-green-500 rounded-full">
                Concluído
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            Escaneia arquivos MP3 nas pastas em segundo plano e verifica quais possuem informação de BPM nas tags ID3. 
            Você pode navegar para outras telas enquanto o scan roda.
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={() => handleRemoveFolder(index)}
                      disabled={isScanning}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add folder */}
            <div className="flex gap-2">
              <Input
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="Adicionar pasta..."
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()}
                disabled={isScanning}
              />
              <Button
                variant="outline"
                onClick={() => handleAddFolder()}
                disabled={!newFolder.trim() || isScanning}
                title="Adicionar pasta digitada"
              >
                <Plus className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                onClick={handleSelectFolder}
                title="Selecionar pasta"
                disabled={isScanning}
              >
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Scan button */}
          <Button
            onClick={handleScanBpm}
            disabled={isScanning || scanFolders.length === 0}
            className="w-full"
          >
            {isScanning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Escaneando em segundo plano...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Escanear BPM em {scanFolders.length} pasta{scanFolders.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>

          {isScanning && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
                <span className="text-sm text-primary font-medium">
                  Analisando tags ID3 em segundo plano...
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Você pode navegar para outras telas. Os resultados aparecerão quando voltar.
              </p>
            </div>
          )}

          {/* Error */}
          {error && !isScanning && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <p className="text-sm text-destructive">❌ {error}</p>
            </div>
          )}

          {/* Results */}
          {scanResult && !isScanning && (
            <div className="space-y-4 animate-fade-in">
              {/* Summary stats */}
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

              {/* Percentage bar */}
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

              {/* BPM Distribution */}
              {scanResult.bpmDistribution && scanResult.bpmDistribution.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Distribuição de BPM</Label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {scanResult.bpmDistribution.map((item) => (
                      <div
                        key={item.range}
                        className="p-3 rounded-lg bg-secondary/30 border border-border text-center"
                      >
                        <p className="text-sm font-bold text-primary">{item.count}</p>
                        <p className="text-xs text-muted-foreground">{item.range}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sample files with BPM */}
              {scanResult.samples && scanResult.samples.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Exemplos encontrados</Label>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="max-h-48 overflow-y-auto">
                      {scanResult.samples.map((sample, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between px-4 py-2 text-sm border-b border-border last:border-0 hover:bg-secondary/30"
                        >
                          <span className="text-foreground truncate flex-1 flex items-center gap-2">
                            <Music className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            {sample.filename}
                          </span>
                          <span className="text-primary font-mono font-bold ml-4">
                            {sample.bpm} BPM
                          </span>
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
          <p className="text-sm text-muted-foreground">
            Mais ferramentas serão adicionadas aqui no futuro.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
