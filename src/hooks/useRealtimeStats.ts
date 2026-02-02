import { useEffect, useCallback, useRef, useId } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { withRetry, ErrorCodes, createError } from '@/lib/errorHandler';
import { useRadioStore } from '@/store/radioStore';
import { useRealtimeStatsStore } from '@/store/realtimeStatsStore';
import { realtimeManager } from '@/lib/realtimeManager';

// Default intervals (can be overridden by config)
const DEFAULT_REFRESH_INTERVAL = 600; // 10 minutes
const BACKGROUND_REFRESH_MULTIPLIER = 2; // Background = 2x slower
const STALE_THRESHOLD_MS = 120000; // 2 minutes

export function useRealtimeStats() {
  const config = useRadioStore((s) => s.config);
  const powerSavingMode = config.powerSavingMode ?? false;
  
  // Use configurable interval from config
  const baseRefreshInterval = (config.dashboardRefreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL);
  
  const isInBackgroundRef = useRef(false);
  const subscriberId = useId();
  const hasInitialLoadRef = useRef(false);
  
  // Use global store instead of local state
  const { stats, setStats, updateFromNewSong, setLoading, setNextRefreshIn } = useRealtimeStatsStore();
  
  const countdownRef = useRef<number>(baseRefreshInterval);

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
      return baseRefreshInterval * BACKGROUND_REFRESH_MULTIPLIER;
    }
    return baseRefreshInterval;
  }, [powerSavingMode, baseRefreshInterval]);

  const loadStats = useCallback(async () => {
    const context = { component: 'useRealtimeStats', action: 'loadStats' };
    
    try {
      await withRetry(
        async () => {
          const now = new Date();
          const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

          const [totalResult, last24hResult, lastHourResult, stationsResult, lastSongResult, recentSongsResult] = await Promise.all([
            supabase.from('scraped_songs').select('*', { count: 'exact', head: true }),
            supabase.from('scraped_songs').select('*', { count: 'exact', head: true }).gte('scraped_at', last24h.toISOString()),
            supabase.from('scraped_songs').select('*', { count: 'exact', head: true }).gte('scraped_at', lastHour.toISOString()),
            supabase.from('radio_stations').select('name, enabled').eq('enabled', true),
            supabase.from('scraped_songs').select('title, artist, station_name, scraped_at').order('scraped_at', { ascending: false }).limit(1).single(),
            supabase.from('scraped_songs').select('title, artist, station_name, scraped_at').order('scraped_at', { ascending: false }).limit(100),
          ]);

          if (totalResult.error && totalResult.error.code !== 'PGRST116') {
            throw new Error(`Query failed: ${totalResult.error.message}`);
          }

          const { data: stationSongs } = await supabase
            .from('scraped_songs')
            .select('station_name')
            .gte('scraped_at', last24h.toISOString());

          const stationCounts: Record<string, number> = {};
          stationSongs?.forEach(song => {
            stationCounts[song.station_name] = (stationCounts[song.station_name] || 0) + 1;
          });

          interface LastSongByStation {
            title: string;
            artist: string;
            station: string;
            timestamp: string;
          }

          const lastSongsByStation: LastSongByStation[] = [];
          const recentSongsByStation: Record<string, LastSongByStation[]> = {};
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
              lastSongsByStation.push(songData);
            }

            if (!recentSongsByStation[stationName]) {
              recentSongsByStation[stationName] = [];
            }
            if (recentSongsByStation[stationName].length < 5) {
              recentSongsByStation[stationName].push(songData);
            }
          });

          interface RadioStation {
            name: string;
            enabled: boolean;
          }

          const allStationsList: RadioStation[] = stationsResult.data?.map(s => ({ name: s.name, enabled: s.enabled ?? true })) || [];
          allStationsList.forEach(station => {
            if (!recentSongsByStation[station.name]) {
              recentSongsByStation[station.name] = [];
            }
          });

          setStats({
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
            lastSongsByStation,
            recentSongsByStation,
            stationCounts,
            isLoading: false,
          });
          
          hasInitialLoadRef.current = true;
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
      setLoading(false);
    }
  }, [setStats, setLoading]);

  // Initial load - only if data is truly stale or not hydrated
  useEffect(() => {
    // Wait for hydration
    if (!stats.isHydrated) {
      return;
    }
    
    // Calculate staleness based on lastUpdated string
    const lastUpdatedTime = stats.lastUpdated ? new Date(stats.lastUpdated).getTime() : 0;
    const timeSinceUpdate = Date.now() - lastUpdatedTime;
    
    const shouldRefresh = 
      !hasInitialLoadRef.current && (
        stats.isLoading || 
        !stats.lastUpdated || 
        timeSinceUpdate > STALE_THRESHOLD_MS
      );
    
    if (shouldRefresh) {
      console.log('[REALTIME-STATS] Initial load triggered, stale:', timeSinceUpdate, 'ms');
      loadStats();
    } else {
      console.log('[REALTIME-STATS] Using cached data from:', stats.lastUpdated);
      hasInitialLoadRef.current = true;
    }
  }, [loadStats, stats.isLoading, stats.lastUpdated, stats.isHydrated]);

  // Auto-refresh with power saving support
  useEffect(() => {
    if (!stats.isHydrated) return;
    
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
  }, [loadStats, getEffectiveInterval, powerSavingMode, setNextRefreshIn, stats.isHydrated]);

  // Subscribe to realtime updates via centralized manager
  useEffect(() => {
    if (!stats.isHydrated) return;
    
    const unsubscribe = realtimeManager.subscribe(
      'scraped_songs',
      `stats_${subscriberId}`,
      (payload) => {
        const newSong = payload.new as { title: string; artist: string; station_name: string; scraped_at: string };
        updateFromNewSong(newSong);
      }
    );

    return unsubscribe;
  }, [subscriberId, updateFromNewSong, stats.isHydrated]);

  return { stats, refresh: loadStats };
}
