import { useState, useEffect, useMemo } from 'react';
import { Clock, Plus, Trash2, Radio, Save, Calendar, Download, Search, Filter, Eye, AlertCircle, CheckCircle, Link, Cloud, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { useToast } from '@/hooks/use-toast';
import { MonitoringSchedule, RadioStation, WeekDay } from '@/types/radio';
import { supabase } from '@/integrations/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { syncSpecialMonitoringToSupabase, useSyncSpecialMonitoring } from '@/hooks/useSyncSpecialMonitoring';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface CapturedSongFromDB {
  title: string;
  artist: string;
  station_name: string;
  scraped_at: string;
}

export function SpecialMonitoringView() {
  const { stations, updateStation, setStations } = useRadioStore();
  const { toast } = useToast();
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [capturedSongs, setCapturedSongs] = useState<CapturedSongFromDB[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStation, setFilterStation] = useState<string>('all');
  const [newSchedule, setNewSchedule] = useState({
    hour: 18,
    minute: 0,
    endHour: 19,
    endMinute: 0,
    label: '',
    stationId: '',
    customStationName: '',
    customStationUrl: '',
    useCustomStation: false,
    weekDays: ['seg', 'ter', 'qua', 'qui', 'sex'] as WeekDay[], // Default: weekdays
  });

  // Auto-sync special monitoring to Cloud
  useSyncSpecialMonitoring();

  const weekDayLabels: Record<WeekDay, string> = {
    dom: 'Dom',
    seg: 'Seg',
    ter: 'Ter',
    qua: 'Qua',
    qui: 'Qui',
    sex: 'Sex',
    sab: 'Sáb',
  };

  const allWeekDays: WeekDay[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

  // All stations (including disabled ones) for quick selection
  const allStations = stations;
  const enabledStations = stations.filter(s => s.enabled);

  // URL validation for mytuner-radio.com
  const isValidMytunerUrl = (url: string): boolean => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.hostname.includes('mytuner-radio.com') || parsed.hostname.includes('mytuner');
    } catch {
      return false;
    }
  };

  const urlValidation = useMemo(() => {
    if (!newSchedule.customStationUrl) return { valid: false, message: '' };
    const valid = isValidMytunerUrl(newSchedule.customStationUrl);
    return {
      valid,
      message: valid ? 'URL válida' : 'URL deve ser do mytuner-radio.com',
    };
  }, [newSchedule.customStationUrl]);

  // Get all schedules across ALL stations (not just enabled)
  const allSchedules = allStations.flatMap(station =>
    (station.monitoringSchedules || []).map(schedule => ({
      ...schedule,
      stationId: station.id,
      stationName: station.name,
      stationUrl: station.scrapeUrl,
    }))
  );

  // Fetch captured songs for scheduled times
  const fetchCapturedSongs = async () => {
    if (allSchedules.filter(s => s.enabled).length === 0) {
      setCapturedSongs([]);
      return;
    }

    setIsLoading(true);
    try {
      const stationNames = [...new Set(allSchedules.filter(s => s.enabled).map(s => s.stationName))];
      
      const { data: songs, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .in('station_name', stationNames)
        .order('scraped_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      // Filter songs by scheduled time ranges AND weekdays
      const filteredSongs = (songs || []).filter(song => {
        const songDate = new Date(song.scraped_at);
        const songHour = songDate.getHours();
        const songMinute = songDate.getMinutes();
        const songTimeInMinutes = songHour * 60 + songMinute;
        const songDayIndex = songDate.getDay();
        const dayMap: WeekDay[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
        const songWeekDay = dayMap[songDayIndex];

        const matchingSchedule = allSchedules.find(s => {
          if (!s.enabled || s.stationName !== song.station_name) return false;
          
          const startTime = s.hour * 60 + s.minute;
          const endTime = (s.endHour ?? s.hour + 1) * 60 + (s.endMinute ?? 0);
          const isInTimeRange = songTimeInMinutes >= startTime && songTimeInMinutes <= endTime;
          
          // Check weekday if specified
          const weekDays = s.weekDays || [];
          const isCorrectDay = weekDays.length === 0 || weekDays.includes(songWeekDay);
          
          return isInTimeRange && isCorrectDay;
        });
        return !!matchingSchedule;
      });

      setCapturedSongs(filteredSongs);
    } catch (error) {
      console.error('Error fetching songs:', error);
      toast({
        title: 'Erro ao carregar',
        description: 'Não foi possível carregar as músicas capturadas.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCapturedSongs();
  }, [allSchedules.length]);

  const handleAddSchedule = () => {
    if (!newSchedule.useCustomStation && !selectedStation) return;
    if (newSchedule.useCustomStation && (!newSchedule.customStationName || !newSchedule.customStationUrl)) return;

    let stationId: string;
    let stationName: string;

    if (newSchedule.useCustomStation) {
      // Add new station to the store
      const newStationId = `special-${Date.now()}`;
      stationName = newSchedule.customStationName;
      
      // Add station to store if not exists
      const existingStation = stations.find(s => s.name === newSchedule.customStationName);
      if (!existingStation) {
        const newStation: RadioStation = {
          id: newStationId,
          name: newSchedule.customStationName,
          urls: [],
          scrapeUrl: newSchedule.customStationUrl,
          styles: [],
          enabled: false, // Not auto-monitored, only for special monitoring
          monitoringSchedules: [],
        };
        setStations([...stations, newStation]);
        stationId = newStationId;
      } else {
        stationId = existingStation.id;
      }
    } else {
      const station = stations.find(s => s.id === selectedStation);
      if (!station) return;
      stationId = station.id;
      stationName = station.name;
    }

    // Need to get station again after potential state update
    const currentStations = useRadioStore.getState().stations;
    const station = currentStations.find(s => s.id === stationId) || {
      id: stationId,
      name: stationName!,
      monitoringSchedules: [],
    };

    const newScheduleEntry: MonitoringSchedule = {
      id: `schedule-${Date.now()}`,
      hour: newSchedule.hour,
      minute: newSchedule.minute,
      endHour: newSchedule.endHour,
      endMinute: newSchedule.endMinute,
      enabled: true,
      label: newSchedule.label || `${newSchedule.hour.toString().padStart(2, '0')}:${newSchedule.minute.toString().padStart(2, '0')} - ${newSchedule.endHour.toString().padStart(2, '0')}:${newSchedule.endMinute.toString().padStart(2, '0')}`,
      customUrl: newSchedule.useCustomStation ? newSchedule.customStationUrl : undefined,
      weekDays: newSchedule.weekDays.length > 0 ? newSchedule.weekDays : undefined,
    };

    const currentSchedules = station.monitoringSchedules || [];
    updateStation(stationId, {
      monitoringSchedules: [...currentSchedules, newScheduleEntry],
    });

    const displayName = newSchedule.useCustomStation ? newSchedule.customStationName : stations.find(s => s.id === selectedStation)?.name;
    toast({
      title: '⏰ Horário adicionado',
      description: `${displayName} será monitorada às ${newSchedule.hour}:${newSchedule.minute.toString().padStart(2, '0')}`,
    });

    setNewSchedule({ hour: 18, minute: 0, endHour: 19, endMinute: 0, label: '', stationId: '', customStationName: '', customStationUrl: '', useCustomStation: false, weekDays: ['seg', 'ter', 'qua', 'qui', 'sex'] });
    setSelectedStation(null);
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

  // Export songs
  const handleExportSongs = async () => {
    setIsExporting(true);
    try {
      const songsToExport = filteredSongs;

      if (songsToExport.length === 0) {
        toast({
          title: 'Nenhuma música',
          description: 'Não há músicas para exportar.',
          variant: 'destructive',
        });
        setIsExporting(false);
        return;
      }

      // Generate export content
      const exportLines = songsToExport.map(song => 
        `${song.artist} - ${song.title} | ${song.station_name} | ${format(new Date(song.scraped_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}`
      );
      
      const exportContent = `MONITORAMENTO ESPECIAL - BANCO DIFERENCIADO
Exportado em: ${format(new Date(), 'dd/MM/yyyy HH:mm:ss', { locale: ptBR })}
Total: ${songsToExport.length} músicas
${'='.repeat(60)}

${exportLines.join('\n')}`;

      // Download as TXT file
      const blob = new Blob([exportContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `monitoramento_especial_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: '📋 Lista exportada!',
        description: `${songsToExport.length} músicas do monitoramento especial.`,
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

  // Filtered songs based on search and station filter
  const filteredSongs = capturedSongs.filter(song => {
    const matchesSearch = searchTerm === '' || 
      song.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      song.artist.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStation = filterStation === 'all' || song.station_name === filterStation;
    return matchesSearch && matchesStation;
  });

  // Get unique stations from captured songs
  const uniqueStations = [...new Set(capturedSongs.map(s => s.station_name))];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Calendar className="w-7 h-7 text-cyan-500" />
            Monitoramento Especial
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure horários específicos para criar bancos de músicas diferenciados
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={async () => {
              setIsSyncing(true);
              // Collect all schedules for sync
              const allSchedulesForSync = allSchedules.map(s => ({
                id: s.id,
                stationName: s.stationName,
                scrapeUrl: s.customUrl || s.stationUrl || '',
                hour: s.hour,
                minute: s.minute,
                endHour: s.endHour ?? s.hour + 1,
                endMinute: s.endMinute ?? 0,
                weekDays: (s.weekDays || ['seg', 'ter', 'qua', 'qui', 'sex']) as WeekDay[],
                label: s.label,
                enabled: s.enabled,
              }));
              await syncSpecialMonitoringToSupabase(allSchedulesForSync);
              setIsSyncing(false);
            }}
            disabled={isSyncing || allSchedules.length === 0}
            className="border-cyan-500/30 text-cyan-500 hover:bg-cyan-500/10"
          >
            {isSyncing ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Cloud className="w-4 h-4 mr-2" />
            )}
            Sincronizar Cloud
          </Button>
          <Button
            variant="secondary"
            onClick={fetchCapturedSongs}
            disabled={isLoading}
          >
            <Eye className="w-4 h-4 mr-2" />
            Atualizar
          </Button>
          <Button
            variant="default"
            onClick={handleExportSongs}
            disabled={isExporting || filteredSongs.length === 0}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            <Download className="w-4 h-4 mr-2" />
            Exportar Lista
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Schedules Panel */}
        <Card className="glass-card border-cyan-500/20 lg:col-span-1">
          <CardHeader className="pb-3 border-b border-border">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="w-5 h-5 text-cyan-500" />
                Horários Cadastrados
              </CardTitle>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-2">
                    <Plus className="w-4 h-4" />
                    Novo
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Adicionar Horário de Monitoramento</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    {/* Toggle for custom station */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                      <div>
                        <p className="text-sm font-medium">Nova emissora</p>
                        <p className="text-xs text-muted-foreground">Cadastrar link de rádio personalizado</p>
                      </div>
                      <Switch
                        checked={newSchedule.useCustomStation}
                        onCheckedChange={checked => setNewSchedule(prev => ({ ...prev, useCustomStation: checked }))}
                      />
                    </div>

                    {newSchedule.useCustomStation ? (
                      <>
                        {/* Quick selection from existing stations */}
                        {allStations.length > 0 && (
                          <div>
                            <label className="text-sm text-muted-foreground">Preencher com emissora existente</label>
                            <Select 
                              value="" 
                              onValueChange={(id) => {
                                const station = allStations.find(s => s.id === id);
                                if (station) {
                                  setNewSchedule(prev => ({
                                    ...prev,
                                    customStationName: station.name,
                                    customStationUrl: station.scrapeUrl || '',
                                  }));
                                }
                              }}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue placeholder="Copiar dados de emissora cadastrada..." />
                              </SelectTrigger>
                              <SelectContent>
                                {allStations.map(station => (
                                  <SelectItem key={station.id} value={station.id}>
                                    <div className="flex items-center gap-2">
                                      <Radio className="w-4 h-4" />
                                      {station.name}
                                      {station.scrapeUrl && (
                                        <Badge variant="outline" className="text-[10px]">URL</Badge>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        
                        <div>
                          <label className="text-sm text-muted-foreground">Nome da Emissora</label>
                          <Input
                            className="mt-1"
                            placeholder="Ex: 105 FM, Jovem Pan, etc."
                            value={newSchedule.customStationName}
                            onChange={e => setNewSchedule(prev => ({ ...prev, customStationName: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="text-sm text-muted-foreground flex items-center gap-2">
                            <Link className="w-3 h-3" />
                            Link da Rádio (mytuner-radio.com)
                          </label>
                          <Input
                            className={`mt-1 ${newSchedule.customStationUrl && !urlValidation.valid ? 'border-destructive' : ''}`}
                            placeholder="https://mytuner-radio.com/radio/..."
                            value={newSchedule.customStationUrl}
                            onChange={e => setNewSchedule(prev => ({ ...prev, customStationUrl: e.target.value }))}
                          />
                          {newSchedule.customStationUrl && (
                            <div className={`flex items-center gap-1 mt-1 text-xs ${urlValidation.valid ? 'text-green-500' : 'text-destructive'}`}>
                              {urlValidation.valid ? (
                                <CheckCircle className="w-3 h-3" />
                              ) : (
                                <AlertCircle className="w-3 h-3" />
                              )}
                              {urlValidation.message}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Cole o link da página da rádio no mytuner-radio.com
                          </p>
                        </div>
                      </>
                    ) : (
                      <div>
                        <label className="text-sm text-muted-foreground">Emissora (ativas no monitoramento)</label>
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
                        {enabledStations.length === 0 && (
                          <p className="text-xs text-amber-500 mt-1">
                            Nenhuma emissora ativa. Ative emissoras na aba "Emissoras" ou cadastre uma nova acima.
                          </p>
                        )}
                      </div>
                    )}

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

                    {/* Week Days Selector */}
                    <div>
                      <label className="text-sm text-muted-foreground font-medium">Dias da Semana</label>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {allWeekDays.map(day => (
                          <button
                            key={day}
                            type="button"
                            onClick={() => {
                              setNewSchedule(prev => {
                                const current = prev.weekDays;
                                const updated = current.includes(day)
                                  ? current.filter(d => d !== day)
                                  : [...current, day];
                                return { ...prev, weekDays: updated };
                              });
                            }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              newSchedule.weekDays.includes(day)
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                            }`}
                          >
                            {weekDayLabels[day]}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {newSchedule.weekDays.length === 0 ? 'Todos os dias' : 
                         newSchedule.weekDays.length === 7 ? 'Todos os dias' :
                         `${newSchedule.weekDays.length} dia${newSchedule.weekDays.length > 1 ? 's' : ''} selecionado${newSchedule.weekDays.length > 1 ? 's' : ''}`}
                      </p>
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
                      <Button 
                        onClick={handleAddSchedule} 
                        disabled={newSchedule.useCustomStation 
                          ? (!newSchedule.customStationName || !newSchedule.customStationUrl || !urlValidation.valid)
                          : !selectedStation
                        }
                      >
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
                <p className="text-sm">Nenhum horário configurado</p>
                <p className="text-xs mt-1">Adicione horários para monitorar músicas diferenciadas</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {allSchedules
                    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
                    .map(schedule => (
                      <div
                        key={schedule.id}
                        className={`p-3 rounded-lg flex items-center justify-between ${
                          schedule.enabled ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-secondary/50 border border-border'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            <div className="w-14 h-14 rounded-lg bg-cyan-500/20 flex flex-col items-center justify-center">
                              <span className="text-sm font-bold text-cyan-500">
                                {schedule.hour.toString().padStart(2, '0')}:{schedule.minute.toString().padStart(2, '0')}
                              </span>
                              <span className="text-[10px] text-cyan-400">início</span>
                            </div>
                            <span className="text-muted-foreground">→</span>
                            <div className="w-14 h-14 rounded-lg bg-orange-500/20 flex flex-col items-center justify-center">
                              <span className="text-sm font-bold text-orange-500">
                                {(schedule.endHour ?? schedule.hour + 1).toString().padStart(2, '0')}:{(schedule.endMinute ?? 0).toString().padStart(2, '0')}
                              </span>
                              <span className="text-[10px] text-orange-400">fim</span>
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{schedule.stationName}</p>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {schedule.label || 'Música diferenciada'}
                            </p>
                            {schedule.weekDays && schedule.weekDays.length > 0 && schedule.weekDays.length < 7 && (
                              <div className="flex gap-0.5 mt-1">
                                {allWeekDays.map(day => (
                                  <span
                                    key={day}
                                    className={`text-[9px] px-1 rounded ${
                                      schedule.weekDays?.includes(day)
                                        ? 'bg-primary/20 text-primary'
                                        : 'bg-secondary/50 text-muted-foreground/50'
                                    }`}
                                  >
                                    {day.charAt(0).toUpperCase()}
                                  </span>
                                ))}
                              </div>
                            )}
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

        {/* Captured Songs Panel */}
        <Card className="glass-card border-primary/20 lg:col-span-2">
          <CardHeader className="pb-3 border-b border-border">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Radio className="w-5 h-5 text-primary" />
                Músicas Capturadas
                <Badge variant="secondary" className="ml-2">
                  {filteredSongs.length} músicas
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar música ou artista..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-9 w-64"
                  />
                </div>
                <Select value={filterStation} onValueChange={setFilterStation}>
                  <SelectTrigger className="w-40">
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Filtrar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {uniqueStations.map(station => (
                      <SelectItem key={station} value={station}>
                        {station}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                <div className="text-center">
                  <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                  <p className="text-sm">Carregando músicas...</p>
                </div>
              </div>
            ) : filteredSongs.length === 0 ? (
              <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                <div className="text-center">
                  <Radio className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Nenhuma música capturada</p>
                  <p className="text-xs mt-1">Configure horários para começar a capturar</p>
                </div>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Título</TableHead>
                      <TableHead>Artista</TableHead>
                      <TableHead>Emissora</TableHead>
                      <TableHead>Capturado em</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSongs.map((song, index) => (
                      <TableRow key={`${song.scraped_at}-${index}`}>
                        <TableCell className="font-medium">{song.title}</TableCell>
                        <TableCell className="text-muted-foreground">{song.artist}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{song.station_name}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDistanceToNow(new Date(song.scraped_at), { addSuffix: true, locale: ptBR })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Info Banner */}
      <Card className="glass-card border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-transparent">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="font-medium text-foreground">Monitoramento Especial - Apenas Exportação</p>
              <p className="text-sm text-muted-foreground mt-1">
                As músicas capturadas nos horários especiais são destinadas à criação de bancos diferenciados. 
                Use o botão "Exportar Lista" para gerar um arquivo com as músicas capturadas. 
                O download automático ocorre apenas para as emissoras no monitoramento regular.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
