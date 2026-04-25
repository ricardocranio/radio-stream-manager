/**
 * Política de agendamento da Locução (LOC / LOC_END):
 *
 *   • Whitelist de horários (HH:MM) → blocos onde a inserção automática é permitida.
 *   • Blacklist de programas fixos (substring case-insensitive contra o "programLabel"
 *     que aparece entre parênteses na linha do bloco — ex.: "Rádio Revista", "Sintonia Total").
 *   • Tokens de "Notícias da hora" → quando a posição manual NÃO está definida,
 *     o LOC é forçado a entrar IMEDIATAMENTE APÓS o último token de notícias do bloco.
 *
 * Prioridade combinada (definida com o usuário):
 *   1. Posição manual (openPos/closePos) SEMPRE vence — mas o bloco como um todo
 *      ainda precisa passar pelo whitelist+blacklist.
 *   2. Sem posição manual + bloco contém Notícias → LOC entra logo após.
 *   3. Sem posição manual + sem Notícias → comportamento padrão (1ª posição musical).
 */

export type DayKey = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';
export const DAY_KEYS: DayKey[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
export const DAY_LABELS: Record<DayKey, string> = {
  dom: 'Domingo', seg: 'Segunda', ter: 'Terça', qua: 'Quarta',
  qui: 'Quinta', sex: 'Sexta', sab: 'Sábado',
};
export function dayKeyFromDate(d: Date): DayKey { return DAY_KEYS[d.getDay()]; }

export interface LocucaoSchedulePolicy {
  /** Dias da semana onde a locução PODE entrar. Vazio = todos. */
  allowedDays: DayKey[];
  /** Horários HH:MM permitidos. Lista vazia = TODOS os horários permitidos. */
  allowedTimes: string[];
  /** Substrings (case-insensitive) que, se aparecerem no programLabel, bloqueiam o bloco. */
  blockedPrograms: string[];
  /** Tokens (UPPERCASE) que marcam "notícias da hora" dentro do bloco. */
  newsTokens: string[];
  /** Liga/desliga toda a política sem perder as listas. */
  enabled: boolean;
  /**
   * Overrides por hora e dia da semana (editáveis pela Grade 24h):
   *   key = `${day}-${HH}` (ex.: "seg-07")
   *   value.locked = força bloqueio (true) / força liberação (false) / undefined = usa regra normal
   *   value.programName = sobrescreve o nome do programa exibido
   *   value.sequence = sequência customizada de posições para esta hora (opcional)
   */
  hourOverrides?: Record<string, HourOverride>;
}

export interface HourOverridePosition {
  position: number;
  /** Source: id de rádio, "genre_XXX", "fixo_xxx", "LOC", "LOC_END", "file_...", etc. */
  radioSource: string;
  customFileName?: string;
}

export interface HourOverride {
  locked?: boolean;
  programName?: string;
  sequence?: HourOverridePosition[];
}

export const DEFAULT_POLICY: LocucaoSchedulePolicy = {
  // Sábado fora por padrão (programação fixa o dia inteiro: Shake Mix → Conexão Mix →
  // Mega Mix → Sem Parar → Mega Funk → Gas Total → Amnesia). Domingo permitido (livre).
  allowedDays: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex'],
  allowedTimes: [],
  blockedPrograms: [
    'Sintonia Total',     // 09:00-10:30 seg-sex
    'Painel Flashback',   // 12:00-12:30 seg-sex
    'Rádio Revista',      // 19:00-19:30 seg-sex
    'Voz do Brasil',      // 21:00 seg-sex (obrigatório legal)
    'Misturadão',         // 20:00-20:30 seg-sex
    'Songs of Love',      // 22:00+ seg-sex
    // FDS (caso allowedDays inclua sábado)
    'Shake Mix', 'Conexão Mix', 'Mega Mix', 'Sem Parar',
    'Mega Funk', 'Gas Total', 'Amnesia',
  ],
  newsTokens: ['NOTICIAS'],
  enabled: true,
};

const STORAGE_KEY = 'locucaoIA_schedulePolicy';

export function loadPolicy(): LocucaoSchedulePolicy {
  try {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!s) return DEFAULT_POLICY;
    const parsed = JSON.parse(s);
    return { ...DEFAULT_POLICY, ...parsed };
  } catch {
    return DEFAULT_POLICY;
  }
}

export function savePolicy(p: LocucaoSchedulePolicy) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

/** Verifica se o dia da semana está permitido. */
export function isDayAllowed(date: Date, policy: LocucaoSchedulePolicy): boolean {
  if (!policy.enabled) return true;
  if (!policy.allowedDays || policy.allowedDays.length === 0) return true;
  return policy.allowedDays.includes(dayKeyFromDate(date));
}

/** Verifica se o horário está na whitelist (lista vazia = qualquer horário). */
export function isTimeAllowed(time: string, policy: LocucaoSchedulePolicy): boolean {
  if (!policy.enabled) return true;
  if (!policy.allowedTimes || policy.allowedTimes.length === 0) return true;
  return policy.allowedTimes.includes(time);
}

/** Verifica se o programa do bloco está bloqueado. */
export function isProgramBlocked(programLabel: string, policy: LocucaoSchedulePolicy): boolean {
  if (!policy.enabled) return false;
  if (!policy.blockedPrograms?.length) return false;
  const haystack = (programLabel || '').toLowerCase();
  return policy.blockedPrograms.some((p) => haystack.includes(p.toLowerCase()));
}

export interface BlockEligibility {
  allowed: boolean;
  reason?: 'day-not-allowed' | 'time-not-whitelisted' | 'program-blocked';
  detail?: string;
}

export function checkBlockEligibility(
  time: string,
  programLabel: string,
  policy: LocucaoSchedulePolicy,
  date: Date = new Date(),
): BlockEligibility {
  if (!isDayAllowed(date, policy)) {
    return { allowed: false, reason: 'day-not-allowed', detail: `${DAY_LABELS[dayKeyFromDate(date)]} não está na lista de dias permitidos.` };
  }
  if (!isTimeAllowed(time, policy)) {
    return { allowed: false, reason: 'time-not-whitelisted', detail: `Horário ${time} fora da whitelist.` };
  }
  if (isProgramBlocked(programLabel, policy)) {
    return { allowed: false, reason: 'program-blocked', detail: `Programa fixo bloqueado: ${programLabel}.` };
  }
  return { allowed: true };
}

/**
 * Localiza o índice (1-based, contando SOMENTE músicas) IMEDIATAMENTE APÓS o
 * último token de notícias presente nos tokens do bloco. Retorna null se não
 * houver token de notícias.
 *
 * Regra: o LOC deve ser inserido ANTES da próxima música APÓS o NOTICIAS, ou
 * seja, openPos = (musicas contadas até NOTICIAS) + 1.
 */
export function findOpenPosAfterNews(
  tokens: string[],
  policy: LocucaoSchedulePolicy,
): number | null {
  if (!policy.enabled) return null;
  if (!policy.newsTokens?.length) return null;
  const newsSet = new Set(policy.newsTokens.map((t) => t.toUpperCase()));
  const SEPARATORS = new Set(['VHT', 'VHTN', 'LOC', 'LOC_END', ...newsSet]);

  let lastNewsIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (newsSet.has(tokens[i].toUpperCase())) lastNewsIdx = i;
  }
  if (lastNewsIdx === -1) return null;

  // Conta quantas MÚSICAS existem até (incluindo) o índice do NOTICIAS — a próxima
  // música após esse ponto é (musicCount + 1).
  let musicCount = 0;
  for (let i = 0; i <= lastNewsIdx; i++) {
    if (!SEPARATORS.has(tokens[i].toUpperCase())) musicCount++;
  }
  return musicCount + 1;
}

/** Chave do override por hora+dia. */
export function overrideKey(day: DayKey, hour: number): string {
  return `${day}-${hour.toString().padStart(2, '0')}`;
}

/** Retorna o override (se existir) para um par dia/hora. */
export function getHourOverride(
  policy: LocucaoSchedulePolicy,
  day: DayKey,
  hour: number,
): { locked?: boolean; programName?: string } | undefined {
  return policy.hourOverrides?.[overrideKey(day, hour)];
}
