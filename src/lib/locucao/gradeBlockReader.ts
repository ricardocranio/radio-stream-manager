/**
 * Reads the auto-built grade `.txt` for the current/next block and extracts
 * the first 2 and last 2 song slots (skipping VHT/VHTN separators and
 * fallback placeholders like MUS/ROM/CLAS/JOV/FUN/<coringa>).
 *
 * Then resolves each token to a real filename in the music folders and reads
 * its ID3 tags to obtain real Artist + Title — feeding the AI voice templates
 * with no human intervention.
 */

const isElectron =
  typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;

const FALLBACK_BASE = ['MUS', 'ROM', 'CLAS', 'JOV', 'FUN'];
const VHT_TOKENS = new Set(['VHT', 'VHTN']);

function dayCodeForDate(d: Date): string {
  // Matches grade filenames: DOM/SEG/TER/QUA/QUI/SEX/SAB
  return ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'][d.getDay()];
}

function isFallback(token: string, coringaCode: string): boolean {
  const t = token.replace(/"/g, '').trim().toUpperCase();
  if (!t) return true;
  const codes = new Set([
    ...FALLBACK_BASE,
    coringaCode.replace(/\.mp3$/i, '').toUpperCase(),
  ]);
  return codes.has(t);
}

interface BlockLine {
  time: string;
  programLabel: string;
  tokens: string[];
}

function parseLine(line: string): BlockLine | null {
  // e.g. "14:00 (FIXO ID=Sintonia Total) MUS,VHT,Artista - Musica.mp3,..."
  const m = line.match(/^(\d{2}:\d{2})\s+\(([^)]+)\)\s*(.*)$/);
  if (!m) return null;
  return {
    time: m[1],
    programLabel: m[2],
    tokens: m[3]
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

export interface ResolvedSong {
  artist: string;
  title: string;
  rawToken: string;
}

export interface BlockExtraction {
  time: string;
  programLabel: string;
  filename: string;
  first2: ResolvedSong[];
  last2: ResolvedSong[];
}

function parseTokenAsFilename(token: string): { artist: string; title: string } | null {
  // Strip surrounding quotes and .mp3
  const clean = token.replace(/^"+|"+$/g, '').replace(/\.mp3$/i, '').trim();
  if (!clean) return null;
  // Pattern "Artist - Title"
  const dash = clean.indexOf(' - ');
  if (dash > 0) {
    return { artist: clean.slice(0, dash).trim(), title: clean.slice(dash + 3).trim() };
  }
  return { artist: '', title: clean };
}

async function resolveTokenToSong(
  token: string,
  musicFolders: string[],
): Promise<ResolvedSong> {
  const fallback = parseTokenAsFilename(token) || { artist: '', title: token };
  // Try ID3 read for richer metadata
  try {
    const api = (window as any).electronAPI;
    if (api?.readId3Genre) {
      const filename = token.replace(/^"+|"+$/g, '').trim();
      const r = await api.readId3Genre({ filePath: filename, musicFolders });
      if (r?.success) {
        return {
          artist: (r.artist || fallback.artist || '').trim(),
          title: (r.title || fallback.title || '').trim(),
          rawToken: token,
        };
      }
    }
  } catch {
    /* ignore — use fallback */
  }
  return { ...fallback, rawToken: token };
}

/**
 * Find the block at or after `targetDate` (defaults to next hour boundary).
 * Returns null if grade file or matching block not found.
 */
export async function extractNextBlockFromGrade(opts: {
  gradeFolder: string;
  musicFolders: string[];
  coringaCode: string;
  targetDate?: Date;
  /** If true, also accept the current-hour block (use it when no future block exists). */
  allowCurrent?: boolean;
}): Promise<BlockExtraction | null> {
  if (!isElectron || !(window as any).electronAPI?.readGradeFile) {
    return null;
  }

  const now = opts.targetDate || new Date();
  const dayCode = dayCodeForDate(now);
  const filename = `${dayCode}.txt`;

  let content = '';
  try {
    const r = await (window as any).electronAPI.readGradeFile({
      folder: opts.gradeFolder,
      filename,
    });
    if (!r?.success || !r.content) return null;
    content = r.content;
  } catch {
    return null;
  }

  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: BlockLine[] = [];
  for (const l of lines) {
    const p = parseLine(l);
    if (p) blocks.push(p);
  }
  if (!blocks.length) return null;

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const nowKey = `${hh}:${mm}`;

  // Pick first block strictly after now; fallback to current/last
  let chosen = blocks.find((b) => b.time > nowKey);
  if (!chosen && opts.allowCurrent) {
    chosen = [...blocks].reverse().find((b) => b.time <= nowKey);
  }
  if (!chosen) return null;

  // Extract song tokens (skip VHT separators and fallback placeholders)
  const songTokens = chosen.tokens.filter((t) => {
    const u = t.replace(/"/g, '').trim().toUpperCase();
    if (VHT_TOKENS.has(u)) return false;
    if (isFallback(t, opts.coringaCode)) return false;
    return true;
  });

  if (songTokens.length === 0) return null;

  const first2Tokens = songTokens.slice(0, 2);
  const last2Tokens = songTokens.slice(-2);

  const first2 = await Promise.all(
    first2Tokens.map((t) => resolveTokenToSong(t, opts.musicFolders)),
  );
  const last2 = await Promise.all(
    last2Tokens.map((t) => resolveTokenToSong(t, opts.musicFolders)),
  );

  return {
    time: chosen.time,
    programLabel: chosen.programLabel,
    filename,
    first2,
    last2,
  };
}
