import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

export interface RealtimeStats {
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

interface RealtimeStatsState {
  stats: RealtimeStats;
  setStats: (stats: Partial<RealtimeStats>) => void;
  updateFromNewSong: (newSong: { title: string; artist: string; station_name: string; scraped_at: string }) => void;
  setLoading: (isLoading: boolean) => void;
  setNextRefreshIn: (seconds: number) => void;
  resetStats: () => void;
}

const initialStats: RealtimeStats = {
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
  nextRefreshIn: 600,
};

export const useRealtimeStatsStore = create<RealtimeStatsState>()(
  persist(
    (set) => ({
      stats: initialStats,
      
      setStats: (newStats) => set((state) => ({
        stats: {
          ...state.stats,
          ...newStats,
          lastUpdated: new Date(),
        },
      })),
      
      updateFromNewSong: (newSong) => set((state) => {
        const newSongData = {
          title: newSong.title,
          artist: newSong.artist,
          station: newSong.station_name,
          timestamp: newSong.scraped_at,
        };

        const updatedLastSongsByStation = [...state.stats.lastSongsByStation];
        const existingIndex = updatedLastSongsByStation.findIndex(s => s.station === newSong.station_name);
        if (existingIndex >= 0) {
          updatedLastSongsByStation[existingIndex] = newSongData;
        } else {
          updatedLastSongsByStation.unshift(newSongData);
        }

        const updatedRecentSongsByStation = { ...state.stats.recentSongsByStation };
        const stationSongs = updatedRecentSongsByStation[newSong.station_name] || [];
        updatedRecentSongsByStation[newSong.station_name] = [newSongData, ...stationSongs].slice(0, 5);

        return {
          stats: {
            ...state.stats,
            totalSongs: state.stats.totalSongs + 1,
            songsLast24h: state.stats.songsLast24h + 1,
            songsLastHour: state.stats.songsLastHour + 1,
            lastSong: newSongData,
            lastSongsByStation: updatedLastSongsByStation,
            recentSongsByStation: updatedRecentSongsByStation,
            stationCounts: {
              ...state.stats.stationCounts,
              [newSong.station_name]: (state.stats.stationCounts[newSong.station_name] || 0) + 1,
            },
          },
        };
      }),
      
      setLoading: (isLoading) => set((state) => ({
        stats: { ...state.stats, isLoading },
      })),
      
      setNextRefreshIn: (seconds) => set((state) => ({
        stats: { ...state.stats, nextRefreshIn: seconds },
      })),
      
      resetStats: () => set({ stats: initialStats }),
    }),
    {
      name: 'realtime-stats-storage',
      partialize: (state) => ({
        stats: {
          ...state.stats,
          isLoading: false, // Don't persist loading state
        },
      }),
    }
  )
);
