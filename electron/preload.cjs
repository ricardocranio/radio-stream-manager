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
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  // Deezer/deemix integration
  downloadFromDeezer: (params) => ipcRenderer.invoke('download-from-deezer', params),
  checkDeemix: () => ipcRenderer.invoke('check-deemix'),
  checkPython: () => ipcRenderer.invoke('check-python'),
  installDeemix: () => ipcRenderer.invoke('install-deemix'),
  onDeemixInstallProgress: (callback) => ipcRenderer.on('deemix-install-progress', (_, progress) => callback(progress)),
  
  // Notifications
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  notifyBatchComplete: (stats) => ipcRenderer.invoke('notify-batch-complete', stats),
  
  // Radio scraping
  scrapeStations: (stations) => ipcRenderer.invoke('scrape-stations', stations),
  scrapeStation: (station) => ipcRenderer.invoke('scrape-station', station),
  
  // Music library check
  checkSongExists: (params) => ipcRenderer.invoke('check-song-exists', params),
  
  // Voz do Brasil download
  downloadVozBrasil: (params) => ipcRenderer.invoke('download-voz-brasil', params),
  cleanupVozBrasil: (params) => ipcRenderer.invoke('cleanup-voz-brasil', params),
  onVozDownloadProgress: (callback) => ipcRenderer.on('voz-download-progress', (_, progress) => callback(progress)),
  
  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_, info) => callback(info)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (_, info) => callback(info)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_, progress) => callback(progress)),
  
  // Platform detection
  platform: process.platform,
  isElectron: true,
});
