/**
 * Lightweight helpers to resolve the locução (LOC / LOC_END) text and active
 * voice from the persisted user configuration in localStorage.
 *
 * Used by the Sequence editor tooltips to preview, on hover, the actual text
 * + voice that will be spoken at runtime — without duplicating the heavier
 * state logic of LocucaoIAView.
 */

export interface ResolvedLocucao {
  text: string;
  voiceLabel: string;
  voiceId: string;
  presetLabel: string;
  origin: 'dia' | 'período' | 'global';
  templateRaw: string;
}

const STORAGE_KEY_TEMPLATES = 'locucaoIA_templates';
const STORAGE_KEY_VOICE = 'locucaoIA_voiceId';
const STORAGE_KEY_PRESET_VOICES = 'locucaoIA_presetVoices';
const STORAGE_KEY_DAY_VOICES = 'locucaoIA_dayVoices';
const STORAGE_KEY_USE_PRESET_VOICE = 'locucaoIA_usePresetVoice';

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

function applyVars(tpl: string, slot: { musica?: string; artista?: string; radio?: string; hora?: string }, now: Date) {
  const dayName = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'][now.getDay()];
  const h = now.getHours();
  const periodo = h >= 5 && h < 12 ? 'manhã' : h >= 12 && h < 18 ? 'tarde' : 'noite';
  const saudacao = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
  return tpl
    .replace(/\{musica1\}/gi, slot.musica || '«música»')
    .replace(/\{artista1\}/gi, slot.artista || '«artista»')
    .replace(/\{musica2\}/gi, '«próx. música»')
    .replace(/\{artista2\}/gi, '«próx. artista»')
    .replace(/\{radio\}/gi, slot.radio || '«rádio»')
    .replace(/\{hora\}/gi, slot.hora || '«hora»')
    .replace(/\{dia\}/gi, dayName)
    .replace(/\{periodo\}/gi, periodo)
    .replace(/\{saudacao\}/gi, saudacao);
}

/**
 * Resolves the LOC (anúncio) or LOC_END (desanúncio) text + voice that would
 * be used at the given moment.
 */
export function resolveLocucao(
  kind: 'LOC' | 'LOC_END',
  now: Date = new Date(),
): ResolvedLocucao {
  const templates = readJSON(STORAGE_KEY_TEMPLATES, DEFAULT_TEMPLATES);
  const globalVoice = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY_VOICE)) || 'JBFqnCBsd6RMkjVDRZzb';
  const presetVoices = readJSON<Record<PeriodKey, string>>(STORAGE_KEY_PRESET_VOICES, {
    manha: '', tarde: '', noite: '', fim_de_semana: '',
  });
  const dayVoices = readJSON<Record<DayKey, string>>(STORAGE_KEY_DAY_VOICES, {
    dom: '', seg: '', ter: '', qua: '', qui: '', sex: '', sab: '',
  });
  const usePresetVoice = (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_USE_PRESET_VOICE) : null) !== 'false';

  const dayKey = DAY_KEYS[now.getDay()];
  const period = detectPeriod(now);

  let voiceId = globalVoice;
  let origin: ResolvedLocucao['origin'] = 'global';
  let presetLabel = `Voz global`;

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

  const templateRaw = kind === 'LOC' ? templates.anuncio : templates.desanuncio;
  const text = applyVars(templateRaw, {}, now);

  return {
    text,
    voiceId,
    voiceLabel: VOICE_LABELS[voiceId] || voiceId,
    presetLabel,
    origin,
    templateRaw,
  };
}
