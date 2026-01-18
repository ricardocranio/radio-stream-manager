const { app, BrowserWindow, Menu, Tray, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow;
let tray = null;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    icon: path.join(__dirname, '../public/favicon.ico'),
    backgroundColor: '#0d1117',
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the app
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // Create application menu
  const menuTemplate = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Recarregar',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.reload(),
        },
        { type: 'separator' },
        {
          label: 'Sair',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar Tudo' },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'toggleDevTools', label: 'DevTools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom Normal' },
        { role: 'zoomIn', label: 'Aumentar Zoom' },
        { role: 'zoomOut', label: 'Diminuir Zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela Cheia' },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Sobre',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Sobre',
              message: 'Programador Rádio',
              detail: 'Versão 5.1\n\nSistema de geração automática de grades de programação para rádios FM.\n\n© 2024 PGM-FM',
            });
          },
        },
        {
          label: 'Abrir Pasta de Dados',
          click: () => {
            shell.openPath(app.getPath('userData'));
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

function createTray() {
  const iconPath = path.join(__dirname, '../public/favicon.ico');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Programador',
      click: () => {
        mainWindow.show();
      },
    },
    {
      label: 'Status: Ativo',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Programador Rádio - v5.1');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });
}

// App ready
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Second instance handling
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Window all closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Before quit
app.on('before-quit', () => {
  app.isQuitting = true;
});

// IPC Handlers for communication with renderer
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-app-path', (event, name) => {
  return app.getPath(name);
});

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('open-path', (event, filePath) => {
  shell.openPath(filePath);
});

// Deezer Download Handler
ipcMain.handle('download-from-deezer', async (event, params) => {
  const { artist, title, arl, outputFolder, quality } = params;
  const fs = require('fs');
  const https = require('https');
  const crypto = require('crypto');
  
  try {
    // Ensure output folder exists
    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true });
    }

    // Search for track on Deezer API
    const searchQuery = encodeURIComponent(`${artist} ${title}`);
    const searchUrl = `https://api.deezer.com/search?q=${searchQuery}&limit=1`;
    
    const searchResult = await new Promise((resolve, reject) => {
      https.get(searchUrl, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Falha ao parsear resposta do Deezer'));
          }
        });
      }).on('error', reject);
    });

    if (!searchResult.data || searchResult.data.length === 0) {
      return { success: false, error: 'Música não encontrada no Deezer' };
    }

    const track = searchResult.data[0];
    
    // For now, return track info - full download requires deemix or similar
    // This is a placeholder that shows the track was found
    // Real implementation would use deemix CLI or deezer-downloader
    
    return { 
      success: true, 
      track: {
        id: track.id,
        title: track.title,
        artist: track.artist.name,
        album: track.album.title,
        duration: track.duration,
        preview: track.preview,
      },
      message: `Música encontrada: ${track.artist.name} - ${track.title}. Para download completo, use deemix CLI.`
    };
    
  } catch (error) {
    console.error('Deezer download error:', error);
    return { success: false, error: error.message || 'Erro ao baixar do Deezer' };
  }
});
