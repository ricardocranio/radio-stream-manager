import { AlertTriangle, Download, Trash2, RefreshCw, Music, Search } from 'lucide-react';
import { useState } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export function MissingView() {
  const { missingSongs, stations } = useRadioStore();
  const [searchTerm, setSearchTerm] = useState('');

  // Demo missing songs
  const demoMissing = [
    { id: '1', title: 'Bohemian Rhapsody', artist: 'Queen', station: 'Metro', timestamp: new Date(), status: 'missing' as const },
    { id: '2', title: 'Shallow', artist: 'Lady Gaga', station: 'Disney FM', timestamp: new Date(), status: 'missing' as const },
    { id: '3', title: 'Blinding Lights', artist: 'The Weeknd', station: 'Metro', timestamp: new Date(), status: 'missing' as const },
    { id: '4', title: 'Dance Monkey', artist: 'Tones and I', station: 'Disney FM', timestamp: new Date(), status: 'missing' as const },
    { id: '5', title: 'Watermelon Sugar', artist: 'Harry Styles', station: 'BH FM', timestamp: new Date(), status: 'missing' as const },
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
          <Button variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Verificar Novamente
          </Button>
          <Button variant="destructive">
            <Trash2 className="w-4 h-4 mr-2" />
            Limpar Lista
          </Button>
        </div>
      </div>

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
                    className="p-4 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                        <Music className="w-5 h-5 text-destructive" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{song.title}</p>
                        <p className="text-sm text-muted-foreground">{song.artist}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="text-primary hover:text-primary">
                      <Download className="w-4 h-4" />
                    </Button>
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
