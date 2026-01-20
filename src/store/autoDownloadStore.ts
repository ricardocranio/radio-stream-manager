import { create } from 'zustand';

interface AutoDownloadState {
  queueLength: number;
  isProcessing: boolean;
  resetCounter: number; // Incremented on reset to signal hooks to clear their refs
  setQueueLength: (length: number) => void;
  setIsProcessing: (processing: boolean) => void;
  resetQueue: () => void;
}

export const useAutoDownloadStore = create<AutoDownloadState>((set) => ({
  queueLength: 0,
  isProcessing: false,
  resetCounter: 0,
  setQueueLength: (length) => set({ queueLength: length }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  resetQueue: () => set((state) => ({ 
    queueLength: 0, 
    isProcessing: false,
    resetCounter: state.resetCounter + 1, // Increment to signal reset
  })),
}));
