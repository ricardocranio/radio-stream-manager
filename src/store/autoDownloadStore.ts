import { create } from 'zustand';

interface ActiveDownload {
  artist: string;
  title: string;
  startedAt: number; // timestamp
}

interface AutoDownloadState {
  queueLength: number;
  isProcessing: boolean;
  resetCounter: number;
  activeDownload: ActiveDownload | null;
  arlValid: boolean;
  arlLastCheck: number | null;
  setQueueLength: (length: number) => void;
  setIsProcessing: (processing: boolean) => void;
  setActiveDownload: (download: ActiveDownload | null) => void;
  setArlStatus: (valid: boolean) => void;
  resetQueue: () => void;
}

export const useAutoDownloadStore = create<AutoDownloadState>((set) => ({
  queueLength: 0,
  isProcessing: false,
  resetCounter: 0,
  activeDownload: null,
  arlValid: true,
  arlLastCheck: null,
  setQueueLength: (length) => set({ queueLength: length }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setActiveDownload: (download) => set({ activeDownload: download }),
  setArlStatus: (valid) => set({ arlValid: valid, arlLastCheck: Date.now() }),
  resetQueue: () => set((state) => ({ 
    queueLength: 0, 
    isProcessing: false,
    activeDownload: null,
    resetCounter: state.resetCounter + 1,
  })),
}));
