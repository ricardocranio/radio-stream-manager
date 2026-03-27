/**
 * Blocked Songs Engine — O(1) lookup for blocked songs/artists/forbidden words.
 * Supports exact match, wildcard artists ("Artist - *"), forbidden words,
 * and alias-aware blocking (checks original, corrected, AND reverse-alias names).
 *
 * Key improvement: if a song is blocked under a WRONG name and there's an alias
 * mapping that wrong name → correct name, the engine blocks BOTH directions.
 * This ensures blocked songs can't sneak through using alias-corrected names.
 */

import { normalizeStr, songKey } from './songUtils';

export interface BlockedEngine {
  isBlocked: (artist: string, title: string) => boolean;
}

export function buildBlockedEngine(
  blockedSongs: string[],
  forbiddenWords: string[],
  aliases: { fromArtist: string; fromTitle: string; toArtist: string; toTitle: string }[]
): BlockedEngine {
  const exact = new Set<string>();
  const wildcardArtists = new Set<string>();

  for (const entry of blockedSongs) {
    const norm = normalizeStr(entry);
    if (norm.endsWith(' - *')) {
      wildcardArtists.add(norm.replace(/ - \*$/, ''));
    } else {
      const dashIndex = entry.indexOf(' - ');
      if (dashIndex !== -1) {
        const artist = entry.slice(0, dashIndex);
        const title = entry.slice(dashIndex + 3);
        exact.add(songKey(artist, title));
      }
    }
  }

  const forbidden = forbiddenWords
    .map(w => normalizeStr(w))
    .filter(Boolean);

  // Forward alias map: wrong name → correct name
  const aliasFromMap = new Map<string, { toArtist: string; toTitle: string }>();
  // Reverse alias map: correct name → wrong name (for reverse blocking)
  const aliasReverseMap = new Map<string, { fromArtist: string; fromTitle: string }>();

  for (const alias of aliases) {
    aliasFromMap.set(songKey(alias.fromArtist, alias.fromTitle), {
      toArtist: alias.toArtist,
      toTitle: alias.toTitle,
    });
    aliasReverseMap.set(songKey(alias.toArtist, alias.toTitle), {
      fromArtist: alias.fromArtist,
      fromTitle: alias.fromTitle,
    });
  }

  function checkRaw(aN: string, tN: string): boolean {
    if (exact.has(`${aN}|||${tN}`)) return true;
    if (wildcardArtists.has(aN)) return true;
    if (forbidden.some(w => aN.includes(w) || tN.includes(w))) return true;
    return false;
  }

  function isBlocked(artist: string, title: string): boolean {
    const aN = normalizeStr(artist);
    const tN = normalizeStr(title);

    // Check 1: Direct match (original name against block list)
    if (checkRaw(aN, tN)) return true;

    // Check 2: Forward alias — if original name has an alias, check the CORRECTED name
    const resolved = aliasFromMap.get(`${aN}|||${tN}`);
    if (resolved) {
      if (checkRaw(normalizeStr(resolved.toArtist), normalizeStr(resolved.toTitle))) return true;
    }

    // Check 3: REVERSE alias — if this is the CORRECTED name, check if the WRONG name is blocked
    // This catches songs arriving with corrected names when the block list has the wrong name
    const reverseResolved = aliasReverseMap.get(`${aN}|||${tN}`);
    if (reverseResolved) {
      if (checkRaw(normalizeStr(reverseResolved.fromArtist), normalizeStr(reverseResolved.fromTitle))) return true;
    }

    return false;
  }

  return { isBlocked };
}
