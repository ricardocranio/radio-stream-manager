import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { useGradeLogStore } from '@/store/gradeLogStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useRealtimeStatsStore } from '@/store/realtimeStatsStore';

const RESET_HOUR = 20; // 20:00
const RESET_STORAGE_KEY = 'pgm-last-daily-reset';

/**
 * Hook that performs automatic daily reset at 20:00
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
  const { resetStats } = useRealtimeStatsStore();

  const getLastResetDate = useCallback((): string | null => {
    return localStorage.getItem(RESET_STORAGE_KEY);
  }, []);

  const setLastResetDate = useCallback((date: string) => {
    localStorage.setItem(RESET_STORAGE_KEY, date);
  }, []);

  const performReset = useCallback(() => {
    console.log('[DAILY RESET] 🧹 Performing daily reset at 20:00...');
    
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
    
    // Reset realtime stats
    resetStats();
    
    // Mark today as reset
    const today = new Date().toISOString().split('T')[0];
    setLastResetDate(today);
    
    console.log('[DAILY RESET] ✅ Daily reset completed');
    
    // Show notification if in Electron
    if (typeof window !== 'undefined' && window.electronAPI?.showNotification) {
      window.electronAPI.showNotification(
        '🔄 Reset Diário',
        'Contagens e estatísticas foram resetadas às 20:00'
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
    resetStats,
    setLastResetDate,
  ]);

  const checkAndReset = useCallback(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const today = now.toISOString().split('T')[0];
    const lastReset = getLastResetDate();
    
    // Check if it's 20:00 and we haven't reset today
    if (currentHour === RESET_HOUR && lastReset !== today) {
      performReset();
    }
  }, [getLastResetDate, performReset]);

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
