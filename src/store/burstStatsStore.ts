/**
 * Pre-Download Burst Statistics Store
 * Tracks the results of each burst phase for dashboard visibility.
 */
import { create } from 'zustand';

export interface BurstEvent {
  id: string;
  timestamp: Date;
  blockTime: string;
  candidates: number;
  downloaded: number;
  failed: number;
  timedOut: number;
  blocked: number;
  durationMs: number;
  details: BurstDetail[];
}

export interface BurstDetail {
  artist: string;
  title: string;
  station: string;
  status: 'downloaded' | 'failed' | 'timeout' | 'blocked';
  reason?: string;
}

interface BurstStatsState {
  events: BurstEvent[];
  addEvent: (event: Omit<BurstEvent, 'id' | 'timestamp'>) => void;
  clearEvents: () => void;
  getLastEvent: () => BurstEvent | null;
}

export const useBurstStatsStore = create<BurstStatsState>()((set, get) => ({
  events: [],
  addEvent: (event) =>
    set((state) => ({
      events: [
        { ...event, id: crypto.randomUUID(), timestamp: new Date() },
        ...state.events,
      ].slice(0, 50), // Keep last 50
    })),
  clearEvents: () => set({ events: [] }),
  getLastEvent: () => get().events[0] ?? null,
}));
