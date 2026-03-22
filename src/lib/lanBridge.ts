/**
 * LAN API Bridge
 * 
 * When the app runs in a remote browser (LAN/VPN), this module
 * provides the same interface as window.electronAPI but routes
 * all calls through HTTP POST to the LAN server's /api/ endpoints.
 */

let lanBaseUrl: string | null = null;

/**
 * Detect if we're running in LAN mode (remote browser, not Electron)
 */
export function isLanMode(): boolean {
  // If electronAPI exists with isElectron=true, we're in Electron
  if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
    return false;
  }
  // Check if we can reach the LAN API
  return !!getLanBaseUrl();
}

/**
 * Get the base URL for LAN API calls.
 * In LAN mode, the API is on the same host that served the page.
 */
export function getLanBaseUrl(): string | null {
  if (lanBaseUrl !== null) return lanBaseUrl;
  
  if (typeof window === 'undefined') return null;
  
  const host = window.location.hostname;
  const port = window.location.port;
  
  // If served from localhost or a LAN IP on port 8088/8089, we're in LAN mode
  if (port === '8088' || port === '8089') {
    lanBaseUrl = `${window.location.protocol}//${host}:${port}`;
    return lanBaseUrl;
  }
  
  return null;
}

/**
 * Call a LAN API endpoint
 */
async function lanApiCall<T = any>(channel: string, params?: any): Promise<T> {
  const base = getLanBaseUrl();
  if (!base) throw new Error('LAN API not available');
  
  const response = await fetch(`${base}/api/${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: params ? JSON.stringify(params) : '{}',
  });
  
  if (!response.ok) {
    throw new Error(`LAN API error: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Check if the LAN API server is reachable
 */
export async function checkLanHealth(): Promise<boolean> {
  try {
    const base = getLanBaseUrl();
    if (!base) return false;
    const resp = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
    const data = await resp.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Create a full electronAPI-compatible interface that routes through HTTP
 */
export function createLanElectronAPI(): typeof window.electronAPI {
  return {
    isElectron: true, // Pretend to be Electron so the UI enables all features
    platform: 'win32',
    
    // App info
    getAppVersion: () => lanApiCall('get-app-version'),
    getAppPath: (name: string) => lanApiCall('get-app-path', name),
    
    // Shell (limited in LAN mode)
    openExternal: (url: string) => { window.open(url, '_blank'); return Promise.resolve(); },
    openPath: (p: string) => lanApiCall('open-path', p),
    openFolder: (p: string) => lanApiCall('open-folder', p),
    ensureFolder: (p: string) => lanApiCall('ensure-folder', p),
    selectFolder: () => Promise.resolve(null), // Can't open native dialog remotely
    
    // Deezer/deemix
    downloadFromDeezer: (params: any) => lanApiCall('download-from-deezer', params),
    checkDeemix: () => lanApiCall('check-deemix'),
    checkPython: () => lanApiCall('check-python'),
    installDeemix: () => lanApiCall('install-deemix'),
    testDeemix: () => lanApiCall('test-deemix'),
    testDeemixSearch: (params: any) => lanApiCall('test-deemix-search', params),
    onDeemixInstallProgress: () => {}, // No real-time events over HTTP
    
    // Station folders
    ensureStationFolders: (params: any) => lanApiCall('ensure-station-folders', params),
    checkFileInSubfolders: (params: any) => lanApiCall('check-file-in-subfolders', params),
    purgeBlockedFiles: (params: any) => lanApiCall('purge-blocked-files', params),
    
    // Duplicates
    scanDuplicates: (params: any) => lanApiCall('scan-duplicates', params),
    deleteDuplicates: (params: any) => lanApiCall('delete-duplicates', params),
    
    // Notifications (show in browser instead)
    showNotification: (title: string, body: string) => {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
      return Promise.resolve();
    },
    notifyBatchComplete: (stats: any) => lanApiCall('notify-batch-complete', stats),
    
    // Scraping
    scrapeStations: (stations: any) => lanApiCall('scrape-stations', stations),
    scrapeStation: (station: any) => lanApiCall('scrape-station', station),
    
    // Music library
    checkSongExists: (params: any) => lanApiCall('check-song-exists', params),
    findSongMatch: (params: any) => lanApiCall('find-song-match', params),
    getMusicLibraryStats: (params: any) => lanApiCall('get-music-library-stats', params),
    getFileDuration: (params: any) => lanApiCall('get-file-duration', params),
    getFileDurationsBatch: (params: any) => lanApiCall('get-file-durations-batch', params),
    
    // Voz do Brasil
    downloadVozBrasil: (params: any) => lanApiCall('download-voz-brasil', params),
    cleanupVozBrasil: (params: any) => lanApiCall('cleanup-voz-brasil', params),
    scrapeVozDownloadUrl: () => lanApiCall('scrape-voz-download-url'),
    recoverTempFiles: (params: any) => lanApiCall('recover-temp-files', params),
    onVozDownloadProgress: () => {},
    
    // Radioagência
    radioagenciaCheck: () => lanApiCall('radioagencia-check'),
    radioagenciaDownload: (params: any) => lanApiCall('radioagencia-download', params),
    radioagenciaCleanup: (params: any) => lanApiCall('radioagencia-cleanup', params),
    onRadioagenciaProgress: () => {},
    
    // Grade files
    saveGradeFile: (params: any) => lanApiCall('save-grade-file', params),
    readGradeFile: (params: any) => lanApiCall('read-grade-file', params),
    listFolderFiles: (params: any) => lanApiCall('list-folder-files', params),
    renameMusicFile: (params: any) => lanApiCall('rename-music-file', params),
    scanFixLibrary: (params: any) => lanApiCall('scan-fix-library', params),
    onLibFixProgress: () => {},
    scanBpmTags: (params: any) => lanApiCall('scan-bpm-tags', params),
    readId3Genre: (params: any) => lanApiCall('read-id3-genre', params),
    saveBpmCache: (params: any) => lanApiCall('save-bpm-cache', params),
    loadBpmCache: (params: any) => lanApiCall('load-bpm-cache', params),
    scanLibraryMetadata: (params: any) => lanApiCall('scan-library-metadata', params),
    moveFileToGenreFolder: (params: any) => lanApiCall('move-file-to-genre-folder', params),
    reorganizeByGenre: (params: any) => lanApiCall('reorganize-by-genre', params),
    processTempFiles: (params: any) => lanApiCall('process-temp-files', params),
    
    // Window management (no-op remotely)
    showWindow: () => Promise.resolve({ success: true }),
    
    // Auto-update (no-op remotely)
    checkForUpdates: () => Promise.resolve({ success: false, error: 'Remote mode' }),
    onUpdateAvailable: () => {},
    onUpdateDownloaded: () => {},
    onDownloadProgress: () => {},
    
    // Python/Deemix status
    onPythonStatus: () => {},
    onDeemixStatus: () => {},
    getDeemixCommand: () => lanApiCall('get-deemix-command'),
    
    // Python Monitor
    startPythonMonitor: () => lanApiCall('start-python-monitor'),
    stopPythonMonitor: () => lanApiCall('stop-python-monitor'),
    restartPythonMonitor: () => lanApiCall('restart-python-monitor'),
    getMonitorStatus: () => lanApiCall('get-monitor-status'),
    getMonitorLogs: () => lanApiCall('get-monitor-logs'),
    onMonitorLog: () => {},
    onMonitorStatus: () => {},
  } as any;
}
