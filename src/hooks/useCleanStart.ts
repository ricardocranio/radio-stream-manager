import { useEffect, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { useGradeLogStore } from '@/store/gradeLogStore';
import { useRealtimeStatsStore } from '@/store/realtimeStatsStore';

/**
 * Hook that performs a clean start when the app launches
 * Clears: missing songs, ranking, captured songs cache, download history, grade history
 * Only runs ONCE per app launch (uses sessionStorage to track)
 */
export function useCleanStart() {
  const hasRun = useRef(false);
  
  const {
    clearMissingSongs,
    clearRanking,
    clearCapturedSongs,
    clearDownloadHistory,
    clearGradeHistory,
  } = useRadioStore();
  
  const { clearBlockLogs, clearSystemErrors } = useGradeLogStore();
  const { resetStats } = useRealtimeStatsStore();

  useEffect(() => {
    // Only run once per app session
    const cleanStartKey = 'pgm-clean-start-v1';
    const hasCleanedThisSession = sessionStorage.getItem(cleanStartKey);
    
    if (hasCleanedThisSession || hasRun.current) {
      return;
    }
    
    hasRun.current = true;
    sessionStorage.setItem(cleanStartKey, 'true');
    
    console.log('[CLEAN START] 🧹 Performing clean start...');
    
    // Clear missing songs
    clearMissingSongs();
    
    // Clear ranking
    clearRanking();
    
    // Clear captured songs (local cache)
    clearCapturedSongs();
    
    // Clear download history
    clearDownloadHistory();
    
    // Clear grade history
    clearGradeHistory();
    
    // Clear logs
    clearBlockLogs();
    clearSystemErrors();
    
    // Reset realtime stats
    resetStats();
    
    console.log('[CLEAN START] ✅ Clean start completed');
  }, [
    clearMissingSongs,
    clearRanking,
    clearCapturedSongs,
    clearDownloadHistory,
    clearGradeHistory,
    clearBlockLogs,
    clearSystemErrors,
    resetStats,
  ]);
}
