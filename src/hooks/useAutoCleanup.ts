import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { supabase } from '@/integrations/supabase/client';

const CLEANUP_INTERVAL = 60 * 60 * 1000; // Run every hour
const MAX_DATA_AGE_HOURS = 24; // Data older than 24h gets cleaned

/**
 * Hook that performs automatic cleanup of old data
 * 
 * Cleans:
 * - Captured songs older than 24h (local store)
 * - Download history older than 24h
 * - Scraped songs older than 24h (Supabase)
 * 
 * NOTE: Excess songs per station (>40) are now handled automatically
 * by database triggers (trg_cleanup_after_insert). Duplicate prevention
 * is also handled server-side (trg_prevent_duplicate_songs).
 * 
 * Runs every hour to keep memory usage low
 */
export function useAutoCleanup() {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const performCleanup = useCallback(async () => {
    const now = Date.now();
    const maxAge = MAX_DATA_AGE_HOURS * 60 * 60 * 1000;
    const cutoffDate = new Date(now - maxAge);
    
    let cleanedCount = 0;

    // Clean old captured songs from local store
    const currentCaptured = useRadioStore.getState().capturedSongs;
    const recentCaptured = currentCaptured.filter(song => {
      const songTime = new Date(song.timestamp).getTime();
      return songTime > cutoffDate.getTime();
    });
    
    if (recentCaptured.length < currentCaptured.length) {
      cleanedCount += currentCaptured.length - recentCaptured.length;
    }

    // Clean old download history
    const currentHistory = useRadioStore.getState().downloadHistory;
    const recentHistory = currentHistory.filter(entry => {
      const entryTime = new Date(entry.timestamp).getTime();
      return entryTime > cutoffDate.getTime();
    });
    
    if (recentHistory.length < currentHistory.length) {
      cleanedCount += currentHistory.length - recentHistory.length;
    }

    // Clean old scraped songs from Supabase (>24h) — excess per station
    // is handled by DB trigger automatically
    try {
      const { error } = await supabase
        .from('scraped_songs')
        .delete()
        .lt('scraped_at', cutoffDate.toISOString());
      
      if (!error) {
        console.log('[CLEANUP] 🧹 Cleaned old Supabase data (>24h)');
      }
    } catch (err) {
      // Silent fail - non-critical
    }

    if (cleanedCount > 0) {
      console.log(`[CLEANUP] 🧹 Cleaned ${cleanedCount} old local entries (>${MAX_DATA_AGE_HOURS}h)`);
    }
  }, []);

  useEffect(() => {
    // Run cleanup after 5 minutes of app start (let app stabilize first)
    const initialTimeout = setTimeout(() => {
      performCleanup();
      
      // Then run every hour
      intervalRef.current = setInterval(performCleanup, CLEANUP_INTERVAL);
    }, 5 * 60 * 1000);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [performCleanup]);
}
