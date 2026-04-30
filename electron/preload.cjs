const { contextBridge, ipcRenderer } = require('electron');

/**
 * Programador Rádio - Preload Script
 * 
 * Exposes protected IPC channels to the renderer process.
 * This bridge maintains security by only allowing specific
 * predefined channels to communicate between the processes.
 */

console.log('[PRELOAD] Electron preload script starting...');

// Safety check to prevent double exposure
if (!process.isMainFrame) {
  console.warn('[PRELOAD] Skipping secondary frame exposure');
} else {
  try {
    // Shared listener cleanup helper
    const setupListener = (channel, callback) => {
      // Standardize: remove all existing listeners for this channel to prevent leaks
      ipcRenderer.removeAllListeners(channel);
      // Create the new listener
      const listener = (event, ...args) => callback(...args);
      ipcRenderer.on(channel, listener);
      // Return unsubscription function
      return () => ipcRenderer.removeListener(channel, listener);
    };

    // Expose protected methods to renderer process
    contextBridge.exposeInMainWorld('electronAPI', {
      // Platform detection
      platform: process.platform,
      isElectron: true,

      // App info
      getAppVersion: () => ipcRenderer.invoke('get-app-version'),
      getAppPath: (name) => ipcRenderer.invoke('get-app-path', name),
      
      // Shell operations
      openExternal: (url) => ipcRenderer.invoke('open-external', url),
      openPath: (path) => ipcRenderer.invoke('open-path', path),
      openFolder: (path) => ipcRenderer.invoke('open-folder', path),
      ensureFolder: (path) => ipcRenderer.invoke('ensure-folder', path),
      selectFolder: () => ipcRenderer.invoke('select-folder'),
      selectFile: (params) => ipcRenderer.invoke('select-file', params),

      // Deezer/deemix integration
      downloadFromDeezer: (params) => ipcRenderer.invoke('download-from-deezer', params),
      checkDeemix: () => ipcRenderer.invoke('check-deemix'),
      checkPython: () => ipcRenderer.invoke('check-python'),
      installDeemix: () => ipcRenderer.invoke('install-deemix'),
      testDeemix: () => ipcRenderer.invoke('test-deemix'),
      testDeemixSearch: (params) => ipcRenderer.invoke('test-deemix-search', params),
      getDeemixCommand: () => ipcRenderer.invoke('get-deemix-command'),
      onDeemixInstallProgress: (callback) => setupListener('deemix-install-progress', callback),
      onDeemixStatus: (callback) => setupListener('deemix-status', callback),
      
      // Station folder management
      ensureStationFolders: (params) => ipcRenderer.invoke('ensure-station-folders', params),
      checkFileInSubfolders: (params) => ipcRenderer.invoke('check-file-in-subfolders', params),
      purgeBlockedFiles: (params) => ipcRenderer.invoke('purge-blocked-files', params),
      
      // Duplicate detection
      scanDuplicates: (params) => ipcRenderer.invoke('scan-duplicates', params),
      deleteDuplicates: (params) => ipcRenderer.invoke('delete-duplicates', params),
      
      // Notifications
      showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
      notifyBatchComplete: (stats) => ipcRenderer.invoke('notify-batch-complete', stats),
      
      // Radio scraping
      scrapeStations: (stations) => ipcRenderer.invoke('scrape-stations', stations),
      scrapeStation: (station) => ipcRenderer.invoke('scrape-station', station),
      
      // Music library check - with similarity matching
      checkSongExists: (params) => ipcRenderer.invoke('check-song-exists', params),
      findSongMatch: (params) => ipcRenderer.invoke('find-song-match', params),
      getMusicLibraryStats: (params) => ipcRenderer.invoke('get-music-library-stats', params),
      getFileDuration: (params) => ipcRenderer.invoke('get-file-duration', params),
      getFileDurationsBatch: (params) => ipcRenderer.invoke('get-file-durations-batch', params),
      
      // Voz do Brasil download
      downloadVozBrasil: (params) => ipcRenderer.invoke('download-voz-brasil', params),
      cleanupVozBrasil: (params) => ipcRenderer.invoke('cleanup-voz-brasil', params),
      scrapeVozDownloadUrl: () => ipcRenderer.invoke('scrape-voz-download-url'),
      recoverTempFiles: (params) => ipcRenderer.invoke('recover-temp-files', params),
      onVozDownloadProgress: (callback) => setupListener('voz-download-progress', callback),
      
      // Radioagência Nacional
      radioagenciaCheck: () => ipcRenderer.invoke('radioagencia-check'),
      radioagenciaDownload: (params) => ipcRenderer.invoke('radioagencia-download', params),
      radioagenciaCleanup: (params) => ipcRenderer.invoke('radioagencia-cleanup', params),
      onRadioagenciaProgress: (callback) => setupListener('radioagencia-download-progress', callback),
      
      // Content folder cleanup
      cleanupContentFolder: (params) => ipcRenderer.invoke('cleanup-content-folder', params),
      cleanupOldDayFiles: (params) => ipcRenderer.invoke('cleanup-old-day-files', params),
      
      // Grade file operations
      saveGradeFile: (params) => ipcRenderer.invoke('save-grade-file', params),
      readGradeFile: (params) => ipcRenderer.invoke('read-grade-file', params),
      listFolderFiles: (params) => ipcRenderer.invoke('list-folder-files', params),
      renameMusicFile: (params) => ipcRenderer.invoke('rename-music-file', params),
      scanFixLibrary: (params) => ipcRenderer.invoke('scan-fix-library', params),
      saveLocucao: (params) => ipcRenderer.invoke('save-locucao', params),
      scanQuarantineLibrary: (params) => ipcRenderer.invoke('scan-quarantine-library', params),
      onLibFixProgress: (callback) => setupListener('lib-fix-progress', callback),
      scanBpmTags: (params) => ipcRenderer.invoke('scan-bpm-tags', params),
      readId3Genre: (params) => ipcRenderer.invoke('read-id3-genre', params),
      saveBpmCache: (params) => ipcRenderer.invoke('save-bpm-cache', params),
      loadBpmCache: (params) => ipcRenderer.invoke('load-bpm-cache', params),
      scanLibraryMetadata: (params) => ipcRenderer.invoke('scan-library-metadata', params),
      moveFileToGenreFolder: (params) => ipcRenderer.invoke('move-file-to-genre-folder', params),
      reorganizeByGenre: (params) => ipcRenderer.invoke('reorganize-by-genre', params),
      validateId3Integrity: (params) => ipcRenderer.invoke('validate-id3-integrity', params),
      listQuarantinedFiles: (params) => ipcRenderer.invoke('list-quarantined-files', params),
      restoreQuarantinedFile: (params) => ipcRenderer.invoke('restore-quarantined-file', params),
      deleteQuarantinedFile: (params) => ipcRenderer.invoke('delete-quarantined-file', params),
      processTempFiles: (params) => ipcRenderer.invoke('process-temp-files', params),
      
      // Window management
      showWindow: () => ipcRenderer.invoke('show-window'),
      
      // Auto-update
      checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
      onUpdateAvailable: (callback) => setupListener('update-available', callback),
      onUpdateDownloaded: (callback) => setupListener('update-downloaded', callback),
      onDownloadProgress: (callback) => setupListener('download-progress', callback),
      
      // Python/Deemix status notifications
      onPythonStatus: (callback) => setupListener('python-status', callback),
      
      // Python Radio Monitor
      startPythonMonitor: () => ipcRenderer.invoke('start-python-monitor'),
      stopPythonMonitor: () => ipcRenderer.invoke('stop-python-monitor'),
      restartPythonMonitor: () => ipcRenderer.invoke('restart-python-monitor'),
      getMonitorStatus: () => ipcRenderer.invoke('get-monitor-status'),
      getMonitorLogs: () => ipcRenderer.invoke('get-monitor-logs'),
      onMonitorLog: (callback) => setupListener('monitor-log', callback),
      onMonitorStatus: (callback) => setupListener('monitor-status', callback),

      // Download warnings (ARL, quality, duration issues)
      onDownloadWarning: (callback) => setupListener('download-warning', callback),
    });

    console.log('[PRELOAD] ✓ electronAPI exposed successfully');
  } catch (err) {
    console.error('[PRELOAD] ❌ Failed to expose electronAPI:', err);
  }
}
