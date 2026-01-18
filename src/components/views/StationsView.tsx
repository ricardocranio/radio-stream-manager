import { useState, useEffect, useCallback } from 'react';
import { Radio, Plus, Trash2, ExternalLink, Save, X, RefreshCw, Loader2, Play, Pause, Clock, Link2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioStation } from '@/types/radio';
import { useToast } from '@/hooks/use-toast';
import { radioScraperApi, findStationConfig, syncStationsWithKnown, knownStations } from '@/lib/api/radioScraper';
import { useAutoScraping } from '@/hooks/useAutoScraping';

export function StationsView() {
  const { stations, updateStation, setStations, addCapturedSong } = useRadioStore();
  const { toast } = useToast();
  const [editingStation, setEditingStation] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RadioStation | null>(null);
  const [scrapingStation, setScrapingStation] = useState<string | null>(null);
  const [autoScrapeEnabled, setAutoScrapeEnabled] = useState(false);
  const [lastAutoScrape, setLastAutoScrape] = useState<Date | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ synced: number; unmatched: string[] } | null>(null);
  
  const { scrapeAllStations, startAutoScraping, stopAutoScraping, isRunning, stats } = useAutoScraping();

  // Auto-sync stations with known URLs on mount
  useEffect(() => {
    const syncResult = syncStationsWithKnown(stations);
    
    if (syncResult.newUrls > 0) {
      // Update stations with matched URLs
      for (const syncedStation of syncResult.synced) {
        if (syncedStation.matched) {
          const station = stations.find(s => s.id === syncedStation.id);
          if (station && station.scrapeUrl !== syncedStation.scrapeUrl) {
            updateStation(station.id, { scrapeUrl: syncedStation.scrapeUrl });
          }
        }
      }
      
      toast({
        title: '🔗 URLs Sincronizadas',
        description: `${syncResult.newUrls} emissoras atualizadas com URLs da base de dados.`,
      });
    }
    
    setSyncStatus({
      synced: syncResult.synced.filter(s => s.matched).length,
      unmatched: syncResult.unmatched,
    });
  }, []); // Run once on mount

  // Check if a station has a known URL match
  const getStationMatchStatus = useCallback((stationName: string): 'matched' | 'custom' | 'none' => {
    const config = findStationConfig(stationName);
    const station = stations.find(s => s.name === stationName);
    
    if (!station?.scrapeUrl) return 'none';
    if (config && station.scrapeUrl === config.scrapeUrl) return 'matched';
    return 'custom';
  }, [stations]);

  // Manually sync a single station
  const handleSyncStation = (station: RadioStation) => {
    const config = findStationConfig(station.name);
    
    if (config) {
      updateStation(station.id, { scrapeUrl: config.scrapeUrl });
      toast({
        title: '✓ URL Sincronizada',
        description: `${station.name} atualizada com URL oficial.`,
      });
    } else {
      toast({
        title: 'Emissora não encontrada',
        description: `Não foi encontrada URL conhecida para "${station.name}".`,
        variant: 'destructive',
      });
    }
  };

  // Sync all stations at once
  const handleSyncAllStations = () => {
    const syncResult = syncStationsWithKnown(stations);
    let updated = 0;
    
    for (const syncedStation of syncResult.synced) {
      if (syncedStation.matched) {
        const station = stations.find(s => s.id === syncedStation.id);
        if (station && station.scrapeUrl !== syncedStation.scrapeUrl) {
          updateStation(station.id, { scrapeUrl: syncedStation.scrapeUrl });
          updated++;
        }
      }
    }
    
    setSyncStatus({
      synced: syncResult.synced.filter(s => s.matched).length,
      unmatched: syncResult.unmatched,
    });
    
    toast({
      title: updated > 0 ? '🔗 URLs Sincronizadas' : 'Tudo sincronizado',
      description: updated > 0 
        ? `${updated} URLs atualizadas. ${syncResult.unmatched.length} sem correspondência.`
        : 'Todas as emissoras já estão com URLs corretas.',
    });
  };

  // Sync auto scrape state
  useEffect(() => {
    setAutoScrapeEnabled(isRunning);
  }, [isRunning]);

  const handleToggleAutoScrape = () => {
    if (autoScrapeEnabled) {
      stopAutoScraping();
      setAutoScrapeEnabled(false);
      toast({
        title: 'Scraping automático desativado',
        description: 'A captura automática de músicas foi pausada.',
      });
    } else {
      startAutoScraping(5); // 5 minutes
      setAutoScrapeEnabled(true);
      setLastAutoScrape(new Date());
      toast({
        title: 'Scraping automático ativado',
        description: 'Músicas serão capturadas automaticamente a cada 5 minutos.',
      });
    }
  };

  const handleManualScrapeAll = async () => {
    setScrapingStation('all');
    try {
      const result = await scrapeAllStations();
      setLastAutoScrape(new Date());
    } finally {
      setScrapingStation(null);
    }
  };

  const handleAddNewStation = () => {
    const newStation: RadioStation = {
      id: `station-${Date.now()}`,
      name: 'Nova Emissora',
      urls: [''],
      scrapeUrl: '',
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

  const handleDeleteStation = (stationId: string) => {
    setStations(stations.filter(s => s.id !== stationId));
    setEditingStation(null);
    setEditForm(null);
    setIsAddingNew(false);
    toast({
      title: 'Emissora removida',
      description: 'A emissora foi excluída com sucesso.',
    });
  };

  const handleEdit = (station: RadioStation) => {
    setEditingStation(station.id);
    setEditForm({ ...station });
    setIsAddingNew(false);
  };

  const handleSave = () => {
    if (editForm) {
      updateStation(editForm.id, editForm);
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
      // Remove the newly added station if canceling
      setStations(stations.filter(s => s.id !== editForm.id));
    }
    setEditingStation(null);
    setEditForm(null);
    setIsAddingNew(false);
  };

  const handleAddUrl = () => {
    if (editForm) {
      setEditForm({
        ...editForm,
        urls: [...editForm.urls, ''],
      });
    }
  };

  const handleRemoveUrl = (index: number) => {
    if (editForm) {
      setEditForm({
        ...editForm,
        urls: editForm.urls.filter((_, i) => i !== index),
      });
    }
  };

  const handleUrlChange = (index: number, value: string) => {
    if (editForm) {
      const newUrls = [...editForm.urls];
      newUrls[index] = value;
      setEditForm({ ...editForm, urls: newUrls });
    }
  };

  const handleStyleChange = (style: string) => {
    if (editForm) {
      const styles = editForm.styles.includes(style)
        ? editForm.styles.filter((s) => s !== style)
        : [...editForm.styles, style];
      setEditForm({ ...editForm, styles });
    }
  };

  const allStyles = ['SERTANEJO', 'PAGODE', 'AGRONEJO', 'POP/VARIADO', 'TEEN/HITS', 'DANCE', 'HITS'];

  const handleTestScrape = async (station: RadioStation) => {
    setScrapingStation(station.id);
    try {
      const result = await radioScraperApi.scrapeStation(station.name, station.scrapeUrl);
      
      if (result.success) {
        const totalSongs = (result.nowPlaying ? 1 : 0) + (result.recentSongs?.length || 0);
        
        toast({
          title: `🎵 ${totalSongs} músicas capturadas!`,
          description: result.nowPlaying 
            ? `Tocando: ${result.nowPlaying.artist} - ${result.nowPlaying.title}${result.recentSongs?.length ? ` + ${result.recentSongs.length} recentes` : ''}`
            : 'Conexão OK, mas sem música tocando no momento.',
        });

        // Add now playing song to captured songs
        if (result.nowPlaying) {
          addCapturedSong({
            id: `scrape-${Date.now()}`,
            title: result.nowPlaying.title,
            artist: result.nowPlaying.artist,
            station: station.name,
            timestamp: new Date(),
            status: 'found',
          });
        }

        // Add recent songs (last 5)
        if (result.recentSongs) {
          for (const song of result.recentSongs.slice(0, 5)) {
            addCapturedSong({
              id: `scrape-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              title: song.title,
              artist: song.artist,
              station: station.name,
              timestamp: new Date(song.timestamp),
              status: 'found',
            });
          }
        }
      } else {
        toast({
          title: 'Erro no scraping',
          description: result.error || 'Não foi possível obter dados da emissora.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Falha ao conectar com o serviço de scraping.',
        variant: 'destructive',
      });
    } finally {
      setScrapingStation(null);
    }
  };
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Emissoras</h2>
          <p className="text-muted-foreground">Gerencie os links e configurações das emissoras de rádio</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Sync Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncAllStations}
            className="gap-2"
          >
            <Link2 className="w-4 h-4" />
            Sincronizar URLs
          </Button>
          
          {/* Auto Scraping Controls */}
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {stats.lastScrape 
                  ? `Última: ${stats.lastScrape.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                  : 'Nunca executado'
                }
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleManualScrapeAll}
              disabled={scrapingStation === 'all' || stats.isRunning}
              className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-500 border-orange-500/30"
            >
              {scrapingStation === 'all' || stats.isRunning ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              {stats.isRunning && stats.currentStation ? `Atualizando ${stats.currentStation}...` : 'Forçar Atualização'}
            </Button>
            <Button
              variant={autoScrapeEnabled ? 'destructive' : 'default'}
              size="sm"
              onClick={handleToggleAutoScrape}
            >
              {autoScrapeEnabled ? (
                <>
                  <Pause className="w-4 h-4 mr-2" />
                  Parar Auto (5min)
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Iniciar Auto (5min)
                </>
              )}
            </Button>
          </div>
          <Button className="gap-2" onClick={handleAddNewStation}>
            <Plus className="w-4 h-4" />
            Nova Emissora
          </Button>
        </div>
      </div>

      {/* Sync Status Banner */}
      {syncStatus && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-sm text-foreground">
              <strong>{syncStatus.synced}</strong> emissoras com URLs oficiais sincronizadas
              {syncStatus.unmatched.length > 0 && (
                <span className="text-muted-foreground ml-2">
                  ({syncStatus.unmatched.length} sem correspondência: {syncStatus.unmatched.slice(0, 3).join(', ')}{syncStatus.unmatched.length > 3 ? '...' : ''})
                </span>
              )}
            </span>
          </div>
          <Badge variant="outline" className="text-xs">
            {Object.keys(knownStations).length} rádios na base
          </Badge>
        </div>
      )}

      {/* Auto Scraping Status Banner */}
      {autoScrapeEnabled && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm text-foreground">
            Scraping automático ativo - Capturando músicas de {stations.filter(s => s.enabled && s.scrapeUrl).length} emissoras a cada 5 minutos
          </span>
          {stats.totalSongs > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {stats.totalSongs} músicas capturadas
            </Badge>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {stations.map((station) => {
          const isEditing = editingStation === station.id;
          const data = isEditing && editForm ? editForm : station;

          return (
            <Card key={station.id} className="glass-card radio-card">
              <CardHeader className="border-b border-border pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Radio className="w-5 h-5 text-primary" />
                    </div>
                    {isEditing ? (
                      <Input
                        value={editForm?.name || ''}
                        onChange={(e) =>
                          setEditForm((prev) => prev && { ...prev, name: e.target.value })
                        }
                        className="w-40"
                      />
                    ) : (
                      <span>{station.name}</span>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={data.enabled}
                      onCheckedChange={(checked) =>
                        isEditing
                          ? setEditForm((prev) => prev && { ...prev, enabled: checked })
                          : updateStation(station.id, { enabled: checked })
                      }
                    />
                    <Label className="text-xs text-muted-foreground">
                      {data.enabled ? 'Ativo' : 'Inativo'}
                    </Label>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* URLs */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">URLs</Label>
                  <div className="mt-2 space-y-2">
                    {data.urls.map((url, index) => (
                      <div key={index} className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <Input
                              value={url}
                              onChange={(e) => handleUrlChange(index, e.target.value)}
                              className="flex-1 font-mono text-xs"
                              placeholder="https://..."
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleRemoveUrl(index)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs font-mono text-primary hover:underline truncate"
                          >
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{url}</span>
                          </a>
                        )}
                      </div>
                    ))}
                    {isEditing && (
                      <Button variant="outline" size="sm" className="w-full mt-2" onClick={handleAddUrl}>
                        <Plus className="w-4 h-4 mr-2" />
                        Adicionar URL
                      </Button>
                    )}
                  </div>
                </div>

                {/* Scrape URL */}
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">URL de Scraping (Tempo Real)</Label>
                    {!isEditing && (
                      <div className="flex items-center gap-1">
                        {getStationMatchStatus(station.name) === 'matched' ? (
                          <Badge variant="outline" className="text-xs text-green-500 border-green-500/30">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Oficial
                          </Badge>
                        ) : getStationMatchStatus(station.name) === 'custom' ? (
                          <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/30">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Customizado
                          </Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSyncStation(station)}
                            className="text-xs h-6 px-2"
                          >
                            <Link2 className="w-3 h-3 mr-1" />
                            Auto-preencher
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <Input
                          value={editForm?.scrapeUrl || ''}
                          onChange={(e) =>
                            setEditForm((prev) => prev && { ...prev, scrapeUrl: e.target.value })
                          }
                          className="flex-1 font-mono text-xs"
                          placeholder="https://mytuner-radio.com/..."
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const config = findStationConfig(editForm?.name || '');
                            if (config) {
                              setEditForm(prev => prev && { ...prev, scrapeUrl: config.scrapeUrl });
                              toast({ title: 'URL preenchida', description: 'URL oficial encontrada e aplicada.' });
                            } else {
                              toast({ title: 'Não encontrada', description: 'Emissora não está na base de dados.', variant: 'destructive' });
                            }
                          }}
                          className="text-xs"
                        >
                          <Link2 className="w-3 h-3" />
                        </Button>
                      </>
                    ) : (
                      <>
                        {data.scrapeUrl ? (
                          <a
                            href={data.scrapeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 flex items-center gap-2 text-xs font-mono text-primary hover:underline truncate"
                          >
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{data.scrapeUrl}</span>
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Não configurado</span>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTestScrape(station)}
                          disabled={!data.scrapeUrl || scrapingStation === station.id}
                        >
                          {scrapingStation === station.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                          <span className="ml-2">Testar</span>
                        </Button>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    URL do mytuner-radio.com para captura em tempo real
                  </p>
                </div>

                {/* Styles */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Estilos</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isEditing ? (
                      allStyles.map((style) => (
                        <Badge
                          key={style}
                          variant={data.styles.includes(style) ? 'default' : 'outline'}
                          className="cursor-pointer transition-all"
                          onClick={() => handleStyleChange(style)}
                        >
                          {style}
                        </Badge>
                      ))
                    ) : (
                      data.styles.map((style) => (
                        <Badge key={style} variant="secondary">
                          {style}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-between gap-2 pt-2 border-t border-border">
                  {isEditing ? (
                    <>
                      <Button 
                        variant="destructive" 
                        size="sm" 
                        onClick={() => handleDeleteStation(station.id)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Excluir
                      </Button>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={handleCancel}>
                          <X className="w-4 h-4 mr-2" />
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={handleSave}>
                          <Save className="w-4 h-4 mr-2" />
                          Salvar
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-end w-full">
                      <Button variant="outline" size="sm" onClick={() => handleEdit(station)}>
                        Editar
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
