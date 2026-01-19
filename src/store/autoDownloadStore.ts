import { create } from 'zustand';

interface AutoDownloadState {
  queueLength: number;
  isProcessing: boolean;
  setQueueLength: (length: number) => void;
  setIsProcessing: (processing: boolean) => void;
  resetQueue: () => void;
}

export const useAutoDownloadStore = create<AutoDownloadState>((set) => ({
  queueLength: 0,
  isProcessing: false,
  setQueueLength: (length) => set({ queueLength: length }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  resetQueue: () => set({ queueLength: 0, isProcessing: false }),
}));
