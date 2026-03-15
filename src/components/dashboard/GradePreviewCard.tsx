import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Eye, Music, Clock, RefreshCw, Loader2, CheckCircle, XCircle, HardDrive, AlertTriangle, FileText, Flame, Radio } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { useGlobalServices } from '@/contexts/GlobalServicesContext';
import { useGradeLogStore } from '@/store/gradeLogStore';
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
  durationSec?: number;
}

/**
 * Parse a builder grade line into PreviewSong entries.
 * This is the ONLY source of truth — matches the TXT file exactly.
 */
import { isVinhetaOrJingle } from '@/lib/vinhetaFilter';

/**
 * Parse a builder grade line into PreviewSong entries.
 * This is the ONLY source of truth — matches the TXT file exactly.
 * Marks vinhetas/jingles as isSpecial so they never go to Deemix.
 */
function parseGradeLine(line: string): PreviewSong[] {
  const songs: PreviewSong[] = [];
  const matches = line.matchAll(/"([^"]+)"/g);
  let pos = 1;
  for (const match of matches) {
    const filename = match[1];
    const withoutExt = filename.replace(/\.mp3$/i, '');
    const parts = withoutExt.split(' - ');
    const artist = parts[0] || filename;
    const title = parts.slice(1).join(' - ') || '';
    // Mark as special if no " - " separator OR if it's a vinheta/jingle
    const isSpecial = !filename.includes(' - ') || isVinhetaOrJingle(artist, title, filename);
    songs.push({
      position: pos++,
      filename,
      artist,
      title,
      isSpecial,
    });
  }
  return songs;
}

export function GradePreviewCard() {
  const { config } = useRadioStore();
  const { gradeBuilder } = useGlobalServices();
  const { getLogsByBlock } = useGradeLogStore();
  const [libraryStatus, setLibraryStatus] = useState<Record<string, LibraryStatus>>({});
  const [isCheckingLibrary, setIsCheckingLibrary] = useState(false);
  const [realBlockDuration, setRealBlockDuration] = useState<number | null>(null);
  const [songDurations, setSongDurations] = useState<Record<string, number>>({});
  const [vhtCount, setVhtCount] = useState(0);
  const [songCount, setSongCount] = useState(0);

  // === MOCK DATA for web preview (non-Electron) ===
  const mockSongs: PreviewSong[] = useMemo(() => {
    if (isElectron) return [];
    return [
      { position: 1, filename: 'Anitta - Envolver.mp3', artist: 'Anitta', title: 'Envolver', isSpecial: false },
      { position: 2, filename: 'VHT_RADIO.mp3', artist: 'VHT_RADIO', title: '', isSpecial: true },
      { position: 3, filename: 'Jorge & Mateus - Enquanto Houver Razões.mp3', artist: 'Jorge & Mateus', title: 'Enquanto Houver Razões', isSpecial: false },
      { position: 4, filename: 'Marília Mendonça - Supera.mp3', artist: 'Marília Mendonça', title: 'Supera', isSpecial: false },
      { position: 5, filename: 'VHT_RADIO.mp3', artist: 'VHT_RADIO', title: '', isSpecial: true },
      { position: 6, filename: 'Henrique & Juliano - Vidinha de Balada.mp3', artist: 'Henrique & Juliano', title: 'Vidinha de Balada', isSpecial: false },
      { position: 7, filename: 'Luísa Sonza - Sentadona.mp3', artist: 'Luísa Sonza', title: 'Sentadona', isSpecial: false },
      { position: 8, filename: 'VHT_RADIO.mp3', artist: 'VHT_RADIO', title: '', isSpecial: true },
      { position: 9, filename: 'Zé Neto & Cristiano - Largado Às Traças.mp3', artist: 'Zé Neto & Cristiano', title: 'Largado Às Traças', isSpecial: false },
    ];
  }, []);

  const mockStationMap: Record<string, string> = useMemo(() => {
    if (isElectron) return {};
    return {
      'anitta-envolver': 'BH FM',
      'jorge & mateus-enquanto houver razões': 'Metropolitana FM',
      'marília mendonça-supera': 'Disney FM',
      'henrique & juliano-vidinha de balada': 'BH FM',
      'luísa sonza-sentadona': 'Jovem Pan',
      'zé neto & cristiano-largado às traças': 'Metropolitana FM',
    };
  }, []);

  // Use builder's nextBlock directly as single source of truth
  const nextBlockTime = gradeBuilder.nextBlock || (isElectron ? '--:--' : (() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes() < 30 ? '30' : '00';
    const nextH = m === '00' ? (h + 1) % 24 : h;
    return `${nextH.toString().padStart(2, '0')}:${m}`;
  })());
  const blockDuration = realBlockDuration ?? gradeBuilder.pendingBlockDurations?.get(nextBlockTime) ?? (!isElectron ? 30.2 : undefined);

  // === SINGLE SOURCE: Builder output (exact match with TXT) ===
  // In web preview (non-Electron), use mock data to demonstrate the radio badges
  const displaySongs = useMemo(() => {
    if (!isElectron) return mockSongs;
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
  }, [gradeBuilder.pendingGradeLines, nextBlockTime, mockSongs]);

  // Normalize string: lowercase, strip accents, collapse whitespace
  const normalizeKey = useCallback((str: string) => {
    return str
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9 ]/g, '')     // remove special chars
      .replace(/\s+/g, ' ');
  }, []);

  // Build a map of song key -> station from block logs
  const songStationMap = useMemo(() => {
    if (!isElectron) return mockStationMap;
    const map: Record<string, string> = {};
    if (nextBlockTime === '--:--') return map;
    
    // Try current block and also look at all recent logs for this block time
    const logs = getLogsByBlock(nextBlockTime);
    
    // If no logs for nextBlock, try current block time too
    if (logs.length === 0) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${(now.getMinutes() < 30 ? '00' : '30')}`;
      if (currentTime !== nextBlockTime) {
        logs.push(...getLogsByBlock(currentTime));
      }
    }
    
    for (const log of logs) {
      if (log.station && log.title && log.artist) {
        const key = `${normalizeKey(log.artist)}-${normalizeKey(log.title || '')}`;
        map[key] = log.station;
      }
    }
    return map;
  }, [nextBlockTime, getLogsByBlock, mockStationMap, normalizeKey]);

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

  // === REAL DURATION CALCULATION from actual files ===
  useEffect(() => {
    if (!nextBlockLine) {
      // For mock mode, set counts and mock durations from displaySongs
      if (!isElectron && displaySongs.length > 0) {
        const mockVhts = displaySongs.filter(s => s.isSpecial).length;
        const mockSongsCount = displaySongs.filter(s => !s.isSpecial).length;
        setVhtCount(mockVhts);
        setSongCount(mockSongsCount);
        // Mock durations between 3:00 and 4:30
        const mockDurs: Record<string, number> = {};
        displaySongs.forEach(s => {
          if (!s.isSpecial) {
            mockDurs[s.filename.toLowerCase()] = 180 + Math.floor(Math.random() * 90);
          } else {
            mockDurs[s.filename.toLowerCase()] = 7;
          }
        });
        setSongDurations(mockDurs);
      } else {
        setVhtCount(0);
        setSongCount(0);
        setSongDurations({});
      }
      setRealBlockDuration(null);
      return;
    }

    // Count VHTs and songs from the raw line
    const headerMatch = nextBlockLine.match(/^(\d{2}:\d{2}\s+\([^)]+\)\s*)(.*)/);
    if (!headerMatch) return;
    const tokens = headerMatch[2].split(',').map(t => t.trim()).filter(Boolean);
    const vhts = tokens.filter(t => t.toLowerCase() === 'vht' || t.toLowerCase() === 'vhtn');
    const songs = tokens.filter(t => t.toLowerCase() !== 'vht' && t.toLowerCase() !== 'vhtn');
    setVhtCount(vhts.length);
    setSongCount(songs.length);

    // Calculate real duration via Electron
    if (!isElectron || !window.electronAPI?.getFileDurationsBatch) {
      // Estimate: 3:30 per song, 7s per VHT
      const estimated = (songs.length * 210 + vhts.length * 7) / 60;
      setRealBlockDuration(parseFloat(estimated.toFixed(1)));
      // Set estimated per-song durations
      const estDurs: Record<string, number> = {};
      displaySongs.forEach(s => {
        estDurs[s.filename.toLowerCase()] = s.isSpecial ? 7 : 210;
      });
      setSongDurations(estDurs);
      return;
    }

    const calculateDuration = async () => {
      try {
        const musicFolders = [
          ...(config.musicFolders || []),
          config.contentFolder,
          config.vinhetasFolder || 'C:\\Playlist\\Vinhetas',
        ].filter(Boolean);

        // Get filenames for batch query
        const filenames = tokens
          .filter(t => t.startsWith('"'))
          .map(t => t.replace(/^"|"$/g, ''));

        let totalSec = 0;
        const DEFAULT_SONG = 210;
        const DEFAULT_VHT = 7;
        const perSongDurs: Record<string, number> = {};

        if (filenames.length > 0) {
          const result = await window.electronAPI!.getFileDurationsBatch({
            filenames,
            musicFolders,
          });
          if (result.success && result.durations) {
            for (const token of tokens) {
              const lower = token.toLowerCase();
              if (lower === 'vht' || lower === 'vhtn') {
                totalSec += DEFAULT_VHT;
              } else if (token.startsWith('"')) {
                const name = token.replace(/^"|"$/g, '');
                const dur = result.durations[name];
                const finalDur = (dur && dur > 0) ? dur : DEFAULT_SONG;
                totalSec += finalDur;
                perSongDurs[name.toLowerCase()] = finalDur;
              } else {
                totalSec += DEFAULT_SONG;
              }
            }
          } else {
            totalSec = songs.length * DEFAULT_SONG + vhts.length * DEFAULT_VHT;
            displaySongs.forEach(s => {
              perSongDurs[s.filename.toLowerCase()] = s.isSpecial ? DEFAULT_VHT : DEFAULT_SONG;
            });
          }
        } else {
          totalSec = songs.length * DEFAULT_SONG + vhts.length * DEFAULT_VHT;
          displaySongs.forEach(s => {
            perSongDurs[s.filename.toLowerCase()] = s.isSpecial ? DEFAULT_VHT : DEFAULT_SONG;
          });
        }

        setSongDurations(perSongDurs);
        setRealBlockDuration(parseFloat((totalSec / 60).toFixed(1)));
      } catch (e) {
        console.warn('[PREVIEW] Failed to calculate real duration:', e);
        setRealBlockDuration(parseFloat(((songs.length * 210 + vhts.length * 7) / 60).toFixed(1)));
      }
    };

    calculateDuration();
  }, [nextBlockLine, config.musicFolders, config.contentFolder, config.vinhetasFolder, displaySongs]);

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
  const isBlockShort = blockDuration !== undefined && blockDuration < 29;
  const isBlockLong = blockDuration !== undefined && blockDuration > 32;
  const isBlockOk = blockDuration !== undefined && blockDuration >= 29 && blockDuration <= 32;

  // Auto-rebuild when block is too short (with debounce to avoid loops)
  const autoFixAttemptedRef = useRef<string>('');
  useEffect(() => {
    if (isBlockShort && !isLoading && nextBlockTime !== '--:--') {
      const key = `${nextBlockTime}-${blockDuration}`;
      if (autoFixAttemptedRef.current !== key) {
        autoFixAttemptedRef.current = key;
        console.log(`[PREVIEW] ⚠️ Bloco ${nextBlockTime} com ${blockDuration} min (<29). Tentando rebuild automático...`);
        // Delay to avoid rapid loops
        const timer = setTimeout(() => {
          gradeBuilder.buildGrade(false, true);
        }, 5000);
        return () => clearTimeout(timer);
      }
    }
  }, [isBlockShort, isLoading, nextBlockTime, blockDuration, gradeBuilder]);

  return (
    <Card className={`glass-card ${isBlockShort ? 'border-red-500/40' : isBlockOk ? 'border-green-500/20' : 'border-amber-500/20'}`}>
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="w-5 h-5 text-amber-500" />
            Preview da Próxima Grade
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
              {nextBlockTime}
            </Badge>
            {blockDuration && (
              <Badge variant="outline" className={`text-xs ${
                blockDuration >= 29 && blockDuration <= 32
                  ? 'bg-green-500/10 text-green-400 border-green-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30'
              }`}>
                <Clock className="w-3 h-3 mr-1" />
                {blockDuration} min
              </Badge>
            )}
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
            <Music className="w-3 h-3" />
            {songCount} músicas
          </span>
          <span className="flex items-center gap-1">
            🎵 {vhtCount} VHTs
          </span>
          {blockDuration && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <Clock className="w-3 h-3" />
              {blockDuration} min
            </span>
          )}
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
        {/* Duration alert banner */}
        {isBlockShort && (
          <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 animate-pulse">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-red-400">
                ⚠️ Bloco abaixo de 29 min ({blockDuration} min) — rebuild automático em andamento
              </p>
              <p className="text-[10px] text-red-400/70">
                O sistema está tentando adicionar músicas extras para atingir o mínimo
              </p>
            </div>
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-red-400 shrink-0" />}
          </div>
        )}
        {isBlockLong && (
          <div className="mb-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-400">
              Bloco acima de 32 min ({blockDuration} min) — pode ultrapassar a janela
            </p>
          </div>
        )}
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
                const stationKey = `${song.artist.toLowerCase().trim()}-${(song.title || '').toLowerCase().trim()}`;
                const stationName = songStationMap[stationKey];

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
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-muted-foreground truncate">
                              {song.artist}
                            </p>
                            {stationName && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 bg-accent/30 text-accent-foreground/70 border-accent/40 shrink-0">
                                <Radio className="w-2.5 h-2.5 mr-0.5" />
                                {stationName}
                              </Badge>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Duration badge */}
                    {(() => {
                      const dur = songDurations[song.filename.toLowerCase()];
                      if (!dur) return null;
                      const mins = Math.floor(dur / 60);
                      const secs = Math.floor(dur % 60);
                      return (
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums">
                          {mins}:{secs.toString().padStart(2, '0')}
                        </span>
                      );
                    })()}

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
