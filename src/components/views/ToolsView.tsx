import { useState } from 'react';
import { Wrench, Music, Search, Loader2, BarChart3, FolderOpen } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

interface BpmScanResult {
  total: number;
  withBpm: number;
  withoutBpm: number;
  samples: { filename: string; bpm: number }[];
  bpmDistribution: { range: string; count: number }[];
}

export function ToolsView() {
  const { config } = useRadioStore();
  const { toast } = useToast();
  const [scanFolder, setScanFolder] = useState(config.musicFolders?.[0] || 'C:\\Playlist\\Músicas');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<BpmScanResult | null>(null);
  const [scanProgress, setScanProgress] = useState(0);

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
      if (folder) setScanFolder(folder);
    } catch (err) {
      console.error('Error selecting folder:', err);
    }
  };

  const handleScanBpm = async () => {
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

    if (!scanFolder) {
      toast({
        title: 'Pasta não informada',
        description: 'Selecione uma pasta para escanear.',
        variant: 'destructive',
      });
      return;
    }

    setIsScanning(true);
    setScanResult(null);
    setScanProgress(0);

    try {
      const result = await window.electronAPI.scanBpmTags({ folder: scanFolder });
      
      if (result.success) {
        setScanResult(result);
        toast({
          title: '✅ Scan concluído!',
          description: `${result.withBpm} de ${result.total} arquivos têm BPM nas tags.`,
        });
      } else {
        toast({
          title: 'Erro no scan',
          description: result.error || 'Erro desconhecido.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('BPM scan error:', err);
      toast({
        title: 'Erro no scan',
        description: 'Falha ao escanear a pasta.',
        variant: 'destructive',
      });
    } finally {
      setIsScanning(false);
    }
  };

  const bpmPercentage = scanResult
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
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            Escaneia arquivos MP3 na pasta e verifica quais possuem informação de BPM nas tags ID3. 
            Útil para decidir se vale a pena usar BPM como critério na montagem da grade de sábado.
          </p>

          {/* Folder selection */}
          <div className="space-y-2">
            <Label>Pasta para escanear</Label>
            <div className="flex gap-2">
              <Input
                value={scanFolder}
                onChange={(e) => setScanFolder(e.target.value)}
                placeholder="C:\Playlist\Músicas"
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={handleSelectFolder}
                title="Selecionar pasta"
              >
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Scan button */}
          <Button
            onClick={handleScanBpm}
            disabled={isScanning || !scanFolder}
            className="w-full"
          >
            {isScanning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Escaneando...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Escanear BPM nos Arquivos
              </>
            )}
          </Button>

          {isScanning && (
            <div className="space-y-2">
              <Progress value={scanProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Analisando tags ID3...</p>
            </div>
          )}

          {/* Results */}
          {scanResult && (
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
