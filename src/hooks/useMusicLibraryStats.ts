import { useState, useEffect, useCallback, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { isElectron, isServiceMode, getMusicLibraryStatsViaAPI } from '@/lib/serviceMode';

interface MusicLibraryStats {
  count: number;
  folders: number;
  isLoading: boolean;
  lastUpdated: Date | null;
  error: string | null;
}

// Cache to avoid repeated network folder scans
let cachedStats: MusicLibraryStats | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes cache for network folders

/**
 * Hook to get music library statistics (file count)
 * Optimized for network folders with caching and timeout
 * Works in Electron environment only, returns 0 for web
 */
export function useMusicLibraryStats() {
  const config = useRadioStore((state) => state.config);
  const [stats, setStats] = useState<MusicLibraryStats>({
    count: cachedStats?.count || 0,
    folders: cachedStats?.folders || 0,
    isLoading: !cachedStats,
    lastUpdated: cachedStats?.lastUpdated || null,
    error: null,
  });
  
  const isLoadingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshStats = useCallback(async (forceRefresh = false) => {
    // Avoid concurrent requests
    if (isLoadingRef.current) {
      return;
    }
    
    // Use cache if available and not forcing refresh
    const now = Date.now();
    if (!forceRefresh && cachedStats && (now - cacheTimestamp < CACHE_DURATION)) {
      setStats(cachedStats);
      return;
    }

    // Try native Electron API first
    if (window.electronAPI?.getMusicLibraryStats) {
      isLoadingRef.current = true;
      setStats(prev => ({ ...prev, isLoading: true, error: null }));
      abortControllerRef.current = new AbortController();

      try {
        const timeoutMs = 30000;
        
        const result = await Promise.race([
          window.electronAPI.getMusicLibraryStats({
            musicFolders: config.musicFolders,
          }),
          new Promise<{ success: false; error: string }>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout: Pasta de rede não respondeu')), timeoutMs)
          )
        ]);

        if (result.success) {
          const newStats: MusicLibraryStats = {
            count: result.count,
            folders: result.folders,
            isLoading: false,
            lastUpdated: new Date(),
            error: null,
          };
          setStats(newStats);
          cachedStats = newStats;
          cacheTimestamp = Date.now();
        } else {
          throw new Error('Erro ao obter estatísticas');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro ao acessar pasta';
        console.warn('[MUSIC-LIBRARY] Error (using cache if available):', errorMessage);
        
        if (cachedStats) {
          setStats({ ...cachedStats, isLoading: false, error: null });
        } else {
          setStats(prev => ({ ...prev, isLoading: false, error: errorMessage }));
        }
      } finally {
        isLoadingRef.current = false;
      }
      return;
    }

    // Try HTTP API for Service Mode
    if (isServiceMode() && config.musicFolders.length > 0) {
      isLoadingRef.current = true;
      setStats(prev => ({ ...prev, isLoading: true, error: null }));
      
      console.log('[MUSIC-LIBRARY] Using HTTP API for service mode');
      
      try {
        const result = await getMusicLibraryStatsViaAPI(config.musicFolders);
        
        if (result.success) {
          const httpStats: MusicLibraryStats = {
            count: result.count,
            folders: result.folders,
            isLoading: false,
            lastUpdated: new Date(),
            error: null,
          };
          setStats(httpStats);
          cachedStats = httpStats;
          cacheTimestamp = Date.now();
          console.log(`[MUSIC-LIBRARY] HTTP API returned ${result.count} files`);
        } else {
          throw new Error(result.error || 'API error');
        }
      } catch (httpError) {
        console.warn('[MUSIC-LIBRARY] HTTP API failed:', httpError);
        if (cachedStats) {
          setStats({ ...cachedStats, isLoading: false, error: null });
        } else {
          setStats(prev => ({ ...prev, isLoading: false, error: 'Erro na API HTTP' }));
        }
      } finally {
        isLoadingRef.current = false;
      }
      return;
    }

    // Web mode fallback
    const webStats: MusicLibraryStats = {
      count: 0,
      folders: config.musicFolders.length,
      isLoading: false,
      lastUpdated: new Date(),
      error: null,
    };
    setStats(webStats);
    cachedStats = webStats;
    cacheTimestamp = now;
  }, [config.musicFolders]);

  useEffect(() => {
    // Initial load with small delay to not block UI
    const initialDelay = setTimeout(() => {
      refreshStats();
    }, 1000);

    // Refresh every 10 minutes (longer interval for network folders)
    const interval = setInterval(() => {
      refreshStats();
    }, 10 * 60 * 1000);
    
    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [refreshStats]);

  return { stats, refreshStats };
}

/**
 * Clear the library stats cache
 * Call this when music folders configuration changes
 */
export function clearMusicLibraryCache() {
  cachedStats = null;
  cacheTimestamp = 0;
}
