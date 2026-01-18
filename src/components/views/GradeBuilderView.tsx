import { useState } from 'react';
import { FileText, Edit3, Save, RotateCcw, Eye, Code, Layers, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore } from '@/store/radioStore';
import { sanitizeFilename } from '@/lib/sanitizeFilename';

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
  'sáb': 'Sábado',
  'DOM': 'Domingo',
};

export function GradeBuilderView() {
  const { programs, sequence, stations } = useRadioStore();
  const { toast } = useToast();
  const [format, setFormat] = useState<GradeFormat>(defaultFormat);
  const [selectedHour, setSelectedHour] = useState(14);
  const [selectedMinute, setSelectedMinute] = useState(0);

  // Demo songs for preview
  const demoSongs = [
    { file: 'Evidências - Chitãozinho & Xororó.mp3', source: 'BH' },
    { file: 'Atrasadinha - Felipe Araújo.mp3', source: 'BH' },
    { file: 'Medo Bobo - Maiara & Maraisa.mp3', source: 'BH' },
    { file: 'Propaganda - Jorge & Mateus.mp3', source: 'BH' },
    { file: 'Péssimo Negócio - Henrique & Juliano.mp3', source: 'BH' },
    { file: 'Deixa Eu Te Amar - Sorriso Maroto.mp3', source: 'BAND' },
    { file: 'Sorte - Thiaguinho.mp3', source: 'BAND' },
    { file: 'Amor Da Sua Cama - Bruno & Marrone.mp3', source: 'BAND' },
    { file: 'Fatalmente - Turma do Pagode.mp3', source: 'BAND' },
    { file: 'Shallow - Lady Gaga.mp3', source: 'DISNEY' },
  ];

  const getProgramForHour = (hour: number) => {
    for (const prog of programs) {
      const [start, end] = prog.timeRange.split('-').map(Number);
      if (hour >= start && hour <= end) {
        return prog.programName;
      }
    }
    return 'PROGRAMA';
  };

  const formatTime = (hour: number, minute: number) => {
    return format.timeFormat
      .replace('HH', hour.toString().padStart(2, '0'))
      .replace('MM', minute.toString().padStart(2, '0'));
  };

  const formatSong = (song: { file: string; source: string }) => {
    // Sanitize filename: remove accents, replace & with "e", remove special chars
    let result = sanitizeFilename(song.file);
    if (format.songQuotes) result = `"${result}"`;
    if (format.includeSource) result = `[${song.source}] ${result}`;
    return result;
  };

  const generateLine = (hour: number, minute: number, isFixed: boolean = false) => {
    const time = formatTime(hour, minute);
    const program = getProgramForHour(hour);

    if (isFixed) {
      return `${time} (${format.fixedBlockText} ${format.programPrefix}${program})`;
    }

    const songs = demoSongs.map(formatSong).join(format.separator);
    return `${time} (${format.programPrefix}${program}) ${songs}`;
  };

  const handleReset = () => {
    setFormat(defaultFormat);
    toast({ title: 'Formato resetado', description: 'Configurações restauradas para o padrão.' });
  };

  const handleSave = () => {
    toast({ title: 'Formato salvo', description: 'O formato será usado na próxima exportação.' });
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Montagem da Grade (%dd%.txt)</h2>
          <p className="text-muted-foreground">Visualize e customize como o arquivo de grade é gerado</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Resetar
          </Button>
          <Button onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Salvar Formato
          </Button>
        </div>
      </div>

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

      <Tabs defaultValue="visual" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="visual" className="gap-2">
            <Layers className="w-4 h-4" />
            Montagem Visual
          </TabsTrigger>
          <TabsTrigger value="format" className="gap-2">
            <Edit3 className="w-4 h-4" />
            Formato
          </TabsTrigger>
          <TabsTrigger value="preview" className="gap-2">
            <Eye className="w-4 h-4" />
            Prévia Completa
          </TabsTrigger>
        </TabsList>

        {/* Visual Builder */}
        <TabsContent value="visual">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Structure Diagram */}
            <Card className="glass-card">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  Estrutura de uma Linha
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {/* Time */}
                  <div className="flex items-center gap-3">
                    <div className="w-24 text-sm text-muted-foreground">Horário</div>
                    <div className="flex-1 p-3 rounded-lg bg-primary/10 border border-primary/30 font-mono">
                      <span className="text-primary">{formatTime(selectedHour, selectedMinute)}</span>
                    </div>
                  </div>

                  {/* Program ID */}
                  <div className="flex items-center gap-3">
                    <div className="w-24 text-sm text-muted-foreground">Programa</div>
                    <div className="flex-1 p-3 rounded-lg bg-accent/10 border border-accent/30 font-mono">
                      <span className="text-muted-foreground">(</span>
                      <span className="text-accent">{format.programPrefix}{getProgramForHour(selectedHour)}</span>
                      <span className="text-muted-foreground">)</span>
                    </div>
                  </div>

                  {/* Songs */}
                  <div className="flex items-start gap-3">
                    <div className="w-24 text-sm text-muted-foreground pt-3">Músicas</div>
                    <div className="flex-1 space-y-2">
                      {sequence.slice(0, 5).map((seq, index) => {
                        const station = stations.find(s => s.id === seq.radioSource);
                        const song = demoSongs[index];
                        return (
                          <div key={seq.position} className="flex items-center gap-2">
                            <Badge variant="outline" className="w-6 h-6 flex items-center justify-center text-xs">
                              {seq.position}
                            </Badge>
                            <div className="flex-1 p-2 rounded bg-secondary/50 text-xs font-mono truncate">
                              {format.songQuotes && <span className="text-success">"</span>}
                              <span className="text-foreground">{song?.file}</span>
                              {format.songQuotes && <span className="text-success">"</span>}
                            </div>
                            <Badge variant="secondary" className="text-xs shrink-0">
                              {station?.name || seq.radioSource}
                            </Badge>
                          </div>
                        );
                      })}
                      <div className="text-center text-muted-foreground text-xs py-2">
                        ... mais 5 músicas (posições 6-10)
                      </div>
                    </div>
                  </div>

                  {/* Separator */}
                  <div className="flex items-center gap-3">
                    <div className="w-24 text-sm text-muted-foreground">Separador</div>
                    <div className="flex-1 p-3 rounded-lg bg-warning/10 border border-warning/30 font-mono text-center">
                      <span className="text-warning">{format.separator}</span>
                    </div>
                  </div>
                </div>

                {/* Hour Selector */}
                <div className="mt-6 pt-4 border-t border-border">
                  <Label className="text-xs text-muted-foreground">Simular horário:</Label>
                  <div className="flex gap-2 mt-2">
                    <Select value={selectedHour.toString()} onValueChange={(v) => setSelectedHour(parseInt(v))}>
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, i) => (
                          <SelectItem key={i} value={i.toString()}>{i.toString().padStart(2, '0')}h</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={selectedMinute.toString()} onValueChange={(v) => setSelectedMinute(parseInt(v))}>
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">00 min</SelectItem>
                        <SelectItem value="30">30 min</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Generated Line Preview */}
            <Card className="glass-card">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Code className="w-4 h-4 text-primary" />
                  Linha Gerada
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="bg-background/80 rounded-lg p-4 font-mono text-xs overflow-x-auto">
                  <pre className="whitespace-pre-wrap break-all text-foreground">
                    {generateLine(selectedHour, selectedMinute)}
                  </pre>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="text-xs text-muted-foreground">Exemplo de bloco fixo (19:00):</div>
                  <div className="bg-background/80 rounded-lg p-4 font-mono text-xs">
                    <pre className="text-muted-foreground">
                      {generateLine(19, 0, true)}
                    </pre>
                  </div>
                </div>

                {/* Sequence Legend */}
                <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <h4 className="text-xs font-medium text-primary mb-3">Sequência de Fontes (Posições 1-10)</h4>
                  <div className="grid grid-cols-5 gap-2">
                    {sequence.map((seq) => {
                      const station = stations.find(s => s.id === seq.radioSource);
                      return (
                        <div key={seq.position} className="text-center">
                          <div className="w-8 h-8 mx-auto rounded-lg bg-secondary flex items-center justify-center font-bold text-sm">
                            {seq.position}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1 truncate">
                            {station?.name || seq.radioSource}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
                    <Input
                      value={format.timeFormat}
                      onChange={(e) => setFormat({ ...format, timeFormat: e.target.value })}
                      className="mt-2 font-mono"
                      placeholder="HH:MM"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Use HH para hora e MM para minutos</p>
                  </div>

                  <div>
                    <Label>Separador entre Músicas</Label>
                    <Input
                      value={format.separator}
                      onChange={(e) => setFormat({ ...format, separator: e.target.value })}
                      className="mt-2 font-mono"
                      placeholder=",vht,"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Texto entre cada música</p>
                  </div>

                  <div>
                    <Label>Prefixo do Programa</Label>
                    <Input
                      value={format.programPrefix}
                      onChange={(e) => setFormat({ ...format, programPrefix: e.target.value })}
                      className="mt-2 font-mono"
                      placeholder="ID="
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label>Texto de Bloco Fixo</Label>
                    <Input
                      value={format.fixedBlockText}
                      onChange={(e) => setFormat({ ...format, fixedBlockText: e.target.value })}
                      className="mt-2 font-mono"
                      placeholder="Fixo"
                    />
                  </div>

                  <div>
                    <Label>Extensão do Arquivo</Label>
                    <Input
                      value={format.fileExtension}
                      onChange={(e) => setFormat({ ...format, fileExtension: e.target.value })}
                      className="mt-2 font-mono"
                      placeholder=".txt"
                    />
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                      <Label className="text-sm">Aspas nos nomes das músicas</Label>
                      <Switch
                        checked={format.songQuotes}
                        onCheckedChange={(checked) => setFormat({ ...format, songQuotes: checked })}
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                      <Label className="text-sm">Incluir fonte (BH, BAND, etc)</Label>
                      <Switch
                        checked={format.includeSource}
                        onCheckedChange={(checked) => setFormat({ ...format, includeSource: checked })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Full Preview */}
        <TabsContent value="preview">
          <Card className="glass-card">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Prévia do Arquivo SEX.txt (Exemplo)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-auto bg-background/50 font-mono text-xs">
                <div className="p-4 space-y-1">
                  {Array.from({ length: 24 }, (_, hour) => (
                    [0, 30].map((minute) => {
                      const isFixed = hour === 19;
                      const line = generateLine(hour, minute, isFixed);
                      return (
                        <div
                          key={`${hour}-${minute}`}
                          className={`py-1 px-2 rounded hover:bg-secondary/30 ${isFixed ? 'text-muted-foreground' : 'text-foreground'}`}
                        >
                          {line}
                        </div>
                      );
                    })
                  )).flat()}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
