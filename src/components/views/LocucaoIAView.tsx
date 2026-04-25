/**
 * Locuções IA - Generate radio voice-overs (announcements / outros)
 * using ElevenLabs TTS, on-demand.
 */
import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Mic, Play, Save, Loader2, Volume2, Sparkles, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useRadioStore } from '@/store/radioStore';
import { extractNextBlockFromGrade, type BlockExtraction } from '@/lib/locucao/gradeBlockReader';

const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;

// Curated PT-BR friendly voices (ElevenLabs multilingual_v2 supports PT)
const VOICES = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George — Masculina grave (locutor FM)' },
  { id: 'nPczCjzI2devNBz1zQrb', label: 'Brian — Masculina envolvente' },
  { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel — Masculina natural' },
  { id: 'bIHbv24MWmeRgasZH58o', label: 'Will — Masculina jovem' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', label: 'Roger — Masculina autoritária' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', label: 'Liam — Masculina clara' },
  { id: 'iP95p4xoKVk53GoZ742B', label: 'Chris — Masculina casual' },
  { id: 'cjVigY5qzO86Huf0OWal', label: 'Eric — Masculina madura' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah — Feminina profissional' },
  { id: 'XrExE9yKIg1WjnnlVkGX', label: 'Matilda — Feminina amigável' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', label: 'Alice — Feminina clara' },
  { id: 'cgSgspJ2msm6clMCkdW9', label: 'Jessica — Feminina jovem' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', label: 'Lily — Feminina suave' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', label: 'Laura — Feminina expressiva' },
];

interface Templates {
  anuncio: string;
  desanuncio: string;
}

interface Slot {
  musica1: string;
  artista1: string;
  musica2: string;
  artista2: string;
  radio: string;
  hora: string;
}

const DEFAULT_TEMPLATES: Templates = {
  anuncio: 'A seguir, {artista1} com {musica1}, e logo depois {artista2} interpretando {musica2}. Você está ouvindo {radio}.',
  desanuncio: 'Você acabou de ouvir {artista2} com {musica2}, e antes {artista1} com {musica1}, aqui na {radio}.',
};

const STORAGE_KEY_TEMPLATES = 'locucaoIA_templates';
const STORAGE_KEY_VOICE = 'locucaoIA_voiceId';
const STORAGE_KEY_SETTINGS = 'locucaoIA_settings';
const STORAGE_KEY_FOLDER = 'locucaoIA_folder';
const STORAGE_KEY_AUTOSAVE = 'locucaoIA_autoSave';

function applyTemplate(tpl: string, slot: Slot): string {
  return tpl
    .replace(/\{musica1\}/gi, slot.musica1 || '')
    .replace(/\{artista1\}/gi, slot.artista1 || '')
    .replace(/\{musica2\}/gi, slot.musica2 || '')
    .replace(/\{artista2\}/gi, slot.artista2 || '')
    .replace(/\{radio\}/gi, slot.radio || '')
    .replace(/\{hora\}/gi, slot.hora || '');
}

export function LocucaoIAView() {
  const [templates, setTemplates] = useState<Templates>(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY_TEMPLATES);
      if (s) return { ...DEFAULT_TEMPLATES, ...JSON.parse(s) };
    } catch {}
    return DEFAULT_TEMPLATES;
  });

  const [voiceId, setVoiceId] = useState<string>(() => localStorage.getItem(STORAGE_KEY_VOICE) || VOICES[0].id);
  const [settings, setSettings] = useState(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (s) return JSON.parse(s);
    } catch {}
    return { stability: 0.5, similarityBoost: 0.75, style: 0.4, speed: 1.0 };
  });
  const [folder, setFolder] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_FOLDER);
    // Migrate old default to new default
    if (!saved || saved === 'C:\\Playlist\\Locucoes') return 'C:\\Playlist\\Locucoes-IA';
    return saved;
  });
  const [autoSave, setAutoSave] = useState<boolean>(() => {
    const v = localStorage.getItem(STORAGE_KEY_AUTOSAVE);
    return v === null ? true : v === 'true';
  });

  const { config } = useRadioStore();

  const [slot, setSlot] = useState<Slot>({
    musica1: '',
    artista1: '',
    musica2: '',
    artista2: '',
    radio: 'BH FM',
    hora: '',
  });

  const [autoFromGrade, setAutoFromGrade] = useState<boolean>(() => {
    const v = localStorage.getItem('locucaoIA_autoFromGrade');
    return v === null ? true : v === 'true';
  });
  const [lastBlock, setLastBlock] = useState<BlockExtraction | null>(null);
  const [loadingGrade, setLoadingGrade] = useState(false);

  const [generating, setGenerating] = useState<'anuncio' | 'desanuncio' | null>(null);
  const [audioUrls, setAudioUrls] = useState<{ anuncio?: { url: string; base64: string }; desanuncio?: { url: string; base64: string } }>({});

  // Persist
  useEffect(() => { localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(templates)); }, [templates]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_VOICE, voiceId); }, [voiceId]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_FOLDER, folder); }, [folder]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_AUTOSAVE, String(autoSave)); }, [autoSave]);
  useEffect(() => { localStorage.setItem('locucaoIA_autoFromGrade', String(autoFromGrade)); }, [autoFromGrade]);

  /** Reads next block from grade .txt and applies first2 (anúncio) + last2 (desanúncio) into slot. */
  const fillFromGrade = async (kind: 'anuncio' | 'desanuncio' | 'both' = 'both', silent = false): Promise<BlockExtraction | null> => {
    if (!isElectron) {
      if (!silent) toast.error('Auto-preenchimento só funciona no app Desktop (Electron).');
      return null;
    }
    setLoadingGrade(true);
    try {
      const block = await extractNextBlockFromGrade({
        gradeFolder: config.gradeFolder,
        musicFolders: config.musicFolders || [],
        coringaCode: config.coringaCode || 'mus',
        allowCurrent: true,
      });
      if (!block) {
        if (!silent) toast.error('Nenhum bloco resolvido encontrado na grade do dia.');
        return null;
      }
      setLastBlock(block);
      setSlot(prev => {
        const next = { ...prev, hora: block.time };
        if (kind === 'anuncio' || kind === 'both') {
          if (block.first2[0]) { next.musica1 = block.first2[0].title; next.artista1 = block.first2[0].artist; }
          if (block.first2[1]) { next.musica2 = block.first2[1].title; next.artista2 = block.first2[1].artist; }
        }
        if (kind === 'desanuncio') {
          if (block.last2[0]) { next.musica1 = block.last2[0].title; next.artista1 = block.last2[0].artist; }
          if (block.last2[1]) { next.musica2 = block.last2[1].title; next.artista2 = block.last2[1].artist; }
        }
        return next;
      });
      if (!silent) toast.success(`Bloco ${block.time} (${block.programLabel}) carregado da grade`);
      return block;
    } catch (err: any) {
      if (!silent) toast.error(`Erro ao ler grade: ${err?.message}`);
      return null;
    } finally {
      setLoadingGrade(false);
    }
  };

  // Auto-fill on mount when option is enabled
  useEffect(() => {
    if (autoFromGrade && isElectron) {
      fillFromGrade('both', true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewAnuncio = useMemo(() => applyTemplate(templates.anuncio, slot), [templates.anuncio, slot]);
  const previewDesanuncio = useMemo(() => applyTemplate(templates.desanuncio, slot), [templates.desanuncio, slot]);

  const buildFilename = (kind: 'anuncio' | 'desanuncio') => {
    const ts = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const tag = kind === 'anuncio' ? 'ANUNCIO' : 'DESANUNCIO';
    return `${tag}_${slot.radio}_${ts}.mp3`;
  };

  const persistAudio = async (kind: 'anuncio' | 'desanuncio', base64: string, dataUrl: string, silent = false) => {
    if (!isElectron || !(window as any).electronAPI?.saveLocucao) {
      if (silent) return; // don't auto-trigger browser download
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = buildFilename(kind);
      link.click();
      return;
    }
    try {
      const result = await (window as any).electronAPI.saveLocucao({
        folder,
        filename: buildFilename(kind),
        audioBase64: base64,
      });
      if (result?.success) toast.success(`💾 Salvo: ${result.path}`);
      else toast.error(`Erro ao salvar: ${result?.error || 'desconhecido'}`);
    } catch (err: any) {
      toast.error(`Erro: ${err?.message}`);
    }
  };

  const generate = async (kind: 'anuncio' | 'desanuncio') => {
    const text = kind === 'anuncio' ? previewAnuncio : previewDesanuncio;
    if (!text.trim()) {
      toast.error('Texto vazio — preencha as músicas/artistas primeiro.');
      return;
    }
    setGenerating(kind);
    try {
      const { data, error } = await supabase.functions.invoke('generate-locucao', {
        body: { text, voiceId, ...settings },
      });
      if (error) throw error;
      if (!data?.audioBase64) throw new Error('Resposta sem áudio');

      const url = `data:audio/mpeg;base64,${data.audioBase64}`;
      setAudioUrls(prev => ({ ...prev, [kind]: { url, base64: data.audioBase64 } }));
      toast.success(`${kind === 'anuncio' ? 'Anúncio' : 'Desanúncio'} gerado (${Math.round((data.sizeBytes || 0) / 1024)} KB)`);

      if (autoSave) {
        await persistAudio(kind, data.audioBase64, url, true);
      }
    } catch (err: any) {
      console.error('[LOCUCAO]', err);
      toast.error(`Falha ao gerar: ${err?.message || 'erro desconhecido'}`);
    } finally {
      setGenerating(null);
    }
  };

  const saveToDisk = async (kind: 'anuncio' | 'desanuncio') => {
    const audio = audioUrls[kind];
    if (!audio) {
      toast.error('Gere o áudio primeiro.');
      return;
    }
    await persistAudio(kind, audio.base64, audio.url, false);
  };


  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Mic className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Locuções IA</h1>
          <p className="text-sm text-muted-foreground">
            Gere anúncios e desanúncios com voz de inteligência artificial (ElevenLabs)
          </p>
        </div>
      </div>

      <Tabs defaultValue="generate" className="space-y-4">
        <TabsList>
          <TabsTrigger value="generate">Gerar Locuções</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="voice">Voz & Configurações</TabsTrigger>
        </TabsList>

        {/* GERAR */}
        <TabsContent value="generate" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados do bloco (2 primeiras músicas)</CardTitle>
              <CardDescription>Preencha as informações que serão inseridas no template.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Música 1</Label>
                <Input value={slot.musica1} onChange={e => setSlot(s => ({ ...s, musica1: e.target.value }))} placeholder="Ex: Garota de Ipanema" />
              </div>
              <div className="space-y-2">
                <Label>Artista 1</Label>
                <Input value={slot.artista1} onChange={e => setSlot(s => ({ ...s, artista1: e.target.value }))} placeholder="Ex: Tom Jobim" />
              </div>
              <div className="space-y-2">
                <Label>Música 2</Label>
                <Input value={slot.musica2} onChange={e => setSlot(s => ({ ...s, musica2: e.target.value }))} placeholder="Ex: Aquarela do Brasil" />
              </div>
              <div className="space-y-2">
                <Label>Artista 2</Label>
                <Input value={slot.artista2} onChange={e => setSlot(s => ({ ...s, artista2: e.target.value }))} placeholder="Ex: Gal Costa" />
              </div>
              <div className="space-y-2">
                <Label>Rádio</Label>
                <Input value={slot.radio} onChange={e => setSlot(s => ({ ...s, radio: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Hora (opcional)</Label>
                <Input value={slot.hora} onChange={e => setSlot(s => ({ ...s, hora: e.target.value }))} placeholder="Ex: 14h" />
              </div>
            </CardContent>
          </Card>

          {/* ANUNCIO CARD */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Anúncio (entrada do bloco)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md bg-muted/40 p-3 text-sm border border-border/50">
                {previewAnuncio || <span className="text-muted-foreground italic">Preencha os dados acima…</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => generate('anuncio')} disabled={generating !== null}>
                  {generating === 'anuncio' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Volume2 className="h-4 w-4 mr-2" />}
                  Gerar Anúncio
                </Button>
                {audioUrls.anuncio && (
                  <>
                    <audio controls src={audioUrls.anuncio.url} className="h-10" />
                    <Button variant="secondary" onClick={() => saveToDisk('anuncio')}>
                      <Save className="h-4 w-4 mr-2" /> Salvar em disco
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* DESANUNCIO CARD */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Desanúncio (saída do bloco)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md bg-muted/40 p-3 text-sm border border-border/50">
                {previewDesanuncio || <span className="text-muted-foreground italic">Preencha os dados acima…</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => generate('desanuncio')} disabled={generating !== null}>
                  {generating === 'desanuncio' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Volume2 className="h-4 w-4 mr-2" />}
                  Gerar Desanúncio
                </Button>
                {audioUrls.desanuncio && (
                  <>
                    <audio controls src={audioUrls.desanuncio.url} className="h-10" />
                    <Button variant="secondary" onClick={() => saveToDisk('desanuncio')}>
                      <Save className="h-4 w-4 mr-2" /> Salvar em disco
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TEMPLATES */}
        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Templates de texto</CardTitle>
              <CardDescription>
                Variáveis disponíveis: <code className="px-1 bg-muted rounded">{'{musica1}'}</code>{' '}
                <code className="px-1 bg-muted rounded">{'{artista1}'}</code>{' '}
                <code className="px-1 bg-muted rounded">{'{musica2}'}</code>{' '}
                <code className="px-1 bg-muted rounded">{'{artista2}'}</code>{' '}
                <code className="px-1 bg-muted rounded">{'{radio}'}</code>{' '}
                <code className="px-1 bg-muted rounded">{'{hora}'}</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Anúncio</Label>
                <Textarea
                  value={templates.anuncio}
                  onChange={e => setTemplates(t => ({ ...t, anuncio: e.target.value }))}
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>Desanúncio</Label>
                <Textarea
                  value={templates.desanuncio}
                  onChange={e => setTemplates(t => ({ ...t, desanuncio: e.target.value }))}
                  rows={4}
                />
              </div>
              <Button variant="outline" onClick={() => setTemplates(DEFAULT_TEMPLATES)}>
                Restaurar padrões
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* VOZ */}
        <TabsContent value="voice" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Voz</CardTitle>
              <CardDescription>Teste diferentes vozes — recomendamos as graves para locução de rádio FM.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Voz</Label>
                <Select value={voiceId} onValueChange={setVoiceId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VOICES.map(v => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Estabilidade: {settings.stability.toFixed(2)}</Label>
                  <Slider value={[settings.stability]} min={0} max={1} step={0.05}
                    onValueChange={([v]) => setSettings((s: any) => ({ ...s, stability: v }))} />
                  <p className="text-xs text-muted-foreground">Menor = mais expressivo. Maior = mais consistente.</p>
                </div>
                <div className="space-y-2">
                  <Label>Similarity Boost: {settings.similarityBoost.toFixed(2)}</Label>
                  <Slider value={[settings.similarityBoost]} min={0} max={1} step={0.05}
                    onValueChange={([v]) => setSettings((s: any) => ({ ...s, similarityBoost: v }))} />
                </div>
                <div className="space-y-2">
                  <Label>Estilo: {settings.style.toFixed(2)}</Label>
                  <Slider value={[settings.style]} min={0} max={1} step={0.05}
                    onValueChange={([v]) => setSettings((s: any) => ({ ...s, style: v }))} />
                  <p className="text-xs text-muted-foreground">Maior = mais estilizado/animado.</p>
                </div>
                <div className="space-y-2">
                  <Label>Velocidade: {settings.speed.toFixed(2)}x</Label>
                  <Slider value={[settings.speed]} min={0.7} max={1.2} step={0.05}
                    onValueChange={([v]) => setSettings((s: any) => ({ ...s, speed: v }))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Pasta para salvar (Electron)</Label>
                <Input value={folder} onChange={e => setFolder(e.target.value)} placeholder="C:\Playlist\Locucoes-IA" />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 p-3 bg-muted/20">
                <div className="space-y-0.5 pr-4">
                  <Label htmlFor="autosave-switch" className="text-sm font-medium">
                    Salvar automaticamente no disco
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Ao gerar uma locução, o MP3 é gravado imediatamente na pasta acima usando o nome padrão.
                  </p>
                </div>
                <Switch
                  id="autosave-switch"
                  checked={autoSave}
                  onCheckedChange={setAutoSave}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
