import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { useGradeLogStore } from '@/store/gradeLogStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';

// Reset schedule: 05:00 (morning) and 21:00 (after critical blocks, during Voz do Brasil)
const RESET_HOURS = [5, 21];
const RESET_STORAGE_KEY = 'pgm-last-daily-reset';

/**
 * Hook that performs automatic system reset at 05:00 and 21:00
 * 
 * Schedule rationale:
 * - 05:00: Clean slate for the new day (during quiet "Nossa Madrugada" period)
 * - 21:00: After all critical blocks (TOP10, TOP50, FIXO), during Voz do Brasil (fixed content)
 * 
 * Clears: missing songs, ranking, captured songs, download history, grade history, logs
 */
export function useDailyReset() {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const {
    clearMissingSongs,
    clearRanking,
    clearCapturedSongs,
    clearDownloadHistory,
    clearGradeHistory,
  } = useRadioStore();
  
  const { clearBlockLogs, clearSystemErrors } = useGradeLogStore();
  const { resetQueue } = useAutoDownloadStore();

  // Get the last reset timestamp (includes hour to allow multiple resets per day)
  const getLastResetKey = useCallback((): string | null => {
    return localStorage.getItem(RESET_STORAGE_KEY);
  }, []);

  // Store reset with date and hour to track which resets have occurred
  const setLastResetKey = useCallback((date: string, hour: number) => {
    localStorage.setItem(RESET_STORAGE_KEY, `${date}-${hour}`);
  }, []);

  const performReset = useCallback((hour: number) => {
    const timeLabel = hour === 5 ? '05:00 (Madrugada)' : '21:00 (Voz do Brasil)';
    console.log(`[DAILY RESET] 🧹 Performing scheduled reset at ${timeLabel}...`);
    
    // Clear all counters and stats
    clearMissingSongs();
    clearRanking();
    clearCapturedSongs();
    clearDownloadHistory();
    clearGradeHistory();
    clearBlockLogs();
    clearSystemErrors();
    
    // Signal auto-download to reset its queue
    resetQueue();
    
    // Mark this reset as completed
    const today = new Date().toISOString().split('T')[0];
    setLastResetKey(today, hour);
    
    console.log(`[DAILY RESET] ✅ Reset completed at ${timeLabel}`);
    
    // Show notification if in Electron
    if (typeof window !== 'undefined' && window.electronAPI?.showNotification) {
      window.electronAPI.showNotification(
        '🔄 Reset Automático',
        `Sistema limpo às ${hour.toString().padStart(2, '0')}:00 - pronto para nova operação`
      );
    }
  }, [
    clearMissingSongs,
    clearRanking,
    clearCapturedSongs,
    clearDownloadHistory,
    clearGradeHistory,
    clearBlockLogs,
    clearSystemErrors,
    resetQueue,
    setLastResetKey,
  ]);

  const checkAndReset = useCallback(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const today = now.toISOString().split('T')[0];
    const lastResetKey = getLastResetKey();
    
    // Check if current hour matches any reset hour
    if (RESET_HOURS.includes(currentHour)) {
      const expectedKey = `${today}-${currentHour}`;
      
      // Only reset if we haven't done this specific reset yet
      if (lastResetKey !== expectedKey) {
        performReset(currentHour);
      }
    }
  }, [getLastResetKey, performReset]);

  useEffect(() => {
    // Check immediately on mount
    checkAndReset();
    
    // Check every minute
    intervalRef.current = setInterval(checkAndReset, 60 * 1000);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [checkAndReset]);
}
