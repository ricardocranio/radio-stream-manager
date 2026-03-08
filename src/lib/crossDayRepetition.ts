/**
 * Cross-Day Repetition Buffer
 * 
 * Persists the last 4 hours of used songs to localStorage so that
 * songs used late at night (e.g., 23:30) aren't repeated early
 * the next day (e.g., 00:00).
 */

const STORAGE_KEY = 'pgmr_crossday_used';
const BUFFER_HOURS = 4;
const MAX_ENTRIES = 60;

interface PersistedUsedSong {
  title: string;
  artist: string;
  blockTime: string;
  savedAt: string; // ISO
}

export function saveCrossDayBuffer(
  usedSongs: Array<{ title: string; artist: string; blockTime: string; usedAt: Date }>
): void {
  try {
    const cutoff = Date.now() - BUFFER_HOURS * 60 * 60 * 1000;
    const recent = usedSongs
      .filter(s => s.usedAt.getTime() > cutoff)
      .slice(-MAX_ENTRIES)
      .map(s => ({
        title: s.title,
        artist: s.artist,
        blockTime: s.blockTime,
        savedAt: s.usedAt.toISOString(),
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // ignore
  }
}

export function loadCrossDayBuffer(): Array<{
  title: string;
  artist: string;
  blockTime: string;
  usedAt: Date;
}> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data: PersistedUsedSong[] = JSON.parse(raw);
    
    const cutoff = Date.now() - BUFFER_HOURS * 60 * 60 * 1000;
    return data
      .filter(s => new Date(s.savedAt).getTime() > cutoff)
      .map(s => ({
        title: s.title,
        artist: s.artist,
        blockTime: s.blockTime,
        usedAt: new Date(s.savedAt),
      }));
  } catch {
    return [];
  }
}
