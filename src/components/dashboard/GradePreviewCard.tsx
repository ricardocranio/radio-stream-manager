import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Eye, Music, TrendingUp, Radio, Clock, Sparkles, Flame, RefreshCw, Loader2, CheckCircle, XCircle, HardDrive, AlertTriangle, FileText } from 'lucide-react';
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

interface ParsedGradeSong {
  filename: string;
  position: number;
}

/**
 * Parse a grade line like: 18:00 (ID=PROGRAMA) "ARTIST - TITLE.MP3",vht,"ARTIST2 - TITLE2.MP3"
 * Returns the list of quoted filenames (songs) in order.
 */
function parseGradeLine(line: string): ParsedGradeSong[] {
  const songs: ParsedGradeSong[] = [];
  const matches = line.matchAll(/"([^"]+)"/g);
  let pos = 1;
  for (const match of matches) {
    songs.push({ filename: match[1], position: pos++ });
  }
  return songs;
}

export function GradePreviewCard() {
  const { config } = useRadioStore();
  const { gradeBuilder } = useGlobalServices();
  const [libraryStatus, setLibraryStatus] = useState<Record<string, LibraryStatus>>({});
  const [isCheckingLibrary, setIsCheckingLibrary] = useState(false);

  // Get the next block time
  const getNextBlockTime = () => {
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentHour = now.getHours();
    if (currentMinute < 30) {
      return { hour: currentHour, minute: 30 };
    } else {
      return { hour: (currentHour + 1) % 24, minute: 0 };
    }
  };

  const nextBlock = useMemo(() => getNextBlockTime(), [gradeBuilder.nextBlock]);
  const nextBlockTime = `${nextBlock.hour.toString().padStart(2, '0')}:${nextBlock.minute.toString().padStart(2, '0')}`;

  // Parse the actual grade lines from the builder
  const gradeSongs = useMemo(() => {
    const lines = gradeBuilder.pendingGradeLines;
    if (!lines || lines.size === 0) return [];

    // Get the line for the next block
    const nextLine = lines.get(nextBlockTime);
    if (nextLine) {
      return parseGradeLine(nextLine);
    }

    // Fallback: show all lines' songs
    const allSongs: ParsedGradeSong[] = [];
    const sortedKeys = Array.from(lines.keys()).sort();
    for (const key of sortedKeys) {
      const line = lines.get(key)!;
      const parsed = parseGradeLine(line);
      allSongs.push(...parsed);
    }
    return allSongs;
  }, [gradeBuilder.pendingGradeLines, nextBlockTime]);

  // Get the full grade line for display context
  const nextBlockLine = useMemo(() => {
    const lines = gradeBuilder.pendingGradeLines;
    if (!lines || lines.size === 0) return null;
    return lines.get(nextBlockTime) || null;
  }, [gradeBuilder.pendingGradeLines, nextBlockTime]);

  // Check library availability for grade songs
  const checkLibrary = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.findSongMatch || gradeSongs.length === 0) {
      const newStatus: Record<string, LibraryStatus> = {};
      gradeSongs.forEach(s => {
        newStatus[s.filename.toLowerCase()] = isElectron ? 'checking' : 'unavailable';
      });
      setLibraryStatus(newStatus);
      return;
    }

    setIsCheckingLibrary(true);
    const newStatus: Record<string, LibraryStatus> = {};
    const musicFolders = config.musicFolders || [];

    // Check each file exists on disk
    for (let i = 0; i < gradeSongs.length; i += 3) {
      const batch = gradeSongs.slice(i, i + 3);
      const results = await Promise.all(
        batch.map(async (song) => {
          const key = song.filename.toLowerCase();
          // Skip coringa/special codes
          if (!song.filename.includes(' - ') && !song.filename.toLowerCase().endsWith('.mp3')) {
            return { key, status: 'found' as LibraryStatus };
          }
          try {
            // Extract artist and title from filename like "ARTIST - TITLE.MP3"
            const withoutExt = song.filename.replace(/\.mp3$/i, '');
            const parts = withoutExt.split(' - ');
            const artist = parts[0] || '';
            const title = parts.slice(1).join(' - ') || '';
            
            if (!artist || !title) {
              return { key, status: 'found' as LibraryStatus };
            }

            const result = await Promise.race([
              window.electronAPI!.findSongMatch({
                artist,
                title,
                musicFolders,
                threshold: config.similarityThreshold || 0.75,
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

    // Send missing songs to download queue
    const missingFiles = gradeSongs.filter(s => newStatus[s.filename.toLowerCase()] === 'missing');
    if (missingFiles.length > 0) {
      const { addMissingSong, missingSongs: existingMissing } = useRadioStore.getState();
      const existingKeys = new Set(
        existingMissing.map(m => `${m.artist.toLowerCase().trim()}|${m.title.toLowerCase().trim()}`)
      );

      for (const s of missingFiles) {
        const withoutExt = s.filename.replace(/\.mp3$/i, '');
        const parts = withoutExt.split(' - ');
        const artist = parts[0]?.trim() || '';
        const title = parts.slice(1).join(' - ')?.trim() || '';
        if (!artist || !title) continue;

        const dlKey = `${artist.toLowerCase()}|${title.toLowerCase()}`;
        if (!existingKeys.has(dlKey)) {
          console.log(`[GradePreview] 🚨 Enviando para download urgente: ${artist} - ${title}`);
          addMissingSong({
            id: `preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title, artist,
            station: 'grade-preview',
            status: 'missing',
            timestamp: new Date(),
            urgency: 'grade',
          });
          existingKeys.add(dlKey);
        }
      }
    }
  }, [gradeSongs, config.musicFolders, config.similarityThreshold]);

  // Auto-check library when grade songs change
  useEffect(() => {
    if (gradeSongs.length > 0) {
      checkLibrary();
    }
  }, [gradeSongs, checkLibrary]);

  const getLibraryIcon = (filename: string) => {
    const key = filename.toLowerCase();
    const status = libraryStatus[key];
    if (!status || status === 'unavailable') return null;
    if (status === 'checking') return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
    if (status === 'found') return <CheckCircle className="w-3 h-3 text-green-400" />;
    if (status === 'missing') return <XCircle className="w-3 h-3 text-red-400" />;
    return null;
  };

  const foundCount = Object.values(libraryStatus).filter(s => s === 'found').length;
  const missingCount = Object.values(libraryStatus).filter(s => s === 'missing').length;

  // Check if the filename looks like a coringa/special code (no " - " separator)
  const isSpecialFile = (filename: string) => {
    return !filename.includes(' - ');
  };

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
              onClick={() => {
                gradeBuilder.buildGrade(false);
              }}
              disabled={gradeBuilder.isBuilding}
            >
              {gradeBuilder.isBuilding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
        {/* Stats bar */}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {gradeSongs.length} faixas
          </span>
          {isElectron && (
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
          {gradeSongs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Music className="w-8 h-8 opacity-50" />
              <p className="text-sm">
                {gradeBuilder.isBuilding 
                  ? 'Montando grade...' 
                  : 'Aguardando montagem automática da grade'}
              </p>
              <p className="text-xs opacity-70">
                A grade será montada automaticamente pelo sistema
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {gradeSongs.map((song, index) => {
                const isMissing = libraryStatus[song.filename.toLowerCase()] === 'missing';
                const isSpecial = isSpecialFile(song.filename);
                
                // Parse artist/title from filename
                const withoutExt = song.filename.replace(/\.mp3$/i, '');
                const parts = withoutExt.split(' - ');
                const displayArtist = parts[0] || song.filename;
                const displayTitle = parts.slice(1).join(' - ') || '';

                return (
                  <div
                    key={index}
                    className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                      isMissing
                        ? 'bg-red-500/10 border-red-500/30'
                        : isSpecial
                          ? 'bg-purple-500/10 border-purple-500/20'
                          : 'bg-card/50 border-border/50 hover:border-border'
                    }`}
                  >
                    {/* Position */}
                    <span className="text-xs font-mono text-muted-foreground w-5 text-right shrink-0">
                      {song.position}
                    </span>

                    {/* Library check icon */}
                    <span className="shrink-0">{getLibraryIcon(song.filename)}</span>

                    {/* Song info */}
                    <div className="flex-1 min-w-0">
                      {isSpecial ? (
                        <span className="text-xs font-mono text-purple-400 truncate block">
                          {song.filename}
                        </span>
                      ) : (
                        <>
                          <p className="text-sm font-medium truncate leading-tight">
                            {displayTitle || displayArtist}
                          </p>
                          {displayTitle && (
                            <p className="text-xs text-muted-foreground truncate">
                              {displayArtist}
                            </p>
                          )}
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

        {/* Raw grade line */}
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
