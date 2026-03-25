/**
 * Song Utilities — shared normalisation & key generation
 * Used by blockedSongsEngine, aliasEngine, and consumers.
 */

export function normalizeStr(s: string): string {
  return (s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function songKey(artist: string, title: string): string {
  return `${normalizeStr(artist)}|||${normalizeStr(title)}`;
}
