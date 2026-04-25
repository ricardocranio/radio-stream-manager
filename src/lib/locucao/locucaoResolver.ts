/**
 * Resolves the locução (LOC / LOC_END) text and active voice using the SAME
 * data sources the runtime generator uses:
 *   • Templates / voices persistidos no localStorage (LocucaoIAView).
 *   • Próximo bloco real lido da grade do dia (gradeBlockReader) → para
 *     preencher {musica1}/{artista1}/{musica2}/{artista2}/{hora}.
 *
 * Garante que tooltip do badge na Sequência e o preview do Editor LOC mostrem
 * o MESMO texto + voz que serão executados na geração real.
 */
import { extractNextBlockFromGrade, type BlockExtraction } from './gradeBlockReader';
import {
  loadPolicy,
  checkBlockEligibility,
  findOpenPosAfterNews,
} from './locucaoSchedulePolicy';

export interface ResolvedLocucao {
  text: string;
  voiceLabel: string;
  voiceId: string;
  presetLabel: string;
  origin: 'dia' | 'período' | 'global';
  templateRaw: string;
  /** Variáveis efetivamente aplicadas (debug / preview detalhado). */
  vars: Record<string, string>;
  /** Bloco-fonte (quando disponível). */
  blockTime?: string;
  blockProgram?: string;
  /** Diagnóstico da política de agendamento. */
  policyStatus?: {
    allowed: boolean;
    reason?: string;
    /** Posição automática (1-based) APÓS NOTICIAS quando aplicável. */
    autoOpenPosFromNews?: number | null;
  };
}

const STORAGE_KEY_TEMPLATES = 'locucaoIA_templates';
const STORAGE_KEY_VOICE = 'locucaoIA_voiceId';
const STORAGE_KEY_PRESET_VOICES = 'locucaoIA_presetVoices';
const STORAGE_KEY_DAY_VOICES = 'locucaoIA_dayVoices';
const STORAGE_KEY_USE_PRESET_VOICE = 'locucaoIA_usePresetVoice';
const STORAGE_KEY_RADIO_NAME = 'locucaoIA_radioName';

const DEFAULT_TEMPLATES = {
  anuncio:
    'A seguir, {artista1} com {musica1}, e logo depois {artista2} interpretando {musica2}. Você está ouvindo {radio}.',
  desanuncio:
    'Você acabou de ouvir {artista2} com {musica2}, e antes {artista1} com {musica1}, aqui na {radio}.',
};

const VOICE_LABELS: Record<string, string> = {
  JBFqnCBsd6RMkjVDRZzb: 'George — Masculina grave',
  nPczCjzI2devNBz1zQrb: 'Brian — Masculina envolvente',
  onwK4e9ZLuTAKqWW03F9: 'Daniel — Masculina natural',
  bIHbv24MWmeRgasZH58o: 'Will — Masculina jovem',
  CwhRBWXzGAHq8TQ4Fs17: 'Roger — Masculina autoritária',
  TX3LPaxmHKxFdv7VOQHJ: 'Liam — Masculina clara',
  iP95p4xoKVk53GoZ742B: 'Chris — Masculina casual',
  cjVigY5qzO86Huf0OWal: 'Eric — Masculina madura',
  EXAVITQu4vr4xnSDxMaL: 'Sarah — Feminina profissional',
  XrExE9yKIg1WjnnlVkGX: 'Matilda — Feminina amigável',
  Xb7hH8MSUJpSbSDYk0k2: 'Alice — Feminina clara',
  cgSgspJ2msm6clMCkdW9: 'Jessica — Feminina jovem',
  pFZP5JQG7iQjIQuC4Bku: 'Lily — Feminina suave',
  FGY2WhTYpPnrIDTdsKH5: 'Laura — Feminina expressiva',
};

const DAY_KEYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
type DayKey = (typeof DAY_KEYS)[number];
const DAY_LABEL: Record<DayKey, string> = {
  dom: 'Domingo', seg: 'Segunda', ter: 'Terça', qua: 'Quarta',
  qui: 'Quinta', sex: 'Sexta', sab: 'Sábado',
};

type PeriodKey = 'manha' | 'tarde' | 'noite' | 'fim_de_semana';
const PERIOD_LABEL: Record<PeriodKey, string> = {
  manha: '🌅 Manhã', tarde: '☀️ Tarde', noite: '🌙 Noite', fim_de_semana: '🎉 Final de semana',
};

const DAY_NAMES_LONG = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
];

function detectPeriod(now: Date): PeriodKey {
  const d = now.getDay();
  if (d === 0 || d === 6) return 'fim_de_semana';
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'manha';
  if (h >= 12 && h < 18) return 'tarde';
  return 'noite';
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (!s) return fallback;
    return { ...(fallback as any), ...JSON.parse(s) } as T;
  } catch {
    return fallback;
  }
}

function readString(key: string, fallback: string): string {
  try {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return s ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Constrói o mapa COMPLETO de variáveis para um determinado kind (LOC/LOC_END).
 * Para LOC (abertura): musica1/artista1 = primeira do bloco, musica2/artista2 = segunda.
 * Para LOC_END (fechamento): musica1/artista1 = penúltima, musica2/artista2 = última.
 * Quando não há bloco real disponível, usa placeholders «entre aspas» para deixar claro
 * no preview que o slot virá em runtime.
 */
function buildVars(
  kind: 'LOC' | 'LOC_END',
  now: Date,
  block: BlockExtraction | null,
  radioName: string,
): Record<string, string> {
  const dayName = DAY_NAMES_LONG[now.getDay()];
  const h = now.getHours();
  const periodo = h >= 5 && h < 12 ? 'manhã' : h >= 12 && h < 18 ? 'tarde' : 'noite';
  const saudacao = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
  const fimDeSemana = (now.getDay() === 0 || now.getDay() === 6) ? 'sim' : 'não';

  const pair = kind === 'LOC' ? block?.first2 : block?.last2;
  const m1 = pair?.[0];
  const m2 = pair?.[1];

  const ph = (label: string) => `«${label}»`;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  return {
    musica1: m1?.title || ph(kind === 'LOC' ? '1ª música' : 'penúltima música'),
    artista1: m1?.artist || ph(kind === 'LOC' ? '1º artista' : 'penúltimo artista'),
    musica2: m2?.title || ph(kind === 'LOC' ? '2ª música' : 'última música'),
    artista2: m2?.artist || ph(kind === 'LOC' ? '2º artista' : 'último artista'),
    radio: radioName,
    hora: block?.time || `${hh}:${mm}`,
    dia: dayName,
    periodo,
    saudacao,
    fim_de_semana: fimDeSemana,
  };
}

function applyVars(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{${k}\\}`, 'gi');
    out = out.replace(re, v);
  }
  return out;
}

function resolveVoice(now: Date) {
  const globalVoice = readString(STORAGE_KEY_VOICE, 'JBFqnCBsd6RMkjVDRZzb');
  const presetVoices = readJSON<Record<PeriodKey, string>>(STORAGE_KEY_PRESET_VOICES, {
    manha: '', tarde: '', noite: '', fim_de_semana: '',
  });
  const dayVoices = readJSON<Record<DayKey, string>>(STORAGE_KEY_DAY_VOICES, {
    dom: '', seg: '', ter: '', qua: '', qui: '', sex: '', sab: '',
  });
  const usePresetVoice = readString(STORAGE_KEY_USE_PRESET_VOICE, 'true') !== 'false';

  const dayKey = DAY_KEYS[now.getDay()];
  const period = detectPeriod(now);

  let voiceId = globalVoice;
  let origin: ResolvedLocucao['origin'] = 'global';
  let presetLabel = 'Voz global';

  if (usePresetVoice) {
    if (dayVoices[dayKey]) {
      voiceId = dayVoices[dayKey];
      origin = 'dia';
      presetLabel = `${DAY_LABEL[dayKey]} (dia)`;
    } else if (presetVoices[period]) {
      voiceId = presetVoices[period];
      origin = 'período';
      presetLabel = PERIOD_LABEL[period];
    } else {
      presetLabel = `${PERIOD_LABEL[period]} → voz global`;
    }
  }

  return {
    voiceId,
    voiceLabel: VOICE_LABELS[voiceId] || voiceId,
    origin,
    presetLabel,
  };
}

/**
 * Versão SÍNCRONA: usa o último bloco em cache (se houver) — útil pra render
 * imediato do popover. Para garantir dados frescos, prefira `resolveLocucaoAsync`.
 */
export function resolveLocucao(
  kind: 'LOC' | 'LOC_END',
  now: Date = new Date(),
  block: BlockExtraction | null = peekCachedBlock(),
): ResolvedLocucao {
  const templates = readJSON(STORAGE_KEY_TEMPLATES, DEFAULT_TEMPLATES);
  const radioName = readString(STORAGE_KEY_RADIO_NAME, 'BH FM');
  const voice = resolveVoice(now);

  const templateRaw = kind === 'LOC' ? templates.anuncio : templates.desanuncio;
  const vars = buildVars(kind, now, block, radioName);
  const text = applyVars(templateRaw, vars);

  // Diagnóstico da política (whitelist horários, blacklist programas, NOTICIAS)
  let policyStatus: ResolvedLocucao['policyStatus'];
  if (block) {
    const policy = loadPolicy();
    const eligibility = checkBlockEligibility(block.time, block.programLabel, policy);
    const autoOpenPosFromNews = findOpenPosAfterNews(block.rawTokens, policy);
    policyStatus = {
      allowed: eligibility.allowed,
      reason: eligibility.detail,
      autoOpenPosFromNews,
    };
  }

  return {
    text,
    voiceId: voice.voiceId,
    voiceLabel: voice.voiceLabel,
    presetLabel: voice.presetLabel,
    origin: voice.origin,
    templateRaw,
    vars,
    blockTime: block?.time,
    blockProgram: block?.programLabel,
    policyStatus,
  };
}

// ===== Cache leve do próximo bloco para tooltips =====
const BLOCK_CACHE_TTL_MS = 30_000;
let cachedBlock: BlockExtraction | null = null;
let cachedAt = 0;
let inflight: Promise<BlockExtraction | null> | null = null;

function peekCachedBlock(): BlockExtraction | null {
  if (Date.now() - cachedAt < BLOCK_CACHE_TTL_MS) return cachedBlock;
  return cachedBlock; // mesmo expirado, devolve o último conhecido p/ render imediato
}

async function fetchBlockCached(): Promise<BlockExtraction | null> {
  if (Date.now() - cachedAt < BLOCK_CACHE_TTL_MS && cachedBlock) return cachedBlock;
  if (inflight) return inflight;

  // Lê config da radioStore via localStorage (zustand persiste em 'radioStore')
  let gradeFolder = '';
  let musicFolders: string[] = [];
  let coringaCode = 'mus';
  try {
    const raw = localStorage.getItem('radioStore');
    if (raw) {
      const parsed = JSON.parse(raw);
      const cfg = parsed?.state?.config || parsed?.config || {};
      gradeFolder = cfg.gradeFolder || '';
      musicFolders = cfg.musicFolders || [];
      coringaCode = cfg.coringaCode || 'mus';
    }
  } catch { /* ignore */ }

  if (!gradeFolder) return null;

  inflight = (async () => {
    try {
      const b = await extractNextBlockFromGrade({
        gradeFolder, musicFolders, coringaCode, allowCurrent: true,
      });
      cachedBlock = b;
      cachedAt = Date.now();
      return b;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Versão ASSÍNCRONA: força leitura fresca do próximo bloco real. */
export async function resolveLocucaoAsync(
  kind: 'LOC' | 'LOC_END',
  now: Date = new Date(),
): Promise<ResolvedLocucao> {
  const block = await fetchBlockCached();
  return resolveLocucao(kind, now, block);
}
