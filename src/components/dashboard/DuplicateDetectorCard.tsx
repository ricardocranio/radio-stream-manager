import { useState } from 'react';
import { Copy, Loader2, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRadioStore } from '@/store/radioStore';
import { useToast } from '@/hooks/use-toast';

interface Duplicate {
  key: string;
  locations: string[];
}

export function DuplicateDetectorCard() {
  const { config } = useRadioStore();
  const { toast } = useToast();
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

  const handleScan = async () => {
    if (!window.electronAPI?.scanLibraryMetadata) {
      toast({ title: '⚠️ Disponível apenas no desktop', variant: 'destructive' });
      return;
    }

    setIsScanning(true);
    setDuplicates([]);

    try {
      const allFolders = (config.musicFolders || []).filter(Boolean) as string[];
      if (allFolders.length === 0) {
        toast({ title: '⚠️ Nenhuma pasta configurada', variant: 'destructive' });
        setIsScanning(false);
        return;
      }

      const result = await window.electronAPI.scanLibraryMetadata({ musicFolders: allFolders });
      if (!result?.success || !result.songs?.length) {
        toast({ title: '✅ Nenhum arquivo encontrado' });
        setIsScanning(false);
        setScanned(true);
        return;
      }

      // Group by normalized artist+title
      const map = new Map<string, string[]>();
      for (const song of result.songs as Array<{ artist: string; title: string; folder: string; filename: string }>) {
        const key = `${(song.artist || '').toLowerCase().trim()} - ${(song.title || '').toLowerCase().trim()}`;
        if (key === ' - ' || key.includes('desconhecido')) continue;
        const location = `${song.folder}/${song.filename}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(location);
      }

      const dups: Duplicate[] = [];
      map.forEach((locations, key) => {
        if (locations.length > 1) dups.push({ key, locations });
      });

      dups.sort((a, b) => b.locations.length - a.locations.length);
      setDuplicates(dups.slice(0, 20));
      setScanned(true);

      toast({
        title: dups.length > 0 ? `⚠️ ${dups.length} duplicata(s) encontrada(s)` : '✅ Nenhuma duplicata',
        description: `${result.songs.length} arquivos escaneados`,
      });
    } catch (err) {
      toast({ title: '❌ Erro', description: String(err), variant: 'destructive' });
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <Card className="glass-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Copy className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Detector de Duplicatas</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={isScanning}
            className="text-xs gap-1.5"
          >
            {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {isScanning ? 'Escaneando...' : 'Escanear'}
          </Button>
        </div>

        {scanned && duplicates.length === 0 && (
          <p className="text-xs text-success">✅ Nenhuma duplicata encontrada no acervo</p>
        )}

        {duplicates.length > 0 && (
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {duplicates.map((d, i) => (
              <div key={i} className="text-xs p-2 rounded bg-amber-500/5 border border-amber-500/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-foreground truncate">{d.key}</span>
                  <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 shrink-0 ml-2">
                    {d.locations.length}x
                  </Badge>
                </div>
                {d.locations.map((loc, j) => (
                  <p key={j} className="text-muted-foreground truncate text-[10px]">📂 {loc}</p>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
