import { useState, useMemo, useEffect, useCallback } from 'react';
import { Clock, Eye, Save, X, Music, Newspaper, Edit2, FileText, Loader2, Copy, Check, FolderOpen, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore, BlockSong, FixedContent } from '@/store/radioStore';
import { useGlobalServices } from '@/contexts/GlobalServicesContext';
import { supabase } from '@/integrations/supabase/client';
import { realtimeManager } from '@/lib/realtimeManager';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { sanitizeFilename } from '@/lib/sanitizeFilename';
import { sanitizeGradeFilename } from '@/lib/gradeBuilder/sanitize';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface BlockInfo {
  time: string;
  label: 'anterior' | 'atual' | 'proximo';
  programName: string;
  songs: BlockSong[];
  fixedContent: FixedContent[];
}

interface CapturedSong {
  title: string;
  artist: string;
  station_name: string;
  scraped_at: string;
}

// Cache key for persisting captured songs across navigation
const GRADE_SONGS_CACHE_KEY = 'grade-schedule-songs-cache';
const CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function loadCachedSongs(): CapturedSong[] {
  try {
    const cached = localStorage.getItem(GRADE_SONGS_CACHE_KEY);
    if (cached) {
      const { songs, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_MAX_AGE_MS && Array.isArray(songs) && songs.length > 0) {
        return songs;
      }
    }
  } catch {}
  return [];
}

function saveSongsToCache(songs: CapturedSong[]) {
  try {
    localStorage.setItem(GRADE_SONGS_CACHE_KEY, JSON.stringify({ songs, timestamp: Date.now() }));
  } catch {}
}

export function GradeScheduleCard() {
  const { blockSongs, programs, fixedContent, setBlockSongs, stations, config } = useRadioStore();
  const { gradeBuilder } = useGlobalServices();
  const { toast } = useToast();
  const [selectedBlock, setSelectedBlock] = useState<BlockInfo | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedSongs, setEditedSongs] = useState<BlockSong[]>([]);
  const [capturedSongs, setCapturedSongs] = useState<CapturedSong[]>(loadCachedSongs);
  const [isLoading, setIsLoading] = useState(() => loadCachedSongs().length === 0);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'songs' | 'preview'>('songs');

  // Timer to keep block times in sync with local PC clock
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setClockTick(t => t + 1), 30000); // every 30s
    return () => clearInterval(interval);
  }, []);

  // Get current day info - SÁB with accent for file compatibility
  const dayInfo = useMemo(() => {
    const now = new Date();
    const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    const dayName = days[now.getDay()];
    const dateFormatted = format(now, "EEEE, dd 'de' MMMM", { locale: ptBR });
    return { dayName, dateFormatted };
  }, []);

  // Handle open grade folder
  const handleOpenGradeFolder = async () => {
    if (window.electronAPI?.openFolder) {
      await window.electronAPI.openFolder(config.gradeFolder);
      toast({
        title: '📂 Pasta aberta',
        description: `Abrindo ${config.gradeFolder}`,
      });
    } else {
      toast({
        title: '⚠️ Modo Web',
        description: 'Abrir pasta disponível apenas no aplicativo desktop.',
        variant: 'destructive',
      });
    }
  };

  // Fetch captured songs from Supabase
  useEffect(() => {
    const fetchCapturedSongs = async () => {
      // Only show loading if we have no cached data
      if (capturedSongs.length === 0) {
        setIsLoading(true);
      }
      try {
        const { data, error } = await supabase
          .from('scraped_songs')
          .select('title, artist, station_name, scraped_at')
          .order('scraped_at', { ascending: false })
          .limit(200);

        if (error) throw error;
        if (data && data.length > 0) {
          setCapturedSongs(data);
          saveSongsToCache(data);
        }
      } catch (error) {
        console.error('[GRADE-SCHEDULE] Error fetching songs:', error);
      }
      setIsLoading(false);
    };

    fetchCapturedSongs();

    // Subscribe to realtime updates via centralized manager (prevents duplicate channels)
    const unsubscribe = realtimeManager.subscribe(
      'scraped_songs',
      'grade_schedule_card',
      (payload) => {
        const newSong = payload.new as CapturedSong;
        setCapturedSongs(prev => {
          const updated = [newSong, ...prev].slice(0, 200);
          saveSongsToCache(updated);
          return updated;
        });
      }
    );

    return unsubscribe;
  }, []);

  // Generate songs pool from captured songs
  const songsPool = useMemo(() => {
    const uniqueSongs = new Map<string, BlockSong>();
    
    capturedSongs.forEach((song, index) => {
      const key = `${song.title}-${song.artist}`;
      if (!uniqueSongs.has(key)) {
        const stationAbbrev = song.station_name.split(' ').map(w => w[0]).join('').toUpperCase();
        uniqueSongs.set(key, {
          id: `captured-${index}`,
          title: song.title,
          artist: song.artist,
          file: `${song.artist} - ${song.title}.mp3`,
          source: stationAbbrev,
          isFixed: false,
        });
      }
    });
    
    return Array.from(uniqueSongs.values());
  }, [capturedSongs]);

  // Helper: parse a builder grade line into BlockSong[]
  const parsePendingLine = useCallback((line: string): BlockSong[] => {
    const songs: BlockSong[] = [];
    const matches = line.matchAll(/"([^"]+)"/g);
    let idx = 0;
    for (const match of matches) {
      const filename = match[1];
      const withoutExt = filename.replace(/\.mp3$/i, '');
      const parts = withoutExt.split(' - ');
      songs.push({
        id: `pending-${idx}`,
        artist: parts[0] || filename,
        title: parts.slice(1).join(' - ') || '',
        file: filename,
        source: 'GRADE',
        isFixed: !filename.includes(' - '),
      });
      idx++;
    }
    return songs;
  }, []);

  // Get current time and calculate blocks - READS FROM BUILDER when available
  const blocks = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentBlock = currentMinute < 30 ? 0 : 30;
    const pendingLines = gradeBuilder.pendingGradeLines;

    const blockList: BlockInfo[] = [];
    
    for (let offset = -2; offset <= 2; offset++) {
      let blockMinute = currentBlock + (offset * 30);
      let blockHour = currentHour;
      
      while (blockMinute < 0) { blockMinute += 60; blockHour -= 1; }
      while (blockMinute >= 60) { blockMinute -= 60; blockHour += 1; }
      if (blockHour < 0) blockHour += 24;
      if (blockHour >= 24) blockHour -= 24;
      
      const timeKey = `${blockHour.toString().padStart(2, '0')}:${blockMinute.toString().padStart(2, '0')}`;
      
      // Get program name for this hour
      let programName = 'PROGRAMA';
      for (const prog of programs) {
        const [start, end] = prog.timeRange.split('-').map(Number);
        if (blockHour >= start && blockHour <= end) {
          programName = prog.programName;
          break;
        }
      }
      
      // Get fixed content for this time slot
      const slotFixedContent = fixedContent.filter(fc => 
        fc.enabled && fc.timeSlots.some(ts => ts.hour === blockHour && ts.minute === blockMinute)
      );
      
      // PRIMARY SOURCE: read from builder's pendingGradeLines (same as TXT file)
      let songs: BlockSong[] = [];
      const pendingLine = pendingLines?.get(timeKey);
      if (pendingLine) {
        songs = parsePendingLine(pendingLine);
      } else {
        // Fallback: use stored blockSongs or auto-generate from captured songs
        songs = blockSongs[timeKey] || [];
        if (songs.length === 0 && songsPool.length > 0) {
          const startIndex = ((blockHour * 2 + (blockMinute === 30 ? 1 : 0)) * 10) % songsPool.length;
          const selectedSongs: BlockSong[] = [];
          for (let i = 0; i < 10 && i < songsPool.length; i++) {
            const poolIndex = (startIndex + i) % songsPool.length;
            selectedSongs.push({ ...songsPool[poolIndex], id: `${timeKey}-${i}` });
          }
          songs = selectedSongs;
        }
      }
      
      blockList.push({
        time: timeKey,
        label: offset < 0 ? 'anterior' : offset === 0 ? 'atual' : 'proximo',
        programName,
        songs,
        fixedContent: slotFixedContent,
      });
    }
    
    return blockList;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockSongs, programs, fixedContent, songsPool, clockTick, gradeBuilder.pendingGradeLines, parsePendingLine]);

  // Handle opening block details
  const handleViewBlock = (block: BlockInfo) => {
    setSelectedBlock(block);
    setEditedSongs([...block.songs]);
    setIsEditing(false);
  };

  // Handle edit mode
  const handleStartEdit = () => {
    if (selectedBlock) {
      setEditedSongs([...selectedBlock.songs]);
      setIsEditing(true);
    }
  };

  // Handle save changes - saves to local state AND exports to destination folder
  const handleSaveChanges = async () => {
    if (selectedBlock) {
      setBlockSongs(selectedBlock.time, editedSongs);
      setSelectedBlock({ ...selectedBlock, songs: editedSongs });
      setIsEditing(false);

      // Also save to physical file in destination folder
      if (window.electronAPI?.saveGradeFile && window.electronAPI?.readGradeFile) {
        try {
          const filename = `${dayInfo.dayName}.txt`;
          
          // Read existing file
          let existingContent = '';
          try {
            const readResult = await window.electronAPI.readGradeFile({
              folder: config.gradeFolder,
              filename,
            });
            if (readResult.success && readResult.content) {
              existingContent = readResult.content;
            }
          } catch {
            console.log('[GRADE-CARD] No existing file, will create new');
          }

          // Generate line for this block using sanitizeGradeFilename for TXT parity
          const songFiles = editedSongs.map(s => {
            const songFilename = sanitizeGradeFilename(sanitizeFilename(`${s.artist} - ${s.title}.mp3`));
            return `"${songFilename}"`;
          }).join(',vht,');
          const blockLine = `${selectedBlock.time} (ID=${selectedBlock.programName}) ${songFiles}`;

          // Parse and update
          const lineMap = new Map<string, string>();
          existingContent.split('\n').filter(l => l.trim()).forEach(line => {
            const match = line.match(/^(\d{2}:\d{2})/);
            if (match) lineMap.set(match[1], line);
          });
          lineMap.set(selectedBlock.time, blockLine);

          // Sort and save
          const sortedContent = Array.from(lineMap.keys())
            .sort()
            .map(t => lineMap.get(t))
            .join('\n');

          const result = await window.electronAPI.saveGradeFile({
            folder: config.gradeFolder,
            filename,
            content: sortedContent,
          });

          if (result.success) {
            console.log(`[GRADE-CARD] ✅ Bloco ${selectedBlock.time} exportado para ${result.filePath}`);
            toast({
              title: '✅ Bloco atualizado e exportado',
              description: `Grade das ${selectedBlock.time} foi salva em ${filename}`,
            });
          } else {
            throw new Error(result.error);
          }
        } catch (error) {
          console.error('[GRADE-CARD] Error saving to file:', error);
          toast({
            title: '⚠️ Bloco salvo localmente',
            description: `Não foi possível exportar para a pasta destino: ${error}`,
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: '✅ Bloco atualizado',
          description: `Grade das ${selectedBlock.time} foi salva.`,
        });
      }
    }
  };

  // Handle song edit
  const handleEditSong = (index: number, field: keyof BlockSong, value: string) => {
    const updated = [...editedSongs];
    updated[index] = { ...updated[index], [field]: value };
    setEditedSongs(updated);
  };

  // Generate .txt preview line for the block - uses sanitizeGradeFilename for TXT parity
  const generateTxtPreview = useCallback((block: BlockInfo | null): string => {
    if (!block) return '';
    
    // If this block came from pendingGradeLines, use the raw line directly (already sanitized)
    const pendingLine = gradeBuilder.pendingGradeLines?.get(block.time);
    if (pendingLine && !isEditing) return pendingLine;
    
    const songs = isEditing ? editedSongs : block.songs;
    if (songs.length === 0) return `${block.time} (ID=${block.programName}) [vazio]`;
    
    // Format with sanitizeGradeFilename (UPPERCASE, no accents) for TXT parity
    const songFiles = songs.map(s => {
      const filename = sanitizeGradeFilename(sanitizeFilename(`${s.artist} - ${s.title}.mp3`));
      return `"${filename}"`;
    }).join(',vht,');
    
    return `${block.time} (ID=${block.programName}) ${songFiles}`;
  }, [isEditing, editedSongs, gradeBuilder.pendingGradeLines]);

  // Handle copy to clipboard
  const handleCopyTxt = useCallback(() => {
    if (selectedBlock) {
      const txtContent = generateTxtPreview(selectedBlock);
      navigator.clipboard.writeText(txtContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: '📋 Copiado!',
        description: 'Linha do bloco copiada para a área de transferência.',
      });
    }
  }, [selectedBlock, generateTxtPreview, toast]);

  // Get label styles
  const getLabelStyle = (label: BlockInfo['label']) => {
    switch (label) {
      case 'anterior':
        return 'bg-muted text-muted-foreground border-border';
      case 'atual':
        return 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30';
      case 'proximo':
        return 'bg-amber-500/20 text-amber-500 border-amber-500/30';
    }
  };

  return (
    <>
      <Card className="glass-card border-emerald-500/20 flex flex-col">
        <CardHeader className="pb-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-500 shrink-0" />
              <span className="truncate">Grades Montadas</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] gap-1">
                <Calendar className="w-3 h-3" />
                {dayInfo.dayName}.txt
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleOpenGradeFolder}
                title="Abrir pasta de grades"
              >
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground capitalize mt-1">{dayInfo.dateFormatted}</p>
        </CardHeader>
        <CardContent className="p-3 flex-1 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              {blocks.map((block) => (
                <div
                  key={block.time}
                  className={`p-2.5 rounded-lg border transition-all cursor-pointer hover:scale-[1.01] ${getLabelStyle(block.label)}`}
                  onClick={() => handleViewBlock(block)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4 shrink-0" />
                        <span className="font-mono font-bold text-sm">{block.time}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {block.programName}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 text-xs">
                        <Music className="w-3 h-3" />
                        <span>{block.songs.length}</span>
                      </div>
                      {block.fixedContent.length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-purple-400">
                          <Newspaper className="w-3 h-3" />
                          <span>{block.fixedContent.length}</span>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewBlock(block);
                        }}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  {block.label === 'atual' && (
                    <Badge className="mt-1.5 text-[9px] bg-emerald-500/30 text-emerald-400 border-0">
                      ● BLOCO ATUAL
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Block Details Dialog */}
      <Dialog open={!!selectedBlock} onOpenChange={(open) => { if (!open) { setSelectedBlock(null); setActiveTab('songs'); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Bloco {selectedBlock?.time}
              <Badge variant="outline" className="ml-2">
                {selectedBlock?.programName}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          
          {selectedBlock && (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'songs' | 'preview')} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="songs" className="gap-2">
                  <Music className="w-4 h-4" />
                  Músicas
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-2">
                  <FileText className="w-4 h-4" />
                  Preview .txt
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="songs" className="mt-4 space-y-4">
                {/* Fixed Content */}
                {selectedBlock.fixedContent.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                      <Newspaper className="w-4 h-4 text-purple-400" />
                      Conteúdos Fixos ({selectedBlock.fixedContent.length})
                    </h4>
                    <div className="space-y-1">
                      {selectedBlock.fixedContent.map((fc) => (
                        <div
                          key={fc.id}
                          className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center gap-2"
                        >
                          <Newspaper className="w-4 h-4 text-purple-400 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{fc.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{fc.fileName}</p>
                          </div>
                          <Badge variant="secondary" className="text-[10px]">
                            {fc.type}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Songs */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Music className="w-4 h-4 text-primary" />
                      Músicas ({selectedBlock.songs.length})
                    </h4>
                    {!isEditing ? (
                      <Button variant="outline" size="sm" onClick={handleStartEdit} className="gap-1.5">
                        <Edit2 className="w-3.5 h-3.5" />
                        Editar
                      </Button>
                    ) : (
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                          <X className="w-3.5 h-3.5 mr-1" />
                          Cancelar
                        </Button>
                        <Button variant="default" size="sm" onClick={handleSaveChanges} className="gap-1.5">
                          <Save className="w-3.5 h-3.5" />
                          Salvar
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  <ScrollArea className="h-[250px]">
                    <div className="space-y-1.5 pr-2">
                      {(isEditing ? editedSongs : selectedBlock.songs).map((song, index) => (
                        <div
                          key={song.id}
                          className={`p-2 rounded-lg border ${song.isFixed ? 'bg-purple-500/10 border-purple-500/20' : 'bg-secondary/30 border-border'}`}
                        >
                          {isEditing ? (
                            <div className="space-y-1.5">
                              <Input
                                value={song.title}
                                onChange={(e) => handleEditSong(index, 'title', e.target.value)}
                                className="h-7 text-sm"
                                placeholder="Título"
                              />
                              <Input
                                value={song.artist}
                                onChange={(e) => handleEditSong(index, 'artist', e.target.value)}
                                className="h-7 text-sm"
                                placeholder="Artista"
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground font-mono w-5 shrink-0">
                                {(index + 1).toString().padStart(2, '0')}
                              </span>
                              {song.isFixed ? (
                                <Newspaper className="w-4 h-4 text-purple-400 shrink-0" />
                              ) : (
                                <Music className="w-4 h-4 text-primary shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">{song.title}</p>
                                <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                              </div>
                              <Badge variant="outline" className="text-[10px] shrink-0">
                                {song.source}
                              </Badge>
                            </div>
                          )}
                        </div>
                      ))}
                      
                      {selectedBlock.songs.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          <Music className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">Nenhuma música neste bloco</p>
                          <p className="text-xs mt-1">Aguardando capturas...</p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>
              
              <TabsContent value="preview" className="mt-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-500" />
                      Formato do Arquivo .txt
                    </h4>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleCopyTxt}
                      className="gap-1.5"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          Copiado!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copiar
                        </>
                      )}
                    </Button>
                  </div>
                  
                  <div className="p-3 rounded-lg bg-black/50 border border-border font-mono text-xs overflow-x-auto">
                    <pre className="whitespace-pre-wrap break-all text-emerald-400">
                      {generateTxtPreview(selectedBlock)}
                    </pre>
                  </div>
                  
                  <div className="mt-4 p-3 rounded-lg bg-secondary/30 border border-border">
                    <h5 className="text-xs font-medium text-muted-foreground mb-2">📖 Legenda do formato:</h5>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p><code className="text-amber-400">HH:MM</code> — Horário do bloco</p>
                      <p><code className="text-blue-400">(ID=PROGRAMA)</code> — Identificador do programa</p>
                      <p><code className="text-emerald-400">"Artista - Titulo.mp3"</code> — Música (com aspas)</p>
                      <p><code className="text-purple-400">vht</code> — Separador/vinheta (sem aspas)</p>
                      <p><code className="text-red-400">mus.mp3</code> — Código coringa (sem aspas)</p>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
