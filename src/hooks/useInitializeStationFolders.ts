import { useEffect, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

/**
 * Hook to initialize station folders for all active radio stations
 * Creates a subfolder for each enabled station in the download folder
 */
export function useInitializeStationFolders() {
  const { stations, deezerConfig } = useRadioStore();
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    // Only run once per session and only in Electron
    if (hasInitializedRef.current || !isElectron) {
      return;
    }

    // Only proceed if Deezer is enabled and configured
    if (!deezerConfig.enabled || !deezerConfig.downloadFolder) {
      return;
    }

    const initializeFolders = async () => {
      try {
        // Get names of all enabled stations
        const enabledStations = stations
          .filter(s => s.enabled)
          .map(s => s.name);

        if (enabledStations.length === 0) {
          console.log('[FOLDERS] No enabled stations to create folders for');
          return;
        }

        console.log(`[FOLDERS] Initializing folders for ${enabledStations.length} stations`);

        const result = await window.electronAPI?.ensureStationFolders({
          baseFolder: deezerConfig.downloadFolder,
          stations: enabledStations,
        });

        if (result?.success) {
          if (result.created.length > 0) {
            console.log(`[FOLDERS] Created ${result.created.length} new folders:`, result.created);
          } else {
            console.log('[FOLDERS] All station folders already exist');
          }
          hasInitializedRef.current = true;
        } else {
          console.error('[FOLDERS] Failed to create station folders:', result?.error);
        }
      } catch (error) {
        console.error('[FOLDERS] Error initializing station folders:', error);
      }
    };

    initializeFolders();
  }, [stations, deezerConfig.enabled, deezerConfig.downloadFolder]);

  // Reset initialization flag when download folder changes
  useEffect(() => {
    hasInitializedRef.current = false;
  }, [deezerConfig.downloadFolder]);
}
