/**
 * Normalizes artist/title fields for deduplication.
 * 
 * Unifies all variations of "feat.", "Feat.", "feat", "&", "e" (conjunction)
 * into a single token "feat" so that:
 *   "Thiaguinho feat. Ferrugem"
 *   "Thiaguinho e Ferrugem"
 *   "Thiaguinho & Ferrugem"
 * are all stored and matched as the same entry.
 * 
 * IMPORTANT: "e" is only replaced when it appears as a standalone word
 * between artist-like tokens (not inside words like "Mercedes").
 */

/**
 * Normalize an artist string for dedup: unify feat/&/e conjunctions.
 */
export function normalizeArtistForDedup(artist: string): string {
  if (!artist) return artist;

  return artist
    // Normalize "feat.", "Feat.", "ft.", "Ft.", "featuring", "part." variations
    .replace(/\b(?:feat\.?|ft\.?|Feat\.?|Ft\.?|featuring|part\.?)\b/gi, 'feat')
    // Replace "&" used as conjunction between artists
    .replace(/\s*&\s*/g, ' feat ')
    // Replace standalone "e" used as conjunction (Portuguese "and")
    // Only match " e " surrounded by spaces to avoid matching inside words
    .replace(/\s+e\s+/gi, ' feat ')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a title string for dedup: unify feat/&/e in parenthetical features.
 */
export function normalizeTitleForDedup(title: string): string {
  if (!title) return title;

  return title
    .replace(/\b(?:feat\.?|ft\.?|Feat\.?|Ft\.?|featuring|part\.?)\b/gi, 'feat')
    .replace(/\s*&\s*/g, ' feat ')
    .replace(/\s+e\s+/gi, ' feat ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize both artist and title for dedup in one call.
 */
export function normalizeForDedup(artist: string, title: string): { artist: string; title: string } {
  return {
    artist: normalizeArtistForDedup(artist),
    title: normalizeTitleForDedup(title),
  };
}
