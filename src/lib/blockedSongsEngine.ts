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

export type BlockedRule = 'exact' | 'wildcard' | 'forbidden' | 'alias' | 'partial';

export interface BlockedMatch {
  rule: BlockedRule;
}

export interface BlockedEngine {
  isBlocked: (artist: string, title: string) => boolean;
  getBlockMatch: (artist: string, title: string) => BlockedMatch | null;
}

export function buildBlockedEngine(
  blockedSongs: string[],
  forbiddenWords: string[],
  aliases: { fromArtist: string; fromTitle: string; toArtist: string; toTitle: string }[]
): BlockedEngine {
  const exact = new Set<string>();
  const wildcardArtists = new Set<string>();
  const exactEntries: Array<{ artist: string; title: string }> = [];

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
        exactEntries.push({
          artist: normalizeStr(artist),
          title: normalizeStr(title),
        });
      }
    }
  }

  const forbidden = forbiddenWords
    .map(w => normalizeStr(w))
    .filter(Boolean);

  // Forward alias map: wrong name → correct name
  const aliasFromMap = new Map<string, { toArtist: string; toTitle: string }>();

  for (const alias of aliases) {
    aliasFromMap.set(songKey(alias.fromArtist, alias.fromTitle), {
      toArtist: alias.toArtist,
      toTitle: alias.toTitle,
    });
  }

  function checkRaw(aN: string, tN: string): Exclude<BlockedRule, 'alias' | 'partial'> | null {
    if (exact.has(`${aN}|||${tN}`)) return 'exact';
    if (wildcardArtists.has(aN)) return 'wildcard';
    if (forbidden.some(w => aN.includes(w) || tN.includes(w))) return 'forbidden';
    return null;
  }

  function checkPartial(aN: string, tN: string): 'partial' | null {
    if (!aN || !tN) return null;

    for (const entry of exactEntries) {
      const frag = entry.title;
      if (!frag || frag.length < 4) continue;

      const titleMatches = tN === frag || (frag.length >= 6 && tN.includes(frag));
      if (!titleMatches) continue;

      // Artist matching: require full-word match, not just substring.
      // Split both into words and check if ALL words of the blocked artist appear in the candidate
      // (or vice-versa for short blocked names). This avoids "Naldo Lima" blocking "Gusttavo Lima".
      const entryWords = entry.artist.split(' ').filter(w => w.length >= 2);
      const candidateWords = aN.split(' ').filter(w => w.length >= 2);

      // At least 60% of blocked artist words must appear in candidate (and exact match on surname-like words)
      const matchingWords = entryWords.filter(w => candidateWords.includes(w));
      const matchRatio = entryWords.length > 0 ? matchingWords.length / entryWords.length : 0;

      // Require ALL words to match (strict), or if single-word artist, require exact equality
      const artistMatches = entryWords.length === 1
        ? candidateWords.includes(entryWords[0])
        : matchRatio >= 1.0;

      if (artistMatches) {
        return 'partial';
      }
    }

    return null;
  }

  function checkDirect(aN: string, tN: string): Exclude<BlockedRule, 'alias'> | null {
    return checkRaw(aN, tN) ?? checkPartial(aN, tN);
  }

  function getBlockMatch(artist: string, title: string): BlockedMatch | null {
    const aN = normalizeStr(artist);
    const tN = normalizeStr(title);

    // Check 1: Direct match (original name against block list)
    const directMatch = checkDirect(aN, tN);
    if (directMatch) return { rule: directMatch };

    // Check 2: Forward alias — if original name has an alias, check the CORRECTED name
    const resolved = aliasFromMap.get(`${aN}|||${tN}`);
    if (resolved) {
      if (checkDirect(normalizeStr(resolved.toArtist), normalizeStr(resolved.toTitle))) {
        return { rule: 'alias' };
      }
    }

    return null;
  }

  function isBlocked(artist: string, title: string): boolean {
    return getBlockMatch(artist, title) !== null;
  }

  return { isBlocked, getBlockMatch };
}
