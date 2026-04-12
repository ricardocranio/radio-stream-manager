/**
 * getAllSearchFolders
 *
 * Returns a deduplicated list of ALL folders the system should scan
 * when checking if a song already exists in the library.
 * This includes:
 *  - config.musicFolders (main library)
 *  - deezerConfig.downloadFolder (where new downloads land)
 *  - genre sub-folders derived from genreRoutes (Pop/, Rock/, etc.)
 *
 * Because scanMusicLibrary (Electron side) is recursive, adding the
 * downloadFolder root is usually enough, but we list genre sub-folders
 * explicitly so the scan covers them even if the download root differs
 * from the music library root.
 */

import { useRadioStore } from '@/store/radioStore';

export function getAllSearchFolders(): string[] {
  const { config, deezerConfig } = useRadioStore.getState();

  const folders = new Set<string>();

  // 1. Main music library folders
  for (const f of config.musicFolders || []) {
    if (f) folders.add(f);
  }

  // 2. Download folder (root where Deemix drops files)
  const dlFolder = deezerConfig?.downloadFolder;
  if (dlFolder) {
    folders.add(dlFolder);

    // 3. Genre sub-folders
    if (deezerConfig.genreRoutingEnabled && deezerConfig.genreRoutes?.length) {
      for (const route of deezerConfig.genreRoutes) {
        if (route.folderName) {
          folders.add(`${dlFolder}\\${route.folderName}`);
        }
      }
    }

    // 4. Default genre folder (e.g. "Musicas")
    if (deezerConfig.genreDefaultFolder) {
      folders.add(`${dlFolder}\\${deezerConfig.genreDefaultFolder}`);
    }
  }

  return Array.from(folders);
}
