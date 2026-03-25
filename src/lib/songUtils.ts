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

/**
 * Normalização de chave para mapeamento de emissoras/estação.
 * Remove acentos, caracteres especiais e colapsa espaços.
 * Centralizada aqui para evitar duplicação inline.
 */
export function normalizeKeyForMap(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}
