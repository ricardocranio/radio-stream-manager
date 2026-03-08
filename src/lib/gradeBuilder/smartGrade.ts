/**
 * Phase 3: Smart Grade Enhancements
 * 
 * Provides:
 * 1. Artist anti-repetition within the same shift (morning/afternoon/night)
 * 2. Genre balancing by time slot using ai_genre data
 * 3. Energy-based transitions (group songs by energy level)
 * 
 * These are additive utilities — the existing songSelection.ts calls them
 * as optional enhancements. If ai_genre/ai_energy data is unavailable,
 * all functions gracefully fall back to no-op behavior.
 */

export type TimeShift = 'madrugada' | 'manha' | 'tarde' | 'noite';

/** Determine the shift (turno) from a block time string "HH:MM" */
export function getTimeShift(blockTime: string): TimeShift {
  const hour = parseInt(blockTime.split(':')[0], 10);
  if (hour >= 0 && hour < 6) return 'madrugada';
  if (hour >= 6 && hour < 12) return 'manha';
  if (hour >= 12 && hour < 18) return 'tarde';
  return 'noite';
}

/**
 * Shift-level artist dedup tracker.
 * Keeps track of artists used within each shift to avoid repetition
 * across blocks in the same time period.
 */
export class ShiftArtistTracker {
  private usedByShift: Map<TimeShift, Set<string>> = new Map();

  isArtistUsedInShift(artist: string, blockTime: string): boolean {
    const shift = getTimeShift(blockTime);
    const used = this.usedByShift.get(shift);
    return used ? used.has(artist.toLowerCase().trim()) : false;
  }

  markArtistUsed(artist: string, blockTime: string): void {
    const shift = getTimeShift(blockTime);
    if (!this.usedByShift.has(shift)) {
      this.usedByShift.set(shift, new Set());
    }
    this.usedByShift.get(shift)!.add(artist.toLowerCase().trim());
  }

  getUsedCount(shift: TimeShift): number {
    return this.usedByShift.get(shift)?.size || 0;
  }

  reset(): void {
    this.usedByShift.clear();
  }
}

/**
 * Genre balancing — recommends target genre distribution for a time slot.
 * Returns a scoring function that can be used to sort candidates.
 */
const GENRE_PREFERENCES: Record<TimeShift, Record<string, number>> = {
  madrugada: { 'Romântico': 3, 'MPB': 2, 'Pop': 1, 'Sertanejo': 1 },
  manha: { 'Pop': 3, 'Sertanejo': 2, 'Pagode': 1, 'MPB': 2 },
  tarde: { 'Pop': 2, 'Sertanejo': 3, 'Funk': 1, 'Pagode': 2 },
  noite: { 'Pop': 3, 'Sertanejo': 2, 'Romântico': 2, 'Funk': 1 },
};

export function getGenreScore(genre: string | null | undefined, blockTime: string): number {
  if (!genre) return 1; // No genre data — neutral score
  const shift = getTimeShift(blockTime);
  const prefs = GENRE_PREFERENCES[shift];
  // Check for partial match
  for (const [prefGenre, score] of Object.entries(prefs)) {
    if (genre.toLowerCase().includes(prefGenre.toLowerCase())) return score;
  }
  return 1; // Default neutral
}

/**
 * Energy transition scoring.
 * For smooth transitions, consecutive songs should have similar energy levels.
 * Returns a penalty score (lower = better fit).
 */
const ENERGY_ORDER: Record<string, number> = {
  'low': 1,
  'medium-low': 2,
  'medium': 3,
  'medium-high': 4,
  'high': 5,
};

export function getEnergyTransitionPenalty(
  previousEnergy: string | null | undefined,
  candidateEnergy: string | null | undefined
): number {
  if (!previousEnergy || !candidateEnergy) return 0; // No data — no penalty
  const prev = ENERGY_ORDER[previousEnergy.toLowerCase()] || 3;
  const curr = ENERGY_ORDER[candidateEnergy.toLowerCase()] || 3;
  const diff = Math.abs(prev - curr);
  // Allow 1 step — penalize 2+ steps
  return diff <= 1 ? 0 : (diff - 1) * 2;
}

/**
 * Combined smart scoring for a candidate song.
 * Higher score = better candidate.
 */
export function getSmartCandidateScore(
  candidate: {
    artist: string;
    ai_genre?: string | null;
    ai_energy?: string | null;
  },
  blockTime: string,
  previousEnergy: string | null | undefined,
  shiftTracker: ShiftArtistTracker
): number {
  let score = 10; // Base

  // Genre bonus
  score += getGenreScore(candidate.ai_genre, blockTime);

  // Energy transition
  score -= getEnergyTransitionPenalty(previousEnergy, candidate.ai_energy);

  // Shift artist penalty (prefer new artists in the shift)
  if (shiftTracker.isArtistUsedInShift(candidate.artist, blockTime)) {
    score -= 5;
  }

  return score;
}

// Singleton instance for use across grade generation
export const shiftArtistTracker = new ShiftArtistTracker();
