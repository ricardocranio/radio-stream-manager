import { useState, useEffect, useCallback, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';

interface MusicLibraryStats {
  count: number;
  folders: number;
  isLoading: boolean;
  lastUpdated: Date | null;
}

// Event-based cache invalidation (replaces polling every 1s)
type InvalidationListener = () => void;
const invalidationListeners = new Set<InvalidationListener>();

/** Force a global cache refresh - call this when folders change or reset occurs */
export function invalidateMusicLibraryCache() {
  console.log('[MUSIC-LIB] 🔄 Cache invalidated');
  invalidationListeners.forEach(listener => listener());
}

/**
 * Hook to get music library statistics (file count)
 * Works in Electron environment only, returns 0 for web
 */
export function useMusicLibraryStats() {
  const config = useRadioStore((state) => state.config);
  const [stats, setStats] = useState<MusicLibraryStats>({
    count: 0,
    folders: 0,
    isLoading: true,
    lastUpdated: null,
  });
  
  const lastFoldersRef = useRef<string[]>([]);

  const refreshStats = useCallback(async (forceRefresh = false) => {
    // Check if folders changed
    const foldersChanged = JSON.stringify(config.musicFolders) !== JSON.stringify(lastFoldersRef.current);
    
    if (foldersChanged || forceRefresh) {
      console.log('[MUSIC-LIB] 📊 Refreshing stats (force:', forceRefresh, 'foldersChanged:', foldersChanged, ')');
      lastFoldersRef.current = [...config.musicFolders];
    }
    
    if (!window.electronAPI?.getMusicLibraryStats) {
      setStats({
        count: 0,
        folders: config.musicFolders.length,
        isLoading: false,
        lastUpdated: new Date(),
      });
      return;
    }

    setStats(prev => ({ ...prev, isLoading: true }));
    
    try {
      const result = await window.electronAPI.getMusicLibraryStats({
        musicFolders: config.musicFolders,
      });

      if (result.success) {
        setStats({
          count: result.count,
          folders: result.folders,
          isLoading: false,
          lastUpdated: new Date(),
        });
        console.log('[MUSIC-LIB] ✅ Stats refreshed:', result.count, 'files in', result.folders, 'folders');
      } else {
        setStats(prev => ({
          ...prev,
          isLoading: false,
          lastUpdated: new Date(),
        }));
      }
    } catch (error) {
      console.error('[MUSIC-LIB] Error getting stats:', error);
      setStats(prev => ({
        ...prev,
        isLoading: false,
      }));
    }
  }, [config.musicFolders]);

  useEffect(() => {
    refreshStats(true); // Force refresh on mount

    // OPTIMIZED: Refresh every 15 minutes for lower I/O
    const interval = setInterval(() => refreshStats(false), 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  // Listen for event-based cache invalidation (replaces 1-second polling)
  useEffect(() => {
    const listener = () => refreshStats(true);
    invalidationListeners.add(listener);
    return () => { invalidationListeners.delete(listener); };
  }, [refreshStats]);

  return { stats, refreshStats: () => refreshStats(true) };
}
