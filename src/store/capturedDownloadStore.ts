/**
 * Persistent store for captured songs batch download.
 * Lives outside any view component so downloads survive navigation.
 */
import { create } from 'zustand';

export interface CapturedDownloadItem {
  id: string;
  title: string;
  artist: string;
  stationName: string;
}

interface CapturedDownloadState {
  queue: CapturedDownloadItem[];
  processed: Map<string, 'success' | 'error' | 'exists'>;
  isProcessing: boolean;
  current: number;
  total: number;
  mode: 'auto' | 'manual';

  enqueue: (songs: CapturedDownloadItem[], mode: 'auto' | 'manual') => void;
  markProcessed: (id: string, status: 'success' | 'error' | 'exists') => void;
  advance: () => void;
  finish: () => void;
  cancel: () => void;
  getStatus: (id: string) => 'idle' | 'downloading' | 'success' | 'error' | 'exists';
  clearProcessed: () => void;
}

export const useCapturedDownloadStore = create<CapturedDownloadState>((set, get) => ({
  queue: [],
  processed: new Map(),
  isProcessing: false,
  current: 0,
  total: 0,
  mode: 'manual',

  enqueue: (songs, mode) => {
    const existing = get().processed;
    // Skip already-processed songs
    const fresh = songs.filter(s => !existing.has(s.id));
    if (fresh.length === 0) return;
    set({
      queue: fresh,
      isProcessing: true,
      current: 0,
      total: fresh.length,
      mode,
    });
  },

  markProcessed: (id, status) => {
    const next = new Map(get().processed);
    next.set(id, status);
    set({ processed: next });
  },

  advance: () => set(s => ({ current: s.current + 1 })),

  finish: () => set({ isProcessing: false, queue: [] }),

  cancel: () => set({ isProcessing: false, queue: [], current: 0, total: 0 }),

  getStatus: (id) => {
    const state = get();
    const p = state.processed.get(id);
    if (p) return p;
    if (state.isProcessing && state.queue.length > 0 && state.current < state.queue.length && state.queue[state.current]?.id === id) return 'downloading';
    return 'idle';
  },

  clearProcessed: () => set({ processed: new Map() }),
}));
