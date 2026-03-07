/**
 * Helpers to preserve already-resolved grade lines during refresh.
 * Only fallback placeholders (mus/rom/clas/coringa) are eligible for replacement.
 */

const LINE_HEADER_REGEX = /^(\d{2}:\d{2}\s+\((?:FIXO\s+)?ID=[^)]+\)\s*)(.*)$/i;

function normalizeToken(token: string): string {
  return token.replace(/"/g, '').trim().toUpperCase();
}

function getFallbackCodes(coringaCode?: string): Set<string> {
  const sanitizedCoringa = (coringaCode || 'mus').replace(/\.mp3$/i, '').toUpperCase();
  return new Set(['MUS', 'ROM', 'CLAS', sanitizedCoringa]);
}

function isFallbackToken(token: string, coringaCode?: string): boolean {
  const normalized = normalizeToken(token);
  if (!normalized) return false;
  return getFallbackCodes(coringaCode).has(normalized);
}

function splitLine(line: string): { header: string; tokens: string[] } | null {
  const match = line.match(LINE_HEADER_REGEX);
  if (!match) return null;

  return {
    header: match[1],
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
 * Keeps all resolved tokens from existing line and replaces only fallback placeholders
 * with the newly generated token at the same position.
 */
export function mergeGradeLinePreservingResolved(
  existingLine: string,
  regeneratedLine: string,
  coringaCode?: string,
): string {
  const existing = splitLine(existingLine);
  const regenerated = splitLine(regeneratedLine);

  if (!existing || !regenerated) return regeneratedLine;
  if (existing.header !== regenerated.header) return regeneratedLine;

  const mergedTokens = existing.tokens.map((existingToken, index) => {
    if (!isFallbackToken(existingToken, coringaCode)) return existingToken;
    return regenerated.tokens[index] ?? existingToken;
  });

  if (regenerated.tokens.length > mergedTokens.length) {
    mergedTokens.push(...regenerated.tokens.slice(mergedTokens.length));
  }

  return `${existing.header}${mergedTokens.join(',')}`;
}
