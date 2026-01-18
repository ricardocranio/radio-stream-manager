import { useState } from 'react';
import { Clock, Save, Plus, Trash2, Edit2, Check, X, GripVertical } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ProgramSchedule } from '@/types/radio';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

const hours = Array.from({ length: 24 }, (_, i) => i);

const programColors: Record<string, string> = {
  'Nossa Madrugada': 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  'Happy Hour': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'Manhã de Hits': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Hora do Almoço': 'bg-green-500/20 text-green-400 border-green-500/30',
  'Tarde Animada': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'TOP10': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'TOP50': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'FIXO': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'VOZ_BRASIL': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'Romance': 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

export function ScheduleView() {
  const { programs, setPrograms } = useRadioStore();
  const { toast } = useToast();
  const [localPrograms, setLocalPrograms] = useState<ProgramSchedule[]>(programs);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ programName: '', startHour: 0, endHour: 0 });
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newProgram, setNewProgram] = useState({ programName: '', startHour: 0, endHour: 0 });

  const parseTimeRange = (range: string) => {
    const [start, end] = range.split('-').map(Number);
    return { start, end };
  };

  const formatTimeRange = (start: number, end: number) => `${start}-${end}`;

  const startEdit = (index: number) => {
    const program = localPrograms[index];
    const { start, end } = parseTimeRange(program.timeRange);
    setEditForm({ programName: program.programName, startHour: start, endHour: end });
    setEditingIndex(index);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditForm({ programName: '', startHour: 0, endHour: 0 });
  };

  const saveEdit = () => {
    if (editingIndex !== null && editForm.programName) {
      setLocalPrograms((prev) =>
        prev.map((p, i) =>
          i === editingIndex
            ? { ...p, programName: editForm.programName, timeRange: formatTimeRange(editForm.startHour, editForm.endHour) }
            : p
        )
      );
      setEditingIndex(null);
    }
  };

  const handleDelete = (index: number) => {
    setLocalPrograms((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    if (newProgram.programName) {
      setLocalPrograms((prev) => [
        ...prev,
        { programName: newProgram.programName, timeRange: formatTimeRange(newProgram.startHour, newProgram.endHour) },
      ]);
      setNewProgram({ programName: '', startHour: 0, endHour: 0 });
      setShowAddDialog(false);
    }
  };

  const handleSave = () => {
    setPrograms(localPrograms);
    toast({
      title: 'Programação salva',
      description: 'A grade de programação foi atualizada.',
    });
  };

  const getProgramColor = (name: string) => {
    return programColors[name] || 'bg-muted text-muted-foreground border-muted-foreground/30';
  };

  const getTimeColor = (range: string) => {
    const start = parseInt(range.split('-')[0]);
    if (start >= 6 && start < 12) return 'bg-warning/20 text-warning border-warning/30';
    if (start >= 12 && start < 18) return 'bg-accent/20 text-accent border-accent/30';
    if (start >= 18 && start < 22) return 'bg-primary/20 text-primary border-primary/30';
    return 'bg-muted text-muted-foreground border-muted-foreground/30';
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Programação</h2>
          <p className="text-muted-foreground">Configure os horários e nomes dos programas</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Plus className="w-4 h-4" />
                Novo Programa
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Programa</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label>Nome do Programa</Label>
                  <Input
                    value={newProgram.programName}
                    onChange={(e) => setNewProgram((prev) => ({ ...prev, programName: e.target.value }))}
                    placeholder="Ex: Manhã de Hits"
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Hora Início</Label>
                    <Select
                      value={newProgram.startHour.toString()}
                      onValueChange={(v) => setNewProgram((prev) => ({ ...prev, startHour: parseInt(v) }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {hours.map((h) => (
                          <SelectItem key={h} value={h.toString()}>
                            {h.toString().padStart(2, '0')}:00
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Hora Fim</Label>
                    <Select
                      value={newProgram.endHour.toString()}
                      onValueChange={(v) => setNewProgram((prev) => ({ ...prev, endHour: parseInt(v) }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {hours.map((h) => (
                          <SelectItem key={h} value={h.toString()}>
                            {h.toString().padStart(2, '0')}:00
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={handleAdd} className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar Programa
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Salvar Programação
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Schedule List */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Grade de Programas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-2">
              {localPrograms.map((program, index) => {
                const { start, end } = parseTimeRange(program.timeRange);
                const isEditing = editingIndex === index;

                return (
                  <div
                    key={index}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      isEditing
                        ? 'bg-primary/10 border-primary/50'
                        : 'bg-secondary/30 border-border hover:border-primary/30'
                    }`}
                  >
                    <GripVertical className="w-4 h-4 text-muted-foreground/50" />

                    {isEditing ? (
                      <>
                        {/* Edit Mode */}
                        <div className="flex items-center gap-2">
                          <Select
                            value={editForm.startHour.toString()}
                            onValueChange={(v) => setEditForm((prev) => ({ ...prev, startHour: parseInt(v) }))}
                          >
                            <SelectTrigger className="w-20">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {hours.map((h) => (
                                <SelectItem key={h} value={h.toString()}>
                                  {h.toString().padStart(2, '0')}h
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-muted-foreground">→</span>
                          <Select
                            value={editForm.endHour.toString()}
                            onValueChange={(v) => setEditForm((prev) => ({ ...prev, endHour: parseInt(v) }))}
                          >
                            <SelectTrigger className="w-20">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {hours.map((h) => (
                                <SelectItem key={h} value={h.toString()}>
                                  {h.toString().padStart(2, '0')}h
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Input
                          value={editForm.programName}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, programName: e.target.value }))}
                          className="flex-1"
                          placeholder="Nome do programa"
                          autoFocus
                        />
                        <Button variant="ghost" size="icon" onClick={saveEdit} className="text-success hover:text-success">
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={cancelEdit} className="text-muted-foreground">
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        {/* View Mode */}
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <Badge variant="outline" className={`font-mono ${getTimeColor(program.timeRange)}`}>
                            {start.toString().padStart(2, '0')}:00
                          </Badge>
                          <span className="text-muted-foreground text-sm">→</span>
                          <Badge variant="outline" className={`font-mono ${getTimeColor(program.timeRange)}`}>
                            {end.toString().padStart(2, '0')}:00
                          </Badge>
                        </div>
                        <div className="flex-1">
                          <Badge className={`${getProgramColor(program.programName)} border`}>
                            {program.programName}
                          </Badge>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => startEdit(index)} className="text-muted-foreground hover:text-primary">
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(index)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Visual Schedule */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle>Visualização 24h</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-1">
              {hours.map((hour) => {
                const program = localPrograms.find((p) => {
                  const { start, end } = parseTimeRange(p.timeRange);
                  return hour >= start && hour <= end;
                });
                return (
                  <div
                    key={hour}
                    className={`flex items-center gap-2 p-2 rounded text-xs transition-colors ${
                      program ? getProgramColor(program.programName) : 'bg-muted/30 text-muted-foreground'
                    }`}
                  >
                    <span className="font-mono w-12">{hour.toString().padStart(2, '0')}:00</span>
                    <span className="truncate">{program?.programName || '—'}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
