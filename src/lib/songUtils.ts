/**
 * Song Utilities — shared normalisation & key generation
 * Used by blockedSongsEngine, aliasEngine, and consumers.
 *
 * Normalisation is intentionally aggressive to maximise alias/block matching:
 *   1. lowercase + trim
 *   2. Unicode NFD → strip combining marks (accents)
 *   3. Normalise punctuation & special chars
 *   4. Strip version suffixes (Ao Vivo, Live, Acústico, etc.)
 *   5. Collapse whitespace
 */

/** Common version/live suffixes stripped during normalisation */
const VERSION_SUFFIXES = [
  // Portuguese
  'ao vivo', 'ao vivo em .*?', 'acustico', 'acustica',
  'ao vivo em lisboa', 'ao vivo em sao paulo',
  // English  
  'live', 'live version', 'live at .*?', 'acoustic', 'acoustic version',
  'radio edit', 'radio version', 'remix', 'remaster', 'remastered',
  'deluxe', 'deluxe edition', 'bonus track',
  // Common suffixes
  'official video', 'official music video', 'lyric video',
  'clipe oficial', 'video oficial',
];

/** Build a single regex that matches all suffix patterns inside parens/brackets */
const SUFFIX_PATTERN = new RegExp(
  `\\s*[\\(\\[]\\s*(?:${VERSION_SUFFIXES.join('|')})\\s*[\\)\\]]`,
  'gi'
);

/**
 * Aggressively normalise a string for comparison purposes.
 * Two strings that "sound the same" should produce the same output.
 */
export function normalizeStr(s: string): string {
  if (!s) return '';

  let r = s
    .toLowerCase()
    .trim()
    // Unicode NFD decomposition, then strip combining diacritical marks
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Replace smart quotes / curly quotes with straight ones, then strip all quotes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/['"`]/g, '')
    // Normalise dashes: em-dash, en-dash, minus → simple hyphen
    .replace(/[\u2013\u2014\u2212]/g, '-')
    // Ensure space before opening parenthesis/bracket so "word(ao" → "word (ao"
    .replace(/([a-z0-9])([(\[])/g, '$1 $2')
    // Strip version suffixes: (Ao Vivo), [Live], (Acústico), (Remix), etc.
    .replace(SUFFIX_PATTERN, '')
    // Normalise feat variations: "feat.", "feat", "ft.", "ft", "featuring" → "feat"
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, 'feat')
    // Strip punctuation that doesn't carry meaning for matching
    // Keep: hyphens, parentheses, brackets, asterisks (wildcards)
    .replace(/[,;:!?¿¡@#$%^&+={}|\\/<>~_"]/g, ' ')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();

  return r;
}

/**
 * Normalise WITHOUT stripping version suffixes.
 * Used when the suffix carries meaning (e.g. file search, display).
 */
export function normalizeStrKeepSuffix(s: string): string {
  if (!s) return '';

  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/['"`]/g, '')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/([a-z0-9])([(\[])/g, '$1 $2')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, 'feat')
    .replace(/[,;:!?¿¡@#$%^&+={}|\\/<>~_"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate a deterministic lookup key for an (artist, title) pair.
 */
export function songKey(artist: string, title: string): string {
  return `${normalizeStr(artist)}|||${normalizeStr(title)}`;
}
