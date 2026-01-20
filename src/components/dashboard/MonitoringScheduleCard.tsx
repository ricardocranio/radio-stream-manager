import { useState } from 'react';
import { Clock, Plus, Trash2, Radio, Save, Calendar, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { useToast } from '@/hooks/use-toast';
import { MonitoringSchedule } from '@/types/radio';
import { supabase } from '@/integrations/supabase/client';
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
  const [isExporting, setIsExporting] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    hour: 18,
    minute: 0,
    endHour: 19,
    endMinute: 0,
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
      endHour: newSchedule.endHour,
      endMinute: newSchedule.endMinute,
      enabled: true,
      label: newSchedule.label || `${newSchedule.hour.toString().padStart(2, '0')}:${newSchedule.minute.toString().padStart(2, '0')} - ${newSchedule.endHour.toString().padStart(2, '0')}:${newSchedule.endMinute.toString().padStart(2, '0')}`,
    };

    const currentSchedules = station.monitoringSchedules || [];
    updateStation(station.id, {
      monitoringSchedules: [...currentSchedules, newScheduleEntry],
    });

    toast({
      title: '⏰ Horário adicionado',
      description: `${station.name} será monitorada às ${newSchedule.hour}:${newSchedule.minute.toString().padStart(2, '0')}`,
    });

    setNewSchedule({ hour: 18, minute: 0, endHour: 19, endMinute: 0, label: '' });
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

  // Export songs captured at scheduled times
  const handleExportScheduledSongs = async () => {
    setIsExporting(true);
    try {
      // Get all enabled schedules
      const schedulesToExport = allSchedules.filter(s => s.enabled);
      
      if (schedulesToExport.length === 0) {
        toast({
          title: 'Nenhum horário ativo',
          description: 'Adicione e ative horários para exportar.',
          variant: 'destructive',
        });
        setIsExporting(false);
        return;
      }

      // Fetch songs from Supabase that match the scheduled hours
      const hoursToFetch = [...new Set(schedulesToExport.map(s => s.hour))];
      const stationNames = [...new Set(schedulesToExport.map(s => s.stationName))];

      const { data: songs, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .in('station_name', stationNames)
        .order('scraped_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      // Filter songs by scheduled hours
      const filteredSongs = (songs || []).filter(song => {
        const songHour = new Date(song.scraped_at).getHours();
        const matchingSchedule = schedulesToExport.find(
          s => s.hour === songHour && s.stationName === song.station_name
        );
        return !!matchingSchedule;
      });

      if (filteredSongs.length === 0) {
        toast({
          title: 'Nenhuma música encontrada',
          description: 'Não há músicas capturadas nos horários configurados.',
        });
        setIsExporting(false);
        return;
      }

      // Generate export content
      const exportLines = filteredSongs.map(song => 
        `${song.artist} - ${song.title} | ${song.station_name} | ${new Date(song.scraped_at).toLocaleString('pt-BR')}`
      );
      
      const exportContent = `MONITORAMENTO ESPECIAL - BANCO DIFERENCIADO\nExportado em: ${new Date().toLocaleString('pt-BR')}\nTotal: ${filteredSongs.length} músicas\n${'='.repeat(50)}\n\n${exportLines.join('\n')}`;

      // Download as TXT file
      const blob = new Blob([exportContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `monitoramento_especial_${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: '📋 Lista exportada!',
        description: `${filteredSongs.length} músicas do monitoramento especial.`,
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Erro ao exportar',
        description: 'Não foi possível exportar a lista.',
        variant: 'destructive',
      });
    }
    setIsExporting(false);
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
    <Card className="glass-card border-cyan-500/20 flex flex-col">
      <CardHeader className="pb-3 border-b border-border shrink-0">
        <div className="flex flex-col gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-5 h-5 text-cyan-500 shrink-0" />
            <span className="truncate">Horários de Monitoramento</span>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5 text-xs h-8"
              onClick={handleExportScheduledSongs}
              disabled={isExporting || allSchedules.filter(s => s.enabled).length === 0}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exportar</span>
              <span className="sm:hidden">Export</span>
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8">
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Novo Horário</span>
                  <span className="sm:hidden">Novo</span>
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

                {/* Time Range: Start */}
                <div>
                  <label className="text-sm text-muted-foreground font-medium">Horário de Início</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <Select
                      value={newSchedule.hour.toString()}
                      onValueChange={v => setNewSchedule(prev => ({ ...prev, hour: parseInt(v) }))}
                    >
                      <SelectTrigger>
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
                    <Select
                      value={newSchedule.minute.toString()}
                      onValueChange={v => setNewSchedule(prev => ({ ...prev, minute: parseInt(v) }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0, 15, 30, 45].map(m => (
                          <SelectItem key={m} value={m.toString()}>
                            {m.toString().padStart(2, '0')} min
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Time Range: End */}
                <div>
                  <label className="text-sm text-muted-foreground font-medium">Horário de Fim</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <Select
                      value={newSchedule.endHour.toString()}
                      onValueChange={v => setNewSchedule(prev => ({ ...prev, endHour: parseInt(v) }))}
                    >
                      <SelectTrigger>
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
                    <Select
                      value={newSchedule.endMinute.toString()}
                      onValueChange={v => setNewSchedule(prev => ({ ...prev, endMinute: parseInt(v) }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0, 15, 30, 45].map(m => (
                          <SelectItem key={m} value={m.toString()}>
                            {m.toString().padStart(2, '0')} min
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
        </div>
      </CardHeader>
      <CardContent className="p-3 flex-1 min-h-0">
        {allSchedules.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhum horário configurado</p>
            <p className="text-xs mt-1">Adicione horários para monitorar</p>
          </div>
        ) : (
          <ScrollArea className="h-[180px]">
            <div className="space-y-2 pr-2">
              {allSchedules
                .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
                .map(schedule => (
                  <div
                    key={schedule.id}
                    className={`p-2 rounded-lg flex items-center justify-between gap-2 ${
                      schedule.enabled ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-secondary/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <div className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-500 text-[10px] font-bold shrink-0">
                        {schedule.hour.toString().padStart(2, '0')}:{schedule.minute.toString().padStart(2, '0')}
                      </div>
                      <span className="text-muted-foreground text-[10px]">→</span>
                      <div className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 text-[10px] font-bold shrink-0">
                        {(schedule.endHour ?? schedule.hour + 1).toString().padStart(2, '0')}:{(schedule.endMinute ?? 0).toString().padStart(2, '0')}
                      </div>
                      <div className="min-w-0 ml-1">
                        <p className="text-xs font-medium text-foreground truncate">{schedule.stationName}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {schedule.label || 'Música diferenciada'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={checked =>
                          handleToggleSchedule(schedule.stationId, schedule.id, checked)
                        }
                        className="scale-90"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveSchedule(schedule.stationId, schedule.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
