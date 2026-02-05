import { useState, useEffect, useCallback, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';

interface MusicLibraryStats {
  count: number;
  folders: number;
  isLoading: boolean;
  lastUpdated: Date | null;
}

// Global cache version to force refresh when needed
let cacheVersion = 0;

// Force a global cache refresh - call this when folders change or reset occurs
export function invalidateMusicLibraryCache() {
  cacheVersion++;
  console.log('[MUSIC-LIB] 🔄 Cache invalidated, version:', cacheVersion);
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
  
  const lastVersionRef = useRef(cacheVersion);
  const lastFoldersRef = useRef<string[]>([]);

  const refreshStats = useCallback(async (forceRefresh = false) => {
    // Check if folders changed
    const foldersChanged = JSON.stringify(config.musicFolders) !== JSON.stringify(lastFoldersRef.current);
    const versionChanged = cacheVersion > lastVersionRef.current;
    
    if (foldersChanged || versionChanged || forceRefresh) {
      console.log('[MUSIC-LIB] 📊 Refreshing stats (force:', forceRefresh, 'foldersChanged:', foldersChanged, ')');
      lastFoldersRef.current = [...config.musicFolders];
      lastVersionRef.current = cacheVersion;
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
      // Note: The Electron API will always read fresh from filesystem
      // We just need to ensure we call it when cache is invalidated
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

    // OPTIMIZED: Refresh every 15 minutes (was 5 minutes) for lower I/O
    const interval = setInterval(() => refreshStats(false), 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  // Also watch for cache invalidation
  useEffect(() => {
    const checkVersion = setInterval(() => {
      if (cacheVersion > lastVersionRef.current) {
        refreshStats(true);
      }
    }, 1000);
    return () => clearInterval(checkVersion);
  }, [refreshStats]);

  return { stats, refreshStats: () => refreshStats(true) };
}
