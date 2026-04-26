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
import { injectLocucaoInGrade, injectMarkersIntoTokens } from '@/lib/locucao/gradeBlockInjector';
import { LocucaoSchedulePolicyEditor } from '@/components/locucao/LocucaoSchedulePolicyEditor';

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

// ===== Presets por período do dia =====
type PeriodPresetKey = 'manha' | 'tarde' | 'noite' | 'fim_de_semana';
type DayPresetKey = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';
type PresetKey = PeriodPresetKey;

const DAY_PRESETS: Record<DayPresetKey, { label: string; emoji: string; dayIndex: number }> = {
  dom: { label: 'Domingo', emoji: '🛋️', dayIndex: 0 },
  seg: { label: 'Segunda', emoji: '☕', dayIndex: 1 },
  ter: { label: 'Terça', emoji: '📻', dayIndex: 2 },
  qua: { label: 'Quarta', emoji: '🎧', dayIndex: 3 },
  qui: { label: 'Quinta', emoji: '🎶', dayIndex: 4 },
  sex: { label: 'Sexta', emoji: '🎤', dayIndex: 5 },
  sab: { label: 'Sábado', emoji: '🎉', dayIndex: 6 },
};

const DAY_KEYS: DayPresetKey[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
function dayKeyFromIndex(i: number): DayPresetKey { return DAY_KEYS[i]; }

const PRESETS: Record<PresetKey, { label: string; emoji: string; templates: Templates }> = {
  manha: {
    label: 'Manhã',
    emoji: '🌅',
    templates: {
      anuncio: 'Bom dia! Nesta manhã de {dia} na {radio}, a seguir {artista1} com {musica1}, e na sequência {artista2} apresentando {musica2}. Vamos juntos!',
      desanuncio: 'Você acabou de ouvir {artista2} com {musica2}, antes {artista1} com {musica1}. Continue ligado na {radio} nesta manhã de {dia}.',
    },
  },
  tarde: {
    label: 'Tarde',
    emoji: '☀️',
    templates: {
      anuncio: 'Boa tarde! Aqui na {radio}, agora é hora de {artista1} com {musica1}, e logo depois {artista2} com {musica2}. Sua tarde de {dia} é aqui!',
      desanuncio: 'Foram {artista1} com {musica1} e {artista2} com {musica2}, embalando a sua tarde de {dia} na {radio}.',
    },
  },
  noite: {
    label: 'Noite',
    emoji: '🌙',
    templates: {
      anuncio: 'Boa noite! Para a sua noite de {dia} na {radio}, a seguir {artista1} interpretando {musica1}, e na sequência {artista2} com {musica2}.',
      desanuncio: 'Acabamos de ouvir {artista2} com {musica2}, e antes {artista1} com {musica1}. Sua noite de {dia} continua aqui na {radio}.',
    },
  },
  fim_de_semana: {
    label: 'Final de semana',
    emoji: '🎉',
    templates: {
      anuncio: 'É {dia} na {radio}! Bora curtir o final de semana com {artista1} e {musica1}, e logo depois {artista2} com {musica2}!',
      desanuncio: 'Foram {artista1} com {musica1} e {artista2} com {musica2}, agitando o seu {dia} aqui na {radio}. O final de semana é nosso!',
    },
  },
};

const STORAGE_KEY_TEMPLATES = 'locucaoIA_templates';
const STORAGE_KEY_VOICE = 'locucaoIA_voiceId';
const STORAGE_KEY_SETTINGS = 'locucaoIA_settings';
const STORAGE_KEY_FOLDER = 'locucaoIA_folder';
const STORAGE_KEY_AUTOSAVE = 'locucaoIA_autoSave';
const STORAGE_KEY_PRESET_VOICES = 'locucaoIA_presetVoices';
const STORAGE_KEY_DAY_VOICES = 'locucaoIA_dayVoices';
const STORAGE_KEY_USE_PRESET_VOICE = 'locucaoIA_usePresetVoice';
const STORAGE_KEY_API_KEY = 'locucaoIA_elevenLabsApiKey';

/** Detecta qual preset corresponde ao momento atual. FDS tem prioridade. */
function detectActivePreset(now: Date = new Date()): PresetKey {
  const d = now.getDay();
  if (d === 0 || d === 6) return 'fim_de_semana';
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'manha';
  if (h >= 12 && h < 18) return 'tarde';
  return 'noite';
}

// ===== Variáveis dinâmicas de data/hora =====
const DAY_NAMES = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function getDynamicVars(now: Date = new Date()): { dia: string; periodo: string; saudacao: string; fimDeSemana: string } {
  const dia = DAY_NAMES[now.getDay()];
  const h = now.getHours();
  let periodo: string;
  let saudacao: string;
  if (h >= 5 && h < 12) { periodo = 'manhã'; saudacao = 'Bom dia'; }
  else if (h >= 12 && h < 18) { periodo = 'tarde'; saudacao = 'Boa tarde'; }
  else { periodo = 'noite'; saudacao = 'Boa noite'; }
  const isFds = now.getDay() === 0 || now.getDay() === 6;
  return { dia, periodo, saudacao, fimDeSemana: isFds ? 'sim' : 'não' };
}

function applyTemplate(tpl: string, slot: Slot, now: Date = new Date()): string {
  const v = getDynamicVars(now);
  return tpl
    .replace(/\{musica1\}/gi, slot.musica1 || '')
    .replace(/\{artista1\}/gi, slot.artista1 || '')
    .replace(/\{musica2\}/gi, slot.musica2 || '')
    .replace(/\{artista2\}/gi, slot.artista2 || '')
    .replace(/\{radio\}/gi, slot.radio || '')
    .replace(/\{hora\}/gi, slot.hora || '')
    .replace(/\{dia\}/gi, v.dia)
    .replace(/\{periodo\}/gi, v.periodo)
    .replace(/\{saudacao\}/gi, v.saudacao)
    .replace(/\{fim_de_semana\}/gi, v.fimDeSemana);
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
  // Mapa: preset → voiceId. Se vazio, cai na voz global (voiceId).
  const [presetVoices, setPresetVoices] = useState<Record<PresetKey, string>>(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY_PRESET_VOICES);
      if (s) return { manha: '', tarde: '', noite: '', fim_de_semana: '', ...JSON.parse(s) };
    } catch {}
    return { manha: '', tarde: '', noite: '', fim_de_semana: '' };
  });
  const [usePresetVoice, setUsePresetVoice] = useState<boolean>(() => {
    const v = localStorage.getItem(STORAGE_KEY_USE_PRESET_VOICE);
    return v === null ? true : v === 'true';
  });
  // Mapa: dia da semana → voiceId. Tem prioridade sobre o preset de período.
  const [dayVoices, setDayVoices] = useState<Record<DayPresetKey, string>>(() => {
    const empty: Record<DayPresetKey, string> = { dom: '', seg: '', ter: '', qua: '', qui: '', sex: '', sab: '' };
    try {
      const s = localStorage.getItem(STORAGE_KEY_DAY_VOICES);
      if (s) return { ...empty, ...JSON.parse(s) };
    } catch {}
    return empty;
  });
  // Chave ElevenLabs do utilizador (opcional). Se vazia, usa a chave do servidor (modo demo).
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem(STORAGE_KEY_API_KEY) || '');
  const [showApiKey, setShowApiKey] = useState(false);
  // Simulação de data/hora (apenas pré-visualização — não afeta geração real, a menos que o usuário aplique).
  const [simulating, setSimulating] = useState(false);
  const [simDay, setSimDay] = useState<number>(new Date().getDay()); // 0..6
  const [simHour, setSimHour] = useState<number>(new Date().getHours()); // 0..23
  const effectiveNow = (): Date => {
    if (!simulating) return new Date();
    const d = new Date();
    // Ajusta para o dia da semana escolhido
    d.setDate(d.getDate() + (simDay - d.getDay()));
    d.setHours(simHour, 0, 0, 0);
    return d;
  };

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
  // Numeric positions (1-based, counting only music tokens; ignores VHT/VHTN)
  // openPos: posição da música ANTES da qual o LOC (abertura) é inserido
  // closePos: posição da música APÓS a qual o LOC_END (fechamento) é inserido
  // null = não inserir esse marcador
  const [openPos, setOpenPos] = useState<number | null>(() => {
    const v = localStorage.getItem('locucaoIA_openPos');
    if (v === null) return 1;
    return v === '' ? null : Number(v);
  });
  const [closePos, setClosePos] = useState<number | null>(() => {
    const v = localStorage.getItem('locucaoIA_closePos');
    if (v === null) return 7;
    return v === '' ? null : Number(v);
  });
  const [autoInsertInGrade, setAutoInsertInGrade] = useState<boolean>(() => {
    const v = localStorage.getItem('locucaoIA_autoInsertInGrade');
    return v === null ? true : v === 'true';
  });
  const [injectingGrade, setInjectingGrade] = useState(false);

  const [generating, setGenerating] = useState<'anuncio' | 'desanuncio' | null>(null);
  const [audioUrls, setAudioUrls] = useState<{ anuncio?: { url: string; base64: string }; desanuncio?: { url: string; base64: string } }>({});

  // Persist
  useEffect(() => { localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(templates)); }, [templates]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_VOICE, voiceId); }, [voiceId]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_FOLDER, folder); }, [folder]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_AUTOSAVE, String(autoSave)); }, [autoSave]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_PRESET_VOICES, JSON.stringify(presetVoices)); }, [presetVoices]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_DAY_VOICES, JSON.stringify(dayVoices)); }, [dayVoices]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_USE_PRESET_VOICE, String(usePresetVoice)); }, [usePresetVoice]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_API_KEY, apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem('locucaoIA_autoFromGrade', String(autoFromGrade)); }, [autoFromGrade]);
  useEffect(() => { localStorage.setItem('locucaoIA_openPos', openPos === null ? '' : String(openPos)); }, [openPos]);
  useEffect(() => { localStorage.setItem('locucaoIA_closePos', closePos === null ? '' : String(closePos)); }, [closePos]);
  useEffect(() => { localStorage.setItem('locucaoIA_autoInsertInGrade', String(autoInsertInGrade)); }, [autoInsertInGrade]);
  // Persiste o nome da rádio para o resolver usado pelos tooltips/preview da Sequência.
  useEffect(() => { localStorage.setItem('locucaoIA_radioName', slot.radio || ''); }, [slot.radio]);

  /** Inject LOC/LOC_END markers in the day's grade .txt at the targeted block time. */
  const insertLocucaoInGrade = async (silent = false): Promise<boolean> => {
    if (!lastBlock?.time) {
      if (!silent) toast.error('Carregue o próximo bloco da grade primeiro.');
      return false;
    }
    setInjectingGrade(true);
    try {
      const r = await injectLocucaoInGrade({
        gradeFolder: config.gradeFolder,
        targetTime: lastBlock.time,
        openPos,
        closePos,
      });
      if (r.success) {
        const parts: string[] = [];
        const effOpen = r.effectiveOpenPos ?? openPos;
        const effClose = r.effectiveClosePos ?? closePos;
        if (effOpen) parts.push(`LOC@${effOpen}${r.openPosFromNews ? ' (após NOTÍCIAS)' : ''}`);
        if (effClose) parts.push(`LOC_END@${effClose}`);
        if (!silent) toast.success(`📌 Locução marcada no bloco ${lastBlock.time} (${parts.join(' + ') || 'sem marcadores'})`);
        return true;
      }
      if (r.skipped) {
        if (!silent) toast.warning(`⚠️ Bloco ${lastBlock.time} pulado: ${r.skipReason}`);
        return false;
      }
      if (!silent) toast.error(r.error || 'Falha ao inserir na grade.');
      return false;
    } finally {
      setInjectingGrade(false);
    }
  };

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

  const previewAnuncio = useMemo(() => applyTemplate(templates.anuncio, slot, effectiveNow()), [templates.anuncio, slot, simulating, simDay, simHour]);
  const previewDesanuncio = useMemo(() => applyTemplate(templates.desanuncio, slot, effectiveNow()), [templates.desanuncio, slot, simulating, simDay, simHour]);

  // Preview dedicado do EDITOR LOC/LOC_END — usa first2 para LOC e last2 para LOC_END
  // garantindo paridade total com o que será gerado em runtime.
  const editorSlotLoc = useMemo<Slot>(() => {
    const a = lastBlock?.first2?.[0];
    const b = lastBlock?.first2?.[1];
    return {
      musica1: a?.title || slot.musica1 || '«1ª música»',
      artista1: a?.artist || slot.artista1 || '«1º artista»',
      musica2: b?.title || slot.musica2 || '«2ª música»',
      artista2: b?.artist || slot.artista2 || '«2º artista»',
      radio: slot.radio,
      hora: lastBlock?.time || slot.hora || '',
    };
  }, [lastBlock, slot]);
  const editorSlotLocEnd = useMemo<Slot>(() => {
    const a = lastBlock?.last2?.[0];
    const b = lastBlock?.last2?.[1];
    return {
      musica1: a?.title || slot.musica1 || '«penúltima música»',
      artista1: a?.artist || slot.artista1 || '«penúltimo artista»',
      musica2: b?.title || slot.musica2 || '«última música»',
      artista2: b?.artist || slot.artista2 || '«último artista»',
      radio: slot.radio,
      hora: lastBlock?.time || slot.hora || '',
    };
  }, [lastBlock, slot]);
  const editorPreviewAnuncio = useMemo(
    () => applyTemplate(templates.anuncio, editorSlotLoc, effectiveNow()),
    [templates.anuncio, editorSlotLoc, simulating, simDay, simHour],
  );
  const editorPreviewDesanuncio = useMemo(
    () => applyTemplate(templates.desanuncio, editorSlotLocEnd, effectiveNow()),
    [templates.desanuncio, editorSlotLocEnd, simulating, simDay, simHour],
  );

  // Prévia em tempo real da linha do bloco com LOC/LOC_END nas posições escolhidas
  const blockPreview = useMemo(() => {
    if (!lastBlock) return null;
    const original = lastBlock.rawTokens;
    const withMarkers = injectMarkersIntoTokens(original, openPos, closePos);
    return { original, withMarkers };
  }, [lastBlock, openPos, closePos]);

  const SEPARATOR_TOKENS = new Set(['VHT', 'VHTN', 'LOC', 'LOC_END']);
  const isMarker = (t: string) => {
    const u = t.toUpperCase();
    return u === 'LOC' || u === 'LOC_END';
  };
  const isVinheta = (t: string) => {
    const u = t.toUpperCase();
    return u === 'VHT' || u === 'VHTN';
  };
  // Computa o índice musical (1-based) de cada token na lista final
  const computeMusicIndices = (tokens: string[]): (number | null)[] => {
    let n = 0;
    return tokens.map((t) => {
      if (SEPARATOR_TOKENS.has(t.toUpperCase())) return null;
      n++;
      return n;
    });
  };

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
    // If auto-from-grade is enabled, refresh the slot with the latest block data
    // (anúncio = first 2 songs of next block; desanúncio = last 2 songs of next block)
    let textToUse = kind === 'anuncio' ? previewAnuncio : previewDesanuncio;
    if (autoFromGrade && isElectron) {
      const block = await fillFromGrade(kind, true);
      if (block) {
        const refreshedSlot: Slot = {
          ...slot,
          hora: block.time,
          ...(kind === 'anuncio'
            ? {
                musica1: block.first2[0]?.title || '',
                artista1: block.first2[0]?.artist || '',
                musica2: block.first2[1]?.title || '',
                artista2: block.first2[1]?.artist || '',
              }
            : {
                musica1: block.last2[0]?.title || '',
                artista1: block.last2[0]?.artist || '',
                musica2: block.last2[1]?.title || '',
                artista2: block.last2[1]?.artist || '',
              }),
        };
        textToUse = applyTemplate(
          kind === 'anuncio' ? templates.anuncio : templates.desanuncio,
          refreshedSlot,
          effectiveNow(),
        );
      }
    }

    if (!textToUse.trim()) {
      toast.error('Texto vazio — preencha as músicas/artistas primeiro.');
      return;
    }
    setGenerating(kind);
    // Resolve voz: prioridade dia da semana > preset de período > voz global.
    const nowEff = effectiveNow();
    const activePreset = detectActivePreset(nowEff);
    const dayKey = dayKeyFromIndex(nowEff.getDay());
    const dayVoice = usePresetVoice ? dayVoices[dayKey] : '';
    const presetVoice = usePresetVoice ? presetVoices[activePreset] : '';
    const effectiveVoiceId = dayVoice || presetVoice || voiceId;
    try {
      const { data, error } = await supabase.functions.invoke('generate-locucao', {
        body: { text: textToUse, voiceId: effectiveVoiceId, ...settings },
        headers: apiKey.trim() ? { 'x-elevenlabs-key': apiKey.trim() } : undefined,
      });
      if (error) throw error;
      if (!data?.audioBase64) throw new Error('Resposta sem áudio');

      const url = `data:audio/mpeg;base64,${data.audioBase64}`;
      setAudioUrls(prev => ({ ...prev, [kind]: { url, base64: data.audioBase64 } }));
      const voiceLabel = VOICES.find(v => v.id === effectiveVoiceId)?.label.split(' —')[0] || 'voz';
      toast.success(`${kind === 'anuncio' ? 'Anúncio' : 'Desanúncio'} gerado com ${voiceLabel} (${Math.round((data.sizeBytes || 0) / 1024)} KB)`);

      if (autoSave) {
        await persistAudio(kind, data.audioBase64, url, true);
      }
      if (autoInsertInGrade && lastBlock?.time && isElectron) {
        // Anúncio insere apenas LOC (openPos); desanúncio insere apenas LOC_END (closePos)
        const r = await injectLocucaoInGrade({
          gradeFolder: config.gradeFolder,
          targetTime: lastBlock.time,
          openPos: kind === 'anuncio' ? openPos : null,
          closePos: kind === 'desanuncio' ? closePos : null,
        });
        if (r.success) {
          const marker = kind === 'anuncio' ? `LOC@${openPos}` : `LOC_END@${closePos}`;
          toast.success(`📌 Marcador "${marker}" inserido em ${lastBlock.time}`);
        }
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

              <div className="space-y-2 rounded-lg border border-primary/30 p-3 bg-primary/5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">🔑 Chave ElevenLabs (sua conta)</Label>
                  {apiKey.trim() ? (
                    <span className="text-xs text-emerald-500 font-medium">✓ Configurada</span>
                  ) : (
                    <span className="text-xs text-amber-500 font-medium">Modo demo (servidor)</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="sk_..."
                    className="font-mono text-xs"
                    autoComplete="off"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowApiKey(s => !s)}>
                    {showApiKey ? '🙈' : '👁️'}
                  </Button>
                  {apiKey.trim() && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setApiKey('')}>
                      Limpar
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Cole a sua chave ElevenLabs para usar o seu próprio crédito de TTS.
                  Obtenha em <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" className="text-primary hover:underline">elevenlabs.io → API Keys</a>.
                  A chave fica guardada apenas neste computador (localStorage) — nunca é enviada para o nosso servidor.
                  Se deixar vazio, será usado o crédito de demonstração (limitado).
                </p>
              </div>

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
          <TabsTrigger value="loc-editor">🎙️ Editor LOC / LOC_END</TabsTrigger>
          <TabsTrigger value="schedule">🎯 Agendamento</TabsTrigger>
          <TabsTrigger value="voice">Voz & Configurações</TabsTrigger>
        </TabsList>

        {/* GERAR */}
        <TabsContent value="generate" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="text-base">Dados do bloco</CardTitle>
                  <CardDescription>
                    Anúncio usa as 2 <strong>primeiras</strong> músicas do próximo bloco; desanúncio usa as 2 <strong>últimas</strong>.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border/50 bg-muted/20">
                    <Switch
                      id="auto-grade"
                      checked={autoFromGrade}
                      onCheckedChange={setAutoFromGrade}
                    />
                    <Label htmlFor="auto-grade" className="text-xs cursor-pointer">Auto-ler grade</Label>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => fillFromGrade('both')} disabled={loadingGrade}>
                    {loadingGrade ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                    Carregar próximo bloco
                  </Button>
                </div>
              </div>
              {lastBlock && (
                <div className="mt-3 text-xs text-muted-foreground rounded-md border border-primary/20 bg-primary/5 p-2">
                  📻 Bloco <strong>{lastBlock.time}</strong> — {lastBlock.programLabel} ({lastBlock.filename})
                  {lastBlock.first2.length > 0 && (
                    <div className="mt-1">
                      <span className="text-foreground">Primeiras:</span> {lastBlock.first2.map(s => `${s.artist} - ${s.title}`).join(' · ')}
                    </div>
                  )}
                  {lastBlock.last2.length > 0 && (
                    <div>
                      <span className="text-foreground">Últimas:</span> {lastBlock.last2.map(s => `${s.artist} - ${s.title}`).join(' · ')}
                    </div>
                  )}
                </div>
              )}

              {/* LOCUÇÃO POSITION CONFIG */}
              <div className="mt-3 rounded-md border border-border/50 bg-muted/10 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Posição da locução no bloco</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Posição abertura (LOC) — antes da música nº</Label>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={openPos ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setOpenPos(v === '' || Number(v) <= 0 ? null : Number(v));
                      }}
                      placeholder="vazio = não inserir"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Posição fechamento (LOC_END) — após música nº</Label>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={closePos ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setClosePos(v === '' || Number(v) <= 0 ? null : Number(v));
                      }}
                      placeholder="vazio = não inserir"
                    />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border/50 bg-background">
                    <Switch
                      id="auto-insert-grade"
                      checked={autoInsertInGrade}
                      onCheckedChange={setAutoInsertInGrade}
                    />
                    <Label htmlFor="auto-insert-grade" className="text-xs cursor-pointer whitespace-nowrap">
                      Inserir auto. ao gerar
                    </Label>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => insertLocucaoInGrade(false)}
                    disabled={injectingGrade || !lastBlock}
                  >
                    {injectingGrade ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    Inserir na grade agora
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Posições contam <strong>apenas músicas</strong> (VHT/VHTN são ignorados).
                  Ex.: <code className="px-1 bg-muted rounded">abertura=1</code> insere{' '}
                  <code className="px-1 bg-muted rounded">LOC</code> antes da 1ª música;{' '}
                  <code className="px-1 bg-muted rounded">fechamento=7</code> insere{' '}
                  <code className="px-1 bg-muted rounded">LOC_END</code> depois da 7ª música.
                  Deixe vazio para não inserir aquele marcador.
                  Você também pode editar manualmente esses tokens na <strong>Sequência Padrão</strong>.
                </p>

                {/* PRÉVIA EM TEMPO REAL DA LINHA DO BLOCO */}
                {blockPreview && (
                  <div className="mt-3 rounded-md border border-primary/30 bg-background p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary">
                        🎬 Prévia da linha {lastBlock?.time} ({lastBlock?.programLabel})
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Atualiza ao mudar abertura/fechamento
                      </span>
                    </div>
                    <div className="font-mono text-xs leading-relaxed flex flex-wrap gap-1">
                      <span className="text-muted-foreground">{lastBlock?.time} ({lastBlock?.programLabel})</span>
                      {(() => {
                        const indices = computeMusicIndices(blockPreview.withMarkers);
                        return blockPreview.withMarkers.map((tok, i) => {
                          const musicIdx = indices[i];
                          if (isMarker(tok)) {
                            return (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-bold"
                                title={tok === 'LOC' ? 'Abertura da locução' : 'Fechamento da locução'}
                              >
                                {tok}
                              </span>
                            );
                          }
                          if (isVinheta(tok)) {
                            return (
                              <span key={i} className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {tok}
                              </span>
                            );
                          }
                          return (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 rounded bg-accent/40 text-foreground"
                              title={`Música #${musicIdx}`}
                            >
                              <span className="text-[9px] text-primary mr-1 font-bold">{musicIdx}</span>
                              {tok.length > 30 ? tok.slice(0, 30) + '…' : tok}
                            </span>
                          );
                        });
                      })()}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm bg-primary inline-block"></span> Marcador
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm bg-accent/40 inline-block"></span> Música (numerada)
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm bg-muted inline-block"></span> Vinheta (não conta)
                      </span>
                    </div>
                  </div>
                )}
              </div>
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
                <div className="space-y-1">
                  <div>
                    <strong className="text-foreground">Músicas/rádio:</strong>{' '}
                    <code className="px-1 bg-muted rounded">{'{musica1}'}</code>{' '}
                    <code className="px-1 bg-muted rounded">{'{artista1}'}</code>{' '}
                    <code className="px-1 bg-muted rounded">{'{musica2}'}</code>{' '}
                    <code className="px-1 bg-muted rounded">{'{artista2}'}</code>{' '}
                    <code className="px-1 bg-muted rounded">{'{radio}'}</code>{' '}
                    <code className="px-1 bg-muted rounded">{'{hora}'}</code>
                  </div>
                  <div>
                    <strong className="text-foreground">🆕 Dia/período (automáticas):</strong>{' '}
                    <code className="px-1 bg-muted rounded">{'{dia}'}</code> (ex: <em>sábado</em>){' '}
                    <code className="px-1 bg-muted rounded">{'{periodo}'}</code> (ex: <em>tarde</em>){' '}
                    <code className="px-1 bg-muted rounded">{'{saudacao}'}</code> (ex: <em>Boa tarde</em>)
                  </div>
                </div>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* PRESETS */}
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <Label className="text-xs font-semibold text-primary">⚡ Presets de prompt + voz por período</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Clique no preset para aplicar o texto. Escolha uma <strong>voz para cada período</strong> —
                      ao gerar, o sistema usará automaticamente a voz do período{' '}
                      {simulating ? <strong className="text-primary">simulado</strong> : 'atual'}{' '}
                      (<em>{PRESETS[detectActivePreset(effectiveNow())].emoji} {PRESETS[detectActivePreset(effectiveNow())].label}</em>).
                    </p>
                  </div>
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-border/50 bg-background">
                    <Switch
                      id="use-preset-voice"
                      checked={usePresetVoice}
                      onCheckedChange={setUsePresetVoice}
                    />
                    <Label htmlFor="use-preset-voice" className="text-xs cursor-pointer whitespace-nowrap">
                      Usar voz do preset
                    </Label>
                  </div>
                </div>

                {/* SIMULADOR DE DATA/HORA */}
                <div className={`rounded-md border p-2.5 space-y-2 ${simulating ? 'border-amber-500/50 bg-amber-500/10' : 'border-border/40 bg-background'}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      🧪 Simular dia/hora
                      {simulating && <span className="text-[10px] font-normal text-amber-600 dark:text-amber-400">(modo simulação ativo)</span>}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="sim-toggle"
                        checked={simulating}
                        onCheckedChange={(v) => {
                          setSimulating(v);
                          if (v) {
                            setSimDay(new Date().getDay());
                            setSimHour(new Date().getHours());
                          }
                        }}
                      />
                      <Label htmlFor="sim-toggle" className="text-xs cursor-pointer">Ativar</Label>
                    </div>
                  </div>
                  {simulating && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Dia da semana</Label>
                          <Select value={String(simDay)} onValueChange={(v) => setSimDay(Number(v))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DAY_NAMES.map((name, idx) => (
                                <SelectItem key={idx} value={String(idx)}>{name.charAt(0).toUpperCase() + name.slice(1)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Hora ({simHour.toString().padStart(2, '0')}:00)</Label>
                          <Slider
                            value={[simHour]}
                            min={0}
                            max={23}
                            step={1}
                            onValueChange={([v]) => setSimHour(v)}
                          />
                        </div>
                      </div>
                      {(() => {
                        const sim = effectiveNow();
                        const preset = detectActivePreset(sim);
                        const dayKey = dayKeyFromIndex(sim.getDay());
                        const vars = getDynamicVars(sim);
                        const dayV = usePresetVoice ? dayVoices[dayKey] : '';
                        const presetV = usePresetVoice ? presetVoices[preset] : '';
                        const vId = dayV || presetV || voiceId;
                        const vLabel = VOICES.find((v) => v.id === vId)?.label || 'voz desconhecida';
                        const source = dayV ? `dia (${DAY_PRESETS[dayKey].label})` : presetV ? `período (${PRESETS[preset].label})` : 'global';
                        return (
                          <div className="rounded border border-border/40 bg-background p-2 text-xs space-y-1">
                            <div>📅 <strong>{vars.dia}</strong> · {String(simHour).padStart(2, '0')}h00 · período <strong>{vars.periodo}</strong> · <em>{vars.saudacao}</em></div>
                            <div>⚡ Preset ativo: <strong>{PRESETS[preset].emoji} {PRESETS[preset].label}</strong> · 📆 Dia: <strong>{DAY_PRESETS[dayKey].emoji} {DAY_PRESETS[dayKey].label}</strong></div>
                            <div>🎤 Voz a ser usada: <strong>{vLabel.split(' —')[0]}</strong> <span className="text-muted-foreground">(origem: {source})</span></div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(Object.keys(PRESETS) as PresetKey[]).map((k) => {
                    const isActive = detectActivePreset(effectiveNow()) === k;
                    return (
                      <div
                        key={k}
                        className={`rounded-md border p-2 space-y-2 ${isActive ? 'border-primary bg-primary/10' : 'border-border/50 bg-background'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Button
                            size="sm"
                            variant={isActive ? 'default' : 'outline'}
                            className="flex-1 justify-start"
                            onClick={() => {
                              setTemplates(PRESETS[k].templates);
                              toast.success(`Preset "${PRESETS[k].label}" aplicado`);
                            }}
                          >
                            {PRESETS[k].emoji} {PRESETS[k].label}
                            {isActive && <span className="ml-auto text-[10px] opacity-80">ATIVO</span>}
                          </Button>
                        </div>
                        <Select
                          value={presetVoices[k] || '__global__'}
                          onValueChange={(v) =>
                            setPresetVoices((prev) => ({ ...prev, [k]: v === '__global__' ? '' : v }))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Voz" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__global__">
                              🎙️ Usar voz global (padrão)
                            </SelectItem>
                            {VOICES.map((vo) => (
                              <SelectItem key={vo.id} value={vo.id}>{vo.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>

                {/* Vozes por dia da semana — prioridade sobre os presets de período */}
                <div className="space-y-2 pt-2 border-t border-border/40">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">📆 Voz por dia da semana</Label>
                    <span className="text-[10px] text-muted-foreground">tem prioridade sobre os presets de período</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {DAY_KEYS.map((dk) => {
                      const isToday = dayKeyFromIndex(effectiveNow().getDay()) === dk;
                      return (
                        <div
                          key={dk}
                          className={`rounded-md border p-2 space-y-1 ${isToday ? 'border-primary bg-primary/10' : 'border-border/50 bg-background'}`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-medium">{DAY_PRESETS[dk].emoji} {DAY_PRESETS[dk].label}</span>
                            {isToday && <span className="text-[9px] opacity-80">HOJE</span>}
                          </div>
                          <Select
                            value={dayVoices[dk] || '__global__'}
                            onValueChange={(v) =>
                              setDayVoices((prev) => ({ ...prev, [dk]: v === '__global__' ? '' : v }))
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Voz" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__global__">— Usar voz do período —</SelectItem>
                              {VOICES.map((vo) => (
                                <SelectItem key={vo.id} value={vo.id}>{vo.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

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

        {/* EDITOR DEDICADO LOC / LOC_END */}
        <TabsContent value="loc-editor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-fuchsia-500/20 text-fuchsia-400">🎙️</span>
                Editor dedicado LOC / LOC_END
              </CardTitle>
              <CardDescription>
                Personalize o conteúdo dos tokens <code className="px-1 bg-muted rounded text-fuchsia-400">LOC</code> (abertura) e{' '}
                <code className="px-1 bg-muted rounded text-fuchsia-400">LOC_END</code> (fechamento) sem precisar editar arquivos.
                Clique em uma variável para inseri-la na posição do cursor.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Variáveis disponíveis */}
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Variáveis disponíveis</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { v: '{musica1}', d: 'LOC: 1ª música do bloco · LOC_END: penúltima música' },
                    { v: '{artista1}', d: 'Artista correspondente a {musica1}' },
                    { v: '{musica2}', d: 'LOC: 2ª música do bloco · LOC_END: última música' },
                    { v: '{artista2}', d: 'Artista correspondente a {musica2}' },
                    { v: '{radio}', d: 'Nome da rádio (ex.: BH FM) — campo "Rádio" da aba Gerar' },
                    { v: '{hora}', d: 'Hora do bloco (HH:MM) lida da grade' },
                    { v: '{dia}', d: 'Dia da semana por extenso (segunda-feira, sábado…)' },
                    { v: '{periodo}', d: 'manhã / tarde / noite' },
                    { v: '{saudacao}', d: 'Bom dia / Boa tarde / Boa noite' },
                    { v: '{fim_de_semana}', d: 'sim / não' },
                  ].map(({ v, d }) => (
                    <button
                      key={v}
                      type="button"
                      title={d}
                      onClick={() => {
                        // We don't know which textarea is focused; we append to both editors via a simple convention:
                        // insert into whichever was focused last (tracked below) — fallback: append to anuncio.
                        const target = (document.activeElement as HTMLTextAreaElement | null);
                        if (target && (target.id === 'loc-anuncio-editor' || target.id === 'loc-end-editor')) {
                          const start = target.selectionStart || target.value.length;
                          const end = target.selectionEnd || target.value.length;
                          const next = target.value.slice(0, start) + v + target.value.slice(end);
                          if (target.id === 'loc-anuncio-editor') {
                            setTemplates(t => ({ ...t, anuncio: next }));
                          } else {
                            setTemplates(t => ({ ...t, desanuncio: next }));
                          }
                          // restore caret after React re-render
                          requestAnimationFrame(() => {
                            target.focus();
                            target.setSelectionRange(start + v.length, start + v.length);
                          });
                        } else {
                          setTemplates(t => ({ ...t, anuncio: t.anuncio + ' ' + v }));
                          toast.info(`${v} adicionado ao texto da abertura (LOC).`);
                        }
                      }}
                      className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-fuchsia-500/15 text-fuchsia-300 hover:bg-fuchsia-500/30 border border-fuchsia-500/30 transition-colors"
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Foque um dos editores abaixo e clique numa variável para inseri-la na posição do cursor.
                </p>
              </div>

              {/* LOC — Abertura */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-fuchsia-500/20 text-fuchsia-400 font-mono">LOC</span>
                    Abertura — texto que toca <em>antes</em> das músicas
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    {templates.anuncio.length} caracteres
                  </span>
                </div>
                <Textarea
                  id="loc-anuncio-editor"
                  rows={4}
                  value={templates.anuncio}
                  onChange={e => setTemplates(t => ({ ...t, anuncio: e.target.value }))}
                  className="font-mono text-sm"
                  placeholder="Ex.: A seguir, {artista1} com {musica1}…"
                />
                <div className="rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wider text-fuchsia-400/80">Pré-visualização ao vivo (LOC)</div>
                    {lastBlock && <div className="text-[10px] text-muted-foreground">bloco {lastBlock.time} · {lastBlock.programLabel}</div>}
                  </div>
                  <div className="text-sm text-foreground leading-relaxed">
                    {editorPreviewAnuncio}
                  </div>
                  {!lastBlock && (
                    <div className="text-[10px] italic text-muted-foreground">
                      Carregue o próximo bloco na aba <span className="text-fuchsia-400">Gerar</span> para ver músicas/artistas reais.
                    </div>
                  )}
                </div>
              </div>

              {/* LOC_END — Fechamento */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-fuchsia-500/20 text-fuchsia-400 font-mono">LOC_END</span>
                    Fechamento — texto que toca <em>depois</em> das músicas
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    {templates.desanuncio.length} caracteres
                  </span>
                </div>
                <Textarea
                  id="loc-end-editor"
                  rows={4}
                  value={templates.desanuncio}
                  onChange={e => setTemplates(t => ({ ...t, desanuncio: e.target.value }))}
                  className="font-mono text-sm"
                  placeholder="Ex.: Você acabou de ouvir {artista2} com {musica2}…"
                />
                <div className="rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wider text-fuchsia-400/80">Pré-visualização ao vivo (LOC_END)</div>
                    {lastBlock && <div className="text-[10px] text-muted-foreground">bloco {lastBlock.time} · {lastBlock.programLabel}</div>}
                  </div>
                  <div className="text-sm text-foreground leading-relaxed">
                    {editorPreviewDesanuncio}
                  </div>
                  {!lastBlock && (
                    <div className="text-[10px] italic text-muted-foreground">
                      Usa as 2 ÚLTIMAS músicas do bloco. Carregue o próximo bloco na aba <span className="text-fuchsia-400">Gerar</span>.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
                <div className="text-[11px] text-muted-foreground">
                  As alterações são salvas automaticamente e usadas tanto pela geração quanto pelo preview de hover na aba Sequência.
                </div>
                <Button variant="outline" size="sm" onClick={() => setTemplates(DEFAULT_TEMPLATES)}>
                  <RefreshCw className="w-3 h-3 mr-1" /> Restaurar padrões
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AGENDAMENTO (whitelist horários, blacklist programas, tokens de notícias) */}
        <TabsContent value="schedule" className="space-y-4">
          <LocucaoSchedulePolicyEditor />
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
