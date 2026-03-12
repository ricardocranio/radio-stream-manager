import { useState, useEffect, useCallback } from 'react';
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
import type { SequenceConfig, WeekDay } from '@/types/radio';

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

export function GradeBuilderView() {
  const { programs, sequence, stations, rankingSongs, scheduledSequences, fixedContent, config } = useRadioStore();
  const { toast } = useToast();
  const [format, setFormat] = useState<GradeFormat>(defaultFormat);
  const [selectedHour, setSelectedHour] = useState(14);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [realSongs, setRealSongs] = useState<SongPool[]>([]);
  const [gradeLines, setGradeLines] = useState<Array<{ time: string; line: string; type: string }>>([]);

  // Fetch real songs from database
  const fetchRealSongs = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .order('scraped_at', { ascending: false })
        .limit(2000);
      if (error) throw error;

      // Also fetch from radio_historico as fallback
      const { data: historico } = await supabase
        .from('radio_historico')
        .select('title, artist, station_name, captured_at')
        .order('captured_at', { ascending: false })
        .limit(500);

      const allSongs = [
        ...(data || []),
        ...(historico || []).map(h => ({
          title: h.title,
          artist: h.artist,
          station_name: h.station_name,
          scraped_at: h.captured_at,
        })),
      ];

      // Deduplicate
      const seen = new Set<string>();
      const unique = allSongs.filter(s => {
        const key = `${s.title.toLowerCase()}-${s.artist.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setRealSongs(unique);
      toast({ title: '🎵 Músicas carregadas', description: `${unique.length} músicas reais disponíveis de ${new Set(unique.map(s => s.station_name)).size} emissoras.` });
    } catch (err) {
      console.error('Error fetching songs:', err);
      toast({ title: 'Erro', description: 'Falha ao buscar músicas do banco de dados.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Load songs on mount
  useEffect(() => {
    fetchRealSongs();
  }, []);

  // Build songs by station
  const songsByStation = useCallback((): Record<string, SongPool[]> => {
    const map: Record<string, SongPool[]> = {};
    for (const song of realSongs) {
      if (!map[song.station_name]) map[song.station_name] = [];
      map[song.station_name].push(song);
    }
    return map;
  }, [realSongs]);

  // Get active sequence for a specific block
  const getActiveSequenceForBlock = useCallback((hour: number, minute: number): SequenceConfig[] => {
    const timeMinutes = hour * 60 + minute;
    const dayMapArr = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
    const currentDay = dayMapArr[new Date().getDay()];

    const activeScheduled = scheduledSequences
      .filter(s => s.enabled)
      .filter(s => s.weekDays.length === 0 || s.weekDays.includes(currentDay))
      .filter(s => {
        const startMin = s.startHour * 60 + s.startMinute;
        const endMin = s.endHour * 60 + s.endMinute;
        if (endMin <= startMin) return timeMinutes >= startMin || timeMinutes < endMin;
        return timeMinutes >= startMin && timeMinutes < endMin;
      })
      .sort((a, b) => b.priority - a.priority);

    return activeScheduled.length > 0 ? activeScheduled[0].sequence : sequence;
  }, [scheduledSequences, sequence]);

  const getProgramForHour = useCallback((hour: number) => {
    for (const prog of programs) {
      const [start, end] = prog.timeRange.split('-').map(Number);
      if (hour >= start && hour <= end) return prog.programName;
    }
    return 'PROGRAMA';
  }, [programs]);

  const isWeekday = () => {
    const day = new Date().getDay();
    return day >= 1 && day <= 5;
  };

  const formatTime = (hour: number, minute: number) => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  // Generate a full grade line with REAL songs
  const generateRealLine = useCallback((hour: number, minute: number, usedSongs: Set<string>, usedArtists: Set<string>): { line: string; type: string } => {
    const time = formatTime(hour, minute);
    const programName = getProgramForHour(hour);
    const pool = songsByStation();

    // Voz do Brasil (21:00 weekdays)
    if (hour === 21 && minute === 0 && isWeekday()) {
      return { line: `${time} (FIXO ID=VOZ DO BRASIL) vht,vozbrasil`, type: 'vozbrasil' };
    }

    // Misturadão (20:00/20:30 weekdays)
    if (hour === 20 && (minute === 0 || minute === 30) && isWeekday()) {
      const dayNames = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
      const dayName = dayNames[new Date().getDay()];
      const sorted = [...rankingSongs].sort((a, b) => b.plays - a.plays);

      const getRankSong = (pos: number): string => {
        if (pos < sorted.length) {
          const s = sorted[pos];
          return `"${sanitizeFilename(`${s.artist} - ${s.title}.mp3`)}"`;
        }
        return config.coringaCode || 'mus';
      };

      if (minute === 0) {
        return {
          line: `${time} (ID=MISTURADAO) "MISTURADAO_BLOCO01_${dayName}.mp3",vht,${getRankSong(4)},vht,"MISTURADAO_BLOCO02_${dayName}.mp3",vht,${getRankSong(1)}`,
          type: 'misturadao',
        };
      } else {
        return {
          line: `${time} (ID=MISTURADAO) "MISTURADAO_BLOCO03_${dayName}.mp3",vht,${getRankSong(7)},vht,"MISTURADAO_BLOCO04_${dayName}.mp3",vht,${getRankSong(8)}`,
          type: 'misturadao',
        };
      }
    }

    // TOP50 (19:00/19:30)
    const top50Item = fixedContent.find(fc => fc.type === 'top50' && fc.enabled && fc.timeSlots.some(ts => ts.hour === hour && ts.minute === minute));
    if (top50Item) {
      const sorted = [...rankingSongs].sort((a, b) => b.plays - a.plays);
      const isFirst = minute === 0;
      const startIdx = isFirst ? 19 : 9;
      const endIdx = isFirst ? 10 : 0;
      const posRange = isFirst ? '20→11' : '10→01';
      const songs: string[] = [];

      for (let i = startIdx; i >= endIdx && songs.length < 10; i--) {
        if (i < sorted.length) {
          songs.push(`"${sanitizeFilename(`${sorted[i].artist} - ${sorted[i].title}.mp3`)}"`);
        } else {
          songs.push(config.coringaCode || 'mus');
        }
      }
      while (songs.length < 10) songs.push(config.coringaCode || 'mus');

      return {
        line: `${time} (ID=TOP50 ${posRange}) ${songs.join(',vht,')}`,
        type: 'top50',
      };
    }

    // Madrugada (00:00-04:30) - Mix from all stations
    if (hour >= 0 && hour <= 4) {
      const allPool = realSongs.filter(s => !usedSongs.has(`${s.title.toLowerCase()}-${s.artist.toLowerCase()}`));
      const shuffled = [...allPool].sort(() => Math.random() - 0.5);
      const picked: string[] = [];
      const localArtists = new Set<string>();

      for (const s of shuffled) {
        if (picked.length >= 10) break;
        const artistKey = s.artist.toLowerCase().trim();
        if (localArtists.has(artistKey)) continue;
        localArtists.add(artistKey);
        usedSongs.add(`${s.title.toLowerCase()}-${s.artist.toLowerCase()}`);
        usedArtists.add(artistKey);
        picked.push(`"${sanitizeFilename(`${s.artist} - ${s.title}.mp3`)}"`);
      }
      while (picked.length < 10) picked.push(config.coringaCode || 'mus');

      return {
        line: `${time} (ID=${programName}) ${picked.join(',vht,')}`,
        type: 'madrugada',
      };
    }

    // Sertanejo Nossa (05:00-07:30)
    if (hour >= 5 && hour <= 7) {
      const sertStations = ['Liberdade FM', 'Positiva FM', 'Positividade FM'];
      const sertPool = realSongs.filter(s =>
        sertStations.some(st => s.station_name.toLowerCase().includes(st.toLowerCase().replace(' fm', ''))) &&
        !usedSongs.has(`${s.title.toLowerCase()}-${s.artist.toLowerCase()}`)
      );
      const shuffled = [...sertPool].sort(() => Math.random() - 0.5);
      const picked: string[] = [];
      const localArtists = new Set<string>();

      for (const s of shuffled) {
        if (picked.length >= 10) break;
        const artistKey = s.artist.toLowerCase().trim();
        if (localArtists.has(artistKey)) continue;
        localArtists.add(artistKey);
        usedSongs.add(`${s.title.toLowerCase()}-${s.artist.toLowerCase()}`);
        picked.push(`"${sanitizeFilename(`${s.artist} - ${s.title}.mp3`)}"`);
      }
      // Fill remaining with general pool
      if (picked.length < 10) {
        const generalPool = realSongs.filter(s => !usedSongs.has(`${s.title.toLowerCase()}-${s.artist.toLowerCase()}`));
        for (const s of generalPool) {
          if (picked.length >= 10) break;
          const artistKey = s.artist.toLowerCase().trim();
          if (localArtists.has(artistKey)) continue;
          localArtists.add(artistKey);
          usedSongs.add(`${s.title.toLowerCase()}-${s.artist.toLowerCase()}`);
          picked.push(`"${sanitizeFilename(`${s.artist} - ${s.title}.mp3`)}"`);
        }
      }
      while (picked.length < 10) picked.push('clas');

      return {
        line: `${time} (ID=Sertanejo Nossa) ${picked.join(',vht,')}`,
        type: 'sertanejo',
      };
    }

    // === Normal Block: Follow active sequence ===
    const activeSeq = getActiveSequenceForBlock(hour, minute);
    const blockSongs: string[] = [];
    const localArtists = new Set<string>();

    // Fixed content for this time slot
    const fixedItem = fixedContent.find(fc =>
      fc.enabled && fc.type !== 'top50' && fc.type !== 'vozbrasil' &&
      fc.timeSlots.some(ts => ts.hour === hour && ts.minute === minute)
    );

    for (const seq of activeSeq) {
      if (blockSongs.length >= activeSeq.length) break;

      // Handle fixo_ items
      if (seq.radioSource.startsWith('fixo_')) {
        const contentId = seq.radioSource.replace('fixo_', '');
        const content = fixedContent.find(fc => fc.id === contentId && fc.enabled);
        if (content) {
          const dayNames = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
          const dayName = dayNames[new Date().getDay()];
          let fileName = seq.customFileName || content.fileName;
          fileName = fileName.replace(/\{HH\}/gi, hour.toString().padStart(2, '0')).replace(/\{DIA\}/gi, dayName).replace(/\{DD\}/gi, dayName);
          if (!fileName.toLowerCase().endsWith('.mp3')) fileName += '.mp3';
          blockSongs.push(`"${fileName}"`);
          continue;
        }
        blockSongs.push(config.coringaCode || 'mus');
        continue;
      }

      // Handle top50 in sequence
      if (seq.radioSource === 'top50') {
        const sorted = [...rankingSongs].sort((a, b) => b.plays - a.plays);
        let found = false;
        for (const rs of sorted) {
          const key = `${rs.title.toLowerCase()}-${rs.artist.toLowerCase()}`;
          const artKey = rs.artist.toLowerCase().trim();
          if (!usedSongs.has(key) && !localArtists.has(artKey)) {
            usedSongs.add(key);
            localArtists.add(artKey);
            blockSongs.push(`"${sanitizeFilename(`${rs.artist} - ${rs.title}.mp3`)}"`);
            found = true;
            break;
          }
        }
        if (!found) blockSongs.push(config.coringaCode || 'mus');
        continue;
      }

      // Handle random_pop
      if (seq.radioSource === 'random_pop') {
        const available = realSongs.filter(s => !usedSongs.has(`${s.title.toLowerCase()}-${s.artist.toLowerCase()}`));
        const shuffled = [...available].sort(() => Math.random() - 0.5);
        let found = false;
        for (const s of shuffled) {
          const artKey = s.artist.toLowerCase().trim();
          if (!localArtists.has(artKey)) {
            usedSongs.add(`${s.title.toLowerCase()}-${s.artist.toLowerCase()}`);
            localArtists.add(artKey);
            blockSongs.push(`"${sanitizeFilename(`${s.artist} - ${s.title}.mp3`)}"`);
            found = true;
            break;
          }
        }
        if (!found) blockSongs.push(config.coringaCode || 'mus');
        continue;
      }

      // Normal station: resolve name
      let stationName = STATION_ID_TO_DB_NAME[seq.radioSource] || '';
      if (!stationName) {
        const stConfig = stations.find(s => s.id === seq.radioSource);
        stationName = stConfig?.name || '';
      }

      // Find song from this station
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

      // Fallback: try all stations with similar style
      if (!found) {
        const stStyle = stations.find(s => s.id === seq.radioSource)?.styles?.[0] || '';
        for (const [, songs] of Object.entries(pool)) {
          for (const s of songs) {
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
          if (found) break;
        }
      }

      if (!found) {
        blockSongs.push(config.coringaCode || 'mus');
      }
    }

    // Insert fixed content
    let allContent = [...blockSongs];
    if (fixedItem) {
      const dayNames = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
      const dayName = dayNames[new Date().getDay()];
      let fileName = fixedItem.fileName
        .replace(/\{HH\}/gi, hour.toString().padStart(2, '0'))
        .replace(/\{DIA\}/gi, dayName)
        .replace(/\{DD\}/gi, dayName)
        .replace(/\{ED\}/gi, '01');
      if (!fileName.toLowerCase().endsWith('.mp3')) fileName += `_${dayName}.mp3`;
      const fixedStr = `"${fileName}"`;
      const pos = fixedItem.position || 'start';
      if (pos === 'start') allContent = [fixedStr, ...blockSongs];
      else if (pos === 'end') allContent = [...blockSongs, fixedStr];
      else if (pos === 'middle') {
        const mid = Math.floor(blockSongs.length / 2);
        allContent = [...blockSongs.slice(0, mid), fixedStr, ...blockSongs.slice(mid)];
      }
    }

    return {
      line: `${time} (ID=${programName}) ${allContent.join(',vht,')}`,
      type: 'normal',
    };
  }, [getProgramForHour, songsByStation, realSongs, rankingSongs, fixedContent, config.coringaCode, getActiveSequenceForBlock, stations, sequence]);

  // Generate full day grade
  const generateFullGrade = useCallback(() => {
    if (realSongs.length === 0) return;

    const usedSongs = new Set<string>();
    const usedArtists = new Set<string>();
    const lines: Array<{ time: string; line: string; type: string }> = [];

    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 30]) {
        // Reset used artists every 2 hours for variety
        if (hour % 2 === 0 && minute === 0) {
          usedArtists.clear();
        }
        const result = generateRealLine(hour, minute, usedSongs, usedArtists);
        lines.push({ time: formatTime(hour, minute), ...result });
      }
    }

    setGradeLines(lines);
  }, [realSongs, generateRealLine]);

  // Auto-generate when songs are loaded
  useEffect(() => {
    if (realSongs.length > 0 && gradeLines.length === 0) {
      generateFullGrade();
    }
  }, [realSongs, gradeLines.length, generateFullGrade]);

  // Get demo songs for the visual builder tab (use real songs if available)
  const getDemoSongs = useCallback(() => {
    if (realSongs.length === 0) return [];
    const activeSeq = getActiveSequenceForBlock(selectedHour, selectedMinute);
    const pool = songsByStation();
    const songs: Array<{ file: string; source: string; station: string }> = [];

    for (const seq of activeSeq) {
      let stationName = STATION_ID_TO_DB_NAME[seq.radioSource] || '';
      if (!stationName) {
        const st = stations.find(s => s.id === seq.radioSource);
        stationName = st?.name || seq.radioSource;
      }
      const stationPool = pool[stationName] || [];
      if (stationPool.length > 0) {
        const song = stationPool[Math.floor(Math.random() * stationPool.length)];
        songs.push({
          file: sanitizeFilename(`${song.artist} - ${song.title}.mp3`),
          source: seq.radioSource.toUpperCase().slice(0, 4),
          station: stationName,
        });
      } else {
        songs.push({ file: 'mus', source: seq.radioSource.toUpperCase().slice(0, 4), station: stationName });
      }
    }
    return songs;
  }, [realSongs, selectedHour, selectedMinute, getActiveSequenceForBlock, songsByStation, stations]);

  const getLineColor = (type: string) => {
    switch (type) {
      case 'vozbrasil': return 'text-green-400';
      case 'misturadao': return 'text-amber-400';
      case 'madrugada': return 'text-blue-400';
      case 'sertanejo': return 'text-orange-400';
      case 'top50': return 'text-yellow-400';
      default: return 'text-foreground';
    }
  };

  const handleReset = () => {
    setFormat(defaultFormat);
    toast({ title: 'Formato resetado', description: 'Configurações restauradas para o padrão.' });
  };

  const handleSave = () => {
    toast({ title: 'Formato salvo', description: 'O formato será usado na próxima exportação.' });
  };

  // Stats
  const stationCounts = realSongs.reduce<Record<string, number>>((acc, s) => {
    acc[s.station_name] = (acc[s.station_name] || 0) + 1;
    return acc;
  }, {});

  const demoSongs = getDemoSongs();

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground truncate">Montagem da Grade (%dd%.txt)</h2>
          <p className="text-muted-foreground text-sm">
            Grade gerada com {realSongs.length} músicas reais de {Object.keys(stationCounts).length} emissoras
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={fetchRealSongs} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin sm:mr-2" /> : <RefreshCw className="w-4 h-4 sm:mr-2" />}
            <span className="hidden sm:inline">Atualizar Músicas</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Resetar</span>
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Salvar Formato</span>
          </Button>
        </div>
      </div>

      {/* Station Pool Stats */}
      <Card className="glass-card border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground">Pool por emissora:</span>
            {Object.entries(stationCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
              <Badge key={name} variant="secondary" className="text-xs">
                {name}: {count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* File Name Pattern */}
      <Card className="glass-card border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              <span className="font-medium">Nome do Arquivo:</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-lg">
              <Badge variant="secondary" className="text-primary">%dd%</Badge>
              <span className="text-muted-foreground">{format.fileExtension}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <div className="flex gap-2 flex-wrap">
              {Object.entries(dayMap).map(([code, name]) => (
                <Badge key={code} variant="outline" className="font-mono text-xs">
                  {code}{format.fileExtension}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="preview" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="preview" className="gap-2">
            <Eye className="w-4 h-4" />
            Prévia Completa
          </TabsTrigger>
          <TabsTrigger value="visual" className="gap-2">
            <Layers className="w-4 h-4" />
            Montagem Visual
          </TabsTrigger>
          <TabsTrigger value="format" className="gap-2">
            <Edit3 className="w-4 h-4" />
            Formato
          </TabsTrigger>
        </TabsList>

        {/* Full Preview - NOW FIRST */}
        <TabsContent value="preview">
          <Card className="glass-card">
            <CardHeader className="border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Prévia com Músicas Reais — {dayMap[['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'][new Date().getDay()]] || 'Hoje'}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={generateFullGrade} disabled={isLoading || realSongs.length === 0}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Regenerar
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center p-12">
                  <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
                  <span className="text-muted-foreground">Carregando músicas reais...</span>
                </div>
              ) : gradeLines.length === 0 ? (
                <div className="flex items-center justify-center p-12 text-muted-foreground">
                  Nenhuma música disponível. Aguarde o monitoramento capturar dados.
                </div>
              ) : (
                <div className="max-h-[600px] overflow-auto bg-background/50 font-mono text-xs">
                  <div className="p-4 space-y-0.5">
                    {gradeLines.map((entry, i) => (
                      <div
                        key={i}
                        className={`py-1 px-2 rounded hover:bg-secondary/30 ${getLineColor(entry.type)}`}
                      >
                        {entry.line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Visual Builder */}
        <TabsContent value="visual">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  Estrutura de uma Linha (Músicas Reais)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-24 text-sm text-muted-foreground">Horário</div>
                    <div className="flex-1 p-3 rounded-lg bg-primary/10 border border-primary/30 font-mono">
                      <span className="text-primary">{formatTime(selectedHour, selectedMinute)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-24 text-sm text-muted-foreground">Programa</div>
                    <div className="flex-1 p-3 rounded-lg bg-accent/10 border border-accent/30 font-mono">
                      <span className="text-muted-foreground">(</span>
                      <span className="text-accent">ID={getProgramForHour(selectedHour)}</span>
                      <span className="text-muted-foreground">)</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-24 text-sm text-muted-foreground pt-3">Músicas</div>
                    <div className="flex-1 space-y-2">
                      {demoSongs.slice(0, 5).map((song, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Badge variant="outline" className="w-6 h-6 flex items-center justify-center text-xs">
                            {index + 1}
                          </Badge>
                          <div className="flex-1 p-2 rounded bg-secondary/50 text-xs font-mono truncate">
                            <span className="text-success">"</span>
                            <span className="text-foreground">{song.file}</span>
                            <span className="text-success">"</span>
                          </div>
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {song.station}
                          </Badge>
                        </div>
                      ))}
                      {demoSongs.length > 5 && (
                        <div className="text-center text-muted-foreground text-xs py-2">
                          ... mais {demoSongs.length - 5} músicas (posições 6-{demoSongs.length})
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-24 text-sm text-muted-foreground">Separador</div>
                    <div className="flex-1 p-3 rounded-lg bg-warning/10 border border-warning/30 font-mono text-center">
                      <span className="text-warning">,vht,</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border">
                  <Label className="text-xs text-muted-foreground">Simular horário:</Label>
                  <div className="flex gap-2 mt-2">
                    <Select value={selectedHour.toString()} onValueChange={(v) => setSelectedHour(parseInt(v))}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, i) => (
                          <SelectItem key={i} value={i.toString()}>{i.toString().padStart(2, '0')}h</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={selectedMinute.toString()} onValueChange={(v) => setSelectedMinute(parseInt(v))}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">00 min</SelectItem>
                        <SelectItem value="30">30 min</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Code className="w-4 h-4 text-primary" />
                  Sequência Ativa
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <h4 className="text-xs font-medium text-primary mb-3">
                    Fontes para {formatTime(selectedHour, selectedMinute)}
                  </h4>
                  <div className="grid grid-cols-5 gap-2">
                    {getActiveSequenceForBlock(selectedHour, selectedMinute).map((seq, idx) => {
                      const station = stations.find(s => s.id === seq.radioSource);
                      const name = seq.radioSource.startsWith('fixo_') ? '📌 FIXO' :
                        seq.radioSource === 'top50' ? '🏆 TOP25' :
                        seq.radioSource === 'random_pop' ? '🎲 RAND' :
                        station?.name || seq.radioSource;
                      return (
                        <div key={idx} className="text-center">
                          <div className="w-8 h-8 mx-auto rounded-lg bg-secondary flex items-center justify-center font-bold text-sm">
                            {idx + 1}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1 truncate">{name}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Scheduled sequence indicator */}
                {scheduledSequences.filter(s => s.enabled).length > 0 && (
                  <div className="mt-4 space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground">Sequências programadas:</h4>
                    {scheduledSequences.filter(s => s.enabled).map(sched => (
                      <div key={sched.id} className="text-xs p-2 rounded bg-secondary/30 flex justify-between">
                        <span>{sched.name}</span>
                        <span className="text-muted-foreground">
                          {formatTime(sched.startHour, sched.startMinute)}-{formatTime(sched.endHour, sched.endMinute)}
                          {sched.weekDays.length > 0 ? ` (${sched.weekDays.join(', ')})` : ' (todos)'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Format Settings */}
        <TabsContent value="format">
          <Card className="glass-card">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-sm">Configurações de Formato</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <Label>Formato do Horário</Label>
                    <Input value={format.timeFormat} onChange={(e) => setFormat({ ...format, timeFormat: e.target.value })} className="mt-2 font-mono" placeholder="HH:MM" />
                    <p className="text-xs text-muted-foreground mt-1">Use HH para hora e MM para minutos</p>
                  </div>
                  <div>
                    <Label>Separador entre Músicas</Label>
                    <Input value={format.separator} onChange={(e) => setFormat({ ...format, separator: e.target.value })} className="mt-2 font-mono" placeholder=",vht," />
                  </div>
                  <div>
                    <Label>Prefixo do Programa</Label>
                    <Input value={format.programPrefix} onChange={(e) => setFormat({ ...format, programPrefix: e.target.value })} className="mt-2 font-mono" placeholder="ID=" />
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label>Texto de Bloco Fixo</Label>
                    <Input value={format.fixedBlockText} onChange={(e) => setFormat({ ...format, fixedBlockText: e.target.value })} className="mt-2 font-mono" placeholder="Fixo" />
                  </div>
                  <div>
                    <Label>Extensão do Arquivo</Label>
                    <Input value={format.fileExtension} onChange={(e) => setFormat({ ...format, fileExtension: e.target.value })} className="mt-2 font-mono" placeholder=".txt" />
                  </div>
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                      <Label className="text-sm">Aspas nos nomes das músicas</Label>
                      <Switch checked={format.songQuotes} onCheckedChange={(checked) => setFormat({ ...format, songQuotes: checked })} />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                      <Label className="text-sm">Incluir fonte (BH, BAND, etc)</Label>
                      <Switch checked={format.includeSource} onCheckedChange={(checked) => setFormat({ ...format, includeSource: checked })} />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
