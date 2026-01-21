import { useState } from 'react';
import { GripVertical, Save, RotateCcw, Plus, Trash2, Clock, Edit2, Calendar, Power, PlusCircle, MinusCircle } from 'lucide-react';
import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ScheduledSequence, SequenceConfig, WeekDay } from '@/types/radio';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

const WEEK_DAYS: { value: WeekDay; label: string }[] = [
  { value: 'dom', label: 'Dom' },
  { value: 'seg', label: 'Seg' },
  { value: 'ter', label: 'Ter' },
  { value: 'qua', label: 'Qua' },
  { value: 'qui', label: 'Qui' },
  { value: 'sex', label: 'Sex' },
  { value: 'sab', label: 'Sáb' },
];

export function SequenceView() {
  const { 
    sequence, 
    setSequence, 
    stations, 
    scheduledSequences,
    addScheduledSequence,
    updateScheduledSequence,
    removeScheduledSequence,
    fixedContent,
  } = useRadioStore();
  const { toast } = useToast();
  const [localSequence, setLocalSequence] = useState(sequence);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduledSequence | null>(null);

  // Form state for new/edit scheduled sequence
  const [formName, setFormName] = useState('');
  const [formStartHour, setFormStartHour] = useState(18);
  const [formStartMinute, setFormStartMinute] = useState(0);
  const [formEndHour, setFormEndHour] = useState(22);
  const [formEndMinute, setFormEndMinute] = useState(0);
  const [formWeekDays, setFormWeekDays] = useState<WeekDay[]>([]);
  const [formPriority, setFormPriority] = useState(1);
  const [formSequence, setFormSequence] = useState<SequenceConfig[]>(sequence);

  // Build radio options with stations first, then special options, FIXO at the end
  const stationOptions = stations
    .filter(s => s.enabled !== false)
    .map((s) => ({ value: s.id, label: s.name }));
  
  const radioOptions = [
    ...stationOptions,
    { value: 'random_pop', label: '🎲 Aleatório (Disney/Metro)' },
    { value: 'top50', label: '🏆 TOP50 (Curadoria)' },
    { value: 'fixo', label: '📌 FIXO (Conteúdo Fixo)' },
  ];

  const handleChange = (position: number, value: string) => {
    setLocalSequence((prev) =>
      prev.map((item) => (item.position === position ? { ...item, radioSource: value } : item))
    );
  };

  const handleFormSequenceChange = (position: number, value: string) => {
    setFormSequence((prev) =>
      prev.map((item) => (item.position === position ? { ...item, radioSource: value } : item))
    );
  };

  const handleSave = () => {
    setSequence(localSequence);
    toast({
      title: 'Sequência padrão salva',
      description: 'A sequência de montagem foi atualizada.',
    });
  };

  const handleReset = () => {
    setLocalSequence(sequence);
    toast({
      title: 'Alterações descartadas',
      description: 'A sequência foi restaurada.',
    });
  };

  const handleAddPosition = () => {
    const newPosition = localSequence.length + 1;
    setLocalSequence([...localSequence, { position: newPosition, radioSource: 'bh' }]);
    toast({
      title: 'Posição adicionada',
      description: `Posição ${newPosition} foi criada.`,
    });
  };

  const handleRemoveLastPosition = () => {
    if (localSequence.length <= 5) {
      toast({
        title: 'Mínimo atingido',
        description: 'A sequência precisa ter pelo menos 5 posições.',
        variant: 'destructive',
      });
      return;
    }
    setLocalSequence(localSequence.slice(0, -1));
    toast({
      title: 'Posição removida',
      description: `Última posição foi removida.`,
    });
  };

  const handleAddFormPosition = () => {
    const newPosition = formSequence.length + 1;
    setFormSequence([...formSequence, { position: newPosition, radioSource: 'bh' }]);
  };

  const handleRemoveFormLastPosition = () => {
    if (formSequence.length <= 5) return;
    setFormSequence(formSequence.slice(0, -1));
  };

  const openNewScheduleDialog = () => {
    setEditingSchedule(null);
    setFormName('Nova Sequência');
    setFormStartHour(18);
    setFormStartMinute(0);
    setFormEndHour(22);
    setFormEndMinute(0);
    setFormWeekDays([]);
    setFormPriority(1);
    setFormSequence([...sequence]);
    setIsDialogOpen(true);
  };

  const openEditScheduleDialog = (schedule: ScheduledSequence) => {
    setEditingSchedule(schedule);
    setFormName(schedule.name);
    setFormStartHour(schedule.startHour);
    setFormStartMinute(schedule.startMinute);
    setFormEndHour(schedule.endHour);
    setFormEndMinute(schedule.endMinute);
    setFormWeekDays([...schedule.weekDays]);
    setFormPriority(schedule.priority);
    setFormSequence([...schedule.sequence]);
    setIsDialogOpen(true);
  };

  const handleSaveSchedule = () => {
    const scheduleData: ScheduledSequence = {
      id: editingSchedule?.id || `sched-${Date.now()}`,
      name: formName,
      startHour: formStartHour,
      startMinute: formStartMinute,
      endHour: formEndHour,
      endMinute: formEndMinute,
      weekDays: formWeekDays,
      sequence: formSequence,
      enabled: editingSchedule?.enabled ?? true,
      priority: formPriority,
    };

    if (editingSchedule) {
      updateScheduledSequence(editingSchedule.id, scheduleData);
      toast({
        title: 'Sequência atualizada',
        description: `"${formName}" foi salva com sucesso.`,
      });
    } else {
      addScheduledSequence(scheduleData);
      toast({
        title: 'Sequência criada',
        description: `"${formName}" foi adicionada.`,
      });
    }

    setIsDialogOpen(false);
  };

  const handleDeleteSchedule = (id: string, name: string) => {
    removeScheduledSequence(id);
    toast({
      title: 'Sequência removida',
      description: `"${name}" foi excluída.`,
    });
  };

  const handleToggleSchedule = (id: string, enabled: boolean) => {
    updateScheduledSequence(id, { enabled });
  };

  const toggleWeekDay = (day: WeekDay) => {
    setFormWeekDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const getStationColor = (source: string) => {
    const colors: Record<string, string> = {
      bh: 'bg-primary/20 text-primary border-primary/30',
      band: 'bg-accent/20 text-accent border-accent/30',
      clube: 'bg-green-500/20 text-green-400 border-green-500/30',
      showfm: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      globo: 'bg-red-500/20 text-red-400 border-red-500/30',
      blink: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      positiva: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
      liberdade: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      mix: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      fixo: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      random_pop: 'bg-muted text-muted-foreground border-muted-foreground/30',
      top50: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    };
    return colors[source] || 'bg-secondary text-secondary-foreground';
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      news: '📰 Notícia',
      horoscope: '🔮 Horóscopo',
      sports: '⚽ Esporte',
      weather: '🌤️ Clima',
      romance: '💕 Romance',
      curiosity: '💡 Curiosidade',
      top50: '🏆 TOP50',
      vozbrasil: '🇧🇷 Voz do Brasil',
      other: '📁 Outro',
    };
    return labels[type] || type;
  };

  const formatTime = (hour: number, minute: number) => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  // Get currently active sequence for display
  const activeSequence = getActiveSequence();
  const activeScheduled = scheduledSequences.find((s) => {
    if (!s.enabled) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = s.startHour * 60 + s.startMinute;
    const endMinutes = s.endHour * 60 + s.endMinute;
    const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
    const currentDay = dayMap[now.getDay()];
    
    if (s.weekDays.length > 0 && !s.weekDays.includes(currentDay)) return false;
    
    if (endMinutes <= startMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  });

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground">Sequência de Montagem</h2>
          <p className="text-muted-foreground text-sm">
            Configure a ordem das rádios para montar o arquivo %dd%.txt
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={openNewScheduleDialog}>
            <Clock className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Nova Programação</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Resetar</span>
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Salvar Padrão</span>
            <span className="sm:hidden">Salvar</span>
          </Button>
        </div>
      </div>

      {/* Active Sequence Indicator */}
      {activeScheduled && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
              <span className="text-sm">
                Sequência ativa: <strong>{activeScheduled.name}</strong>
                <span className="text-muted-foreground ml-2">
                  ({formatTime(activeScheduled.startHour, activeScheduled.startMinute)} - {formatTime(activeScheduled.endHour, activeScheduled.endMinute)})
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scheduled Sequences */}
      {scheduledSequences.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calendar className="w-5 h-5 text-primary" />
              Sequências Programadas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-3">
              {scheduledSequences.map((schedule) => (
                <div
                  key={schedule.id}
                  className={`flex items-center justify-between gap-4 p-3 rounded-lg border transition-all ${
                    schedule.enabled 
                      ? 'bg-secondary/30 border-border hover:border-primary/30' 
                      : 'bg-muted/20 border-muted opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Switch
                      checked={schedule.enabled}
                      onCheckedChange={(checked) => handleToggleSchedule(schedule.id, checked)}
                    />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{schedule.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>
                          {formatTime(schedule.startHour, schedule.startMinute)} - {formatTime(schedule.endHour, schedule.endMinute)}
                        </span>
                        {schedule.weekDays.length > 0 && (
                          <>
                            <span className="text-muted-foreground/50">|</span>
                            <span>{schedule.weekDays.join(', ')}</span>
                          </>
                        )}
                        {schedule.weekDays.length === 0 && (
                          <>
                            <span className="text-muted-foreground/50">|</span>
                            <span>Todos os dias</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      P{schedule.priority}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditScheduleDialog(schedule)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir sequência?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Tem certeza que deseja excluir "{schedule.name}"? Esta ação não pode ser desfeita.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeleteSchedule(schedule.id, schedule.name)}>
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Default Sequence Configuration */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center justify-between">
              <span>Sequência Padrão</span>
              {!activeScheduled && (
                <Badge variant="default" className="text-xs">
                  <Power className="w-3 h-3 mr-1" />
                  Ativa
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-2">
                {localSequence.map((item) => (
                  <div
                    key={item.position}
                    className="flex items-center gap-3 p-2 rounded-lg bg-secondary/30 border border-border hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <GripVertical className="w-4 h-4" />
                      <span className="font-mono font-bold text-foreground w-6 text-sm">
                        {item.position.toString().padStart(2, '0')}
                      </span>
                    </div>
                    <Select
                      value={item.radioSource}
                      onValueChange={(value) => handleChange(item.position, value)}
                    >
                      <SelectTrigger className="flex-1 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {radioOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Badge variant="outline" className={`${getStationColor(item.radioSource)} text-[10px]`}>
                      {item.radioSource.toUpperCase()}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="flex gap-2 mt-4 pt-4 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={handleAddPosition}
              >
                <PlusCircle className="w-4 h-4 mr-2" />
                Adicionar Posição
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRemoveLastPosition}
                disabled={localSequence.length <= 5}
              >
                <MinusCircle className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {localSequence.length} posições configuradas
            </p>
          </CardContent>
        </Card>

        {/* Fixed Content Panel - Sidebar */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="text-lg">📌</span>
              Conteúdos Fixos
              <Badge variant="secondary" className="ml-auto text-xs">
                {fixedContent.filter(c => c.enabled).length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            {fixedContent.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum conteúdo fixo cadastrado.
              </p>
            ) : (
              <ScrollArea className="h-[400px] pr-2">
                <div className="space-y-2">
                  {fixedContent.map((content) => (
                    <div
                      key={content.id}
                      className={`p-2 rounded-lg border transition-all ${
                        content.enabled
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-muted/20 border-muted opacity-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-xs truncate">{content.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{content.fileName}</p>
                        </div>
                        <Badge variant="outline" className="text-[8px] shrink-0 px-1">
                          {content.enabled ? 'ON' : 'OFF'}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                        <Badge variant="secondary" className="text-[8px] px-1 py-0">
                          {getTypeLabel(content.type)}
                        </Badge>
                        {content.position && (
                          <Badge variant="outline" className="text-[8px] px-1 py-0 bg-primary/10">
                            Pos: {content.position === 'start' ? 'Início' : content.position === 'middle' ? 'Meio' : content.position === 'end' ? 'Fim' : content.position}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[9px] text-muted-foreground mt-1 truncate">
                        {content.timeSlots.map((t) => `${t.hour.toString().padStart(2, '0')}:${t.minute.toString().padStart(2, '0')}`).slice(0, 4).join(', ')}
                        {content.timeSlots.length > 4 && ` +${content.timeSlots.length - 4}`}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Preview */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle>Prévia da Sequência</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Visualização de como as músicas serão selecionadas em cada bloco:
              </p>
              
              <div className="grid grid-cols-5 gap-2">
                {(activeScheduled ? activeSequence : localSequence).map((item) => {
                  const station = stations.find((s) => s.id === item.radioSource);
                  return (
                    <div
                      key={item.position}
                      className={`aspect-square rounded-lg flex flex-col items-center justify-center ${getStationColor(item.radioSource)} border`}
                    >
                      <span className="text-2xl font-bold">{item.position}</span>
                      <span className="text-[10px] uppercase tracking-wide mt-1 text-center px-1 truncate w-full">
                        {station?.name || item.radioSource}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 p-4 rounded-lg bg-muted/30 border border-border">
                <h4 className="font-medium text-sm mb-2">Legenda</h4>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {stations.slice(0, 6).map((station) => (
                    <div key={station.id} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${getStationColor(station.id)}`} />
                      <span className="text-muted-foreground truncate">{station.name}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-emerald-500/30" />
                    <span className="text-muted-foreground">FIXO</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-muted" />
                    <span className="text-muted-foreground">Aleatório</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-yellow-500/30" />
                    <span className="text-muted-foreground">TOP50</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <h4 className="font-medium text-sm text-primary mb-2">ℹ️ Informação</h4>
                <p className="text-xs text-muted-foreground">
                  Sequências programadas substituem a sequência padrão nos horários configurados.
                  <br />
                  <span className="text-yellow-400">Prioridade:</span> Se houver conflito de horários, a sequência com maior prioridade (P) será usada.
                  <br />
                  <span className="text-emerald-400">FIXO:</span> Insere conteúdo fixo configurado na posição selecionada.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Dialog for New/Edit Scheduled Sequence */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingSchedule ? 'Editar Sequência Programada' : 'Nova Sequência Programada'}
            </DialogTitle>
            <DialogDescription>
              Configure uma sequência que será ativada automaticamente no horário definido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex: Horário Nobre"
              />
            </div>

            {/* Time Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Início</Label>
                <div className="flex gap-2">
                  <Select
                    value={formStartHour.toString()}
                    onValueChange={(v) => setFormStartHour(parseInt(v))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={i.toString()}>
                          {i.toString().padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-2xl">:</span>
                  <Select
                    value={formStartMinute.toString()}
                    onValueChange={(v) => setFormStartMinute(parseInt(v))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 30].map((m) => (
                        <SelectItem key={m} value={m.toString()}>
                          {m.toString().padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Fim</Label>
                <div className="flex gap-2">
                  <Select
                    value={formEndHour.toString()}
                    onValueChange={(v) => setFormEndHour(parseInt(v))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={i.toString()}>
                          {i.toString().padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-2xl">:</span>
                  <Select
                    value={formEndMinute.toString()}
                    onValueChange={(v) => setFormEndMinute(parseInt(v))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 30].map((m) => (
                        <SelectItem key={m} value={m.toString()}>
                          {m.toString().padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Week Days */}
            <div className="space-y-2">
              <Label>Dias da Semana (vazio = todos)</Label>
              <div className="flex flex-wrap gap-2">
                {WEEK_DAYS.map((day) => (
                  <Badge
                    key={day.value}
                    variant={formWeekDays.includes(day.value) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleWeekDay(day.value)}
                  >
                    {day.label}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label>Prioridade (maior = mais importante)</Label>
              <Select
                value={formPriority.toString()}
                onValueChange={(v) => setFormPriority(parseInt(v))}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((p) => (
                    <SelectItem key={p} value={p.toString()}>
                      Prioridade {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sequence Config */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Sequência de Emissoras</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddFormPosition}
                  >
                    <PlusCircle className="w-3 h-3 mr-1" />
                    Posição
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveFormLastPosition}
                    disabled={formSequence.length <= 5}
                  >
                    <MinusCircle className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto p-1">
                {formSequence.map((item) => (
                  <div
                    key={item.position}
                    className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30 border border-border"
                  >
                    <span className="font-mono font-bold text-foreground w-6 text-sm">
                      {item.position.toString().padStart(2, '0')}
                    </span>
                    <Select
                      value={item.radioSource}
                      onValueChange={(value) => handleFormSequenceChange(item.position, value)}
                    >
                      <SelectTrigger className="flex-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {radioOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {formSequence.length} posições configuradas
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveSchedule}>
              <Save className="w-4 h-4 mr-2" />
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
