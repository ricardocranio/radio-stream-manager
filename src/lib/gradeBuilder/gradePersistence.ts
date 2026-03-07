/**
 * Grade Persistence
 * 
 * Persists the assembled grade lines and built-block locks to localStorage
 * so they survive page refreshes (Ctrl+R).
 */

const STORAGE_KEY = 'pgmr_grade_state';

interface PersistedGrade {
  /** ISO date string of when this was saved */
  savedAt: string;
  /** Day code (e.g. "SAB", "SEG") to invalidate on day change */
  dayCode: string;
  /** Map entries: [timeKey, line] */
  lines: [string, string][];
  /** Already-built block keys */
  lockedBlocks: string[];
}

export function saveGradeToStorage(
  lineMap: Map<string, string>,
  lockedBlocks: Set<string>,
  dayCode: string,
): void {
  try {
    const data: PersistedGrade = {
      savedAt: new Date().toISOString(),
      dayCode,
      lines: Array.from(lineMap.entries()),
      lockedBlocks: Array.from(lockedBlocks),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function loadGradeFromStorage(currentDayCode: string): {
  lineMap: Map<string, string>;
  lockedBlocks: Set<string>;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: PersistedGrade = JSON.parse(raw);

    // Invalidate if day changed
    if (data.dayCode !== currentDayCode) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // Invalidate if older than 6 hours
    const age = Date.now() - new Date(data.savedAt).getTime();
    if (age > 6 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return {
      lineMap: new Map(data.lines),
      lockedBlocks: new Set(data.lockedBlocks),
    };
  } catch {
    return null;
  }
}

export function clearGradeStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}
