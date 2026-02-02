import { useState } from 'react';
import { Download, FileText, Calendar, Settings, Copy, Check, RefreshCw, Code, FileJson, FolderOpen, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore } from '@/store/radioStore';
import { format } from 'date-fns';
import { sanitizeFilename } from '@/lib/sanitizeFilename';

const isElectron = !!window.electronAPI?.isElectron;

export function ExportView() {
  const { programs, sequence, config, stations } = useRadioStore();
  const { toast } = useToast();
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedGrade, setCopiedGrade] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isSavingGrade, setIsSavingGrade] = useState(false);

  // Generate config.json content for Python script
  const generateConfigJson = () => {
    const configForPython = {
      music_folders_win: config.musicFolders,
      grade_folder_win: config.gradeFolder,
      content_folder_win: config.contentFolder,
      ranking_file_win: config.rankingFile,
      program_ids: programs.reduce((acc, p) => {
        acc[p.timeRange] = p.programName;
        return acc;
      }, {} as Record<string, string>),
      radio_urls: stations.reduce((acc, s) => {
        acc[s.id] = {
          urls: s.urls,
          styles: s.styles,
        };
        return acc;
      }, {} as Record<string, { urls: string[]; styles: string[] }>),
      forbidden_words: ['1.FM', 'Love Classics', 'Solitaire', 'Mahjong', 'Dayspedia', 'Games', 'Online', 'METROPOLITANA - SP', 'BAND FM'],
      funk_words: ['funk', 'mc ', 'sequencia', 'proibidão', 'baile', 'kondzilla', 'gr6'],
      user_agents: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'],
      coringa_code: config.coringaCode,
      artist_repetition_interval_minutes: config.artistRepetitionMinutes,
      block_processing_safety_margin_minutes: config.safetyMarginMinutes,
      inventory_cache_duration_seconds: 3600,
      // Custom sequence mapping for the Python script
      sequence_map: sequence.reduce((acc, s) => {
        acc[s.position] = s.radioSource;
        return acc;
      }, {} as Record<number, string>),
    };
    return JSON.stringify(configForPython, null, 2);
  };

  // Generate demo grade content (for preview only)
  const generateGradePreview = () => {
    const blocks: string[] = [];

    const songsByStation: Record<string, string[]> = {
      bh: ['Evidencias - Chitaozinho e Xororo.mp3', 'Atrasadinha - Felipe Araujo.mp3', 'Medo Bobo - Maiara e Maraisa.mp3', 'Propaganda - Jorge e Mateus.mp3', 'Pessimo Negocio - Henrique e Juliano.mp3'],
      band: ['Deixa Eu Te Amar - Sorriso Maroto.mp3', 'Sorte - Thiaguinho.mp3', 'Amor Da Sua Cama - Bruno e Marrone.mp3', 'Fatalmente - Turma do Pagode.mp3'],
      disney: ['Shallow - Lady Gaga.mp3', 'Blinding Lights - The Weeknd.mp3'],
      metro: ['Hear Me Now - Alok.mp3', 'Dance Monkey - Tones and I.mp3'],
    };

    for (let hour = 6; hour < 12; hour++) {
      for (const minute of [0, 30]) {
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        let programName = 'PROGRAMA';
        for (const prog of programs) {
          const [start, end] = prog.timeRange.split('-').map(Number);
          if (hour >= start && hour <= end) {
            programName = prog.programName;
            break;
          }
        }
        const songs: string[] = [];
        const numSongs = 10;
        for (let i = 0; i < numSongs; i++) {
          const seqItem = sequence[i];
          let station = seqItem?.radioSource || 'bh';
          if (station === 'random_pop') station = Math.random() > 0.5 ? 'disney' : 'metro';
          const stationSongs = songsByStation[station] || songsByStation.bh;
          const song = stationSongs[i % stationSongs.length];
          // Sanitize filename for output
          songs.push(`"${sanitizeFilename(song)}"`);
        }
        blocks.push(`${timeStr} (ID=${programName}) ${songs.join(',vht,')}`);
      }
    }
    return blocks.join('\n');
  };

  const configJson = generateConfigJson();
  const gradePreview = generateGradePreview();

  const handleDownloadConfig = () => {
    const blob = new Blob([configJson], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: 'Config exportado!',
      description: 'Coloque o arquivo config.json na mesma pasta do script Python.',
    });
  };

  // Save config.json directly to grade folder (Electron only)
  const handleSaveConfigToFolder = async () => {
    if (!window.electronAPI?.saveGradeFile) {
      toast({
        title: '⚠️ Modo Web',
        description: 'Salvamento direto disponível apenas no aplicativo desktop.',
      });
      return;
    }

    setIsSavingConfig(true);
    try {
      const result = await window.electronAPI.saveGradeFile({
        folder: config.gradeFolder,
        filename: 'config.json',
        content: configJson,
      });

      if (result.success) {
        toast({
          title: '✅ Config salvo!',
          description: `Arquivo salvo em ${result.filePath}`,
        });
      } else {
        toast({
          title: '❌ Erro ao salvar',
          description: result.error || 'Erro desconhecido',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error saving config:', error);
      toast({
        title: '❌ Erro ao salvar',
        description: 'Erro ao salvar arquivo',
        variant: 'destructive',
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Get day code for current day - SÁB with accent for file compatibility
  const getDayCode = () => {
    const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    return days[new Date().getDay()];
  };

  // Save grade file directly to folder (Electron only)
  const handleSaveGradeToFolder = async () => {
    if (!window.electronAPI?.saveGradeFile) {
      toast({
        title: '⚠️ Modo Web',
        description: 'Salvamento direto disponível apenas no aplicativo desktop.',
      });
      return;
    }

    setIsSavingGrade(true);
    try {
      const filename = `${getDayCode()}.txt`;
      const result = await window.electronAPI.saveGradeFile({
        folder: config.gradeFolder,
        filename,
        content: gradePreview,
      });

      if (result.success) {
        toast({
          title: '✅ Grade salva!',
          description: `Arquivo ${filename} salvo em ${config.gradeFolder}`,
        });
      } else {
        toast({
          title: '❌ Erro ao salvar',
          description: result.error || 'Erro desconhecido',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error saving grade:', error);
      toast({
        title: '❌ Erro ao salvar',
        description: 'Erro ao salvar arquivo',
        variant: 'destructive',
      });
    } finally {
      setIsSavingGrade(false);
    }
  };

  // Open grade folder (Electron only)
  const handleOpenFolder = async () => {
    if (window.electronAPI?.openFolder) {
      await window.electronAPI.openFolder(config.gradeFolder);
    } else {
      toast({
        title: '⚠️ Modo Web',
        description: 'Abertura de pasta disponível apenas no aplicativo desktop.',
      });
    }
  };

  const handleCopyConfig = () => {
    navigator.clipboard.writeText(configJson);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
    toast({ title: 'Copiado!', description: 'config.json copiado para a área de transferência.' });
  };

  const handleCopyGrade = () => {
    navigator.clipboard.writeText(gradePreview);
    setCopiedGrade(true);
    setTimeout(() => setCopiedGrade(false), 2000);
    toast({ title: 'Copiado!', description: 'Prévia da grade copiada.' });
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground">Exportar Configuração</h2>
          <p className="text-muted-foreground text-sm">
            {isElectron ? 'Salve diretamente na pasta de grades ou exporte' : 'Modo Híbrido: Exporte para o script Python'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          {isElectron && (
            <>
              <Button variant="outline" size="sm" onClick={handleOpenFolder} className="gap-2">
                <FolderOpen className="w-4 h-4" />
                <span className="hidden sm:inline">Abrir Pasta</span>
              </Button>
              <Button size="sm" onClick={handleSaveConfigToFolder} className="gap-2" disabled={isSavingConfig}>
                <Save className="w-4 h-4" />
                <span className="hidden sm:inline">{isSavingConfig ? 'Salvando...' : 'Salvar Config'}</span>
              </Button>
            </>
          )}
          <Button variant={isElectron ? 'outline' : 'default'} size="sm" onClick={handleDownloadConfig} className="gap-2">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Baixar config.json</span>
            <span className="sm:hidden">Baixar</span>
          </Button>
        </div>
      </div>

      {/* Workflow Info */}
      <Card className="glass-card border-primary/20 bg-primary/5">
        <CardContent className="p-6">
          <h3 className="font-semibold text-primary mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Como funciona o Modo Híbrido
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold shrink-0">1</div>
              <div>
                <p className="font-medium text-foreground">Configure na Interface</p>
                <p className="text-sm text-muted-foreground">Ajuste emissoras, sequência, programação e configurações aqui</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold shrink-0">2</div>
              <div>
                <p className="font-medium text-foreground">Exporte o config.json</p>
                <p className="text-sm text-muted-foreground">Baixe e coloque na pasta do script Python</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold shrink-0">3</div>
              <div>
                <p className="font-medium text-foreground">Python gera automaticamente</p>
                <p className="text-sm text-muted-foreground">O script lê o config e salva as grades em C:\Playlist\pgm\Grades</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="config" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="config" className="gap-2">
            <FileJson className="w-4 h-4" />
            config.json
          </TabsTrigger>
          <TabsTrigger value="preview" className="gap-2">
            <FileText className="w-4 h-4" />
            Prévia da Grade
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config">
          <Card className="glass-card">
            <CardHeader className="border-b border-border py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileJson className="w-4 h-4 text-primary" />
                  config.json
                  <Badge variant="secondary" className="text-xs">Para o Script Python</Badge>
                </CardTitle>
                <Button variant="outline" size="sm" onClick={handleCopyConfig}>
                  {copiedConfig ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copiedConfig ? 'Copiado!' : 'Copiar'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-auto bg-background/50">
                <pre className="p-4 font-mono text-xs text-foreground">{configJson}</pre>
              </div>
            </CardContent>
          </Card>

          {/* Instructions */}
          <Card className="glass-card mt-4">
            <CardContent className="p-4">
              <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                <Code className="w-4 h-4 text-primary" />
                Instruções de Uso
              </h4>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>1. Baixe o arquivo <code className="bg-secondary px-1 rounded">config.json</code></p>
                <p>2. Coloque na mesma pasta do <code className="bg-secondary px-1 rounded">FINAL_1.py</code></p>
                <p>3. Execute o script: <code className="bg-secondary px-1 rounded">python FINAL_1.py</code></p>
                <p>4. O script vai usar suas configurações automaticamente!</p>
              </div>
              <div className="mt-4 p-3 rounded-lg bg-warning/10 border border-warning/20">
                <p className="text-xs text-warning">
                  ⚠️ Se o config.json já existir, será substituído. Faça backup se necessário.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview">
          <Card className="glass-card">
            <CardHeader className="border-b border-border py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Prévia da Grade ({getDayCode()}.txt)
                  <Badge variant="outline" className="text-xs">{isElectron ? 'Salvar direto' : 'Gerado pelo Python'}</Badge>
                </CardTitle>
                <div className="flex gap-2">
                  {isElectron && (
                    <Button variant="default" size="sm" onClick={handleSaveGradeToFolder} disabled={isSavingGrade}>
                      <Save className="w-4 h-4 mr-2" />
                      {isSavingGrade ? 'Salvando...' : `Salvar ${getDayCode()}.txt`}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={handleCopyGrade}>
                    {copiedGrade ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                    {copiedGrade ? 'Copiado!' : 'Copiar'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[400px] overflow-auto bg-background/50">
                <pre className="p-4 font-mono text-xs text-foreground whitespace-pre-wrap">{gradePreview}</pre>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card mt-4 border-success/20">
            <CardContent className="p-4 flex items-start gap-3">
              <RefreshCw className="w-5 h-5 text-success shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-success text-sm">
                  {isElectron 
                    ? `Salve diretamente em ${config.gradeFolder}` 
                    : 'Grade gerada automaticamente pelo Python'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {isElectron 
                    ? `Clique em "Salvar ${getDayCode()}.txt" para salvar a grade diretamente na pasta configurada.`
                    : `O script Python atualiza a grade a cada 20 minutos e salva em ${config.gradeFolder}\\${getDayCode()}.txt.`
                  }
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Current Config Summary */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border py-3">
          <CardTitle className="text-sm">Resumo da Configuração Atual</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Emissoras Ativas</p>
              <p className="font-mono font-bold text-foreground">{stations.filter(s => s.enabled).length}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Intervalo de Atualização</p>
              <p className="font-mono font-bold text-foreground">{config.updateIntervalMinutes} min</p>
            </div>
            <div>
              <p className="text-muted-foreground">Repetição de Artista</p>
              <p className="font-mono font-bold text-foreground">{config.artistRepetitionMinutes} min</p>
            </div>
            <div>
              <p className="text-muted-foreground">Código Coringa</p>
              <p className="font-mono font-bold text-foreground">{config.coringaCode}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
