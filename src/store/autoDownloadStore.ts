import { create } from 'zustand';

interface ActiveDownload {
  artist: string;
  title: string;
  startedAt: number; // timestamp
}

interface DownloadDailyStats {
  date: string; // YYYY-MM-DD
  downloaded: number;
  failed: number;
  skipped: number;
}

interface AutoDownloadState {
  queueLength: number;
  isProcessing: boolean;
  resetCounter: number;
  activeDownload: ActiveDownload | null;
  arlValid: boolean;
  arlLastCheck: number | null;
  vozBrasilFailed: boolean;
  vozBrasilLastError: string | null;
  vozBrasilDownloading: boolean;
  vozBrasilProgress: number; // 0-100
  dailyStats: DownloadDailyStats;
  tempRetryCount: number;
  setQueueLength: (length: number) => void;
  setIsProcessing: (processing: boolean) => void;
  setActiveDownload: (download: ActiveDownload | null) => void;
  setArlStatus: (valid: boolean) => void;
  setVozBrasilFailed: (failed: boolean, error?: string) => void;
  setVozBrasilDownloading: (downloading: boolean) => void;
  setVozBrasilProgress: (progress: number) => void;
  incrementDailyStat: (type: 'downloaded' | 'failed' | 'skipped') => void;
  setTempRetryCount: (count: number) => void;
  resetQueue: () => void;
}

const getTodayStr = () => new Date().toISOString().split('T')[0];

export const useAutoDownloadStore = create<AutoDownloadState>((set, get) => ({
  queueLength: 0,
  isProcessing: false,
  resetCounter: 0,
  activeDownload: null,
  arlValid: true,
  arlLastCheck: null,
  vozBrasilFailed: false,
  vozBrasilLastError: null,
  vozBrasilDownloading: false,
  vozBrasilProgress: 0,
  dailyStats: { date: getTodayStr(), downloaded: 0, failed: 0, skipped: 0 },
  tempRetryCount: 0,
  setQueueLength: (length) => set({ queueLength: length }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setActiveDownload: (download) => set({ activeDownload: download }),
  setArlStatus: (valid) => set({ arlValid: valid, arlLastCheck: Date.now() }),
  setVozBrasilFailed: (failed, error) => set({ vozBrasilFailed: failed, vozBrasilLastError: error || null, ...(failed ? { vozBrasilDownloading: false, vozBrasilProgress: 0 } : {}) }),
  setVozBrasilDownloading: (downloading) => set({ vozBrasilDownloading: downloading, ...(downloading ? { vozBrasilProgress: 0 } : {}) }),
  setVozBrasilProgress: (progress) => set({ vozBrasilProgress: progress }),
  incrementDailyStat: (type) => set((state) => {
    const today = getTodayStr();
    const stats = state.dailyStats.date === today ? { ...state.dailyStats } : { date: today, downloaded: 0, failed: 0, skipped: 0 };
    stats[type]++;
    return { dailyStats: stats };
  }),
  setTempRetryCount: (count) => set({ tempRetryCount: count }),
  resetQueue: () => set((state) => ({ 
    queueLength: 0, 
    isProcessing: false,
    activeDownload: null,
    resetCounter: state.resetCounter + 1,
  })),
}));
