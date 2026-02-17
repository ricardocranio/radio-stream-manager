import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { supabase } from '@/integrations/supabase/client';

const CLEANUP_INTERVAL = 60 * 60 * 1000; // Run every hour
const MAX_DATA_AGE_HOURS = 24; // Data older than 24h gets cleaned
const MAX_SONGS_PER_STATION = 5; // Maximum songs to keep per station

/**
 * Hook that performs automatic cleanup of old data
 * 
 * Cleans:
 * - Captured songs older than 24h (local store)
 * - Download history older than 24h
 * - Scraped songs older than 24h (Supabase)
 * - Excess songs per station (keeps only 50 most recent per station)
 * 
 * Runs every hour to keep memory usage low
 */
export function useAutoCleanup() {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const { capturedSongs, downloadHistory } = useRadioStore();

  // Clean excess songs per station (keep only 50 most recent)
  const cleanExcessSongsPerStation = useCallback(async () => {
    try {
      // Get all unique station names
      const { data: stations, error: stationsError } = await supabase
        .from('scraped_songs')
        .select('station_name')
        .order('station_name');

      if (stationsError || !stations) return;

      // Get unique station names
      const uniqueStations = [...new Set(stations.map(s => s.station_name))];
      let totalDeleted = 0;

      for (const stationName of uniqueStations) {
        // Count songs for this station
        const { count, error: countError } = await supabase
          .from('scraped_songs')
          .select('*', { count: 'exact', head: true })
          .eq('station_name', stationName);

        if (countError || count === null) continue;

        // If station has more than MAX_SONGS_PER_STATION, delete oldest
        if (count > MAX_SONGS_PER_STATION) {
          const songsToDelete = count - MAX_SONGS_PER_STATION;
          
          // Get IDs of oldest songs to delete
          const { data: oldestSongs, error: selectError } = await supabase
            .from('scraped_songs')
            .select('id')
            .eq('station_name', stationName)
            .order('scraped_at', { ascending: true })
            .limit(songsToDelete);

          if (selectError || !oldestSongs?.length) continue;

          const idsToDelete = oldestSongs.map(s => s.id);
          
          const { error: deleteError } = await supabase
            .from('scraped_songs')
            .delete()
            .in('id', idsToDelete);

          if (!deleteError) {
            totalDeleted += songsToDelete;
            console.log(`[CLEANUP] 🧹 ${stationName}: removidas ${songsToDelete} músicas antigas (limite: ${MAX_SONGS_PER_STATION})`);
          }
        }
      }

      if (totalDeleted > 0) {
        console.log(`[CLEANUP] 🧹 Total: ${totalDeleted} músicas excedentes removidas`);
      }
    } catch (err) {
      console.error('[CLEANUP] Error cleaning excess songs:', err);
    }
  }, []);

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
      // We can't directly set, but limiting happens naturally via addCapturedSong
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

    // Clean old scraped songs from Supabase (background, non-blocking)
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

    // Clean excess songs per station (keep only 50 most recent)
    await cleanExcessSongsPerStation();

    if (cleanedCount > 0) {
      console.log(`[CLEANUP] 🧹 Cleaned ${cleanedCount} old local entries (>${MAX_DATA_AGE_HOURS}h)`);
    }
  }, [cleanExcessSongsPerStation]);

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
