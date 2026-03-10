import { useState, useMemo } from 'react';
import { Music, Search, Loader2, BarChart3, Tag, Disc3, ArrowUpDown, Filter } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface SongMeta {
  filename: string;
  artist: string;
  title: string;
  bpm: number | null;
  genre: string | null;
  folder: string;
}

interface GenreSummary {
  genre: string;
  count: number;
}

type SortKey = 'artist' | 'title' | 'bpm' | 'genre';
type SortDir = 'asc' | 'desc';

const GENRE_COLORS: Record<string, string> = {
  'Pop': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'Rock': 'bg-red-500/20 text-red-400 border-red-500/30',
  'Sertanejo': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'Funk': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'Eletrônica': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'Electronic': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'Hip-Hop': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'R&B': 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  'Country': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Jazz': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Reggae': 'bg-green-500/20 text-green-400 border-green-500/30',
  'MPB': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'Pagode': 'bg-lime-500/20 text-lime-400 border-lime-500/30',
  'Gospel': 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  'Forró': 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

function getGenreClass(genre: string | null) {
  if (!genre) return 'bg-muted/40 text-muted-foreground border-border';
  for (const [key, cls] of Object.entries(GENRE_COLORS)) {
    if (genre.toLowerCase().includes(key.toLowerCase())) return cls;
  }
  return 'bg-accent/20 text-accent border-accent/30';
}

export function LibraryBrowserView() {
  const { config } = useRadioStore();
  const { toast } = useToast();
  const [songs, setSongs] = useState<SongMeta[]>([]);
  const [genreSummary, setGenreSummary] = useState<GenreSummary[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [genreFilter, setGenreFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('artist');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleScan = async () => {
    if (!window.electronAPI?.scanLibraryMetadata) {
      toast({ title: '⚠️ Disponível apenas no Electron', variant: 'destructive' });
      return;
    }
    setIsScanning(true);
    setSongs([]);
    setGenreSummary([]);
    try {
      const result = await window.electronAPI.scanLibraryMetadata({ musicFolders: config.musicFolders });
      if (result.success) {
        setSongs(result.songs);
        setGenreSummary(result.genreSummary);
        setScannedCount(result.scanned);
        toast({
          title: '✅ Biblioteca escaneada',
          description: `${result.songs.length} músicas indexadas, ${result.genreSummary.length} gêneros encontrados`,
        });
      }
    } catch (err) {
      toast({ title: '❌ Erro ao escanear', description: String(err), variant: 'destructive' });
    } finally {
      setIsScanning(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const filteredSongs = useMemo(() => {
    let list = songs;
    if (genreFilter !== 'all') {
      if (genreFilter === 'none') list = list.filter(s => !s.genre);
      else list = list.filter(s => s.genre === genreFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        s.artist.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.filename.toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'bpm') {
        cmp = (a.bpm || 0) - (b.bpm || 0);
      } else {
        const va = (a[sortKey] || '').toLowerCase();
        const vb = (b[sortKey] || '').toLowerCase();
        cmp = va.localeCompare(vb);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [songs, genreFilter, searchQuery, sortKey, sortDir]);

  const bpmStats = useMemo(() => {
    const withBpm = songs.filter(s => s.bpm && s.bpm > 0);
    if (withBpm.length === 0) return null;
    const avg = Math.round(withBpm.reduce((s, x) => s + (x.bpm || 0), 0) / withBpm.length);
    const min = Math.min(...withBpm.map(s => s.bpm!));
    const max = Math.max(...withBpm.map(s => s.bpm!));
    return { count: withBpm.length, avg, min, max };
  }, [songs]);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Biblioteca Musical</h2>
          <p className="text-muted-foreground text-sm">Visualize BPM, gênero e metadados de toda a biblioteca</p>
        </div>
        <Button onClick={handleScan} disabled={isScanning} className="shrink-0">
          {isScanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Music className="w-4 h-4 mr-2" />}
          {isScanning ? 'Escaneando...' : songs.length > 0 ? 'Re-escanear' : 'Escanear Biblioteca'}
        </Button>
      </div>

      {/* Genre Summary Cards */}
      {genreSummary.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Tag className="w-4 h-4" /> Distribuição por Gênero
          </h3>
          <div className="flex flex-wrap gap-2">
            {genreSummary.slice(0, 20).map(g => (
              <button
                key={g.genre}
                onClick={() => setGenreFilter(genreFilter === g.genre ? 'all' : g.genre)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  genreFilter === g.genre
                    ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                    : ''
                } ${getGenreClass(g.genre)}`}
              >
                {g.genre}
                <span className="opacity-70">({g.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats Row */}
      {songs.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="glass-card border-primary/20">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-primary">{songs.length}</p>
              <p className="text-xs text-muted-foreground">Total Músicas</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-accent/20">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-accent">{genreSummary.length}</p>
              <p className="text-xs text-muted-foreground">Gêneros</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-green-500/20">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{bpmStats?.count || 0}</p>
              <p className="text-xs text-muted-foreground">Com BPM</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-amber-500/20">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">
                {bpmStats ? `${bpmStats.min}-${bpmStats.max}` : '—'}
              </p>
              <p className="text-xs text-muted-foreground">Faixa BPM</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search + Filter */}
      {songs.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por artista, título ou arquivo..."
              className="pl-9"
            />
          </div>
          <Select value={genreFilter} onValueChange={setGenreFilter}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Filtrar gênero" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os gêneros</SelectItem>
              <SelectItem value="none">Sem gênero</SelectItem>
              {genreSummary.map(g => (
                <SelectItem key={g.genre} value={g.genre}>{g.genre} ({g.count})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Songs Table */}
      {songs.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="border-b border-border py-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Disc3 className="w-4 h-4 text-primary" />
                {filteredSongs.length} música{filteredSongs.length !== 1 ? 's' : ''}
                {genreFilter !== 'all' && <Badge variant="secondary" className="text-[10px]">{genreFilter === 'none' ? 'Sem gênero' : genreFilter}</Badge>}
              </span>
            </CardTitle>
          </CardHeader>
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('artist')}>
                    <span className="flex items-center gap-1">Artista <ArrowUpDown className="w-3 h-3" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('title')}>
                    <span className="flex items-center gap-1">Título <ArrowUpDown className="w-3 h-3" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none w-[80px]" onClick={() => toggleSort('bpm')}>
                    <span className="flex items-center gap-1">BPM <ArrowUpDown className="w-3 h-3" /></span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none w-[150px]" onClick={() => toggleSort('genre')}>
                    <span className="flex items-center gap-1">Gênero <ArrowUpDown className="w-3 h-3" /></span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSongs.slice(0, 500).map((song, idx) => (
                  <TableRow key={`${song.filename}-${idx}`} className="hover:bg-secondary/30">
                    <TableCell className="font-medium text-sm max-w-[200px] truncate">{song.artist}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[250px] truncate">{song.title}</TableCell>
                    <TableCell className="text-sm font-mono text-center">
                      {song.bpm ? (
                        <span className="text-green-400">{song.bpm}</span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${getGenreClass(song.genre)}`}>
                        {song.genre || 'N/A'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredSongs.length > 500 && (
              <div className="p-3 text-center text-xs text-muted-foreground">
                Mostrando 500 de {filteredSongs.length} músicas. Use a busca para filtrar.
              </div>
            )}
          </ScrollArea>
        </Card>
      )}

      {/* Empty state */}
      {songs.length === 0 && !isScanning && (
        <Card className="glass-card border-dashed border-2 border-muted">
          <CardContent className="p-12 text-center">
            <Music className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground mb-2">Nenhuma música escaneada</h3>
            <p className="text-sm text-muted-foreground/60 mb-4">
              Clique em "Escanear Biblioteca" para indexar todas as músicas das pastas configuradas
              e visualizar BPM, gênero e metadados.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
