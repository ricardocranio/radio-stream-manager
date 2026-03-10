import { useState, useEffect, useCallback } from 'react';
import { Tags, Loader2, CheckCircle2, Music, FileText, Wrench, FolderOpen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useRadioStore } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useToast } from '@/hooks/use-toast';

interface FixProgress {
  scanned: number;
  renamed: number;
  current: string;
}

export function Id3ActivityCard() {
  const { config } = useRadioStore();
  const dailyStats = useAutoDownloadStore((s) => s.dailyStats);
  const activeDownload = useAutoDownloadStore((s) => s.activeDownload);
  const { toast } = useToast();

  const [isFixing, setIsFixing] = useState(false);
  const [fixProgress, setFixProgress] = useState<FixProgress | null>(null);
  const [fixResult, setFixResult] = useState<{ scanned: number; renamed: number; errors: number; purged: number } | null>(null);

  // Track cumulative ID3 processed files (downloads trigger ID3 reads)
  const id3ProcessedToday = dailyStats.downloaded + dailyStats.skipped;

  const handleScanFix = useCallback(async () => {
    if (!window.electronAPI?.scanFixLibrary) {
      toast({ title: '⚠️ Disponível apenas no desktop', variant: 'destructive' });
      return;
    }
    setIsFixing(true);
    setFixProgress(null);
    setFixResult(null);

    window.electronAPI.onLibFixProgress?.((progress) => {
      setFixProgress(progress);
    });

    try {
      const result = await window.electronAPI.scanFixLibrary({ musicFolders: config.musicFolders });
      setFixResult({ scanned: result.scanned, renamed: result.renamed, errors: result.errors, purged: result.purged || 0 });
      setFixProgress(null);
      toast({
        title: '✅ ID3 Scan Completo',
        description: `${result.scanned} escaneados · ${result.renamed} renomeados · ${result.errors} erros`,
      });
    } catch (err) {
      toast({ title: '❌ Erro no scan ID3', description: String(err), variant: 'destructive' });
    } finally {
      setIsFixing(false);
    }
  }, [config.musicFolders, toast]);

  // Clear result after 30s
  useEffect(() => {
    if (fixResult) {
      const timer = setTimeout(() => setFixResult(null), 30000);
      return () => clearTimeout(timer);
    }
  }, [fixResult]);

  const isActive = isFixing || !!activeDownload;

  return (
    <Card className="glass-card border-indigo-500/20 bg-gradient-to-r from-indigo-500/5 to-transparent">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          {/* Left: Icon + Info */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-indigo-500/20' : 'bg-indigo-500/10'}`}>
              {isFixing ? (
                <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
              ) : (
                <Tags className="w-5 h-5 text-indigo-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-foreground text-sm">Sistema ID3</span>
                {isActive ? (
                  <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 text-[10px]">
                    <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />
                    Processando
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-500">
                    <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                    Ativo
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Leitura automática de Artist, Title, Genre e BPM das tags ID3v2
              </p>
            </div>
          </div>

          {/* Right: Stats + Action */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Counters */}
            <div className="flex items-center gap-3 text-center">
              <div>
                <p className="text-lg font-bold font-mono text-indigo-400 tabular-nums">{id3ProcessedToday}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">ID3 Hoje</p>
              </div>
              {fixResult && (
                <div>
                  <p className="text-lg font-bold font-mono text-emerald-400 tabular-nums">{fixResult.renamed}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Renomeados</p>
                </div>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleScanFix}
              disabled={isFixing || !window.electronAPI?.scanFixLibrary}
              className="gap-1.5 text-xs border-indigo-500/30 hover:bg-indigo-500/10"
            >
              {isFixing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wrench className="w-3.5 h-3.5" />
              )}
              Scan ID3
            </Button>
          </div>
        </div>

        {/* Fix Progress */}
        {isFixing && fixProgress && (
          <div className="mt-3 space-y-2 p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Escaneando biblioteca...</span>
              <span className="font-mono text-indigo-400 font-bold">
                {fixProgress.scanned} escaneados · {fixProgress.renamed} renomeados
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Music className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="text-muted-foreground truncate">{fixProgress.current}</span>
            </div>
          </div>
        )}

        {/* Active Download ID3 */}
        {activeDownload && !isFixing && (
          <div className="mt-3 flex items-center gap-2 text-xs p-2 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
            <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0 animate-pulse" />
            <span className="text-muted-foreground">Lendo ID3:</span>
            <span className="text-foreground font-medium truncate">
              {activeDownload.artist} - {activeDownload.title}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
