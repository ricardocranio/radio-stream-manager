import { useState, useEffect, useCallback } from 'react';
import { Shield, RotateCcw, Trash2, RefreshCw, Music, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore } from '@/store/radioStore';
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

interface QuarantinedFile {
  path: string;
  parentFolder: string;
  filename: string;
  fileArtist: string;
  fileTitle: string;
  id3Artist: string;
  id3Title: string;
  sizeMB: string;
  date: number;
}

export function QuarantineCard() {
  const [files, setFiles] = useState<QuarantinedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const config = useRadioStore((s) => s.config);
  const deezerConfig = useRadioStore((s) => s.deezerConfig);
  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

  const loadFiles = useCallback(async () => {
    if (!isElectron || !(window.electronAPI as any)?.listQuarantinedFiles) return;
    setLoading(true);
    try {
      const folders = [
        ...(config.musicFolders || []),
        deezerConfig.downloadFolder,
      ].filter(Boolean);
      const result = await (window.electronAPI as any).listQuarantinedFiles({ folders: [...new Set(folders)] });
      if (result?.success) {
        setFiles(result.files || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [config.musicFolders, deezerConfig.downloadFolder, isElectron]);

  useEffect(() => {
    loadFiles();
    const interval = setInterval(loadFiles, 5 * 60 * 1000); // Refresh every 5 min
    return () => clearInterval(interval);
  }, [loadFiles]);

  const handleRestore = async (file: QuarantinedFile) => {
    try {
      const result = await (window.electronAPI as any).restoreQuarantinedFile({ filePath: file.path });
      if (result?.success) {
        toast({ title: '✅ Restaurado', description: `${file.filename} voltou para a biblioteca` });
        setFiles(prev => prev.filter(f => f.path !== file.path));
      } else {
        toast({ title: 'Erro', description: result?.error || 'Falha ao restaurar', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Erro', description: String(e), variant: 'destructive' });
    }
  };

  const handleDelete = async (file: QuarantinedFile) => {
    try {
      const result = await (window.electronAPI as any).deleteQuarantinedFile({ filePath: file.path });
      if (result?.success) {
        toast({ title: '🗑️ Deletado', description: `${file.filename} removido definitivamente` });
        setFiles(prev => prev.filter(f => f.path !== file.path));
      } else {
        toast({ title: 'Erro', description: result?.error || 'Falha ao deletar', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Erro', description: String(e), variant: 'destructive' });
    }
  };

  const handleDeleteAll = async () => {
    let deleted = 0;
    for (const file of files) {
      try {
        const result = await (window.electronAPI as any).deleteQuarantinedFile({ filePath: file.path });
        if (result?.success) deleted++;
      } catch {}
    }
    toast({ title: '🗑️ Limpeza concluída', description: `${deleted} arquivo(s) deletado(s)` });
    loadFiles();
  };

  if (!isElectron) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-destructive" />
            Quarentena ID3
            {files.length > 0 && (
              <Badge variant="destructive" className="text-xs">
                {files.length}
              </Badge>
            )}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={loadFiles} disabled={loading} className="h-7 w-7 p-0">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {files.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive">
                    <Trash2 className="w-3 h-3 mr-1" /> Limpar tudo
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Deletar todos os arquivos em quarentena?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Essa ação é irreversível. {files.length} arquivo(s) serão removidos permanentemente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Deletar tudo
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Music className="w-4 h-4" />
            Nenhum arquivo em quarentena
          </div>
        ) : (
          <ScrollArea className="max-h-[280px]">
            <div className="space-y-2">
              {files.map((file) => (
                <div key={file.path} className="border border-border rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {file.fileArtist} - {file.fileTitle}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <AlertTriangle className="w-3 h-3 text-destructive shrink-0" />
                        <p className="text-xs text-destructive truncate">
                          ID3: {file.id3Artist || '?'} - {file.id3Title || '?'}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {file.sizeMB} MB
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-primary hover:text-primary"
                        onClick={() => handleRestore(file)}
                        title="Restaurar para biblioteca"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            title="Deletar definitivamente"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Deletar arquivo?</AlertDialogTitle>
                            <AlertDialogDescription>
                              "{file.filename}" será removido permanentemente.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(file)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Deletar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
