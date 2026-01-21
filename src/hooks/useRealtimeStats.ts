import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { withRetry, ErrorCodes, createError } from '@/lib/errorHandler';
import { debounce } from '@/lib/errorHandler';
import { useRadioStore } from '@/store/radioStore';

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
  nextRefreshIn: number; // seconds until next auto-refresh
}

const REFRESH_INTERVAL = 30; // seconds
const BACKGROUND_REFRESH_MULTIPLIER = 3; // 3x slower when in background

// Singleton channel to avoid duplicate subscriptions
let globalChannel: ReturnType<typeof supabase.channel> | null = null;
let subscriberCount = 0;

export function useRealtimeStats() {
  // Get power saving mode from store
  const powerSavingMode = useRadioStore((s) => s.config.powerSavingMode ?? false);
  const isInBackgroundRef = useRef(false);
  
  const [stats, setStats] = useState<RealtimeStats>({
    totalSongs: 0,
    songsLast24h: 0,
    songsLastHour: 0,
    activeStations: 0,
    allStations: [],
    lastSong: null,
    lastSongsByStation: [],
    recentSongsByStation: {},
    stationCounts: {},
    isLoading: true,
    lastUpdated: null,
    nextRefreshIn: REFRESH_INTERVAL,
  });
  
  // Use refs for countdown to avoid re-renders
  const countdownRef = useRef<number>(REFRESH_INTERVAL);
  const countdownDisplayRef = useRef<number>(REFRESH_INTERVAL);

  // Track background state
  useEffect(() => {
    const handleVisibility = () => {
      isInBackgroundRef.current = document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Get effective refresh interval based on power saving mode
  const getEffectiveInterval = useCallback(() => {
    if (powerSavingMode && isInBackgroundRef.current) {
      return REFRESH_INTERVAL * BACKGROUND_REFRESH_MULTIPLIER;
    }
    return REFRESH_INTERVAL;
  }, [powerSavingMode]);

  const loadStats = useCallback(async () => {
    const context = { component: 'useRealtimeStats', action: 'loadStats' };
    
    try {
      await withRetry(
        async () => {
          const now = new Date();
          const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

          // Parallel queries for performance
          const [totalResult, last24hResult, lastHourResult, stationsResult, lastSongResult, recentSongsResult] = await Promise.all([
            supabase.from('scraped_songs').select('*', { count: 'exact', head: true }),
            supabase.from('scraped_songs').select('*', { count: 'exact', head: true }).gte('scraped_at', last24h.toISOString()),
            supabase.from('scraped_songs').select('*', { count: 'exact', head: true }).gte('scraped_at', lastHour.toISOString()),
            supabase.from('radio_stations').select('name, enabled').eq('enabled', true),
            supabase.from('scraped_songs').select('title, artist, station_name, scraped_at').order('scraped_at', { ascending: false }).limit(1).single(),
            supabase.from('scraped_songs').select('title, artist, station_name, scraped_at').order('scraped_at', { ascending: false }).limit(100),
          ]);

          // Check for critical errors
          if (totalResult.error && totalResult.error.code !== 'PGRST116') {
            throw new Error(`Query failed: ${totalResult.error.message}`);
          }

          // Get station counts
          const { data: stationSongs } = await supabase
            .from('scraped_songs')
            .select('station_name')
            .gte('scraped_at', last24h.toISOString());

          const stationCounts: Record<string, number> = {};
          stationSongs?.forEach(song => {
            stationCounts[song.station_name] = (stationCounts[song.station_name] || 0) + 1;
          });

          // Process recent songs to get last song per station and recent songs by station
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

          const allStationsList: RadioStation[] = stationsResult.data?.map(s => ({ name: s.name, enabled: s.enabled ?? true })) || [];
          allStationsList.forEach(station => {
            if (!recentSongsByStation[station.name]) {
              recentSongsByStation[station.name] = [];
            }
          });

          setStats(prev => ({
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
            lastUpdated: new Date(),
            nextRefreshIn: prev.nextRefreshIn,
          }));
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
      setStats(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Auto-refresh with power saving support
  useEffect(() => {
    let refreshIntervalId: NodeJS.Timeout;
    let countdownIntervalId: NodeJS.Timeout;
    let currentInterval = REFRESH_INTERVAL;

    const runRefresh = () => {
      // Always refresh, but less frequently if in background with power saving
      loadStats();
      currentInterval = getEffectiveInterval();
      countdownRef.current = currentInterval;
      countdownDisplayRef.current = currentInterval;
    };

    const setupIntervals = () => {
      currentInterval = getEffectiveInterval();
      countdownRef.current = currentInterval;
      
      // Use dynamic interval that checks conditions on each tick
      const scheduleNextRefresh = () => {
        refreshIntervalId = setTimeout(() => {
          runRefresh();
          scheduleNextRefresh(); // Re-schedule with potentially new interval
        }, getEffectiveInterval() * 1000);
      };
      
      scheduleNextRefresh();

      // Update countdown display every 5 seconds
      countdownIntervalId = setInterval(() => {
        countdownRef.current = Math.max(0, countdownRef.current - 5);
        countdownDisplayRef.current = countdownRef.current;
        setStats(prev => {
          if (prev.nextRefreshIn === countdownRef.current) return prev;
          return { ...prev, nextRefreshIn: countdownRef.current };
        });
      }, 5000);
    };

    setupIntervals();

    return () => {
      clearTimeout(refreshIntervalId);
      clearInterval(countdownIntervalId);
    };
  }, [loadStats, getEffectiveInterval, powerSavingMode]);

  // Subscribe to realtime updates with error handling
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 3;
    let isCleanedUp = false;
    let currentChannel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimeoutId: NodeJS.Timeout | null = null;
    
    const setupChannel = () => {
      if (isCleanedUp) return;
      
      // Remove any existing channel first
      if (currentChannel) {
        try {
          supabase.removeChannel(currentChannel);
        } catch (e) {
          // Ignore removal errors
        }
        currentChannel = null;
      }
      
      console.log('[REALTIME] Setting up channel...');
      
      currentChannel = supabase
        .channel(`stats_realtime_${Date.now()}`) // Unique channel name
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'scraped_songs' },
          (payload) => {
            if (isCleanedUp) return;
            console.log('[REALTIME] New song received:', payload.new);
            const newSong = payload.new as { title: string; artist: string; station_name: string; scraped_at: string };
            
            setStats(prev => {
              const newSongData = {
                title: newSong.title,
                artist: newSong.artist,
                station: newSong.station_name,
                timestamp: newSong.scraped_at,
              };

              // Update lastSongsByStation
              const updatedLastSongsByStation = [...prev.lastSongsByStation];
              const existingIndex = updatedLastSongsByStation.findIndex(s => s.station === newSong.station_name);
              if (existingIndex >= 0) {
                updatedLastSongsByStation[existingIndex] = newSongData;
              } else {
                updatedLastSongsByStation.unshift(newSongData);
              }

              // Update recentSongsByStation
              const updatedRecentSongsByStation = { ...prev.recentSongsByStation };
              const stationSongs = updatedRecentSongsByStation[newSong.station_name] || [];
              updatedRecentSongsByStation[newSong.station_name] = [newSongData, ...stationSongs].slice(0, 5);

              return {
                ...prev,
                totalSongs: prev.totalSongs + 1,
                songsLast24h: prev.songsLast24h + 1,
                songsLastHour: prev.songsLastHour + 1,
                lastSong: newSongData,
                lastSongsByStation: updatedLastSongsByStation,
                recentSongsByStation: updatedRecentSongsByStation,
                stationCounts: {
                  ...prev.stationCounts,
                  [newSong.station_name]: (prev.stationCounts[newSong.station_name] || 0) + 1,
                },
              };
            });
          }
        )
        .subscribe((status) => {
          if (isCleanedUp) return;
          console.log('[REALTIME] Subscription status:', status);
          
          if (status === 'CHANNEL_ERROR') {
            console.error('[REALTIME] Channel error, scheduling retry...');
            if (retryCount < maxRetries && !isCleanedUp) {
              retryCount++;
              // Clear any existing retry timeout
              if (retryTimeoutId) clearTimeout(retryTimeoutId);
              retryTimeoutId = setTimeout(() => {
                if (!isCleanedUp) {
                  setupChannel();
                }
              }, 2000 * retryCount);
            } else {
              console.error('[REALTIME] Max retries reached, falling back to polling');
              loadStats();
            }
          } else if (status === 'SUBSCRIBED') {
            console.log('[REALTIME] ✓ Successfully subscribed to updates');
            retryCount = 0;
          }
        });
    };

    setupChannel();

    return () => {
      isCleanedUp = true;
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
      if (currentChannel) {
        try {
          supabase.removeChannel(currentChannel);
        } catch (e) {
          // Ignore removal errors on cleanup
        }
      }
    };
  }, [loadStats]);

  return { stats, refresh: loadStats };
}
