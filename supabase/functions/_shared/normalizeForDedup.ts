/**
 * Normalizes artist/title fields for deduplication (Edge Function version).
 * Mirrors src/lib/normalizeForDedup.ts for server-side use.
 */

export function normalizeArtistForDedup(artist: string): string {
  if (!artist) return artist;
  return artist
    .replace(/\b(?:feat\.?|ft\.?|Feat\.?|Ft\.?|featuring|part\.?)\b/gi, 'feat')
    .replace(/\s*&\s*/g, ' feat ')
    .replace(/\s+e\s+/gi, ' feat ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitleForDedup(title: string): string {
  if (!title) return title;
  return title
    .replace(/\b(?:feat\.?|ft\.?|Feat\.?|Ft\.?|featuring|part\.?)\b/gi, 'feat')
    .replace(/\s*&\s*/g, ' feat ')
    .replace(/\s+e\s+/gi, ' feat ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeForDedup(artist: string, title: string): { artist: string; title: string } {
  return {
    artist: normalizeArtistForDedup(artist),
    title: normalizeTitleForDedup(title),
  };
}
