import { useState } from 'react';
import { Download, FileText, Calendar, Clock, Copy, Check, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore } from '@/store/radioStore';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function ExportView() {
  const { programs, sequence, config } = useRadioStore();
  const { toast } = useToast();
  const [selectedDay, setSelectedDay] = useState('SEX');
  const [showPreview, setShowPreview] = useState(true);
  const [copied, setCopied] = useState(false);

  const days = [
    { value: 'SEG', label: 'Segunda-feira' },
    { value: 'TER', label: 'Terça-feira' },
    { value: 'QUA', label: 'Quarta-feira' },
    { value: 'QUI', label: 'Quinta-feira' },
    { value: 'SEX', label: 'Sexta-feira' },
    { value: 'sáb', label: 'Sábado' },
    { value: 'DOM', label: 'Domingo' },
  ];

  // Generate demo grade content
  const generateGradeContent = () => {
    const blocks: string[] = [];

    // Demo songs for each station
    const songsByStation: Record<string, string[]> = {
      bh: [
        'Evidências - Chitãozinho & Xororó.mp3',
        'Atrasadinha - Felipe Araújo.mp3',
        'Medo Bobo - Maiara & Maraisa.mp3',
        'Propaganda - Jorge & Mateus.mp3',
        'Péssimo Negócio - Henrique & Juliano.mp3',
      ],
      band: [
        'Deixa Eu Te Amar - Sorriso Maroto.mp3',
        'Sorte - Thiaguinho.mp3',
        'Amor Da Sua Cama - Bruno & Marrone.mp3',
        'Fatalmente - Turma do Pagode.mp3',
      ],
      disney: ['Shallow - Lady Gaga.mp3', 'Blinding Lights - The Weeknd.mp3'],
      metro: ['Hear Me Now - Alok.mp3', 'Dance Monkey - Tones and I.mp3'],
    };

    // Generate blocks for each half hour
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 30]) {
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

        // Find program for this hour
        let programName = 'PROGRAMA';
        for (const prog of programs) {
          const [start, end] = prog.timeRange.split('-').map(Number);
          if (hour >= start && hour <= end) {
            programName = prog.programName;
            break;
          }
        }

        // Skip fixed hours (19:00, 19:30)
        if (hour === 19) {
          blocks.push(`${timeStr} (Fixo ID=${programName})`);
          continue;
        }

        // Generate songs based on sequence
        const songs: string[] = [];
        const numSongs = hour === 18 ? 3 : 10;

        for (let i = 0; i < numSongs; i++) {
          const seqItem = sequence[i];
          let station = seqItem?.radioSource || 'bh';
          if (station === 'random_pop') {
            station = Math.random() > 0.5 ? 'disney' : 'metro';
          }
          const stationSongs = songsByStation[station] || songsByStation.bh;
          const song = stationSongs[i % stationSongs.length];
          songs.push(`"${song}"`);
        }

        blocks.push(`${timeStr} (ID=${programName}) ${songs.join(',vht,')}`);
      }
    }

    return blocks.join('\n');
  };

  const gradeContent = generateGradeContent();

  const handleDownload = () => {
    const blob = new Blob([gradeContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedDay}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: 'Grade exportada!',
      description: `Arquivo ${selectedDay}.txt baixado com sucesso.`,
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(gradeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: 'Copiado!',
      description: 'Conteúdo da grade copiado para a área de transferência.',
    });
  };

  const lineCount = gradeContent.split('\n').length;
  const charCount = gradeContent.length;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Exportar Grade</h2>
          <p className="text-muted-foreground">
            Gere e baixe o arquivo .txt no formato do script Python
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedDay} onValueChange={setSelectedDay}>
            <SelectTrigger className="w-48">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Selecione o dia" />
            </SelectTrigger>
            <SelectContent>
              {days.map((day) => (
                <SelectItem key={day.value} value={day.value}>
                  {day.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleDownload}>
            <Download className="w-4 h-4 mr-2" />
            Baixar {selectedDay}.txt
          </Button>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Arquivo</p>
                <p className="font-mono font-bold text-foreground">{selectedDay}.txt</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Clock className="w-8 h-8 text-accent" />
              <div>
                <p className="text-sm text-muted-foreground">Blocos</p>
                <p className="font-mono font-bold text-foreground">{lineCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-success" />
              <div>
                <p className="text-sm text-muted-foreground">Caracteres</p>
                <p className="font-mono font-bold text-foreground">{charCount.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-8 h-8 text-warning" />
              <div>
                <p className="text-sm text-muted-foreground">Gerado em</p>
                <p className="font-mono text-sm text-foreground">
                  {format(new Date(), 'dd/MM HH:mm')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Format Info */}
      <Card className="glass-card border-primary/20">
        <CardHeader className="border-b border-border py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Formato do Arquivo
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-2">Estrutura de cada linha:</p>
              <code className="block bg-secondary/50 p-3 rounded font-mono text-xs">
                HH:MM (ID=NomePrograma) "musica1.mp3",vht,"musica2.mp3",vht,...
              </code>
            </div>
            <div>
              <p className="text-muted-foreground mb-2">Exemplo:</p>
              <code className="block bg-secondary/50 p-3 rounded font-mono text-xs">
                14:00 (ID=Tarde Animada) "Evidências.mp3",vht,"Shallow.mp3"
              </code>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="outline" className="text-xs">
              <span className="text-primary">vht</span> = Separador entre músicas
            </Badge>
            <Badge variant="outline" className="text-xs">
              <span className="text-primary">ID=</span> Nome do programa
            </Badge>
            <Badge variant="outline" className="text-xs">
              <span className="text-primary">Fixo</span> = Bloco sem música automática
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Prévia do Arquivo
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}>
                {showPreview ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                {showPreview ? 'Ocultar' : 'Mostrar'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? 'Copiado!' : 'Copiar'}
              </Button>
            </div>
          </div>
        </CardHeader>
        {showPreview && (
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-auto bg-background/50">
              <pre className="p-4 font-mono text-xs text-foreground whitespace-pre-wrap">
                {gradeContent}
              </pre>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        {days.map((day) => (
          <Button
            key={day.value}
            variant={selectedDay === day.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setSelectedDay(day.value);
            }}
          >
            <Download className="w-3 h-3 mr-2" />
            {day.value}.txt
          </Button>
        ))}
      </div>
    </div>
  );
}
