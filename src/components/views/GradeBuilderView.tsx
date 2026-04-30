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
    return programs.find(p => {
      const [start, end] = p.timeRange.split('-').map(Number);
      return hour >= start && hour <= end;
    })?.programName || 'PROGRAMA';
  }, [programs]);

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
  }, [generateRealLine]);

  useEffect(() => { if (realSongs.length > 0) generateFullGrade(); }, [realSongs]);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold">GradeBuilder</h2>
      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Prévia da Grade</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              {gradeLines.map((line, i) => (
                <div key={i} className="font-mono text-xs py-1 border-b border-border">
                  {line.line}
                </div>
              ))}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
