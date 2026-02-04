import { useEffect, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

/**
 * Hook to initialize station folders for all active radio stations
 * Creates a subfolder for each enabled station in the download folder
 * 
 * IMPORTANT: This hook now reacts to changes in the stations list,
 * so it will create new folders when stations are added from the database.
 */
export function useInitializeStationFolders() {
  const { stations, deezerConfig } = useRadioStore();
  const lastCreatedStationsRef = useRef<Set<string>>(new Set());
  const isCreatingRef = useRef(false);

  useEffect(() => {
    // Only run in Electron with Deezer configured
    if (!isElectron || !deezerConfig.enabled || !deezerConfig.downloadFolder) {
      return;
    }

    // Prevent concurrent folder creation
    if (isCreatingRef.current) {
      return;
    }

    const createFolders = async () => {
      try {
        // Get names of all enabled stations
        const enabledStations = stations
          .filter(s => s.enabled)
          .map(s => s.name);

        if (enabledStations.length === 0) {
          console.log('[FOLDERS] No enabled stations to create folders for');
          return;
        }

        // Check if there are new stations that haven't been created yet
        const newStations = enabledStations.filter(
          name => !lastCreatedStationsRef.current.has(name)
        );

        if (newStations.length === 0) {
          // All stations already have folders created
          return;
        }

        isCreatingRef.current = true;
        console.log(`[FOLDERS] Creating folders for ${newStations.length} new stations:`, newStations);

        const result = await window.electronAPI?.ensureStationFolders({
          baseFolder: deezerConfig.downloadFolder,
          stations: enabledStations, // Pass all enabled stations (API will skip existing)
        });

        if (result?.success) {
          // Mark all enabled stations as "created" (either newly created or already existed)
          enabledStations.forEach(name => lastCreatedStationsRef.current.add(name));
          
          if (result.created.length > 0) {
            console.log(`[FOLDERS] ✅ Created ${result.created.length} new folders:`, result.created);
          } else {
            console.log('[FOLDERS] All station folders already exist');
          }
        } else {
          console.error('[FOLDERS] Failed to create station folders:', result?.error);
        }
      } catch (error) {
        console.error('[FOLDERS] Error initializing station folders:', error);
      } finally {
        isCreatingRef.current = false;
      }
    };

    // Run with a small delay to allow DB sync to complete first
    const timeoutId = setTimeout(createFolders, 2000);
    
    return () => clearTimeout(timeoutId);
  }, [stations, deezerConfig.enabled, deezerConfig.downloadFolder]);

  // Reset when download folder changes
  useEffect(() => {
    lastCreatedStationsRef.current.clear();
  }, [deezerConfig.downloadFolder]);
}
