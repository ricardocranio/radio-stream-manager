/**
 * Ranking Temporal Decay
 * 
 * Applies a freshness weight to ranking songs so that recently played
 * songs score higher than stale ones with the same play count.
 * 
 * Formula: weightedScore = plays * decayFactor
 * decayFactor = 1.0 for songs played today, decaying by 5% per day
 * down to a minimum of 0.5 (10+ days old).
 */

const DECAY_PER_DAY = 0.05;
const MIN_DECAY = 0.5;

export interface RankedSong {
  id: string;
  title: string;
  artist: string;
  plays: number;
  style: string;
  trend: 'up' | 'down' | 'stable';
  lastPlayed: Date;
}

export function applyTemporalDecay(songs: RankedSong[]): RankedSong[] {
  const now = Date.now();

  return [...songs].sort((a, b) => {
    const scoreA = getWeightedScore(a, now);
    const scoreB = getWeightedScore(b, now);
    return scoreB - scoreA;
  });
}

function getWeightedScore(song: RankedSong, nowMs: number): number {
  const ageMs = nowMs - new Date(song.lastPlayed).getTime();
  const ageDays = Math.max(0, ageMs / (24 * 60 * 60 * 1000));
  const decayFactor = Math.max(MIN_DECAY, 1.0 - (ageDays * DECAY_PER_DAY));
  return song.plays * decayFactor;
}
