/**
 * Injects a locução marker token into the next block of the day's grade `.txt`.
 *
 * Tokens written in UPPERCASE: `LOC` (anúncio/abertura) and `LOC_END` (desanúncio/fechamento).
 *
 * Position model (user-controlled):
 *   - `openPos` / `closePos` are 1-based indices counting **only music tokens**
 *     (VHT, VHTN, LOC, LOC_END are skipped).
 *   - `openPos = 1` → marker placed BEFORE the 1st music.
 *   - `openPos = N` → marker placed BEFORE the Nth music.
 *   - `closePos = K` → marker placed AFTER the Kth music.
 *   - Use `null`/`undefined` to skip a side.
 *
 * Idempotent: same marker isn't duplicated at the same target slot.
 */

import {
  loadPolicy,
  checkBlockEligibility,
  findOpenPosAfterNews,
  type LocucaoSchedulePolicy,
} from './locucaoSchedulePolicy';

const isElectron =
  typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;

/** Legacy preset positions (kept for backwards compat with old UI). */
export type LocPosition = 'inicio' | 'fim' | 'inicio_fim';

const LOC_START = 'LOC';
const LOC_END = 'LOC_END';
const SEPARATOR_TOKENS = new Set(['VHT', 'VHTN', LOC_START, LOC_END]);

function dayCodeForDate(d: Date): string {
  return ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'][d.getDay()];
}

function isMusicToken(t: string): boolean {
  return !SEPARATOR_TOKENS.has(t.toUpperCase());
}

/**
 * Insert markers into a tokens array. Mutates and returns a new array.
 * - openMusicPos: 1-based music index BEFORE which to place LOC.
 * - closeMusicPos: 1-based music index AFTER which to place LOC_END.
 */
export function injectMarkersIntoTokens(
  tokens: string[],
  openMusicPos: number | null,
  closeMusicPos: number | null,
): string[] {
  // Strip existing LOC / LOC_END to allow user to reposition cleanly
  let cleaned = tokens.filter((t) => {
    const u = t.toUpperCase();
    return u !== LOC_START && u !== LOC_END;
  });

  // Build a list of "slots" where we can insert (between/around tokens),
  // with their music index. We compute insertions as (insertIndex, marker).
  type Insertion = { idx: number; marker: string; order: number };
  const insertions: Insertion[] = [];

  if (openMusicPos && openMusicPos >= 1) {
    let musicSeen = 0;
    let placed = false;
    for (let i = 0; i < cleaned.length; i++) {
      if (isMusicToken(cleaned[i])) {
        musicSeen++;
        if (musicSeen === openMusicPos) {
          insertions.push({ idx: i, marker: LOC_START, order: 0 });
          placed = true;
          break;
        }
      }
    }
    // If user asked for a position beyond available musics → place at end
    if (!placed) insertions.push({ idx: cleaned.length, marker: LOC_START, order: 0 });
  }

  if (closeMusicPos && closeMusicPos >= 1) {
    let musicSeen = 0;
    let placed = false;
    for (let i = 0; i < cleaned.length; i++) {
      if (isMusicToken(cleaned[i])) {
        musicSeen++;
        if (musicSeen === closeMusicPos) {
          insertions.push({ idx: i + 1, marker: LOC_END, order: 1 });
          placed = true;
          break;
        }
      }
    }
    if (!placed) insertions.push({ idx: cleaned.length, marker: LOC_END, order: 1 });
  }

  // Apply insertions from highest idx to lowest so indices stay valid.
  // For ties, LOC_END (order 1) goes after LOC (order 0).
  insertions.sort((a, b) => (b.idx - a.idx) || (b.order - a.order));
  for (const ins of insertions) {
    cleaned.splice(ins.idx, 0, ins.marker);
  }
  return cleaned;
}

/** Convert legacy preset to numeric positions given a token list. */
function presetToNumeric(
  tokens: string[],
  position: LocPosition,
): { openPos: number | null; closePos: number | null } {
  const musicCount = tokens.filter(isMusicToken).length;
  if (position === 'inicio') return { openPos: 1, closePos: null };
  if (position === 'fim') return { openPos: null, closePos: musicCount || 1 };
  return { openPos: 1, closePos: musicCount || 1 };
}

export interface InjectOptions {
  gradeFolder: string;
  targetTime: string; // 'HH:MM'
  date?: Date;
  /** Either provide numeric positions… */
  openPos?: number | null;
  closePos?: number | null;
  /** …or a legacy preset (mapped to numeric on the fly). */
  position?: LocPosition;
}

/** Inject markers into the line whose time matches `targetTime`. */
export function injectLocucaoInLine(
  content: string,
  targetTime: string,
  opts: { openPos?: number | null; closePos?: number | null; position?: LocPosition },
): { content: string; updated: boolean; line?: string } {
  const lines = content.split('\n');
  let updated = false;
  let resultLine: string | undefined;

  const newLines = lines.map((rawLine) => {
    const m = rawLine.match(/^(\d{2}:\d{2})\s+\(([^)]+)\)\s*(.*)$/);
    if (!m || m[1] !== targetTime) return rawLine;

    const header = `${m[1]} (${m[2]}) `;
    const tokens = m[3].split(',').map((t) => t.trim()).filter(Boolean);

    let openPos = opts.openPos ?? null;
    let closePos = opts.closePos ?? null;
    if (opts.position && openPos === null && closePos === null) {
      const mapped = presetToNumeric(tokens, opts.position);
      openPos = mapped.openPos;
      closePos = mapped.closePos;
    }

    const newTokens = injectMarkersIntoTokens(tokens, openPos, closePos);
    updated = true;
    resultLine = `${header}${newTokens.join(',')}`;
    return resultLine;
  });

  return { content: newLines.join('\n'), updated, line: resultLine };
}

/** Read the day's grade .txt, inject markers, and write it back. */
export async function injectLocucaoInGrade(
  opts: InjectOptions,
): Promise<{ success: boolean; updated: boolean; line?: string; error?: string }> {
  if (!isElectron || !(window as any).electronAPI?.readGradeFile) {
    return { success: false, updated: false, error: 'Disponível apenas no app Desktop.' };
  }
  const date = opts.date || new Date();
  const filename = `${dayCodeForDate(date)}.txt`;
  const api = (window as any).electronAPI;

  try {
    const r = await api.readGradeFile({ folder: opts.gradeFolder, filename });
    if (!r?.success || !r.content) {
      return { success: false, updated: false, error: 'Grade do dia não encontrada.' };
    }
    const result = injectLocucaoInLine(r.content, opts.targetTime, {
      openPos: opts.openPos,
      closePos: opts.closePos,
      position: opts.position,
    });
    if (!result.updated) {
      return {
        success: false,
        updated: false,
        error: `Bloco ${opts.targetTime} não encontrado em ${filename}.`,
      };
    }
    const w = await api.saveGradeFile({
      folder: opts.gradeFolder,
      filename,
      content: result.content,
    });
    if (!w?.success) {
      return { success: false, updated: false, error: w?.error || 'Falha ao salvar grade.' };
    }
    return { success: true, updated: true, line: result.line };
  } catch (err: any) {
    return { success: false, updated: false, error: err?.message || 'Erro inesperado.' };
  }
}
