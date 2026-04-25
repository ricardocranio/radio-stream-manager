/**
 * Helpers to preserve already-resolved grade lines during refresh.
 * Only fallback placeholders (mus/rom/clas/coringa) are eligible for replacement.
 */

const LINE_HEADER_REGEX = /^(\d{2}:\d{2}\s+\((?:FIXO\s+)?ID=[^)]+\)\s*)(.*)$/i;
/** Matches just the time prefix, ignoring different program IDs */
const LINE_TIME_REGEX = /^(\d{2}:\d{2})\s+\([^)]+\)\s*(.*)$/i;

function normalizeToken(token: string): string {
  return token.replace(/"/g, '').trim().toUpperCase();
}

function getFallbackCodes(coringaCode?: string): Set<string> {
  const sanitizedCoringa = (coringaCode || 'mus').replace(/\.mp3$/i, '').toUpperCase();
  return new Set(['MUS', 'ROM', 'CLAS', 'JOV', 'FUN', sanitizedCoringa]);
}

function isFallbackToken(token: string, coringaCode?: string): boolean {
  const normalized = normalizeToken(token);
  if (!normalized) return false;
  return getFallbackCodes(coringaCode).has(normalized);
}

/** VHT/VHTN are separators, not song slots. LOC/LOC_END mark AI voice-over insertion points. */
function isVhtToken(token: string): boolean {
  const n = normalizeToken(token);
  return n === 'VHT' || n === 'VHTN' || n === 'LOC' || n === 'LOC_END';
}

/** Count only song slots (not VHT separators) */
function countSongTokens(tokens: string[]): { total: number; resolved: number; fallback: number } {
  let total = 0;
  let resolved = 0;
  let fallback = 0;
  for (const token of tokens) {
    if (isVhtToken(token)) continue;
    total++;
    if (isFallbackToken(token)) {
      fallback++;
    } else {
      resolved++;
    }
  }
  return { total, resolved, fallback };
}

function splitLine(line: string): { header: string; time: string; tokens: string[] } | null {
  const match = line.match(LINE_HEADER_REGEX);
  if (!match) return null;
  const timeMatch = line.match(/^(\d{2}:\d{2})/);

  return {
    header: match[1],
    time: timeMatch ? timeMatch[1] : '',
    tokens: match[2]
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0),
  };
}

export function hasUnresolvedSongTokens(line: string, coringaCode?: string): boolean {
  const parsed = splitLine(line);
  if (!parsed) return false;
  return parsed.tokens.some((token) => isFallbackToken(token, coringaCode));
}

/**
 * Check if a grade line has ALL song slots filled with real songs (no fallbacks).
 * Returns true if the block is fully resolved and should be locked.
 */
export function isBlockFullyResolved(line: string, coringaCode?: string): boolean {
  const parsed = splitLine(line);
  if (!parsed) return false;
  const { total, fallback } = countSongTokens(parsed.tokens);
  // A block is fully resolved when it has songs and none are fallbacks
  return total > 0 && fallback === 0;
}

/**
 * Keeps all resolved tokens from existing line and replaces only fallback placeholders
 * with the newly generated token at the same position.
 * 
 * IMPORTANT: If the program ID differs (e.g., "Happy Hour" vs "Tarde Animada"),
 * we still merge by TIME match — preserving resolved songs regardless of label changes.
 */
export function mergeGradeLinePreservingResolved(
  existingLine: string,
  regeneratedLine: string,
  coringaCode?: string,
): string {
  const existing = splitLine(existingLine);
  const regenerated = splitLine(regeneratedLine);

  if (!existing || !regenerated) return regeneratedLine;
  
  // Match by TIME (e.g., "17:00") instead of full header to avoid
  // losing resolved songs when the program name changes between cycles
  if (existing.time !== regenerated.time) return regeneratedLine;

  // If the existing block is fully resolved, keep it as-is (use regenerated header for label updates)
  const stats = countSongTokens(existing.tokens);
  if (stats.total > 0 && stats.fallback === 0) {
    console.log(`[MERGE] 🔒 Bloco ${existing.time} totalmente resolvido (${stats.resolved} músicas) — mantendo intacto`);
    // Use the regenerated header (may have updated program name) but keep existing tokens
    return `${regenerated.header}${existing.tokens.join(',')}`;
  }

  const mergedTokens = existing.tokens.map((existingToken, index) => {
    if (!isFallbackToken(existingToken, coringaCode)) return existingToken;
    return regenerated.tokens[index] ?? existingToken;
  });

  if (regenerated.tokens.length > mergedTokens.length) {
    mergedTokens.push(...regenerated.tokens.slice(mergedTokens.length));
  }

  const mergedStats = countSongTokens(mergedTokens);
  console.log(`[MERGE] Bloco ${existing.time}: ${mergedStats.resolved}/${mergedStats.total} resolvidas (${mergedStats.fallback} faltando)`);

  return `${regenerated.header}${mergedTokens.join(',')}`;
}
