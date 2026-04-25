const { contextBridge, ipcRenderer } = require('electron');

console.log('Electron preload script loaded');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
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
  onDeemixInstallProgress: (callback) => {
    ipcRenderer.removeAllListeners('deemix-install-progress');
    ipcRenderer.on('deemix-install-progress', (_, progress) => callback(progress));
  },
  
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
  onVozDownloadProgress: (callback) => {
    ipcRenderer.removeAllListeners('voz-download-progress');
    ipcRenderer.on('voz-download-progress', (_, progress) => callback(progress));
  },
  
  // Radioagência Nacional
  radioagenciaCheck: () => ipcRenderer.invoke('radioagencia-check'),
  radioagenciaDownload: (params) => ipcRenderer.invoke('radioagencia-download', params),
  radioagenciaCleanup: (params) => ipcRenderer.invoke('radioagencia-cleanup', params),
  onRadioagenciaProgress: (callback) => {
    ipcRenderer.removeAllListeners('radioagencia-download-progress');
    ipcRenderer.on('radioagencia-download-progress', (_, progress) => callback(progress));
  },
  
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
  onLibFixProgress: (callback) => {
    ipcRenderer.removeAllListeners('lib-fix-progress');
    ipcRenderer.on('lib-fix-progress', (_, progress) => callback(progress));
  },
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
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.on('update-available', (_, info) => callback(info));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.on('update-downloaded', (_, info) => callback(info));
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.on('download-progress', (_, progress) => callback(progress));
  },
  
  // Python/Deemix status notifications
  onPythonStatus: (callback) => {
    ipcRenderer.removeAllListeners('python-status');
    ipcRenderer.on('python-status', (_, status) => callback(status));
  },
  onDeemixStatus: (callback) => {
    ipcRenderer.removeAllListeners('deemix-status');
    ipcRenderer.on('deemix-status', (_, status) => callback(status));
  },
  getDeemixCommand: () => ipcRenderer.invoke('get-deemix-command'),
  
  // Python Radio Monitor
  startPythonMonitor: () => ipcRenderer.invoke('start-python-monitor'),
  stopPythonMonitor: () => ipcRenderer.invoke('stop-python-monitor'),
  restartPythonMonitor: () => ipcRenderer.invoke('restart-python-monitor'),
  getMonitorStatus: () => ipcRenderer.invoke('get-monitor-status'),
  getMonitorLogs: () => ipcRenderer.invoke('get-monitor-logs'),
  onMonitorLog: (callback) => {
    ipcRenderer.removeAllListeners('monitor-log');
    ipcRenderer.on('monitor-log', (_, log) => callback(log));
  },
  onMonitorStatus: (callback) => {
    ipcRenderer.removeAllListeners('monitor-status');
    ipcRenderer.on('monitor-status', (_, status) => callback(status));
  },

  // Download warnings (ARL, quality, duration issues)
  onDownloadWarning: (callback) => {
    ipcRenderer.removeAllListeners('download-warning');
    ipcRenderer.on('download-warning', (_, warning) => callback(warning));
  },

  // Platform detection
  platform: process.platform,
  isElectron: true,
});
