/**
 * Shared song normalization utilities.
 * 
 * Used by blockedSongsEngine, aliasEngine, and any code that needs
 * consistent artist/title keys for comparison or deduplication.
 */

/**
 * Normalize a string for comparison:
 * - lowercase
 * - trim
 * - remove diacritics (NFD + strip combining marks)
 * - collapse whitespace
 */
export function normalizeStr(s: string): string {
  return (s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Create a deterministic key from artist + title for Map/Set lookups.
 */
export function songKey(artist: string, title: string): string {
  return `${normalizeStr(artist)}|||${normalizeStr(title)}`;
}
