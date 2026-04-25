/**
 * Injects a locução marker token into the next block of the day's grade `.txt`.
 *
 * Conventions:
 *   - Token written in UPPERCASE: `LOC` (announcement) or `LOC_END` (de-announcement).
 *   - Position options:
 *       'inicio'  → after the program ID, before the first song (anúncio)
 *       'fim'     → at the end of the line (desanúncio)
 *       'inicio_fim' → both (anúncio + desanúncio)
 *
 * Idempotent: if the token already exists at the requested position it is not
 * duplicated. Other tokens (songs, VHT/VHTN) are preserved.
 */

const isElectron =
  typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;

export type LocPosition = 'inicio' | 'fim' | 'inicio_fim';

const LOC_START = 'LOC';
const LOC_END = 'LOC_END';

function dayCodeForDate(d: Date): string {
  return ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'][d.getDay()];
}

/**
 * Inject the locução tokens into the line whose time matches `targetTime`
 * (HH:MM). Returns the updated grade content.
 */
export function injectLocucaoInLine(
  content: string,
  targetTime: string,
  position: LocPosition,
): { content: string; updated: boolean; line?: string } {
  const lines = content.split('\n');
  let updated = false;
  let resultLine: string | undefined;

  const newLines = lines.map((rawLine) => {
    const line = rawLine;
    const m = line.match(/^(\d{2}:\d{2})\s+\(([^)]+)\)\s*(.*)$/);
    if (!m) return rawLine;
    if (m[1] !== targetTime) return rawLine;

    const header = `${m[1]} (${m[2]}) `;
    let tokens = m[3]
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const wantStart = position === 'inicio' || position === 'inicio_fim';
    const wantEnd = position === 'fim' || position === 'inicio_fim';

    // Avoid duplicates
    const hasStart = tokens[0]?.toUpperCase() === LOC_START;
    const hasEnd = tokens[tokens.length - 1]?.toUpperCase() === LOC_END;

    if (wantStart && !hasStart) tokens = [LOC_START, ...tokens];
    if (wantEnd && !hasEnd) tokens = [...tokens, LOC_END];

    updated = true;
    resultLine = `${header}${tokens.join(',')}`;
    return resultLine;
  });

  return { content: newLines.join('\n'), updated, line: resultLine };
}

/**
 * Reads the day's grade .txt, injects locução markers in the block at
 * `targetTime`, and writes it back. No-op outside Electron.
 */
export async function injectLocucaoInGrade(opts: {
  gradeFolder: string;
  targetTime: string; // 'HH:MM'
  position: LocPosition;
  date?: Date;
}): Promise<{ success: boolean; updated: boolean; line?: string; error?: string }> {
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
    const result = injectLocucaoInLine(r.content, opts.targetTime, opts.position);
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
