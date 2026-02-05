import { Music, Radio, Clock, Download, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

export interface ScrapedSong {
  id: string;
  title: string;
  artist: string;
  station_name: string;
  scraped_at: string;
  is_now_playing: boolean;
  source: string | null;
}

export interface DownloadStatus {
  [songId: string]: 'idle' | 'downloading' | 'success' | 'error' | 'exists';
}

interface CapturedSongsListProps {
  songs: ScrapedSong[];
  isLoading: boolean;
  downloadStatus: DownloadStatus;
  onDownloadSong: (song: ScrapedSong) => void;
}

export function CapturedSongsList({ 
  songs, 
  isLoading, 
  downloadStatus, 
  onDownloadSong 
}: CapturedSongsListProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Music className="w-5 h-5" />
            Histórico de Músicas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (songs.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Music className="w-5 h-5" />
            Histórico de Músicas (0)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Music className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhuma música encontrada</h3>
            <p className="text-muted-foreground">
              Aguardando captura de músicas. Verifique se o monitoramento está ativo.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Music className="w-5 h-5" />
          Histórico de Músicas ({songs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {songs.map((song, index) => (
            <div
              key={song.id}
              className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-sm font-mono text-muted-foreground w-8">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{song.title}</p>
                  <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="hidden sm:flex">
                  <Radio className="w-3 h-3 mr-1" />
                  {song.station_name}
                </Badge>
                {song.is_now_playing && (
                  <Badge className="bg-success/20 text-success border-success/30">
                    AO VIVO
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground whitespace-nowrap hidden md:flex items-center">
                  <Clock className="w-3 h-3 mr-1" />
                  {format(new Date(song.scraped_at), 'dd/MM HH:mm', { locale: ptBR })}
                </span>
                {/* Download button - Always visible, disabled in browser */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onDownloadSong(song)}
                  disabled={!isElectron || downloadStatus[song.id] === 'downloading'}
                  title={!isElectron ? 'Disponível no Desktop' : 'Baixar música'}
                >
                  {downloadStatus[song.id] === 'downloading' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : downloadStatus[song.id] === 'success' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-success" />
                  ) : downloadStatus[song.id] === 'exists' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : downloadStatus[song.id] === 'error' ? (
                    <XCircle className="w-3.5 h-3.5 text-destructive" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
