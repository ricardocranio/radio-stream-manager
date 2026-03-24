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
    const data: Partial<PersistedGrade> = JSON.parse(raw);

    // Invalidate if day changed
    if (data.dayCode !== currentDayCode) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // Invalidate if older than 6 hours
    const savedAt = typeof data.savedAt === 'string' ? new Date(data.savedAt).getTime() : NaN;
    const age = Date.now() - savedAt;
    if (age > 6 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    if (!Array.isArray(data.lines) || !Array.isArray(data.lockedBlocks)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const safeLines = data.lines.filter(
      (entry): entry is [string, string] =>
        Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'string'
    );

    const safeLockedBlocks = data.lockedBlocks.filter(
      (entry): entry is string => typeof entry === 'string'
    );

    return {
      lineMap: new Map(safeLines),
      lockedBlocks: new Set(safeLockedBlocks),
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearGradeStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}
