import { useState, useMemo } from 'react';
import { Eye, Music, TrendingUp, Radio, Clock, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface GradePreviewProps {
  recentSongsByStation: Record<string, { title: string; artist: string; timestamp: string }[]>;
}

export function GradePreviewCard({ recentSongsByStation }: GradePreviewProps) {
  const { sequence, stations, rankingSongs, gradeHistory } = useRadioStore();
  
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
  
  // Generate preview based on sequence and captured songs
  const previewSongs = useMemo(() => {
    const songs: { position: number; title: string; artist: string; source: string; isFromRanking: boolean }[] = [];
    
    // Map station IDs to names
    const stationIdToName: Record<string, string> = {};
    stations.forEach(s => {
      stationIdToName[s.id] = s.name;
    });
    
    sequence.forEach((seq, index) => {
      const stationName = stationIdToName[seq.radioSource];
      const stationSongs = stationName ? recentSongsByStation[stationName] : [];
      
      if (stationSongs && stationSongs.length > 0) {
        const songIndex = index % stationSongs.length;
        const song = stationSongs[songIndex];
        songs.push({
          position: seq.position,
          title: song.title,
          artist: song.artist,
          source: stationName || seq.radioSource,
          isFromRanking: rankingSongs.some(
            r => r.title.toLowerCase() === song.title.toLowerCase() && 
                 r.artist.toLowerCase() === song.artist.toLowerCase()
          ),
        });
      } else {
        songs.push({
          position: seq.position,
          title: '(Aguardando captura)',
          artist: stationName || seq.radioSource,
          source: stationName || seq.radioSource,
          isFromRanking: false,
        });
      }
    });
    
    return songs;
  }, [sequence, stations, recentSongsByStation, rankingSongs]);
  
  // Count songs from ranking
  const songsFromRanking = previewSongs.filter(s => s.isFromRanking).length;
  
  // Last grade TOP50 usage
  const lastGradeTop50Count = useMemo(() => {
    if (gradeHistory.length === 0) return 0;
    // Estimate: for TOP50 blocks at 19:00 and 19:30, count is based on fixedContent config
    const top50Blocks = gradeHistory.filter(g => g.programName.includes('TOP'));
    if (top50Blocks.length > 0) {
      return top50Blocks[0].songsFound || 0;
    }
    return Math.min(rankingSongs.length, 20);
  }, [gradeHistory, rankingSongs]);

  return (
    <Card className="glass-card border-amber-500/20">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="w-5 h-5 text-amber-500" />
            Preview da Próxima Grade
          </CardTitle>
          <div className="flex items-center gap-2">
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
              <p className="text-xs text-muted-foreground">Última grade usou músicas do ranking</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-purple-500">{lastGradeTop50Count}</p>
            <p className="text-xs text-muted-foreground">de {Math.min(rankingSongs.length, 50)}</p>
          </div>
        </div>

        {/* Songs Preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Músicas que serão usadas:
            </p>
            <Badge variant="secondary" className="text-xs">
              {songsFromRanking} no ranking
            </Badge>
          </div>
          
          <ScrollArea className="h-[200px]">
            <div className="space-y-1">
              {previewSongs.map((song, index) => (
                <div
                  key={index}
                  className={`p-2 rounded-lg flex items-center gap-3 ${
                    song.isFromRanking 
                      ? 'bg-purple-500/10 border border-purple-500/20' 
                      : 'bg-secondary/50'
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {song.position}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {song.title}
                      {song.isFromRanking && (
                        <TrendingUp className="w-3 h-3 inline ml-1 text-purple-500" />
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    <Radio className="w-3 h-3 mr-1" />
                    {song.source}
                  </Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
