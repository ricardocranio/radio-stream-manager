import { create } from 'zustand';

interface CapturedDownloadState {
  queueLength: number;
  isProcessing: boolean;
  processedCount: number;
  errorCount: number;
  existsCount: number;
  setQueueLength: (length: number) => void;
  setIsProcessing: (processing: boolean) => void;
  incrementProcessed: () => void;
  incrementError: () => void;
  incrementExists: () => void;
  resetStats: () => void;
}

export const useCapturedDownloadStore = create<CapturedDownloadState>((set) => ({
  queueLength: 0,
  isProcessing: false,
  processedCount: 0,
  errorCount: 0,
  existsCount: 0,
  setQueueLength: (length) => set({ queueLength: length }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  incrementProcessed: () => set((s) => ({ processedCount: s.processedCount + 1 })),
  incrementError: () => set((s) => ({ errorCount: s.errorCount + 1 })),
  incrementExists: () => set((s) => ({ existsCount: s.existsCount + 1 })),
  resetStats: () => set({ queueLength: 0, isProcessing: false, processedCount: 0, errorCount: 0, existsCount: 0 }),
}));
