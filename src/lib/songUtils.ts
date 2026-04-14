/**
 * Song Utilities — shared normalisation & key generation
 * Used by blockedSongsEngine, aliasEngine, and consumers.
 *
 * Normalisation is intentionally aggressive to maximise alias/block matching:
 *   1. lowercase + trim
 *   2. Unicode NFD → strip combining marks (accents)
 *   3. Normalise punctuation & special chars
 *   4. Collapse whitespace
 */

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
    // Normalise feat variations: "feat.", "feat", "ft.", "ft", "featuring" → "feat"
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, 'feat')
    // Strip remaining punctuation that doesn't carry meaning for matching
    // Keep hyphens (artist separators), parentheses and brackets (live/acoustic tags)
    .replace(/[,;:!?¿¡@#$%^&*+={}|\\/<>~_]/g, ' ')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();

  return r;
}

/**
 * Generate a deterministic lookup key for an (artist, title) pair.
 */
export function songKey(artist: string, title: string): string {
  return `${normalizeStr(artist)}|||${normalizeStr(title)}`;
}
