import { useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';

interface CheckResult {
  exists: boolean;
  path?: string;
}

/**
 * Hook to check if a song exists in the local music library
 * Uses Electron IPC when available, falls back to simulation for web
 */
export function useCheckMusicLibrary() {
  const config = useRadioStore((state) => state.config);

  const checkSongExists = useCallback(async (artist: string, title: string): Promise<CheckResult> => {
    // Use Electron API if available
    if (window.electronAPI?.checkSongExists) {
      try {
        const result = await window.electronAPI.checkSongExists({
          artist,
          title,
          musicFolders: config.musicFolders,
        });
        return result;
      } catch (error) {
        console.error('Error checking song in library:', error);
        return { exists: false };
      }
    }

    // Fallback for web: simulate check (always returns false in web mode)
    console.log(`[WEB] Would check: ${artist} - ${title} in ${config.musicFolders.join(', ')}`);
    return { exists: false };
  }, [config.musicFolders]);

  const checkMultipleSongs = useCallback(async (
    songs: Array<{ artist: string; title: string }>
  ): Promise<Map<string, CheckResult>> => {
    const results = new Map<string, CheckResult>();

    for (const song of songs) {
      const key = `${song.artist.toLowerCase().trim()}-${song.title.toLowerCase().trim()}`;
      const result = await checkSongExists(song.artist, song.title);
      results.set(key, result);
    }

    return results;
  }, [checkSongExists]);

  return { checkSongExists, checkMultipleSongs };
}

/**
 * Standalone function to check a song in the library
 */
export async function checkSongInLibrary(
  artist: string,
  title: string,
  musicFolders: string[]
): Promise<CheckResult> {
  if (window.electronAPI?.checkSongExists) {
    try {
      return await window.electronAPI.checkSongExists({
        artist,
        title,
        musicFolders,
      });
    } catch (error) {
      console.error('Error checking song:', error);
      return { exists: false };
    }
  }

  // Web mode: always returns false
  return { exists: false };
}