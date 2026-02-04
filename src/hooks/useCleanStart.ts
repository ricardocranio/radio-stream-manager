import { useEffect, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { useGradeLogStore } from '@/store/gradeLogStore';
import { useRealtimeStatsStore } from '@/store/realtimeStatsStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { supabase } from '@/integrations/supabase/client';
import { invalidateMusicLibraryCache } from '@/hooks/useMusicLibraryStats';

// Key for first-ever launch detection (persists across sessions)
const FIRST_LAUNCH_KEY = 'pgm-first-launch-completed';
// Key for per-session clean start
const CLEAN_START_KEY = 'pgm-clean-start-v1';

/**
 * Hook that performs a clean start when the app launches
 * 
 * On FIRST EVER launch: clears Supabase scraped_songs table
 * On EVERY launch: clears local state (missing songs, ranking, captured songs, 
 * download history, grade history, realtime stats, logs)
 * 
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
  const resetRealtimeStats = useRealtimeStatsStore(state => state.reset);
  const resetDownloadQueue = useAutoDownloadStore(state => state.resetQueue);

  useEffect(() => {
    // Only run once per app session
    const hasCleanedThisSession = sessionStorage.getItem(CLEAN_START_KEY);
    
    if (hasCleanedThisSession || hasRun.current) {
      return;
    }
    
    hasRun.current = true;
    sessionStorage.setItem(CLEAN_START_KEY, 'true');
    
    const performCleanStart = async () => {
      console.log('[CLEAN START] 🧹 Performing clean start...');
      
      // Check if this is the first-ever launch
      const isFirstLaunch = !localStorage.getItem(FIRST_LAUNCH_KEY);
      
      if (isFirstLaunch) {
        console.log('[CLEAN START] 🆕 First launch detected - clearing Supabase data...');
        
        // Clear scraped_songs from Supabase on first launch
        try {
          const { error } = await supabase
            .from('scraped_songs')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
          
          if (error) {
            console.error('[CLEAN START] Failed to clear Supabase:', error);
          } else {
            console.log('[CLEAN START] ✅ Supabase scraped_songs cleared');
          }
        } catch (err) {
          console.error('[CLEAN START] Error clearing Supabase:', err);
        }
        
        // Mark first launch as completed
        localStorage.setItem(FIRST_LAUNCH_KEY, new Date().toISOString());
      }
      
      // Clear all local state (every launch)
      clearMissingSongs();
      clearRanking();
      clearCapturedSongs();
      clearDownloadHistory();
      clearGradeHistory();
      clearBlockLogs();
      clearSystemErrors();
      
      // Reset realtime stats (24h, 1h counts, etc.)
      resetRealtimeStats();
      
      // Reset download queue
      resetDownloadQueue();
      
      // Invalidate music library cache to force fresh read
      invalidateMusicLibraryCache();
      
      console.log('[CLEAN START] ✅ Clean start completed');
    };
    
    performCleanStart();
  }, [
    clearMissingSongs,
    clearRanking,
    clearCapturedSongs,
    clearDownloadHistory,
    clearGradeHistory,
    clearBlockLogs,
    clearSystemErrors,
    resetRealtimeStats,
    resetDownloadQueue,
  ]);
}
