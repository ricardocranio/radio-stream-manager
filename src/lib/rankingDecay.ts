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
const MS_PER_DAY = 86_400_000;

export interface RankedSong {
  id: string;
  title: string;
  artist: string;
  plays: number;
  style: string;
  trend: 'up' | 'down' | 'stable';
  lastPlayed: Date | number;
}

export function applyTemporalDecay(songs: RankedSong[]): RankedSong[] {
  const now = Date.now();

  return [...songs].sort((a, b) => {
    const scoreA = getWeightedScore(a, now);
    const scoreB = getWeightedScore(b, now);
    return scoreB - scoreA;
  });
}

/**
 * Score ponderado pelo tempo desde a última reprodução.
 * Aceita lastPlayed como Date ou number (UNIX ms).
 */
export function getWeightedScore(
  song: { plays: number; lastPlayed: Date | number },
  nowMs: number = Date.now()
): number {
  const lastMs = song.lastPlayed instanceof Date
    ? song.lastPlayed.getTime()
    : typeof song.lastPlayed === 'number'
      ? song.lastPlayed
      : new Date(song.lastPlayed).getTime();
  const ageMs = nowMs - lastMs;
  const ageDays = Math.max(0, ageMs / MS_PER_DAY);
  const decayFactor = Math.max(MIN_DECAY, 1.0 - (ageDays * DECAY_PER_DAY));
  return song.plays * decayFactor;
}

/**
 * Retorna apenas o decayFactor (útil para exibição na UI).
 */
export function getDecayFactor(
  lastPlayed: Date | number,
  nowMs: number = Date.now()
): number {
  const lastMs = lastPlayed instanceof Date
    ? lastPlayed.getTime()
    : typeof lastPlayed === 'number'
      ? lastPlayed
      : new Date(lastPlayed).getTime();
  const ageDays = Math.max(0, (nowMs - lastMs) / MS_PER_DAY);
  return Math.max(MIN_DECAY, 1.0 - (ageDays * DECAY_PER_DAY));
}

/**
 * Quantos dias faltam para a música atingir o fator mínimo de 0.5.
 */
export function daysUntilMinDecay(
  lastPlayed: Date | number,
  nowMs: number = Date.now()
): number {
  const lastMs = lastPlayed instanceof Date
    ? lastPlayed.getTime()
    : typeof lastPlayed === 'number'
      ? lastPlayed
      : new Date(lastPlayed).getTime();
  const ageDays = (nowMs - lastMs) / MS_PER_DAY;
  const daysToMin = (1.0 - MIN_DECAY) / DECAY_PER_DAY; // = 10 dias
  return Math.max(0, Math.ceil(daysToMin - ageDays));
}
