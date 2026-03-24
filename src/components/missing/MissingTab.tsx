/**
 * MissingTab - Sub-component for the "Músicas Faltando" tab
 * Handles: search, grouped list, individual downloads, external search
 */
import { Music, Search, Download, Trash2, ExternalLink, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRadioStore, MissingSong } from '@/store/radioStore';

interface DownloadStatus {
  [songId: string]: 'idle' | 'downloading' | 'success' | 'error';
}

interface MissingTabProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filteredSongs: MissingSong[];
  groupedByStation: Record<string, MissingSong[]>;
  getSearchUrl: (artist: string, title: string, service: 'deezer' | 'youtube') => string;
  openExternalLink: (url: string) => void;
  downloadStatus: DownloadStatus;
  onDownload: (songId: string, artist: string, title: string) => void;
  batchIsRunning: boolean;
  deemixInstalled: boolean | null;
  simulationMode: boolean;
  deezerEnabled: boolean;
  deezerArl: string;
}

export function MissingTab({
  searchTerm, setSearchTerm,
  filteredSongs, groupedByStation,
  getSearchUrl, openExternalLink,
  downloadStatus, onDownload,
  batchIsRunning, deemixInstalled, simulationMode,
  deezerEnabled, deezerArl,
}: MissingTabProps) {
  const { removeMissingSong } = useRadioStore();

  const getStatusIcon = (songId: string) => {
    const status = downloadStatus[songId];
    switch (status) {
      case 'downloading': return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'success': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error': return <XCircle className="w-4 h-4 text-destructive" />;
      default: return <Download className="w-4 h-4" />;
    }
  };

  const canDownload = simulationMode || (deezerEnabled && deezerArl);

  return (
    <div className="space-y-4">
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

      {/* Stats Summary */}
      <div className="flex items-center gap-4 flex-wrap">
        <Badge variant="destructive" className="text-sm px-3 py-1">
          {filteredSongs.length} Faltando
        </Badge>
        {Object.entries(groupedByStation).map(([station, songs]) => (
          <Badge key={station} variant="outline" className="text-xs">
            {station}: {songs.length}
          </Badge>
        ))}
      </div>

      {/* Song List */}
      <Card className="glass-card">
        <CardContent className="p-0">
          <ScrollArea className="h-[400px]">
            <div className="divide-y divide-border">
              {filteredSongs.map((song) => (
                <div
                  key={song.id}
                  className={`px-4 py-2 flex items-center justify-between hover:bg-secondary/30 transition-colors ${
                    song.status === 'downloaded' ? 'bg-green-500/5' :
                    song.status === 'error' ? 'bg-destructive/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {song.status === 'downloaded' ? (
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    ) : song.status === 'downloading' ? (
                      <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                    ) : song.status === 'error' ? (
                      <XCircle className="w-4 h-4 text-destructive shrink-0" />
                    ) : (
                      <Music className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground text-sm truncate">
                        {song.artist} - {song.title}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">{song.station}</p>
                        {song.urgency && song.urgency !== 'normal' && (
                          <Badge variant="outline" className={`text-[10px] px-1 py-0 ${
                            song.urgency === 'grade' ? 'border-destructive/50 text-destructive' : 'border-amber-500/50 text-amber-500'
                          }`}>
                            {song.urgency === 'grade' ? '🔴 Grade' : '🟡 Seq'}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {canDownload && song.status !== 'downloaded' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-primary hover:text-primary"
                        onClick={() => onDownload(song.id, song.artist, song.title)}
                        disabled={downloadStatus[song.id] === 'downloading' || batchIsRunning || (!simulationMode && deemixInstalled === false)}
                        title={simulationMode ? 'Simular download' : 'Baixar do Deezer'}
                      >
                        {getStatusIcon(song.id)}
                      </Button>
                    )}
                    {song.status === 'downloaded' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-green-500 hover:text-green-600"
                        onClick={() => removeMissingSong(song.id)}
                        title="Remover da lista"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Buscar em serviços">
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-popover border-border">
                        <DropdownMenuItem onClick={() => openExternalLink(getSearchUrl(song.artist, song.title, 'deezer'))}>
                          🎵 Deezer
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openExternalLink(getSearchUrl(song.artist, song.title, 'youtube'))}>
                          ▶️ YouTube
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

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
