import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { withRetry, ErrorCodes, createError } from '@/lib/errorHandler';
import { useRadioStore } from '@/store/radioStore';
import { realtimeManager } from '@/lib/realtimeManager';
import { useRealtimeStatsStore } from '@/store/realtimeStatsStore';

interface LastSongByStation {
  title: string;
  artist: string;
  station: string;
  timestamp: string;
}

interface RadioStation {
  name: string;
  enabled: boolean;
}

interface RealtimeStats {
  totalSongs: number;
  songsLast24h: number;
  songsLastHour: number;
  activeStations: number;
  allStations: RadioStation[];
  lastSong: {
    title: string;
    artist: string;
    station: string;
    timestamp: string;
  } | null;
  lastSongsByStation: LastSongByStation[];
  recentSongsByStation: Record<string, LastSongByStation[]>;
  stationCounts: Record<string, number>;
  isLoading: boolean;
  lastUpdated: Date | null;
  nextRefreshIn: number;
}

const REFRESH_INTERVAL = 600; // Stats refresh every 10 minutes
const BACKGROUND_REFRESH_MULTIPLIER = 2; // Background = 20 minutes

// STABLE subscriber ID - prevents channel disconnect on tab navigation
const STATS_SUBSCRIBER_ID = 'realtime_stats_global';

export function useRealtimeStats() {
  const powerSavingMode = useRadioStore((s) => s.config.powerSavingMode ?? false);
  const isInBackgroundRef = useRef(false);
  const countdownRef = useRef<number>(REFRESH_INTERVAL);
  
  // Use persisted store for data that survives navigation
  const persistedStore = useRealtimeStatsStore();
  
  // Local loading state
  const [isLoading, setIsLoading] = useState(!persistedStore.isHydrated);
  const [nextRefreshIn, setNextRefreshIn] = useState(REFRESH_INTERVAL);
  
  // Create stats object from persisted store + local state
  const stats = useMemo<RealtimeStats>(() => ({
    totalSongs: persistedStore.totalSongs,
    songsLast24h: persistedStore.songsLast24h,
    songsLastHour: persistedStore.songsLastHour,
    activeStations: persistedStore.activeStations,
    allStations: persistedStore.allStations,
    lastSong: persistedStore.lastSong,
    lastSongsByStation: persistedStore.lastSongsByStation,
    recentSongsByStation: persistedStore.recentSongsByStation,
    stationCounts: persistedStore.stationCounts,
    isLoading,
    lastUpdated: persistedStore.lastUpdated ? new Date(persistedStore.lastUpdated) : null,
    nextRefreshIn,
  }), [persistedStore, isLoading, nextRefreshIn]);

  // Track background state
  useEffect(() => {
    const handleVisibility = () => {
      isInBackgroundRef.current = document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const getEffectiveInterval = useCallback(() => {
    if (powerSavingMode && isInBackgroundRef.current) {
      return REFRESH_INTERVAL * BACKGROUND_REFRESH_MULTIPLIER;
    }
    return REFRESH_INTERVAL;
  }, [powerSavingMode]);

  const loadStats = useCallback(async () => {
    const context = { component: 'useRealtimeStats', action: 'loadStats' };
    setIsLoading(true);
    
    try {
      await withRetry(
        async () => {
          const now = new Date();
          const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

          // Fetch data — 6 parallel queries (removed separate stationSongs query)
          const [totalResult, last24hResult, lastHourResult, stationsResult, lastSongResult, recentSongsResult] = await Promise.all([
            supabase.from('scraped_songs').select('*', { count: 'exact', head: true }),
            supabase.from('scraped_songs').select('*', { count: 'exact', head: true }).gte('scraped_at', last24h.toISOString()),
            supabase.from('scraped_songs').select('*', { count: 'exact', head: true }).gte('scraped_at', lastHour.toISOString()),
            supabase.from('radio_stations').select('name, enabled').eq('enabled', true),
            supabase.from('scraped_songs').select('title, artist, station_name, scraped_at').order('scraped_at', { ascending: false }).limit(1).single(),
            supabase.from('scraped_songs').select('title, artist, station_name, scraped_at').order('scraped_at', { ascending: false }).limit(200),
          ]);

          if (totalResult.error && totalResult.error.code !== 'PGRST116') {
            throw new Error(`Query failed: ${totalResult.error.message}`);
          }

          // Compute station counts from recentSongsResult (eliminates extra DB round-trip)
          const newStationCounts: Record<string, number> = {};
          recentSongsResult.data?.forEach(song => {
            newStationCounts[song.station_name] = (newStationCounts[song.station_name] || 0) + 1;
          });

          const newLastSongsByStation: LastSongByStation[] = [];
          const newRecentSongsByStation: Record<string, LastSongByStation[]> = {};
          const seenStations = new Set<string>();

          recentSongsResult.data?.forEach(song => {
            const stationName = song.station_name;
            const songData: LastSongByStation = {
              title: song.title,
              artist: song.artist,
              station: stationName,
              timestamp: song.scraped_at,
            };

            if (!seenStations.has(stationName)) {
              seenStations.add(stationName);
              newLastSongsByStation.push(songData);
            }

            if (!newRecentSongsByStation[stationName]) {
              newRecentSongsByStation[stationName] = [];
            }
            if (newRecentSongsByStation[stationName].length < 5) {
              newRecentSongsByStation[stationName].push(songData);
            }
          });

          const allStationsList: RadioStation[] = stationsResult.data?.map(s => ({ name: s.name, enabled: s.enabled ?? true })) || [];
          allStationsList.forEach(station => {
            if (!newRecentSongsByStation[station.name]) {
              newRecentSongsByStation[station.name] = [];
            }
          });

          // Update persisted store
          persistedStore.setStats({
            totalSongs: totalResult.count || 0,
            songsLast24h: last24hResult.count || 0,
            songsLastHour: lastHourResult.count || 0,
            activeStations: stationsResult.data?.length || 0,
            allStations: allStationsList,
            lastSong: lastSongResult.data ? {
              title: lastSongResult.data.title,
              artist: lastSongResult.data.artist,
              station: lastSongResult.data.station_name,
              timestamp: lastSongResult.data.scraped_at,
            } : null,
            lastSongsByStation: newLastSongsByStation,
            recentSongsByStation: newRecentSongsByStation,
            stationCounts: newStationCounts,
          });
          
          setIsLoading(false);
        },
        {
          maxRetries: 3,
          initialDelay: 1000,
          context,
          onRetry: (attempt) => {
            console.log(`[REALTIME-STATS] Retry attempt ${attempt}/3`);
          },
        }
      );
    } catch (error) {
      createError(
        error instanceof Error ? error.message : 'Failed to load stats',
        ErrorCodes.SUPABASE_QUERY,
        context
      );
      setIsLoading(false);
    }
  }, [persistedStore]);

  // Initial load - only if data is stale or missing
  useEffect(() => {
    const shouldLoad = !persistedStore.lastUpdated || 
      (new Date().getTime() - new Date(persistedStore.lastUpdated).getTime()) > 5 * 60 * 1000; // 5 min stale
    
    if (shouldLoad) {
      loadStats();
    } else {
      setIsLoading(false);
    }
  }, [loadStats, persistedStore.lastUpdated]);

  // Auto-refresh with power saving support
  useEffect(() => {
    let refreshTimeoutId: NodeJS.Timeout;
    let countdownIntervalId: NodeJS.Timeout;

    const scheduleNextRefresh = () => {
      const interval = getEffectiveInterval();
      countdownRef.current = interval;
      
      refreshTimeoutId = setTimeout(() => {
        loadStats();
        scheduleNextRefresh();
      }, interval * 1000);
    };

    scheduleNextRefresh();

    // Update countdown display every 40 seconds
    countdownIntervalId = setInterval(() => {
      countdownRef.current = Math.max(0, countdownRef.current - 40);
      setNextRefreshIn(countdownRef.current);
    }, 40000);

    return () => {
      clearTimeout(refreshTimeoutId);
      clearInterval(countdownIntervalId);
    };
  }, [loadStats, getEffectiveInterval, powerSavingMode]);

  // Subscribe to realtime updates via centralized manager
  useEffect(() => {
    const unsubscribe = realtimeManager.subscribe(
      'scraped_songs',
      STATS_SUBSCRIBER_ID,
      (payload) => {
        const newSong = payload.new as { title: string; artist: string; station_name: string; scraped_at: string };
        persistedStore.updateFromNewSong(newSong);
      }
    );

    return unsubscribe;
  }, [persistedStore]);

  return { stats, refresh: loadStats };
}
