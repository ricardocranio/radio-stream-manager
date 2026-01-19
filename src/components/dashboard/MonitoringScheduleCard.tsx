import { useState } from 'react';
import { Clock, Plus, Trash2, Radio, Save, X, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { useToast } from '@/hooks/use-toast';
import { MonitoringSchedule } from '@/types/radio';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function MonitoringScheduleCard() {
  const { stations, updateStation } = useRadioStore();
  const { toast } = useToast();
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    hour: 18,
    minute: 0,
    label: '',
  });

  const enabledStations = stations.filter(s => s.enabled);

  const handleAddSchedule = () => {
    if (!selectedStation) return;

    const station = stations.find(s => s.id === selectedStation);
    if (!station) return;

    const newScheduleEntry: MonitoringSchedule = {
      id: `schedule-${Date.now()}`,
      hour: newSchedule.hour,
      minute: newSchedule.minute,
      enabled: true,
      label: newSchedule.label || `Horário ${newSchedule.hour}:${newSchedule.minute.toString().padStart(2, '0')}`,
    };

    const currentSchedules = station.monitoringSchedules || [];
    updateStation(station.id, {
      monitoringSchedules: [...currentSchedules, newScheduleEntry],
    });

    toast({
      title: '⏰ Horário adicionado',
      description: `${station.name} será monitorada às ${newSchedule.hour}:${newSchedule.minute.toString().padStart(2, '0')}`,
    });

    setNewSchedule({ hour: 18, minute: 0, label: '' });
    setIsDialogOpen(false);
  };

  const handleRemoveSchedule = (stationId: string, scheduleId: string) => {
    const station = stations.find(s => s.id === stationId);
    if (!station) return;

    const updatedSchedules = (station.monitoringSchedules || []).filter(
      s => s.id !== scheduleId
    );
    updateStation(stationId, { monitoringSchedules: updatedSchedules });

    toast({
      title: 'Horário removido',
      description: 'Configuração de monitoramento atualizada.',
    });
  };

  const handleToggleSchedule = (stationId: string, scheduleId: string, enabled: boolean) => {
    const station = stations.find(s => s.id === stationId);
    if (!station) return;

    const updatedSchedules = (station.monitoringSchedules || []).map(s =>
      s.id === scheduleId ? { ...s, enabled } : s
    );
    updateStation(stationId, { monitoringSchedules: updatedSchedules });
  };

  // Get all schedules across stations
  const allSchedules = enabledStations.flatMap(station =>
    (station.monitoringSchedules || []).map(schedule => ({
      ...schedule,
      stationId: station.id,
      stationName: station.name,
    }))
  );

  return (
    <Card className="glass-card border-cyan-500/20">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="w-5 h-5 text-cyan-500" />
            Horários de Monitoramento
          </CardTitle>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-2">
                <Plus className="w-4 h-4" />
                Novo Horário
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Horário de Monitoramento</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <label className="text-sm text-muted-foreground">Emissora</label>
                  <Select value={selectedStation || ''} onValueChange={setSelectedStation}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Selecione a emissora" />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledStations.map(station => (
                        <SelectItem key={station.id} value={station.id}>
                          <div className="flex items-center gap-2">
                            <Radio className="w-4 h-4" />
                            {station.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground">Hora</label>
                    <Select
                      value={newSchedule.hour.toString()}
                      onValueChange={v => setNewSchedule(prev => ({ ...prev, hour: parseInt(v) }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, i) => (
                          <SelectItem key={i} value={i.toString()}>
                            {i.toString().padStart(2, '0')}h
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">Minuto</label>
                    <Select
                      value={newSchedule.minute.toString()}
                      onValueChange={v => setNewSchedule(prev => ({ ...prev, minute: parseInt(v) }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0, 15, 30, 45].map(m => (
                          <SelectItem key={m} value={m.toString()}>
                            {m.toString().padStart(2, '0')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="text-sm text-muted-foreground">Descrição (opcional)</label>
                  <Input
                    className="mt-1"
                    placeholder="Ex: Horário nobre, Música diferenciada"
                    value={newSchedule.label}
                    onChange={e => setNewSchedule(prev => ({ ...prev, label: e.target.value }))}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleAddSchedule} disabled={!selectedStation}>
                    <Save className="w-4 h-4 mr-2" />
                    Salvar
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {allSchedules.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhum horário específico configurado</p>
            <p className="text-xs mt-1">Adicione horários para monitorar músicas diferenciadas</p>
          </div>
        ) : (
          <ScrollArea className="h-[200px]">
            <div className="space-y-2">
              {allSchedules
                .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
                .map(schedule => (
                  <div
                    key={schedule.id}
                    className={`p-3 rounded-lg flex items-center justify-between ${
                      schedule.enabled ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-secondary/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-cyan-500/20 flex flex-col items-center justify-center">
                        <span className="text-lg font-bold text-cyan-500">
                          {schedule.hour.toString().padStart(2, '0')}
                        </span>
                        <span className="text-xs text-cyan-400">
                          :{schedule.minute.toString().padStart(2, '0')}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{schedule.stationName}</p>
                          <Badge variant="outline" className="text-xs">
                            <Radio className="w-3 h-3 mr-1" />
                            Monitorar
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {schedule.label || 'Música diferenciada'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={checked =>
                          handleToggleSchedule(schedule.stationId, schedule.id, checked)
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveSchedule(schedule.stationId, schedule.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
