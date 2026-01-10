import { useState } from 'react';
import { Clock, Save, Plus, Trash2 } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ProgramSchedule } from '@/types/radio';

export function ScheduleView() {
  const { programs, setPrograms } = useRadioStore();
  const { toast } = useToast();
  const [localPrograms, setLocalPrograms] = useState<ProgramSchedule[]>(programs);
  const [newProgram, setNewProgram] = useState({ timeRange: '', programName: '' });

  const handleUpdate = (index: number, field: keyof ProgramSchedule, value: string) => {
    setLocalPrograms((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  };

  const handleDelete = (index: number) => {
    setLocalPrograms((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    if (newProgram.timeRange && newProgram.programName) {
      setLocalPrograms((prev) => [...prev, newProgram]);
      setNewProgram({ timeRange: '', programName: '' });
    }
  };

  const handleSave = () => {
    setPrograms(localPrograms);
    toast({
      title: 'Programação salva',
      description: 'A grade de programação foi atualizada.',
    });
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
        <Button onClick={handleSave}>
          <Save className="w-4 h-4 mr-2" />
          Salvar Programação
        </Button>
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
            <div className="space-y-3">
              {localPrograms.map((program, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 p-3 rounded-lg bg-secondary/30 border border-border hover:border-primary/30 transition-colors"
                >
                  <Badge variant="outline" className={`font-mono ${getTimeColor(program.timeRange)}`}>
                    {program.timeRange}h
                  </Badge>
                  <Input
                    value={program.programName}
                    onChange={(e) => handleUpdate(index, 'programName', e.target.value)}
                    className="flex-1"
                    placeholder="Nome do programa"
                  />
                  <Input
                    value={program.timeRange}
                    onChange={(e) => handleUpdate(index, 'timeRange', e.target.value)}
                    className="w-24 font-mono"
                    placeholder="0-5"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}

              {/* Add New */}
              <div className="flex items-center gap-4 p-3 rounded-lg border border-dashed border-border hover:border-primary/50 transition-colors">
                <Badge variant="outline" className="font-mono text-muted-foreground">
                  NOVO
                </Badge>
                <Input
                  value={newProgram.programName}
                  onChange={(e) => setNewProgram((prev) => ({ ...prev, programName: e.target.value }))}
                  className="flex-1"
                  placeholder="Nome do novo programa"
                />
                <Input
                  value={newProgram.timeRange}
                  onChange={(e) => setNewProgram((prev) => ({ ...prev, timeRange: e.target.value }))}
                  className="w-24 font-mono"
                  placeholder="0-5"
                />
                <Button variant="outline" size="icon" onClick={handleAdd}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
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
              {Array.from({ length: 24 }, (_, hour) => {
                const program = localPrograms.find((p) => {
                  const [start, end] = p.timeRange.split('-').map(Number);
                  return hour >= start && hour <= end;
                });
                return (
                  <div
                    key={hour}
                    className={`flex items-center gap-2 p-2 rounded text-xs ${
                      program ? getTimeColor(program.timeRange) : 'bg-muted/30'
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
