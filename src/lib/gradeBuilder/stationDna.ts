/**
 * Station DNA Profiling
 * 
 * Builds dynamic DNA profiles from captured songs to enable intelligent
 * cross-station substitution. Instead of inserting CORINGA when no song
 * from the target station is available, the system finds songs from other
 * stations that share the same "DNA" (common artists, similar patterns).
 * 
 * DNA Profile = frequency map of artists per station.
 * Stations that share many artists have similar DNA.
 */

import type { SongEntry } from './types';

export interface StationDnaProfile {
  /** Artist name (lowercase) → play count */
  artistFrequency: Record<string, number>;
  /** Total songs analyzed */
  totalSongs: number;
}

export type DnaProfiles = Record<string, StationDnaProfile>;

/**
 * Build DNA profiles from the current song pool.
 * Each station gets a frequency map of its artists.
 */
export function buildDnaProfiles(songsByStation: Record<string, SongEntry[]>): DnaProfiles {
  const profiles: DnaProfiles = {};

  for (const [stationName, songs] of Object.entries(songsByStation)) {
    const artistFreq: Record<string, number> = {};
    for (const song of songs) {
      const artist = song.artist.toLowerCase().trim();
      artistFreq[artist] = (artistFreq[artist] || 0) + 1;
    }
    profiles[stationName] = {
      artistFrequency: artistFreq,
      totalSongs: songs.length,
    };
  }

  return profiles;
}

/**
 * Find the best DNA-compatible substitute song from other stations.
 * 
 * Strategy:
 * 1. Shared Artists: Songs whose artist appears on the target station (highest affinity)
 * 2. Style Match: Songs from stations with the most shared artists (similar DNA)
 * 
 * Returns candidates sorted by relevance (shared artist songs first, then style-similar).
 */
export function findDnaCompatibleSongs(
  targetStation: string,
  songsByStation: Record<string, SongEntry[]>,
  dnaProfiles: DnaProfiles,
  excludeKeys: Set<string>,
  excludeArtists: Set<string>,
): SongEntry[] {
  const targetProfile = dnaProfiles[targetStation];
  if (!targetProfile) return [];

  const targetArtists = new Set(Object.keys(targetProfile.artistFrequency));

  // Rank other stations by DNA similarity (shared artist count)
  const stationSimilarity: Array<{ station: string; sharedCount: number }> = [];
  for (const [stName, profile] of Object.entries(dnaProfiles)) {
    if (stName === targetStation) continue;
    let shared = 0;
    for (const artist of Object.keys(profile.artistFrequency)) {
      if (targetArtists.has(artist)) shared++;
    }
    if (shared > 0 || profile.totalSongs > 0) {
      stationSimilarity.push({ station: stName, sharedCount: shared });
    }
  }
  stationSimilarity.sort((a, b) => b.sharedCount - a.sharedCount);

  const candidates: Array<{ song: SongEntry; priority: number }> = [];

  for (const { station: stName, sharedCount } of stationSimilarity) {
    const songs = songsByStation[stName] || [];
    for (const song of songs) {
      const key = `${song.title.toLowerCase()}-${song.artist.toLowerCase()}`;
      const normalizedArtist = song.artist.toLowerCase().trim();
      if (excludeKeys.has(key) || excludeArtists.has(normalizedArtist)) continue;

      // Priority: shared artist = 100 + freq on target station; style-similar = sharedCount
      const isSharedArtist = targetArtists.has(normalizedArtist);
      const priority = isSharedArtist
        ? 100 + (targetProfile.artistFrequency[normalizedArtist] || 0)
        : sharedCount;

      candidates.push({ song, priority });
    }
  }

  // Sort by priority (highest first), then shuffle within same priority for variety
  candidates.sort((a, b) => b.priority - a.priority);

  return candidates.map(c => c.song);
}
