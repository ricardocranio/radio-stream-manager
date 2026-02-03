import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, RotateCcw, Clock, Shield, Music2, FolderOpen, Eye, EyeOff, HardDrive, FolderPlus, Trash2, Music, Loader2, CheckCircle2, XCircle, BarChart3 } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { useSimilarityLogStore } from '@/store/similarityLogStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ArlValidationResult {
  status: 'idle' | 'validating' | 'valid' | 'invalid';
  message?: string;
  user?: string;
  premium?: boolean;
}

export function SettingsView() {
  const { config, setConfig, deezerConfig, setDeezerConfig } = useRadioStore();
  const similarityStats = useSimilarityLogStore((state) => state.stats);
  const resetSimilarityStats = useSimilarityLogStore((state) => state.resetStats);
  const { toast } = useToast();
  const [localConfig, setLocalConfig] = useState(config);
  const [showArl, setShowArl] = useState(false);
  const [arlValidation, setArlValidation] = useState<ArlValidationResult>({ status: 'idle' });
  const [forbiddenWords, setForbiddenWords] = useState(
    config.forbiddenWords?.join(', ') || '1.FM, Love Classics, Solitaire, Mahjong, Dayspedia, Games, Online, METROPOLITANA - SP, BAND FM'
  );
  const [funkWords, setFunkWords] = useState(
    config.funkWords?.join(', ') || 'funk, mc , sequencia, proibidão, baile, kondzilla, gr6'
  );
  
  // Auto-save filter words when they change
  const filterSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    // Skip on initial mount
    if (isInitialMount.current) return;
    
    if (filterSaveTimeoutRef.current) {
      clearTimeout(filterSaveTimeoutRef.current);
    }
    
    filterSaveTimeoutRef.current = setTimeout(() => {
      const parsedForbidden = forbiddenWords.split(',').map(w => w.trim()).filter(Boolean);
      const parsedFunk = funkWords.split(',').map(w => w.trim()).filter(Boolean);
      
      setConfig({
        forbiddenWords: parsedForbidden,
        funkWords: parsedFunk,
      });
      console.log('[SETTINGS] ✓ Auto-saved content filters');
    }, 800);
    
    return () => {
      if (filterSaveTimeoutRef.current) {
        clearTimeout(filterSaveTimeoutRef.current);
      }
    };
  }, [forbiddenWords, funkWords, setConfig]);
  
  // Track if initial load is complete to avoid auto-save on mount
  const isInitialMount = useRef(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to update Deezer config - saves immediately to store
  const updateDeezerConfig = (updates: Partial<typeof deezerConfig>) => {
    setDeezerConfig(updates);
  };

  // Auto-save localConfig when it changes (with debounce)
  const autoSaveConfig = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      setConfig(localConfig);
      console.log('[SETTINGS] ✓ Auto-saved config:', localConfig.musicFolders);
    }, 500); // 500ms debounce
  }, [localConfig, setConfig]);

  useEffect(() => {
    // Skip auto-save on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    autoSaveConfig();
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [localConfig, autoSaveConfig]);

  // Sync localConfig and filters when store config changes externally
  useEffect(() => {
    setLocalConfig(config);
    // Sync filter words from config
    if (config.forbiddenWords) {
      setForbiddenWords(config.forbiddenWords.join(', '));
    }
    if (config.funkWords) {
      setFunkWords(config.funkWords.join(', '));
    }
  }, [config]);

  const handleReset = () => {
    setLocalConfig(config);
    toast({
      title: 'Configurações restauradas',
      description: 'As alterações foram descartadas.',
    });
  };

  const validateArlFormat = (arl: string) => {
    // ARL should be a long alphanumeric string (usually 192 chars)
    return arl.length > 100 && /^[a-zA-Z0-9]+$/.test(arl);
  };

  const handleValidateArl = async () => {
    if (!deezerConfig.arl) {
      toast({
        title: 'ARL não informada',
        description: 'Cole a ARL do Deezer antes de verificar.',
        variant: 'destructive',
      });
      return;
    }

    setArlValidation({ status: 'validating' });

    try {
      const { data, error } = await supabase.functions.invoke('validate-deezer-arl', {
        body: { arl: deezerConfig.arl },
      });

      if (error) {
        setArlValidation({ status: 'invalid', message: 'Erro ao conectar com o servidor' });
        toast({
          title: 'Erro na validação',
          description: 'Não foi possível verificar a ARL.',
          variant: 'destructive',
        });
        return;
      }

      if (data.valid) {
        setArlValidation({ 
          status: 'valid', 
          message: data.message,
          user: data.user,
          premium: data.premium
        });
        toast({
          title: '✅ ARL Válida!',
          description: data.message,
        });
      } else {
        setArlValidation({ status: 'invalid', message: data.error });
        toast({
          title: '❌ ARL Inválida',
          description: data.error || 'A ARL não é válida ou está expirada.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Error validating ARL:', err);
      setArlValidation({ status: 'invalid', message: 'Erro de conexão' });
      toast({
        title: 'Erro de conexão',
        description: 'Não foi possível conectar ao servidor de validação.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Configurações</h2>
          <p className="text-muted-foreground">Ajuste os parâmetros do sistema de programação</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Auto-save ativo
          </span>
          <Button variant="outline" onClick={handleReset} size="sm">
            <RotateCcw className="w-4 h-4 mr-2" />
            Restaurar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deezer Integration - NEW */}
        <Card className="glass-card border-primary/20 lg:col-span-2">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Music2 className="w-5 h-5 text-primary" />
              Integração Deezer
              {deezerConfig.enabled && deezerConfig.arl && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-green-500/10 text-green-500 rounded-full">
                  Conectado
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
              <div>
                <Label>Ativar Integração Deezer</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Permitir download de músicas faltantes via Deezer
                </p>
              </div>
              <Switch
                checked={deezerConfig.enabled}
                onCheckedChange={(checked) =>
                  updateDeezerConfig({ enabled: checked })
                }
              />
            </div>

            {deezerConfig.enabled && (
              <div className="flex items-center justify-between p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                <div>
                  <Label className="text-green-400">🤖 Download Automático</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Baixar automaticamente músicas faltantes da fila (requer ARL configurado)
                  </p>
                </div>
                <Switch
                  checked={deezerConfig.autoDownload}
                  onCheckedChange={(checked) =>
                    updateDeezerConfig({ autoDownload: checked })
                  }
                />
              </div>
            )}

            {deezerConfig.enabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="arl">ARL (Token de Autenticação)</Label>
                  <div className="relative">
                    <Input
                      id="arl"
                      type={showArl ? 'text' : 'password'}
                      value={deezerConfig.arl}
                      onChange={(e) =>
                        updateDeezerConfig({ arl: e.target.value })
                      }
                      placeholder="Cole seu ARL do Deezer aqui..."
                      className="pr-10 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowArl(!showArl)}
                    >
                      {showArl ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                  
                  {/* ARL Validation Status & Button */}
                  <div className="flex items-center gap-2 mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleValidateArl}
                      disabled={!deezerConfig.arl || arlValidation.status === 'validating'}
                      className="flex items-center gap-2"
                    >
                      {arlValidation.status === 'validating' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Verificando...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          Verificar ARL
                        </>
                      )}
                    </Button>
                    
                    {arlValidation.status === 'valid' && (
                      <span className="flex items-center gap-1 text-xs text-green-500">
                        <CheckCircle2 className="w-4 h-4" />
                        {arlValidation.user}{arlValidation.premium ? ' (Premium)' : ''}
                      </span>
                    )}
                    
                    {arlValidation.status === 'invalid' && (
                      <span className="flex items-center gap-1 text-xs text-red-500">
                        <XCircle className="w-4 h-4" />
                        {arlValidation.message}
                      </span>
                    )}
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    {deezerConfig.arl ? (
                      validateArlFormat(deezerConfig.arl) ? (
                        <span className="text-green-500">✓ Formato válido ({deezerConfig.arl.length} caracteres)</span>
                      ) : (
                        <span className="text-yellow-500">⚠ Formato parece inválido (verifique)</span>
                      )
                    ) : (
                      'Obtenha o ARL nos cookies do Deezer (arl=...)'
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="downloadFolder">Pasta de Download</Label>
                    {!(window.electronAPI?.isElectron) && (
                      <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">
                        Seleção disponível no Desktop
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="downloadFolder"
                      value={deezerConfig.downloadFolder}
                      onChange={(e) =>
                        updateDeezerConfig({ downloadFolder: e.target.value })
                      }
                      placeholder="C:\Playlist\Downloads"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      title={window.electronAPI?.isElectron ? "Selecionar pasta" : "Disponível apenas no app desktop"}
                      onClick={async () => {
                        // Check if running in Electron with selectFolder available
                        if (window.electronAPI?.isElectron && window.electronAPI?.selectFolder) {
                          try {
                            // Use Electron's native folder picker
                            const folder = await window.electronAPI.selectFolder();
                            if (folder) {
                              updateDeezerConfig({ downloadFolder: folder });
                              toast({
                                title: 'Pasta selecionada',
                                description: `Pasta "${folder}" selecionada com sucesso.`,
                              });
                            }
                          } catch (err) {
                            console.error('Error selecting folder:', err);
                            toast({
                              title: 'Erro ao selecionar pasta',
                              description: 'Não foi possível abrir o seletor de pastas.',
                              variant: 'destructive',
                            });
                          }
                        } else {
                          // Not in Electron - show message
                          toast({
                            title: '🖥️ Recurso Desktop',
                            description: 'A seleção de pasta com árvore de diretórios só funciona no aplicativo desktop (Electron). No navegador, digite o caminho manualmente.',
                            variant: 'destructive',
                          });
                        }
                      }}
                    >
                      <FolderOpen className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Pasta onde as músicas baixadas serão salvas. {!(window.electronAPI?.isElectron) && "Digite o caminho completo (ex: C:\\Playlist\\Downloads)"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quality">Qualidade do Download</Label>
                  <Select
                    value={deezerConfig.quality}
                    onValueChange={(value: 'MP3_128' | 'MP3_320' | 'FLAC') =>
                      updateDeezerConfig({ quality: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MP3_128">MP3 128kbps (Menor tamanho)</SelectItem>
                      <SelectItem value="MP3_320">MP3 320kbps (Recomendado)</SelectItem>
                      <SelectItem value="FLAC">FLAC (Sem perda - Premium HiFi)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    FLAC requer assinatura Deezer HiFi
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <Label>Intervalo de Download Automático</Label>
                    <span className="text-sm font-mono text-primary">
                      {(deezerConfig.autoDownloadIntervalMinutes || 1) < 1 
                        ? `${Math.round((deezerConfig.autoDownloadIntervalMinutes || 0.5) * 60)}s`
                        : `${deezerConfig.autoDownloadIntervalMinutes || 1} min`}
                    </span>
                  </div>
                  <Slider
                    value={[deezerConfig.autoDownloadIntervalMinutes || 1]}
                    onValueChange={([value]) =>
                      updateDeezerConfig({ autoDownloadIntervalMinutes: value })
                    }
                    min={0.5}
                    max={30}
                    step={0.5}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>30s</span>
                    <span>1min</span>
                    <span>5min</span>
                    <span>15min</span>
                    <span>30min</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tempo entre cada download automático (padrão: 1 min)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Como obter o ARL</Label>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Faça login no Deezer pelo navegador</li>
                    <li>Abra DevTools (F12) → Application → Cookies</li>
                    <li>Procure o cookie "arl" em www.deezer.com</li>
                    <li>Copie o valor (192 caracteres)</li>
                  </ol>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Music Library Folders - NEW */}
        <Card className="glass-card border-blue-500/20 lg:col-span-2">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Music className="w-5 h-5 text-blue-500" />
              Banco Musical (Acervo Local)
              <span className="ml-2 px-2 py-0.5 text-xs bg-blue-500/10 text-blue-500 rounded-full">
                {localConfig.musicFolders.length} {localConfig.musicFolders.length === 1 ? 'pasta' : 'pastas'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure as pastas onde o sistema irá buscar os arquivos de música para verificar se as músicas capturadas já existem no acervo.
            </p>
            
            {localConfig.musicFolders.map((folder, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <HardDrive className="w-5 h-5 text-blue-500" />
                </div>
                <Input
                  value={folder}
                  onChange={(e) => {
                    const newFolders = [...localConfig.musicFolders];
                    newFolders[index] = e.target.value;
                    setLocalConfig((prev) => ({ ...prev, musicFolders: newFolders }));
                  }}
                  className="flex-1 font-mono text-sm"
                  placeholder="C:\Caminho\Para\Músicas"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Selecionar pasta"
                  onClick={async () => {
                    if (window.electronAPI?.isElectron && window.electronAPI?.selectFolder) {
                      try {
                        const selectedFolder = await window.electronAPI.selectFolder();
                        if (selectedFolder) {
                          const newFolders = [...localConfig.musicFolders];
                          newFolders[index] = selectedFolder;
                          setLocalConfig((prev) => ({ ...prev, musicFolders: newFolders }));
                          toast({
                            title: '📁 Pasta selecionada',
                            description: selectedFolder,
                          });
                        }
                      } catch (err) {
                        toast({
                          title: 'Erro',
                          description: 'Não foi possível abrir o seletor de pastas.',
                          variant: 'destructive',
                        });
                      }
                    } else {
                      toast({
                        title: '🖥️ Recurso Desktop',
                        description: 'A seleção de pasta só funciona no aplicativo desktop.',
                        variant: 'destructive',
                      });
                    }
                  }}
                >
                  <FolderOpen className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (localConfig.musicFolders.length > 1) {
                      const newFolders = localConfig.musicFolders.filter((_, i) => i !== index);
                      setLocalConfig((prev) => ({ ...prev, musicFolders: newFolders }));
                    } else {
                      toast({
                        title: 'Mínimo de 1 pasta',
                        description: 'Você precisa ter pelo menos uma pasta configurada.',
                        variant: 'destructive',
                      });
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            
            <Button 
              variant="outline" 
              className="w-full border-dashed"
              onClick={() => {
                setLocalConfig((prev) => ({ 
                  ...prev, 
                  musicFolders: [...prev.musicFolders, ''] 
                }));
              }}
            >
              <FolderPlus className="w-4 h-4 mr-2" />
              Adicionar Pasta
            </Button>
            
            <p className="text-xs text-muted-foreground">
              O sistema vasculha recursivamente todas as subpastas procurando arquivos de áudio (.mp3, .flac, .wav, .m4a, .aac, .ogg, .wma)
            </p>

            {/* Similarity Threshold Slider */}
            <div className="space-y-2 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <Label>Threshold de Similaridade</Label>
                <span className="text-sm font-mono text-blue-500">
                  {Math.round((localConfig.similarityThreshold || 0.75) * 100)}%
                </span>
              </div>
              <Slider
                value={[(localConfig.similarityThreshold || 0.75) * 100]}
                onValueChange={([value]) =>
                  setLocalConfig((prev) => ({ ...prev, similarityThreshold: value / 100 }))
                }
                min={50}
                max={95}
                step={5}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>50%</span>
                <span>65%</span>
                <span>75%</span>
                <span>85%</span>
                <span>95%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Define o quão similar uma música capturada precisa ser com o arquivo local para ser considerada "encontrada". 
                Valores menores = mais flexível (mais matches), valores maiores = mais rigoroso (menos falsos positivos).
              </p>

              {/* Similarity Stats Panel */}
              {similarityStats.totalChecked > 0 && (
                <div className="mt-4 p-4 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-medium">Estatísticas de Similaridade</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        resetSimilarityStats();
                        toast({
                          title: 'Estatísticas resetadas',
                          description: 'O contador de similaridade foi zerado.',
                        });
                      }}
                      className="text-xs h-7"
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Resetar
                    </Button>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="text-center p-2 rounded bg-background">
                      <div className="text-lg font-bold text-foreground">{similarityStats.totalChecked}</div>
                      <div className="text-xs text-muted-foreground">Verificadas</div>
                    </div>
                    <div className="text-center p-2 rounded bg-green-500/10">
                      <div className="text-lg font-bold text-green-500">{similarityStats.accepted}</div>
                      <div className="text-xs text-muted-foreground">Aceitas</div>
                    </div>
                    <div className="text-center p-2 rounded bg-red-500/10">
                      <div className="text-lg font-bold text-red-500">{similarityStats.rejected}</div>
                      <div className="text-xs text-muted-foreground">Rejeitadas</div>
                    </div>
                    <div className="text-center p-2 rounded bg-blue-500/10">
                      <div className="text-lg font-bold text-blue-500">
                        {Math.round(similarityStats.averageSimilarity * 100)}%
                      </div>
                      <div className="text-xs text-muted-foreground">Média</div>
                    </div>
                  </div>

                  {/* Detailed breakdown */}
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                        Abaixo threshold: {similarityStats.belowThreshold}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                        Sem match: {similarityStats.noMatch}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        Erros: {similarityStats.errors}
                      </span>
                    </div>
                    {similarityStats.totalChecked > 0 && (
                      <div className="mt-2 text-xs">
                        <span className="text-green-500 font-medium">
                          Taxa de aceite: {Math.round((similarityStats.accepted / similarityStats.totalChecked) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Timing Settings */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Configurações de Tempo
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Intervalo de Atualização</Label>
                  <span className="text-sm font-mono text-primary">
                    {localConfig.updateIntervalMinutes} min
                  </span>
                </div>
                <Slider
                  value={[localConfig.updateIntervalMinutes]}
                  onValueChange={([value]) =>
                    setLocalConfig((prev) => ({ ...prev, updateIntervalMinutes: value }))
                  }
                  min={5}
                  max={60}
                  step={5}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Tempo entre cada atualização da grade
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Intervalo de Repetição de Artista</Label>
                  <span className="text-sm font-mono text-primary">
                    {localConfig.artistRepetitionMinutes} min
                  </span>
                </div>
                <Slider
                  value={[localConfig.artistRepetitionMinutes]}
                  onValueChange={([value]) =>
                    setLocalConfig((prev) => ({ ...prev, artistRepetitionMinutes: value }))
                  }
                  min={15}
                  max={120}
                  step={5}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Tempo mínimo antes de repetir o mesmo artista
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Margem de Segurança</Label>
                  <span className="text-sm font-mono text-primary">
                    {localConfig.safetyMarginMinutes} min
                  </span>
                </div>
                <Slider
                  value={[localConfig.safetyMarginMinutes]}
                  onValueChange={([value]) =>
                    setLocalConfig((prev) => ({ ...prev, safetyMarginMinutes: value }))
                  }
                  min={1}
                  max={15}
                  step={1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Margem antes do início do bloco para processar
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Filter Settings */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-accent" />
              Filtros de Conteúdo
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div>
              <Label className="text-sm">Palavras Proibidas</Label>
              <Textarea
                value={forbiddenWords}
                onChange={(e) => setForbiddenWords(e.target.value)}
                className="mt-2 font-mono text-xs h-24"
                placeholder="Palavras separadas por vírgula..."
              />
              <p className="text-xs text-muted-foreground mt-2">
                Músicas contendo essas palavras serão ignoradas
              </p>
            </div>

            <div>
              <Label className="text-sm">Palavras de Funk (Bloqueadas)</Label>
              <Textarea
                value={funkWords}
                onChange={(e) => setFunkWords(e.target.value)}
                className="mt-2 font-mono text-xs h-24"
                placeholder="Palavras separadas por vírgula..."
              />
              <p className="text-xs text-muted-foreground mt-2">
                Termos usados para identificar e bloquear funk
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Performance Settings */}
        <Card className="glass-card border-orange-500/20 lg:col-span-2">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-orange-500" />
              Performance e Economia de Recursos
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Power Saving Mode - NEW */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-orange-500/10 border border-orange-500/30">
                <div>
                  <Label className="text-orange-400">🔋 Modo Economia</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Reduz atualizações quando o app está em segundo plano (3x mais lento)
                  </p>
                </div>
                <Switch
                  checked={(localConfig as any).powerSavingMode ?? false}
                  onCheckedChange={(checked) =>
                    setLocalConfig((prev) => ({ ...prev, powerSavingMode: checked }))
                  }
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <Label>Curadoria TOP50 (10x10)</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ativar seleção inteligente TOP50
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <Label>Auto-Clean</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Limpar músicas faltando automaticamente
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <Label>Logging Detalhado</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Registrar operações no log
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <Label>Conteúdo Fixo</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Incluir notícias/horóscopo
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <Label>Ranking de Sucessos</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Usar ranking para priorização
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <Label>Cache de Inventário</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cache por 1 hora
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <Label>Notificações Toast</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Mostrar alertas de novas músicas
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
