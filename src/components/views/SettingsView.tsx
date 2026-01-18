import { useState } from 'react';
import { Settings, Save, RotateCcw, Clock, Users, Shield, Music2, FolderOpen, Eye, EyeOff } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function SettingsView() {
  const { config, setConfig, deezerConfig, setDeezerConfig } = useRadioStore();
  const { toast } = useToast();
  const [localConfig, setLocalConfig] = useState(config);
  const [localDeezerConfig, setLocalDeezerConfig] = useState(deezerConfig);
  const [showArl, setShowArl] = useState(false);
  const [forbiddenWords, setForbiddenWords] = useState(
    '1.FM, Love Classics, Solitaire, Mahjong, Dayspedia, Games, Online, METROPOLITANA - SP, BAND FM'
  );
  const [funkWords, setFunkWords] = useState(
    'funk, mc , sequencia, proibidão, baile, kondzilla, gr6'
  );

  const handleSave = () => {
    setConfig(localConfig);
    setDeezerConfig(localDeezerConfig);
    toast({
      title: 'Configurações salvas',
      description: 'As configurações do sistema foram atualizadas.',
    });
  };

  const handleReset = () => {
    setLocalConfig(config);
    setLocalDeezerConfig(deezerConfig);
    toast({
      title: 'Configurações restauradas',
      description: 'As alterações foram descartadas.',
    });
  };

  const validateArl = (arl: string) => {
    // ARL should be a long alphanumeric string (usually 192 chars)
    return arl.length > 100 && /^[a-zA-Z0-9]+$/.test(arl);
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Configurações</h2>
          <p className="text-muted-foreground">Ajuste os parâmetros do sistema de programação</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Restaurar
          </Button>
          <Button onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Salvar Configurações
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
              {localDeezerConfig.enabled && localDeezerConfig.arl && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-green-500/10 text-green-500 rounded-full">
                  Conectado
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
              <div>
                <Label>Ativar Download Automático</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Permitir download de músicas faltantes via Deezer
                </p>
              </div>
              <Switch
                checked={localDeezerConfig.enabled}
                onCheckedChange={(checked) =>
                  setLocalDeezerConfig((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </div>

            {localDeezerConfig.enabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="arl">ARL (Token de Autenticação)</Label>
                  <div className="relative">
                    <Input
                      id="arl"
                      type={showArl ? 'text' : 'password'}
                      value={localDeezerConfig.arl}
                      onChange={(e) =>
                        setLocalDeezerConfig((prev) => ({ ...prev, arl: e.target.value }))
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
                  <p className="text-xs text-muted-foreground">
                    {localDeezerConfig.arl ? (
                      validateArl(localDeezerConfig.arl) ? (
                        <span className="text-green-500">✓ ARL válido</span>
                      ) : (
                        <span className="text-yellow-500">⚠ ARL parece inválido (verifique)</span>
                      )
                    ) : (
                      'Obtenha o ARL nos cookies do Deezer (arl=...)'
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="downloadFolder">Pasta de Download</Label>
                  <div className="relative">
                    <Input
                      id="downloadFolder"
                      value={localDeezerConfig.downloadFolder}
                      onChange={(e) =>
                        setLocalDeezerConfig((prev) => ({ ...prev, downloadFolder: e.target.value }))
                      }
                      placeholder="C:\Playlist\Downloads"
                      className="pr-10"
                    />
                    <FolderOpen className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Pasta onde as músicas baixadas serão salvas
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quality">Qualidade do Download</Label>
                  <Select
                    value={localDeezerConfig.quality}
                    onValueChange={(value: 'MP3_128' | 'MP3_320' | 'FLAC') =>
                      setLocalDeezerConfig((prev) => ({ ...prev, quality: value }))
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

        {/* Advanced Settings */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-muted-foreground" />
              Configurações Avançadas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
