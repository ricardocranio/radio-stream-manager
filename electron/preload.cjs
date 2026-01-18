const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: (name) => ipcRenderer.invoke('get-app-path', name),
  
  // Shell operations
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  openFolder: (path) => ipcRenderer.invoke('open-folder', path),
  
  // Deezer/deemix integration
  downloadFromDeezer: (params) => ipcRenderer.invoke('download-from-deezer', params),
  checkDeemix: () => ipcRenderer.invoke('check-deemix'),
  
  // Notifications
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  notifyBatchComplete: (stats) => ipcRenderer.invoke('notify-batch-complete', stats),
  
  // Platform detection
  platform: process.platform,
  isElectron: true,
});

// Log that preload is running
console.log('Electron preload script loaded');
