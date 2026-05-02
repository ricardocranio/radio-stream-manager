import { useState, useEffect, useCallback } from 'react';
import { useDeferredRender } from '@/hooks/useDeferredRender';
import { FileText, Edit3, Save, RotateCcw, Eye, Code, Layers, ArrowRight, RefreshCw, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { sanitizeFilename } from '@/lib/sanitizeFilename';
import { supabase } from '@/integrations/supabase/client';
import { STATION_ID_TO_DB_NAME } from '@/lib/gradeBuilder/constants';
import type { SequenceConfig } from '@/types/radio';

interface GradeFormat {
  timeFormat: string;
  separator: string;
  programPrefix: string;
  songQuotes: boolean;
  includeSource: boolean;
  fixedBlockText: string;
  fileExtension: string;
}

const defaultFormat: GradeFormat = {
  timeFormat: 'HH:MM',
  separator: ',vht,',
  programPrefix: 'ID=',
  songQuotes: true,
  includeSource: false,
  fixedBlockText: 'Fixo',
  fileExtension: '.txt',
};

const dayMap: Record<string, string> = {
  'SEG': 'Segunda-feira',
  'TER': 'Terça-feira',
  'QUA': 'Quarta-feira',
  'QUI': 'Quinta-feira',
  'SEX': 'Sexta-feira',
  'SÁB': 'Sábado',
  'DOM': 'Domingo',
};

interface SongPool {
  title: string;
  artist: string;
  station_name: string;
  scraped_at: string;
}

const formatTime = (h: number, m: number) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

export function GradeBuilderView() {
  const isReady = useDeferredRender();
  const { programs, sequence, stations, rankingSongs, scheduledSequences, fixedContent, config, setConfig } = useRadioStore();
  const { toast } = useToast();
  const [format, setFormat] = useState<GradeFormat>(defaultFormat);
  const [selectedHour, setSelectedHour] = useState(14);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [realSongs, setRealSongs] = useState<SongPool[]>([]);
  const [gradeLines, setGradeLines] = useState<Array<{ time: string; line: string; type: string }>>([]);

  const getProgramForHour = useCallback((hour: number) => {
    if (config.useDefaultFixedSchedules === false) return 'SEQUÊNCIA';
    
    return programs.find(p => {
      const [start, end] = p.timeRange.split('-').map(Number);
      return hour >= start && hour <= end;
    })?.programName || 'SEQUÊNCIA';
  }, [programs, config.useDefaultFixedSchedules]);

  const fetchRealSongs = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .order('scraped_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      const { data: historico } = await supabase
        .from('radio_historico')
        .select('title, artist, station_name, captured_at')
        .order('captured_at', { ascending: false })
        .limit(500);
      const allSongs = [...(data || []), ...(historico || []).map(h => ({ title: h.title, artist: h.artist, station_name: h.station_name, scraped_at: h.captured_at }))];
      const seen = new Set<string>();
      const unique = allSongs.filter(s => {
        const key = `${s.title.toLowerCase()}-${s.artist.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setRealSongs(unique);
      toast({ title: '🎵 Músicas carregadas', description: `${unique.length} músicas reais disponíveis.` });
    } catch (err) {
      console.error('Error fetching songs:', err);
      toast({ title: 'Erro', description: 'Falha ao buscar músicas.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchRealSongs(); }, []);

  const songsByStation = useCallback((): Record<string, SongPool[]> => {
    const poolStations = stations.filter(s => s.isCapture !== false);
    const poolStationNames = new Set(poolStations.map(s => s.name));
    const map: Record<string, SongPool[]> = {};
    for (const song of realSongs) {
      if (!poolStationNames.has(song.station_name)) continue;
      if (!map[song.station_name]) map[song.station_name] = [];
      map[song.station_name].push(song);
    }
    return map;
  }, [realSongs, stations]);

  const generateRealLine = useCallback((hour: number, minute: number, usedSongs: Set<string>, usedArtists: Set<string>) => {
    const time = formatTime(hour, minute);
    const programName = getProgramForHour(hour);
    const pool = songsByStation();

    const activeSeq = getActiveSequence(hour, minute);
    const blockSongs: string[] = [];
    const localArtists = new Set<string>();

    for (const seq of activeSeq) {
      let stationName = STATION_ID_TO_DB_NAME[seq.radioSource] || stations.find(s => s.id === seq.radioSource)?.name || seq.radioSource;
      const stationPool = pool[stationName] || [];
      let found = false;
      for (const s of stationPool) {
        const key = `${s.title.toLowerCase()}-${s.artist.toLowerCase()}`;
        const artKey = s.artist.toLowerCase().trim();
        if (!usedSongs.has(key) && !localArtists.has(artKey) && !usedArtists.has(artKey)) {
          usedSongs.add(key);
          usedArtists.add(artKey);
          localArtists.add(artKey);
          blockSongs.push(`"${sanitizeFilename(`${s.artist} - ${s.title}.mp3`)}"`);
          found = true;
          break;
        }
      }
      if (!found) blockSongs.push(config.coringaCode || 'mus');
    }
    return { line: `${time} (ID=${programName}) ${blockSongs.join(',vht,')}`, type: 'normal' };
  }, [getProgramForHour, songsByStation, config.coringaCode, stations]);

  const generateFullGrade = useCallback(() => {
    if (realSongs.length === 0) return;
    const usedSongs = new Set<string>();
    const usedArtists = new Set<string>();
    const lines: Array<{ time: string; line: string; type: string }> = [];
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 30]) {
        if (hour % 2 === 0 && minute === 0) usedArtists.clear();
        lines.push({ time: formatTime(hour, minute), ...generateRealLine(hour, minute, usedSongs, usedArtists) });
      }
    }
    setGradeLines(lines);
  }, [realSongs, generateRealLine]);

  useEffect(() => { if (realSongs.length > 0) generateFullGrade(); }, [realSongs, generateFullGrade]);

  const stationCounts = realSongs.reduce<Record<string, number>>((acc, s) => {
    acc[s.station_name] = (acc[s.station_name] || 0) + 1;
    return acc;
  }, {});

  if (!isReady) return null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Montagem da Grade</h2>
          <p className="text-muted-foreground text-sm">Pool sincronizado com Captura em Tempo Real</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchRealSongs} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Atualizar Pool
          </Button>
          <Button size="sm" onClick={generateFullGrade}>Gerar Grade</Button>
        </div>
      </div>

      <Card className="glass-card border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground">Emissoras Seletas (Pool):</span>
            {Object.entries(stationCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
              <Badge key={name} variant="secondary" className="text-xs">{name}: {count}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="preview">
        <TabsList>
          <TabsTrigger value="preview">Prévia da Grade</TabsTrigger>
          <TabsTrigger value="settings">Configurações</TabsTrigger>
        </TabsList>
        <TabsContent value="preview">
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-[600px] font-mono text-xs">
                <div className="p-4 space-y-1">
                  {gradeLines.map((entry, i) => (
                    <div key={i} className="py-1 hover:bg-secondary/30 rounded px-2">{entry.line}</div>
                  ))}
                  {gradeLines.length === 0 && <div className="text-center p-8 text-muted-foreground">Clique em "Gerar Grade" para visualizar</div>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="settings">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <Label>Grade 24h</Label>
                <Switch checked={config.useGrade24h} onCheckedChange={(c) => setConfig({ useGrade24h: c })} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
