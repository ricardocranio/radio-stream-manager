import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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

interface RealtimeStatsState {
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
  lastUpdated: string | null;
  isHydrated: boolean;
}

interface RealtimeStatsActions {
  setStats: (stats: Partial<Omit<RealtimeStatsState, 'isHydrated'>>) => void;
  updateFromNewSong: (song: { title: string; artist: string; station_name: string; scraped_at: string }) => void;
  setHydrated: (hydrated: boolean) => void;
  reset: () => void;
  resetCountsOnly: () => void; // Resets counts but preserves song data
}

const initialState: Omit<RealtimeStatsState, 'isHydrated'> = {
  totalSongs: 0,
  songsLast24h: 0,
  songsLastHour: 0,
  activeStations: 0,
  allStations: [],
  lastSong: null,
  lastSongsByStation: [],
  recentSongsByStation: {},
  stationCounts: {},
  lastUpdated: null,
};

export const useRealtimeStatsStore = create<RealtimeStatsState & RealtimeStatsActions>()(
  persist(
    (set, get) => ({
      ...initialState,
      isHydrated: false,

      setStats: (stats) => {
        set({
          ...stats,
          lastUpdated: new Date().toISOString(),
        });
      },

      updateFromNewSong: (newSong) => {
        const state = get();
        const newSongData = {
          title: newSong.title,
          artist: newSong.artist,
          station: newSong.station_name,
          timestamp: newSong.scraped_at,
        };

        // Update lastSongsByStation
        const updatedLastSongsByStation = [...state.lastSongsByStation];
        const existingIndex = updatedLastSongsByStation.findIndex(s => s.station === newSong.station_name);
        if (existingIndex >= 0) {
          updatedLastSongsByStation[existingIndex] = newSongData;
        } else {
          updatedLastSongsByStation.unshift(newSongData);
        }

        // Update recentSongsByStation
        const updatedRecentSongsByStation = { ...state.recentSongsByStation };
        const stationSongs = updatedRecentSongsByStation[newSong.station_name] || [];
        updatedRecentSongsByStation[newSong.station_name] = [newSongData, ...stationSongs].slice(0, 5);

        set({
          totalSongs: state.totalSongs + 1,
          songsLast24h: state.songsLast24h + 1,
          songsLastHour: state.songsLastHour + 1,
          lastSong: newSongData,
          lastSongsByStation: updatedLastSongsByStation,
          recentSongsByStation: updatedRecentSongsByStation,
          stationCounts: {
            ...state.stationCounts,
            [newSong.station_name]: (state.stationCounts[newSong.station_name] || 0) + 1,
          },
          lastUpdated: new Date().toISOString(),
        });
      },

      setHydrated: (hydrated) => set({ isHydrated: hydrated }),

      reset: () => set({ ...initialState, isHydrated: true }),

      // Reset counts only - preserves lastSongsByStation and recentSongsByStation
      resetCountsOnly: () => {
        const state = get();
        set({
          totalSongs: 0,
          songsLast24h: 0,
          songsLastHour: 0,
          activeStations: state.activeStations,
          allStations: state.allStations,
          lastSong: state.lastSong,
          lastSongsByStation: state.lastSongsByStation,
          recentSongsByStation: state.recentSongsByStation,
          stationCounts: {},
          lastUpdated: new Date().toISOString(),
          isHydrated: true,
        });
      },
    }),
    {
      name: 'realtime-stats-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        totalSongs: state.totalSongs,
        songsLast24h: state.songsLast24h,
        songsLastHour: state.songsLastHour,
        activeStations: state.activeStations,
        allStations: state.allStations,
        lastSong: state.lastSong,
        lastSongsByStation: state.lastSongsByStation,
        recentSongsByStation: state.recentSongsByStation,
        stationCounts: state.stationCounts,
        lastUpdated: state.lastUpdated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated(true);
        }
      },
    }
  )
);
