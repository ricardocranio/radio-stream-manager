import { useState, useMemo, useEffect, useCallback } from 'react';
import { Eye, Music, Clock, RefreshCw, Loader2, CheckCircle, XCircle, HardDrive, AlertTriangle, FileText, Flame } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { useGlobalServices } from '@/contexts/GlobalServicesContext';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

type LibraryStatus = 'checking' | 'found' | 'missing' | 'unavailable';

interface PreviewSong {
  position: number;
  filename: string;
  artist: string;
  title: string;
  isSpecial: boolean;
}

/**
 * Parse a builder grade line into PreviewSong entries.
 * This is the ONLY source of truth — matches the TXT file exactly.
 */
function parseGradeLine(line: string): PreviewSong[] {
  const songs: PreviewSong[] = [];
  const matches = line.matchAll(/"([^"]+)"/g);
  let pos = 1;
  for (const match of matches) {
    const filename = match[1];
    const isSpecial = !filename.includes(' - ');
    const withoutExt = filename.replace(/\.mp3$/i, '');
    const parts = withoutExt.split(' - ');
    songs.push({
      position: pos++,
      filename,
      artist: parts[0] || filename,
      title: parts.slice(1).join(' - ') || '',
      isSpecial,
    });
  }
  return songs;
}

export function GradePreviewCard() {
  const { config } = useRadioStore();
  const { gradeBuilder } = useGlobalServices();
  const [libraryStatus, setLibraryStatus] = useState<Record<string, LibraryStatus>>({});
  const [isCheckingLibrary, setIsCheckingLibrary] = useState(false);

  // Use builder's nextBlock directly as single source of truth
  const nextBlockTime = gradeBuilder.nextBlock || '--:--';

  // === SINGLE SOURCE: Builder output (exact match with TXT) ===
  const displaySongs = useMemo(() => {
    const lines = gradeBuilder.pendingGradeLines;
    if (!lines || lines.size === 0) return [];
    // Try next block first
    const nextLine = lines.get(nextBlockTime);
    if (nextLine) return parseGradeLine(nextLine);
    // Try current block
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${(now.getMinutes() < 30 ? '00' : '30')}`;
    const currentLine = lines.get(currentTime);
    if (currentLine) return parseGradeLine(currentLine);
    // Try any available block (show the latest one)
    const sortedKeys = Array.from(lines.keys()).sort();
    if (sortedKeys.length > 0) {
      const lastKey = sortedKeys[sortedKeys.length - 1];
      return parseGradeLine(lines.get(lastKey)!);
    }
    return [];
  }, [gradeBuilder.pendingGradeLines, nextBlockTime]);

  // Get the raw grade line from builder
  const nextBlockLine = useMemo(() => {
    const lines = gradeBuilder.pendingGradeLines;
    if (!lines || lines.size === 0) return null;
    return lines.get(nextBlockTime) || null;
  }, [gradeBuilder.pendingGradeLines, nextBlockTime]);

  // Check library availability
  const checkLibrary = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.findSongMatch || displaySongs.length === 0) {
      const newStatus: Record<string, LibraryStatus> = {};
      displaySongs.forEach(s => {
        if (!s.isSpecial) newStatus[s.filename.toLowerCase()] = isElectron ? 'checking' : 'unavailable';
      });
      setLibraryStatus(newStatus);
      return;
    }

    setIsCheckingLibrary(true);
    const newStatus: Record<string, LibraryStatus> = {};
    const musicFolders = config.musicFolders || [];
    const threshold = config.similarityThreshold || 0.75;

    const songsToCheck = displaySongs.filter(s => !s.isSpecial);

    for (let i = 0; i < songsToCheck.length; i += 3) {
      const batch = songsToCheck.slice(i, i + 3);
      const results = await Promise.all(
        batch.map(async (song) => {
          const key = song.filename.toLowerCase();
          try {
            const result = await Promise.race([
              window.electronAPI!.findSongMatch({
                artist: song.artist,
                title: song.title || song.artist,
                musicFolders,
                threshold,
              } as any),
              new Promise<{ exists: false }>((resolve) => setTimeout(() => resolve({ exists: false }), 10000)),
            ]);
            return { key, status: (result.exists ? 'found' : 'missing') as LibraryStatus };
          } catch {
            return { key, status: 'missing' as LibraryStatus };
          }
        })
      );
      for (const { key, status } of results) {
        newStatus[key] = status;
      }
      setLibraryStatus({ ...newStatus });
    }

    setIsCheckingLibrary(false);

    // Send missing to download queue
    const missingFiles = songsToCheck.filter(s => newStatus[s.filename.toLowerCase()] === 'missing');
    if (missingFiles.length > 0) {
      const { addMissingSong, missingSongs: existingMissing } = useRadioStore.getState();
      const existingKeys = new Set(
        existingMissing.map(m => `${m.artist.toLowerCase().trim()}|${m.title.toLowerCase().trim()}`)
      );
      for (const s of missingFiles) {
        const dlKey = `${s.artist.toLowerCase().trim()}|${(s.title || '').toLowerCase().trim()}`;
        if (!existingKeys.has(dlKey) && s.artist && s.title) {
          addMissingSong({
            id: `preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: s.title, artist: s.artist,
            station: 'preview',
            status: 'missing', timestamp: new Date(), urgency: 'grade',
          });
          existingKeys.add(dlKey);
        }
      }
    }
  }, [displaySongs, config.musicFolders, config.similarityThreshold]);

  useEffect(() => {
    if (displaySongs.length > 0 && displaySongs.some(s => !s.isSpecial)) {
      checkLibrary();
    }
  }, [displaySongs, checkLibrary]);

  const getLibraryIcon = (song: PreviewSong) => {
    if (song.isSpecial) return null;
    const key = song.filename.toLowerCase();
    const status = libraryStatus[key];
    if (!status || status === 'unavailable') return null;
    if (status === 'checking') return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
    if (status === 'found') return <CheckCircle className="w-3 h-3 text-green-400" />;
    if (status === 'missing') return <XCircle className="w-3 h-3 text-red-400" />;
    return null;
  };

  const foundCount = Object.values(libraryStatus).filter(s => s === 'found').length;
  const missingCount = Object.values(libraryStatus).filter(s => s === 'missing').length;
  const isLoading = gradeBuilder.isBuilding;

  return (
    <Card className="glass-card border-amber-500/20">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="w-5 h-5 text-amber-500" />
            Preview da Próxima Grade
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
              {nextBlockTime}
            </Badge>
            {displaySongs.length > 0 && (
              <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30">
                TXT
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {isCheckingLibrary && (
              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                Verificando
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => gradeBuilder.buildGrade(false, true)}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {displaySongs.length} faixas
          </span>
          {isElectron && (foundCount > 0 || missingCount > 0) && (
            <span className="flex items-center gap-1">
              <HardDrive className="w-3 h-3" />
              {foundCount}✅ {missingCount}❌
            </span>
          )}
          {gradeBuilder.lastBuildTime && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {format(gradeBuilder.lastBuildTime, 'HH:mm', { locale: ptBR })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        <ScrollArea className="h-[320px]">
          {displaySongs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Music className="w-8 h-8 opacity-50" />
              <p className="text-sm">
                {isLoading ? 'Montando grade...' : 'Aguardando montagem da grade'}
              </p>
              <p className="text-xs opacity-60">
                A grade será montada automaticamente antes do próximo bloco
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {displaySongs.map((song, index) => {
                const isMissing = libraryStatus[song.filename.toLowerCase()] === 'missing';

                return (
                  <div
                    key={index}
                    className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                      isMissing
                        ? 'bg-red-500/10 border-red-500/30'
                        : song.isSpecial
                          ? 'bg-purple-500/10 border-purple-500/20'
                          : 'bg-card/50 border-border/50 hover:border-border'
                    }`}
                  >
                    {/* Position */}
                    <span className="text-xs font-mono text-muted-foreground w-5 text-right shrink-0">
                      {song.position}
                    </span>

                    {/* Library icon */}
                    <span className="shrink-0">{getLibraryIcon(song)}</span>

                    {/* Song info */}
                    <div className="flex-1 min-w-0">
                      {song.isSpecial ? (
                        <span className="text-xs font-mono text-purple-400 truncate block">
                          {song.filename}
                        </span>
                      ) : (
                        <>
                          <p className="text-sm font-medium truncate leading-tight">
                            {song.title || song.artist}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {song.artist}
                          </p>
                        </>
                      )}
                    </div>

                    {/* Missing badge */}
                    {isMissing && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-red-500/20 text-red-400 border-red-500/30 shrink-0">
                        <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                        FALTA
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Raw grade line from builder */}
        {nextBlockLine && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-[10px] text-muted-foreground font-mono break-all leading-relaxed opacity-60">
              {nextBlockLine}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
