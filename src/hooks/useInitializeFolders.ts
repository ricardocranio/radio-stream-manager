import { useEffect } from 'react';
import { useRadioStore } from '@/store/radioStore';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

/**
 * Hook to ensure all required folders exist on app startup (Electron only)
 * Creates folders if they don't exist
 */
export function useInitializeFolders() {
  const { config, deezerConfig } = useRadioStore();

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.ensureFolder) {
      return;
    }

    const initializeFolders = async () => {
      console.log('[INIT-FOLDERS] Checking required folders...');
      
      // Collect all folders that need to exist
      const foldersToCheck = [
        config.gradeFolder,
        config.contentFolder,
        config.vozBrasilFolder,
        deezerConfig.downloadFolder,
        ...config.musicFolders,
      ].filter(Boolean);

      // Remove duplicates
      const uniqueFolders = [...new Set(foldersToCheck)];

      for (const folder of uniqueFolders) {
        try {
          const result = await window.electronAPI!.ensureFolder(folder);
          if (result.success) {
            if (result.created) {
              console.log(`[INIT-FOLDERS] ✓ Created: ${folder}`);
            } else {
              console.log(`[INIT-FOLDERS] ✓ Exists: ${folder}`);
            }
          } else {
            console.error(`[INIT-FOLDERS] ✗ Failed: ${folder} - ${result.error}`);
          }
        } catch (error) {
          console.error(`[INIT-FOLDERS] ✗ Error checking ${folder}:`, error);
        }
      }

      console.log('[INIT-FOLDERS] Folder initialization complete');
    };

    initializeFolders();
  }, [config.gradeFolder, config.contentFolder, config.vozBrasilFolder, config.musicFolders, deezerConfig.downloadFolder]);
}
