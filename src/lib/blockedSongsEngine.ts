/**
 * Centralized blocked-songs engine.
 * 
 * Replaces duplicated blocking logic across radioStore, songSelection,
 * useGlobalDownloadService, and useCapturedDownloadService.
 * 
 * Supports:
 * - Exact match: "Artist - Title"
 * - Wildcard artist: "Artist - *"
 * - Forbidden words (partial match in artist or title)
 * - Alias-aware: checks both original AND aliased names
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
  // Pre-compute exact and wildcard sets
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

  // Pre-compute alias forward map for checking corrected names
  const aliasFromMap = new Map<string, { toArtist: string; toTitle: string }>();
  for (const alias of aliases) {
    aliasFromMap.set(songKey(alias.fromArtist, alias.fromTitle), {
      toArtist: alias.toArtist,
      toTitle: alias.toTitle,
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

    // Check raw name
    if (checkRaw(aN, tN)) return true;

    // Also check the ALIASED (corrected) name against the block list
    const resolved = aliasFromMap.get(`${aN}|||${tN}`);
    if (resolved) {
      if (checkRaw(normalizeStr(resolved.toArtist), normalizeStr(resolved.toTitle))) return true;
    }

    return false;
  }

  return { isBlocked };
}
