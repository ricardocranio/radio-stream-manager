import { create } from 'zustand';

interface BpmCacheEntry {
  bpm: number;
  scannedAt: string;
}

interface BpmScanResultData {
  success: boolean;
  total: number;
  withBpm: number;
  withoutBpm: number;
  samples: { filename: string; bpm: number }[];
  bpmDistribution: { range: string; count: number }[];
  error?: string;
}

interface BpmScanStore {
  // Scan state
  isScanning: boolean;
  scanResult: BpmScanResultData | null;
  error: string | null;

  // Cache state
  cache: Record<string, BpmCacheEntry>;
  cacheLoaded: boolean;
  cacheSize: number;
  lastCacheUpdate: string | null;

  // Actions - scan
  startScan: () => void;
  finishScan: (result: BpmScanResultData) => void;
  failScan: (error: string) => void;

  // Actions - cache
  setCacheLoaded: (loaded: boolean) => void;
  updateCache: (entries: Record<string, BpmCacheEntry>) => void;
  clearCache: () => void;
  
  // Helpers
  getBpm: (filename: string) => number | null;
  getAgitadas: (minBpm: number) => string[];
  getCacheStats: () => { total: number; avgBpm: number; minBpm: number; maxBpm: number };
}

export const useBpmScanStore = create<BpmScanStore>((set, get) => ({
  isScanning: false,
  scanResult: null,
  error: null,

  cache: {},
  cacheLoaded: false,
  cacheSize: 0,
  lastCacheUpdate: null,

  startScan: () => set({ isScanning: true, scanResult: null, error: null }),
  
  finishScan: (result) => set({ isScanning: false, scanResult: result, error: null }),
  
  failScan: (error) => set({ isScanning: false, error }),

  setCacheLoaded: (loaded) => set({ cacheLoaded: loaded }),

  updateCache: (entries) => set((state) => {
    const newCache = { ...state.cache, ...entries };
    return {
      cache: newCache,
      cacheSize: Object.keys(newCache).length,
      lastCacheUpdate: new Date().toISOString(),
    };
  }),

  clearCache: () => set({ cache: {}, cacheSize: 0, lastCacheUpdate: null }),

  getBpm: (filename: string) => {
    const entry = get().cache[filename];
    return entry ? entry.bpm : null;
  },

  getAgitadas: (minBpm: number) => {
    const { cache } = get();
    return Object.entries(cache)
      .filter(([, entry]) => entry.bpm >= minBpm)
      .map(([filename]) => filename);
  },

  getCacheStats: () => {
    const { cache } = get();
    const entries = Object.values(cache);
    if (entries.length === 0) {
      return { total: 0, avgBpm: 0, minBpm: 0, maxBpm: 0 };
    }
    const bpms = entries.map(e => e.bpm);
    return {
      total: entries.length,
      avgBpm: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
      minBpm: Math.min(...bpms),
      maxBpm: Math.max(...bpms),
    };
  },
}));

/**
 * Load BPM cache from disk on startup (Electron only).
 * Call this once from a top-level hook or effect.
 */
export async function loadBpmCacheFromDisk(folder: string): Promise<void> {
  const store = useBpmScanStore.getState();
  if (store.cacheLoaded) return;

  if (!window.electronAPI?.loadBpmCache) {
    store.setCacheLoaded(true);
    return;
  }

  try {
    const result = await window.electronAPI.loadBpmCache({ folder });
    if (result.success && result.data) {
      store.updateCache(result.data);
      console.log(`[BPM-CACHE] ✅ Carregado: ${Object.keys(result.data).length} entradas`);
    } else {
      console.log('[BPM-CACHE] Nenhum cache encontrado, iniciando vazio');
    }
  } catch (err) {
    console.error('[BPM-CACHE] Erro ao carregar:', err);
  } finally {
    store.setCacheLoaded(true);
  }
}

/**
 * Save current BPM cache to disk (Electron only).
 */
export async function saveBpmCacheToDisk(folder: string): Promise<void> {
  if (!window.electronAPI?.saveBpmCache) return;

  const { cache } = useBpmScanStore.getState();
  
  try {
    const result = await window.electronAPI.saveBpmCache({ folder, data: cache });
    if (result.success) {
      console.log(`[BPM-CACHE] ✅ Salvo: ${Object.keys(cache).length} entradas`);
    } else {
      console.error('[BPM-CACHE] Erro ao salvar:', result.error);
    }
  } catch (err) {
    console.error('[BPM-CACHE] Erro ao salvar:', err);
  }
}
