import { useState } from 'react';
import { Newspaper, Plus, Trash2, Save, Clock, Calendar, Edit2, Check, X, Star, CloudSun, Heart, Lightbulb, Trophy, Music, TrendingUp, Mic } from 'lucide-react';
import { useRadioStore, FixedContent } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

const typeIcons: Record<string, React.ReactNode> = {
  news: <Newspaper className="w-4 h-4" />,
  horoscope: <Star className="w-4 h-4" />,
  sports: <Trophy className="w-4 h-4" />,
  weather: <CloudSun className="w-4 h-4" />,
  romance: <Heart className="w-4 h-4" />,
  curiosity: <Lightbulb className="w-4 h-4" />,
  other: <Music className="w-4 h-4" />,
  top50: <TrendingUp className="w-4 h-4" />,
  vozbrasil: <Mic className="w-4 h-4" />,
};

const typeLabels: Record<string, string> = {
  news: 'Notícias',
  horoscope: 'Horóscopo',
  sports: 'Esportes',
  weather: 'Clima',
  romance: 'Romance',
  curiosity: 'Curiosidades',
  other: 'Outros',
  top50: 'TOP50 (Curadoria)',
  vozbrasil: 'A Voz do Brasil',
};

const typeColors: Record<string, string> = {
  news: 'bg-primary/20 text-primary border-primary/30',
  horoscope: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  sports: 'bg-success/20 text-success border-success/30',
  weather: 'bg-blue-400/20 text-blue-400 border-blue-400/30',
  romance: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  curiosity: 'bg-warning/20 text-warning border-warning/30',
  other: 'bg-muted text-muted-foreground border-muted-foreground/30',
  top50: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  vozbrasil: 'bg-green-500/20 text-green-400 border-green-500/30',
};


const dayPatterns = [
  { value: 'WEEKDAYS', label: 'Dias úteis (Seg-Sex)' },
  { value: 'WEEKEND', label: 'Fim de semana (Sáb-Dom)' },
  { value: 'ALL', label: 'Todos os dias' },
  { value: 'MONDAY', label: 'Segunda-feira' },
  { value: 'TUESDAY', label: 'Terça-feira' },
  { value: 'WEDNESDAY', label: 'Quarta-feira' },
  { value: 'THURSDAY', label: 'Quinta-feira' },
  { value: 'FRIDAY', label: 'Sexta-feira' },
  { value: 'SATURDAY', label: 'Sábado' },
  { value: 'SUNDAY', label: 'Domingo' },
];

export function FixedContentView() {
  const { fixedContent, updateFixedContent, addFixedContent, removeFixedContent } = useRadioStore();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newContent, setNewContent] = useState<Partial<FixedContent>>({
    name: '',
    fileName: '',
    type: 'other',
    dayPattern: 'WEEKDAYS',
    timeSlots: [],
    enabled: true,
    top50Count: 5,
  });
  const [newTimeSlot, setNewTimeSlot] = useState({ hour: 12, minute: 0 });

  const handleAddTimeSlot = () => {
    if (newContent.timeSlots) {
      const exists = newContent.timeSlots.some(
        (s) => s.hour === newTimeSlot.hour && s.minute === newTimeSlot.minute
      );
      if (!exists) {
        setNewContent({
          ...newContent,
          timeSlots: [...newContent.timeSlots, { ...newTimeSlot }].sort(
            (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute)
          ),
        });
      }
    }
  };

  const handleRemoveTimeSlot = (hour: number, minute: number) => {
    if (newContent.timeSlots) {
      setNewContent({
        ...newContent,
        timeSlots: newContent.timeSlots.filter(
          (s) => !(s.hour === hour && s.minute === minute)
        ),
      });
    }
  };

  const handleAddContent = () => {
    if (newContent.name && (newContent.fileName || newContent.type === 'top50')) {
      const content: FixedContent = {
        id: Date.now().toString(),
        name: newContent.name,
        fileName: newContent.type === 'top50' ? 'POSICAO{N}' : newContent.fileName || '',
        type: newContent.type as FixedContent['type'],
        dayPattern: newContent.dayPattern || 'WEEKDAYS',
        timeSlots: newContent.timeSlots || [],
        enabled: true,
        top50Count: newContent.type === 'top50' ? (newContent.top50Count || 5) : undefined,
      };
      addFixedContent(content);
      setShowAddDialog(false);
      setNewContent({
        name: '',
        fileName: '',
        type: 'other',
        dayPattern: 'WEEKDAYS',
        timeSlots: [],
        enabled: true,
        top50Count: 5,
      });
      toast({ title: 'Conteúdo adicionado', description: `${content.name} foi criado.` });
    }
  };

  const groupedByType = fixedContent.reduce((acc, content) => {
    if (!acc[content.type]) acc[content.type] = [];
    acc[content.type].push(content);
    return acc;
  }, {} as Record<string, FixedContent[]>);

  // Generate 24h timeline
  const timelineHours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Conteúdos Fixos</h2>
          <p className="text-muted-foreground">Gerencie notícias, horóscopo, esportes e outros conteúdos programados</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Novo Conteúdo
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Adicionar Conteúdo Fixo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <Label>Nome</Label>
                <Input
                  value={newContent.name}
                  onChange={(e) => setNewContent({ ...newContent, name: e.target.value })}
                  placeholder="Ex: Notícia da Hora"
                  className="mt-1"
                />
              </div>
              {newContent.type === 'top50' ? (
                <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                  <div className="flex items-center gap-2 text-yellow-400 mb-2">
                    <TrendingUp className="w-4 h-4" />
                    <span className="font-medium text-sm">TOP50 - Curadoria do Monitoramento</span>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Quantidade de músicas aleatórias do TOP50</Label>
                    <Select
                      value={(newContent.top50Count || 5).toString()}
                      onValueChange={(value) => setNewContent({ ...newContent, top50Count: parseInt(value) })}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 5, 8, 10, 15, 20].map((n) => (
                          <SelectItem key={n} value={n.toString()}>{n} músicas</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Na grade: "POSICAO1.MP3",vht,"POSICAO5.MP3"... (posições aleatórias)
                    </p>
                  </div>
                </div>
              ) : newContent.type === 'vozbrasil' ? (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                  <div className="flex items-center gap-2 text-green-400 mb-2">
                    <Mic className="w-4 h-4" />
                    <span className="font-medium text-sm">A Voz do Brasil</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Programa obrigatório baixado automaticamente de Seg-Sex.
                    <br />
                    Arquivo: VOZ_DO_BRASIL.MP3
                    <br />
                    Configure o download na aba "Voz do Brasil".
                  </p>
                </div>
              ) : (
                <div>
                  <Label>Nome do Arquivo (padrão)</Label>
                  <Input
                    value={newContent.fileName}
                    onChange={(e) => setNewContent({ ...newContent, fileName: e.target.value })}
                    placeholder="Ex: NOTICIA_DA_HORA_{HH}HORAS"
                    className="mt-1 font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use {'{HH}'} para hora, {'{ED}'} para edição, {'{DIA}'} para dia da semana
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tipo</Label>
                  <Select
                    value={newContent.type}
                    onValueChange={(value) => setNewContent({ ...newContent, type: value as FixedContent['type'] })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(typeLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          <div className="flex items-center gap-2">
                            {typeIcons[value]}
                            {label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Dias</Label>
                  <Select
                    value={newContent.dayPattern}
                    onValueChange={(value) => setNewContent({ ...newContent, dayPattern: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {dayPatterns.map((pattern) => (
                        <SelectItem key={pattern.value} value={pattern.value}>
                          {pattern.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Horários</Label>
                <div className="flex gap-2 mt-1">
                  <Select
                    value={newTimeSlot.hour.toString()}
                    onValueChange={(v) => setNewTimeSlot({ ...newTimeSlot, hour: parseInt(v) })}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={i.toString()}>{i.toString().padStart(2, '0')}h</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={newTimeSlot.minute.toString()}
                    onValueChange={(v) => setNewTimeSlot({ ...newTimeSlot, minute: parseInt(v) })}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">00</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={handleAddTimeSlot}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {newContent.timeSlots?.map((slot) => (
                    <Badge
                      key={`${slot.hour}-${slot.minute}`}
                      variant="secondary"
                      className="cursor-pointer hover:bg-destructive/20"
                      onClick={() => handleRemoveTimeSlot(slot.hour, slot.minute)}
                    >
                      {slot.hour.toString().padStart(2, '0')}:{slot.minute.toString().padStart(2, '0')}
                      <X className="w-3 h-3 ml-1" />
                    </Badge>
                  ))}
                </div>
              </div>
              <Button onClick={handleAddContent} className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Timeline View */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Linha do Tempo (24h)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 overflow-x-auto">
          <div className="min-w-[800px]">
            <div className="flex">
              {timelineHours.map((hour) => (
                <div key={hour} className="flex-1 text-center text-xs text-muted-foreground border-l border-border first:border-l-0">
                  {hour.toString().padStart(2, '0')}
                </div>
              ))}
            </div>
            <div className="mt-2 space-y-1">
              {fixedContent.filter((c) => c.enabled).map((content) => (
                <div key={content.id} className="flex h-6 relative">
                  {timelineHours.map((hour) => {
                    const hasSlot = content.timeSlots.some((s) => s.hour === hour);
                    return (
                      <div key={hour} className="flex-1 border-l border-border/30 first:border-l-0">
                        {hasSlot && (
                          <div
                            className={`h-full rounded-sm ${typeColors[content.type]} flex items-center justify-center`}
                            title={`${content.name} - ${hour}:00`}
                          >
                            {typeIcons[content.type]}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-border">
              {Object.entries(typeLabels).map(([type, label]) => (
                <div key={type} className="flex items-center gap-1.5 text-xs">
                  <div className={`w-4 h-4 rounded flex items-center justify-center ${typeColors[type]}`}>
                    {typeIcons[type]}
                  </div>
                  <span className="text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Content by Type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Object.entries(groupedByType).map(([type, contents]) => (
          <Card key={type} className="glass-card">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded flex items-center justify-center ${typeColors[type]}`}>
                    {typeIcons[type]}
                  </div>
                  {typeLabels[type]}
                </div>
                <Badge variant="secondary">{contents.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {contents.map((content) => (
                  <div key={content.id} className="p-4 hover:bg-secondary/30 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground truncate">{content.name}</p>
                          <Switch
                            checked={content.enabled}
                            onCheckedChange={(enabled) => updateFixedContent(content.id, { enabled })}
                            className="scale-75"
                          />
                        </div>
                        {content.type === 'top50' ? (
                          <p className="text-xs font-mono text-yellow-400/80 truncate mt-1">
                            POSICAO1.MP3, POSICAO2.MP3... ({content.top50Count || 5} músicas aleatórias)
                          </p>
                        ) : content.type === 'vozbrasil' ? (
                          <p className="text-xs font-mono text-green-400/80 truncate mt-1">
                            VOZ_DO_BRASIL.MP3 (download automático)
                          </p>
                        ) : (
                          <p className="text-xs font-mono text-muted-foreground truncate mt-1">
                            {content.fileName}_{'{DIA}'}.mp3
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {content.timeSlots.slice(0, 6).map((slot) => (
                            <Badge key={`${slot.hour}-${slot.minute}`} variant="outline" className="text-xs font-mono">
                              {slot.hour.toString().padStart(2, '0')}:{slot.minute.toString().padStart(2, '0')}
                            </Badge>
                          ))}
                          {content.timeSlots.length > 6 && (
                            <Badge variant="outline" className="text-xs">
                              +{content.timeSlots.length - 6}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            removeFixedContent(content.id);
                            toast({ title: 'Conteúdo removido' });
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
