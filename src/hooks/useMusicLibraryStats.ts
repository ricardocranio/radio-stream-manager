import { useState, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';

interface MusicLibraryStats {
  count: number;
  folders: number;
  isLoading: boolean;
  lastUpdated: Date | null;
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

  const refreshStats = useCallback(async () => {
    if (!window.electronAPI?.getMusicLibraryStats) {
      setStats({
        count: 0,
        folders: config.musicFolders.length,
        isLoading: false,
        lastUpdated: new Date(),
      });
      return;
    }

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
      } else {
        setStats(prev => ({
          ...prev,
          isLoading: false,
          lastUpdated: new Date(),
        }));
      }
    } catch (error) {
      console.error('Error getting music library stats:', error);
      setStats(prev => ({
        ...prev,
        isLoading: false,
      }));
    }
  }, [config.musicFolders]);

  useEffect(() => {
    refreshStats();

    // Refresh every 5 minutes
    const interval = setInterval(refreshStats, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  return { stats, refreshStats };
}
