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
  
  // Deezer/deemix integration
  downloadFromDeezer: (params) => ipcRenderer.invoke('download-from-deezer', params),
  checkDeemix: () => ipcRenderer.invoke('check-deemix'),
  checkPython: () => ipcRenderer.invoke('check-python'),
  installDeemix: () => ipcRenderer.invoke('install-deemix'),
  testDeemix: () => ipcRenderer.invoke('test-deemix'),
  testDeemixSearch: (params) => ipcRenderer.invoke('test-deemix-search', params),
  onDeemixInstallProgress: (callback) => ipcRenderer.on('deemix-install-progress', (_, progress) => callback(progress)),
  
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
  
  // Voz do Brasil download
  downloadVozBrasil: (params) => ipcRenderer.invoke('download-voz-brasil', params),
  cleanupVozBrasil: (params) => ipcRenderer.invoke('cleanup-voz-brasil', params),
  onVozDownloadProgress: (callback) => ipcRenderer.on('voz-download-progress', (_, progress) => callback(progress)),
  
  // Grade file operations
  saveGradeFile: (params) => ipcRenderer.invoke('save-grade-file', params),
  readGradeFile: (params) => ipcRenderer.invoke('read-grade-file', params),
  listFolderFiles: (params) => ipcRenderer.invoke('list-folder-files', params),
  
  // Window management
  showWindow: () => ipcRenderer.invoke('show-window'),
  
  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_, info) => callback(info)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (_, info) => callback(info)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_, progress) => callback(progress)),
  
  // Python/Deemix status notifications
  onPythonStatus: (callback) => ipcRenderer.on('python-status', (_, status) => callback(status)),
  onDeemixStatus: (callback) => ipcRenderer.on('deemix-status', (_, status) => callback(status)),
  getDeemixCommand: () => ipcRenderer.invoke('get-deemix-command'),
  
  // Platform detection
  platform: process.platform,
  isElectron: true,
});
