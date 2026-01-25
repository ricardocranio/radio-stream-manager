import { useState, useEffect, useMemo } from 'react';
import { Eye, TrendingUp, Radio, Clock, Sparkles, FileText, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useRadioStore } from '@/store/radioStore';
import { isElectron, isServiceMode, readGradeFileViaAPI } from '@/lib/serviceMode';

interface GradePreviewProps {
  recentSongsByStation: Record<string, { title: string; artist: string; timestamp: string }[]>;
}

interface ParsedBlock {
  time: string;
  programId: string;
  songs: string[];
}

const isElectronEnv = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

export function GradePreviewCard({ recentSongsByStation }: GradePreviewProps) {
  const { rankingSongs, config } = useRadioStore();
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  
  // Get day code for filename
  const getDayCode = () => {
    const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    return days[new Date().getDay()];
  };

  // Calculate next block time
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
  
  const nextBlock = getNextBlockTime();
  const nextBlockTime = `${nextBlock.hour.toString().padStart(2, '0')}:${nextBlock.minute.toString().padStart(2, '0')}`;

  // Read physical file content
  const readGradeFile = async () => {
    if (!isElectronEnv || !window.electronAPI?.readGradeFile) {
      return;
    }
    
    setIsLoading(true);
    try {
      const dayCode = getDayCode();
      const filename = `${dayCode}.txt`;
      
      let result: { success: boolean; content?: string };
      
      // Try native Electron API first
      if (window.electronAPI?.readGradeFile) {
        result = await window.electronAPI.readGradeFile({
          folder: config.gradeFolder,
          filename,
        });
      } else if (isServiceMode()) {
        // Fall back to HTTP API for Service Mode
        result = await readGradeFileViaAPI(config.gradeFolder, filename);
      } else {
        result = { success: false };
      }
      
      if (result.success && result.content) {
        setFileContent(result.content);
        setLastRefresh(new Date());
      }
    } catch (error) {
      console.error('[GRADE-PREVIEW] Error reading file:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Read file on mount and periodically
  useEffect(() => {
    readGradeFile();
    const interval = setInterval(readGradeFile, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [config.gradeFolder]);

  // Parse file content into blocks
  const parsedBlocks = useMemo((): ParsedBlock[] => {
    if (!fileContent) return [];
    
    const blocks: ParsedBlock[] = [];
    const lines = fileContent.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      // Match format: HH:MM (ID=PROGRAM) "song1.mp3",vht,"song2.mp3",...
      const match = line.match(/^(\d{2}:\d{2})\s*(?:\d{2}:\d{2}\s*)?\((?:ID=|FIXO ID=)?([^)]+)\)\s*(.*)$/);
      if (match) {
        const [, time, programId, songsStr] = match;
        
        // Extract song names from the quoted strings
        const songMatches = songsStr.match(/"([^"]+)"/g);
        const songs = songMatches 
          ? songMatches.map(s => s.replace(/"/g, '').replace('.mp3', ''))
          : [];
        
        blocks.push({ time, programId: programId.trim(), songs });
      }
    }
    
    return blocks.sort((a, b) => a.time.localeCompare(b.time));
  }, [fileContent]);

  // Find next block from parsed content
  const nextBlockData = useMemo(() => {
    return parsedBlocks.find(b => b.time === nextBlockTime) || null;
  }, [parsedBlocks, nextBlockTime]);

  // Count songs from ranking in all blocks
  const songsFromRanking = useMemo(() => {
    const allSongs = parsedBlocks.flatMap(b => b.songs);
    return allSongs.filter(song => {
      const [artist, title] = song.split(' - ');
      if (!artist || !title) return false;
      return rankingSongs.some(
        r => r.title.toLowerCase().includes(title.toLowerCase()) || 
             r.artist.toLowerCase().includes(artist.toLowerCase())
      );
    }).length;
  }, [parsedBlocks, rankingSongs]);

  return (
    <Card className="glass-card border-amber-500/20">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="w-5 h-5 text-amber-500" />
            Preview da Próxima Grade
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={readGradeFile}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Badge variant="outline" className="border-amber-500/50 text-amber-500">
              <Clock className="w-3 h-3 mr-1" />
              {nextBlockTime}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* TOP50 Usage Indicator */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-transparent border border-purple-500/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Músicas do TOP50 na Grade</p>
              <p className="text-xs text-muted-foreground">
                {parsedBlocks.length} blocos montados • {getDayCode()}.txt
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-purple-500">{songsFromRanking}</p>
            <p className="text-xs text-muted-foreground">no ranking</p>
          </div>
        </div>

        {/* Songs Preview - from actual file */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Músicas que serão usadas:
            </p>
            {nextBlockData && (
              <Badge variant="secondary" className="text-xs">
                <FileText className="w-3 h-3 mr-1" />
                {nextBlockData.programId}
              </Badge>
            )}
          </div>
          
          <ScrollArea className="h-[200px]">
            {!isElectronEnv ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                <p>Preview disponível apenas no modo desktop</p>
              </div>
            ) : !nextBlockData ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                <p>Bloco {nextBlockTime} ainda não foi gerado</p>
              </div>
            ) : (
              <div className="space-y-1">
                {nextBlockData.songs.map((song, index) => {
                  const [artist, ...titleParts] = song.split(' - ');
                  const title = titleParts.join(' - ') || song;
                  const isFromRanking = rankingSongs.some(
                    r => r.title.toLowerCase().includes(title.toLowerCase()) || 
                         r.artist.toLowerCase().includes(artist.toLowerCase())
                  );
                  
                  return (
                    <div
                      key={index}
                      className={`p-2 rounded-lg flex items-center gap-3 ${
                        isFromRanking 
                          ? 'bg-purple-500/10 border border-purple-500/20' 
                          : 'bg-secondary/50'
                      }`}
                    >
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {title}
                          {isFromRanking && (
                            <TrendingUp className="w-3 h-3 inline ml-1 text-purple-500" />
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{artist}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Last refresh indicator */}
        {lastRefresh && (
          <p className="text-xs text-muted-foreground text-center">
            Atualizado: {lastRefresh.toLocaleTimeString('pt-BR')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
