import { useState, useEffect } from 'react';
import { Radio, Plus, Trash2, ExternalLink, Save, X, RefreshCw, Loader2, Download, Copy, CheckCircle2, AlertCircle, Power, Settings, CloudUpload } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioStation } from '@/types/radio';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useSyncStationsToSupabase, syncStationsToSupabase } from '@/hooks/useSyncStationsToSupabase';

// Types for mytuner stations
interface RadioConfig {
  nome: string;
  url: string;
  tipo: 'mytuner' | 'clubefm' | 'other';
  ativo: boolean;
}

interface ConfigData {
  configuracao: {
    intervalo_minutos: number;
    mostrar_navegador: boolean;
    arquivo_historico: string;
    arquivo_relatorio: string;
  };
  radios: RadioConfig[];
}

export function StationsView() {
  const { stations, updateStation, setStations, addCapturedSong, addOrUpdateRankingSong } = useRadioStore();
  const { toast } = useToast();
  const [editingStation, setEditingStation] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RadioStation | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [capturedSongsCount, setCapturedSongsCount] = useState(0);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [dbStations, setDbStations] = useState<{ id: string; name: string; scrape_url: string; enabled: boolean; styles: string[] }[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Auto-sync stations to Supabase
  useSyncStationsToSupabase();
  
  // Load stats from Supabase
  useEffect(() => {
    const loadStats = async () => {
      setIsLoadingStats(true);
      try {
        // Count captured songs
        const { count } = await supabase
          .from('scraped_songs')
          .select('*', { count: 'exact', head: true });
        
        setCapturedSongsCount(count || 0);
        
        // Get last capture time
        const { data: lastSong } = await supabase
          .from('scraped_songs')
          .select('scraped_at')
          .order('scraped_at', { ascending: false })
          .limit(1)
          .single();
        
        if (lastSong) {
          setLastCapture(new Date(lastSong.scraped_at).toLocaleString('pt-BR'));
        }
        
        // Load stations from DB
        const { data: stationsData } = await supabase
          .from('radio_stations')
          .select('*')
          .order('name');
        
        if (stationsData) {
          setDbStations(stationsData.map(s => ({
            id: s.id,
            name: s.name,
            scrape_url: s.scrape_url,
            enabled: s.enabled ?? true,
            styles: s.styles || []
          })));
        }
      } catch (error) {
        console.error('Error loading stats:', error);
      } finally {
        setIsLoadingStats(false);
      }
    };
    
    loadStats();
    
    // Refresh every 30 seconds
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const allStyles = ['SERTANEJO', 'PAGODE', 'AGRONEJO', 'POP/VARIADO', 'TEEN/HITS', 'DANCE', 'HITS'];

  // Generate config JSON for Python script
  const generateConfigJson = (): ConfigData => {
    return {
      configuracao: {
        intervalo_minutos: 5,
        mostrar_navegador: false,
        arquivo_historico: "radio_historico.json",
        arquivo_relatorio: "radio_relatorio.txt"
      },
      radios: stations.filter(s => s.enabled).map(s => ({
        nome: s.name,
        url: s.scrapeUrl || '',
        tipo: s.scrapeUrl?.includes('mytuner') ? 'mytuner' : 'other' as const,
        ativo: s.enabled
      }))
    };
  };

  const handleCopyConfig = () => {
    const config = generateConfigJson();
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    toast({
      title: '📋 Configuração copiada!',
      description: 'Cole no arquivo radios_config.json do script Python.',
    });
  };

  const handleDownloadConfig = () => {
    const config = generateConfigJson();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'radios_config.json';
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: '⬇️ Download iniciado',
      description: 'radios_config.json baixado com sucesso.',
    });
  };

  const handleAddNewStation = async () => {
    const newStation: RadioStation = {
      id: `station-${Date.now()}`,
      name: 'Nova Emissora',
      urls: [],
      scrapeUrl: 'https://mytuner-radio.com/pt/radio/',
      styles: ['SERTANEJO'],
      enabled: true,
    };
    setStations([...stations, newStation]);
    setEditingStation(newStation.id);
    setEditForm(newStation);
    setIsAddingNew(true);
    toast({
      title: 'Nova emissora criada',
      description: 'Preencha os dados e clique em Salvar.',
    });
  };

  const handleDeleteStation = async (stationId: string) => {
    setStations(stations.filter(s => s.id !== stationId));
    setEditingStation(null);
    setEditForm(null);
    setIsAddingNew(false);
    toast({
      title: 'Emissora removida',
      description: 'A emissora foi excluída.',
    });
  };

  const handleEdit = (station: RadioStation) => {
    setEditingStation(station.id);
    setEditForm({ ...station });
    setIsAddingNew(false);
  };

  const handleSave = async () => {
    if (editForm) {
      updateStation(editForm.id, editForm);
      
      // Also update in Supabase if it exists
      if (editForm.scrapeUrl) {
        try {
          const { error } = await supabase
            .from('radio_stations')
            .upsert({
              name: editForm.name,
              scrape_url: editForm.scrapeUrl,
              enabled: editForm.enabled,
              styles: editForm.styles
            }, { onConflict: 'name' });
          
          if (!error) {
            toast({
              title: '✓ Emissora salva',
              description: `${editForm.name} atualizada no banco de dados.`,
            });
          }
        } catch (e) {
          console.log('Local save only');
        }
      }
      
      setEditingStation(null);
      setEditForm(null);
      setIsAddingNew(false);
      toast({
        title: 'Emissora atualizada',
        description: `${editForm.name} foi atualizada com sucesso.`,
      });
    }
  };

  const handleCancel = () => {
    if (isAddingNew && editForm) {
      setStations(stations.filter(s => s.id !== editForm.id));
    }
    setEditingStation(null);
    setEditForm(null);
    setIsAddingNew(false);
  };

  const handleStyleChange = (style: string) => {
    if (editForm) {
      const styles = editForm.styles.includes(style)
        ? editForm.styles.filter((s) => s !== style)
        : [...editForm.styles, style];
      setEditForm({ ...editForm, styles });
    }
  };

  const handleToggleStation = async (stationId: string, enabled: boolean) => {
    updateStation(stationId, { enabled });
    
    const station = stations.find(s => s.id === stationId);
    if (station) {
      try {
        await supabase
          .from('radio_stations')
          .update({ enabled })
          .eq('name', station.name);
      } catch (e) {
        console.log('Local update only');
      }
    }
  };

  const handleDownloadScript = () => {
    window.open('/radio_monitor_supabase.py', '_blank');
    toast({
      title: '⬇️ Script Python',
      description: 'Baixe e execute: python radio_monitor_supabase.py',
    });
  };

  const handleSyncToSupabase = async () => {
    setIsSyncing(true);
    await syncStationsToSupabase(stations.map(s => ({
      name: s.name,
      scrapeUrl: s.scrapeUrl || '',
      styles: s.styles,
      enabled: s.enabled,
    })));
    setIsSyncing(false);
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Emissoras</h2>
          <p className="text-muted-foreground">Configure as emissoras de rádio para monitoramento</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button 
            variant="outline" 
            onClick={handleSyncToSupabase} 
            disabled={isSyncing}
            className="gap-2"
            size="sm"
          >
            {isSyncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CloudUpload className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">Sincronizar</span>
          </Button>
          <Button variant="outline" onClick={handleDownloadConfig} className="gap-2" size="sm">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Baixar Config</span>
          </Button>
          <Button variant="outline" onClick={handleCopyConfig} className="gap-2" size="sm">
            <Copy className="w-4 h-4" />
            <span className="hidden sm:inline">Copiar JSON</span>
          </Button>
          <Button className="gap-2" onClick={handleAddNewStation} size="sm">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nova Emissora</span>
          </Button>
        </div>
      </div>

      {/* Status Card */}
      <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-primary" />
                <span className="text-sm font-medium">
                  {stations.filter(s => s.enabled).length} emissoras ativas
                </span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-sm text-muted-foreground">
                  {isLoadingStats ? '...' : `${capturedSongsCount} músicas capturadas`}
                </span>
              </div>
              {lastCapture && (
                <>
                  <div className="h-4 w-px bg-border" />
                  <span className="text-xs text-muted-foreground">
                    Última: {lastCapture}
                  </span>
                </>
              )}
            </div>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={handleDownloadScript}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              Baixar Script Python
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card className="border-dashed border-2 border-muted-foreground/20">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Settings className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Como usar o monitoramento automático:</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Configure as emissoras abaixo com as URLs do mytuner-radio.com</li>
                <li>Baixe a configuração (JSON) e o script Python</li>
                <li>Execute o script no seu computador: <code className="bg-muted px-1 rounded">python radio_monitor_supabase.py</code></li>
                <li>O script captura músicas automaticamente a cada 5 minutos</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {stations.map((station) => {
          const isEditing = editingStation === station.id;
          const data = isEditing && editForm ? editForm : station;

          return (
            <Card key={station.id} className={`transition-all ${!data.enabled ? 'opacity-60' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <div className={`w-8 h-8 rounded-lg ${data.enabled ? 'bg-primary/10' : 'bg-muted'} flex items-center justify-center`}>
                      <Radio className={`w-4 h-4 ${data.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    {isEditing ? (
                      <Input
                        value={editForm?.name || ''}
                        onChange={(e) => setEditForm((prev) => prev && { ...prev, name: e.target.value })}
                        className="h-8 w-40"
                      />
                    ) : (
                      <span className="truncate">{station.name}</span>
                    )}
                  </CardTitle>
                  <Switch
                    checked={data.enabled}
                    onCheckedChange={(checked) => 
                      isEditing
                        ? setEditForm((prev) => prev && { ...prev, enabled: checked })
                        : handleToggleStation(station.id, checked)
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* URL de Scraping */}
                <div>
                  <Label className="text-xs text-muted-foreground">URL MyTuner</Label>
                  {isEditing ? (
                    <Input
                      value={editForm?.scrapeUrl || ''}
                      onChange={(e) => setEditForm((prev) => prev && { ...prev, scrapeUrl: e.target.value })}
                      className="mt-1 font-mono text-xs"
                      placeholder="https://mytuner-radio.com/pt/radio/..."
                    />
                  ) : (
                    <div className="mt-1">
                      {data.scrapeUrl ? (
                        <a
                          href={data.scrapeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-mono text-primary hover:underline truncate"
                        >
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{data.scrapeUrl}</span>
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Não configurado</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Estilos */}
                <div>
                  <Label className="text-xs text-muted-foreground">Estilos</Label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {isEditing ? (
                      allStyles.map((style) => (
                        <Badge
                          key={style}
                          variant={data.styles.includes(style) ? 'default' : 'outline'}
                          className="cursor-pointer text-xs"
                          onClick={() => handleStyleChange(style)}
                        >
                          {style}
                        </Badge>
                      ))
                    ) : (
                      data.styles.length > 0 ? (
                        data.styles.map((style) => (
                          <Badge key={style} variant="secondary" className="text-xs">
                            {style}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">Nenhum</span>
                      )
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  {isEditing ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={handleCancel}>
                        <X className="w-4 h-4 mr-1" />
                        Cancelar
                      </Button>
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => handleDeleteStation(station.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <Button size="sm" onClick={handleSave}>
                        <Save className="w-4 h-4 mr-1" />
                        Salvar
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleEdit(station)}>
                      Editar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Empty State */}
      {stations.length === 0 && (
        <div className="text-center py-12">
          <Radio className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">Nenhuma emissora configurada</h3>
          <p className="text-muted-foreground mb-4">Adicione emissoras para começar o monitoramento</p>
          <Button onClick={handleAddNewStation}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Emissora
          </Button>
        </div>
      )}
    </div>
  );
}
