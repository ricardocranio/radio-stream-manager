import { create } from 'zustand';

interface BpmSample {
  filename: string;
  bpm: number;
}

interface BpmDistribution {
  range: string;
  count: number;
}

interface BpmScanResult {
  success: boolean;
  total: number;
  withBpm: number;
  withoutBpm: number;
  samples: BpmSample[];
  bpmDistribution: BpmDistribution[];
  error?: string;
}

interface BpmScanStore {
  isScanning: boolean;
  scanResult: BpmScanResult | null;
  scanFolders: string[];
  error: string | null;

  setScanFolders: (folders: string[]) => void;
  startScan: () => void;
  finishScan: (result: BpmScanResult) => void;
  failScan: (error: string) => void;
  reset: () => void;
}

export const useBpmScanStore = create<BpmScanStore>((set) => ({
  isScanning: false,
  scanResult: null,
  scanFolders: [],
  error: null,

  setScanFolders: (folders) => set({ scanFolders: folders }),
  
  startScan: () => set({ isScanning: true, scanResult: null, error: null }),
  
  finishScan: (result) => set({ isScanning: false, scanResult: result, error: null }),
  
  failScan: (error) => set({ isScanning: false, error }),
  
  reset: () => set({ isScanning: false, scanResult: null, error: null }),
}));
