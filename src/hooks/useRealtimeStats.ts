import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface RealtimeStats {
  totalSongs: number;
  songsLast24h: number;
  songsLastHour: number;
  activeStations: number;
  lastSong: {
    title: string;
    artist: string;
    station: string;
    timestamp: string;
  } | null;
  stationCounts: Record<string, number>;
  isLoading: boolean;
}

export function useRealtimeStats() {
  const [stats, setStats] = useState<RealtimeStats>({
    totalSongs: 0,
    songsLast24h: 0,
    songsLastHour: 0,
    activeStations: 0,
    lastSong: null,
    stationCounts: {},
    isLoading: true,
  });

  const loadStats = useCallback(async () => {
    try {
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

      // Parallel queries for performance
      const [totalResult, last24hResult, lastHourResult, stationsResult, lastSongResult] = await Promise.all([
        supabase.from('scraped_songs').select('*', { count: 'exact', head: true }),
        supabase.from('scraped_songs').select('*', { count: 'exact', head: true }).gte('scraped_at', last24h.toISOString()),
        supabase.from('scraped_songs').select('*', { count: 'exact', head: true }).gte('scraped_at', lastHour.toISOString()),
        supabase.from('radio_stations').select('name, enabled').eq('enabled', true),
        supabase.from('scraped_songs').select('title, artist, station_name, scraped_at').order('scraped_at', { ascending: false }).limit(1).single(),
      ]);

      // Get station counts
      const { data: stationSongs } = await supabase
        .from('scraped_songs')
        .select('station_name')
        .gte('scraped_at', last24h.toISOString());

      const stationCounts: Record<string, number> = {};
      stationSongs?.forEach(song => {
        stationCounts[song.station_name] = (stationCounts[song.station_name] || 0) + 1;
      });

      setStats({
        totalSongs: totalResult.count || 0,
        songsLast24h: last24hResult.count || 0,
        songsLastHour: lastHourResult.count || 0,
        activeStations: stationsResult.data?.length || 0,
        lastSong: lastSongResult.data ? {
          title: lastSongResult.data.title,
          artist: lastSongResult.data.artist,
          station: lastSongResult.data.station_name,
          timestamp: lastSongResult.data.scraped_at,
        } : null,
        stationCounts,
        isLoading: false,
      });
    } catch (error) {
      console.error('Error loading realtime stats:', error);
      setStats(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, [loadStats]);

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('stats_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scraped_songs' },
        (payload) => {
          const newSong = payload.new as { title: string; artist: string; station_name: string; scraped_at: string };
          
          setStats(prev => ({
            ...prev,
            totalSongs: prev.totalSongs + 1,
            songsLast24h: prev.songsLast24h + 1,
            songsLastHour: prev.songsLastHour + 1,
            lastSong: {
              title: newSong.title,
              artist: newSong.artist,
              station: newSong.station_name,
              timestamp: newSong.scraped_at,
            },
            stationCounts: {
              ...prev.stationCounts,
              [newSong.station_name]: (prev.stationCounts[newSong.station_name] || 0) + 1,
            },
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { stats, refresh: loadStats };
}
