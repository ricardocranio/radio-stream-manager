/**
 * Centralized alias (song correction) engine.
 * 
 * Replaces duplicated alias resolution logic across songSelection,
 * useGlobalDownloadService, useCapturedDownloadService, and useAutoGradeBuilder.
 * 
 * - resolve(artist, title): maps "wrong" name → "correct" name
 * - resolveReverse(artist, title): maps "correct" name → "original" name (for library fallback)
 */

import { songKey } from './songUtils';

export interface AliasEngine {
  resolve: (artist: string, title: string) => { artist: string; title: string };
  resolveReverse: (artist: string, title: string) => { artist: string; title: string };
}

export function buildAliasEngine(
  aliases: { fromArtist: string; fromTitle: string; toArtist: string; toTitle: string }[]
): AliasEngine {
  const forwardMap = new Map<string, { artist: string; title: string }>();
  const reverseMap = new Map<string, { artist: string; title: string }>();

  for (const alias of aliases) {
    forwardMap.set(songKey(alias.fromArtist, alias.fromTitle), {
      artist: alias.toArtist,
      title: alias.toTitle,
    });
    reverseMap.set(songKey(alias.toArtist, alias.toTitle), {
      artist: alias.fromArtist,
      title: alias.fromTitle,
    });
  }

  function resolve(artist: string, title: string) {
    return forwardMap.get(songKey(artist, title)) ?? { artist, title };
  }

  function resolveReverse(artist: string, title: string) {
    return reverseMap.get(songKey(artist, title)) ?? { artist, title };
  }

  return { resolve, resolveReverse };
}
