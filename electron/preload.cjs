const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: (name) => ipcRenderer.invoke('get-app-path', name),
  
  // Shell operations
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  
  // Deezer download
  downloadFromDeezer: (params) => ipcRenderer.invoke('download-from-deezer', params),
  
  // Platform detection
  platform: process.platform,
  isElectron: true,
});

// Log that preload is running
console.log('Electron preload script loaded');
