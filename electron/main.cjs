const { app, BrowserWindow, Menu, Tray, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const https = require('https');

let mainWindow;
let tray = null;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Check if deemix is installed
function checkDeemixInstalled() {
  return new Promise((resolve) => {
    exec('deemix --help', (error) => {
      resolve(!error);
    });
  });
}

// Show Windows notification
function showNotification(title, body, onClick) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      icon: path.join(__dirname, '../public/favicon.ico'),
      silent: false,
    });
    
    if (onClick) {
      notification.on('click', onClick);
    }
    
    notification.show();
    return notification;
  }
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
      preload: path.join(__dirname, 'preload.cjs'),
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
              detail: 'Versão 5.1 (V21)\n\nSistema de geração automática de grades de programação para rádios FM.\n\nIntegração Deezer via deemix.\n\n© 2024 PGM-FM',
            });
          },
        },
        {
          label: 'Verificar deemix',
          click: async () => {
            const { dialog } = require('electron');
            const installed = await checkDeemixInstalled();
            dialog.showMessageBox(mainWindow, {
              type: installed ? 'info' : 'warning',
              title: 'Status do deemix',
              message: installed ? 'deemix está instalado!' : 'deemix NÃO encontrado',
              detail: installed 
                ? 'O deemix CLI está configurado corretamente.'
                : 'Instale o deemix com: pip install deemix\n\nOu baixe em: https://deemix.app',
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

// Check if deemix is available
ipcMain.handle('check-deemix', async () => {
  return await checkDeemixInstalled();
});

// Show notification from renderer
ipcMain.handle('show-notification', (event, { title, body }) => {
  showNotification(title, body, () => {
    mainWindow.show();
    mainWindow.focus();
  });
});

// Search track on Deezer API
async function searchDeezerTrack(artist, title) {
  return new Promise((resolve, reject) => {
    const searchQuery = encodeURIComponent(`${artist} ${title}`);
    const searchUrl = `https://api.deezer.com/search?q=${searchQuery}&limit=5`;
    
    https.get(searchUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.data && result.data.length > 0) {
            resolve(result.data[0]);
          } else {
            reject(new Error('Música não encontrada no Deezer'));
          }
        } catch (e) {
          reject(new Error('Falha ao parsear resposta do Deezer'));
        }
      });
    }).on('error', reject);
  });
}

// Save ARL to deemix config
function saveArlToDeemixConfig(arl) {
  const deemixConfigDir = path.join(app.getPath('home'), '.config', 'deemix');
  const arlFile = path.join(deemixConfigDir, '.arl');
  
  try {
    if (!fs.existsSync(deemixConfigDir)) {
      fs.mkdirSync(deemixConfigDir, { recursive: true });
    }
    fs.writeFileSync(arlFile, arl, 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save ARL:', error);
    return false;
  }
}

// Deezer Download Handler using deemix CLI
ipcMain.handle('download-from-deezer', async (event, params) => {
  const { artist, title, arl, outputFolder, quality } = params;
  
  try {
    // First check if deemix is installed
    const deemixInstalled = await checkDeemixInstalled();
    
    if (!deemixInstalled) {
      return { 
        success: false, 
        error: 'deemix não está instalado. Instale com: pip install deemix',
        needsInstall: true
      };
    }

    // Ensure output folder exists
    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true });
    }

    // Save ARL to deemix config
    saveArlToDeemixConfig(arl);

    // Search for track on Deezer API to get the URL
    const track = await searchDeezerTrack(artist, title);
    const deezerUrl = track.link || `https://www.deezer.com/track/${track.id}`;
    
    // Map quality setting to deemix format
    const qualityMap = {
      'MP3_128': '128',
      'MP3_320': '320',
      'FLAC': 'flac'
    };
    const deemixQuality = qualityMap[quality] || '320';

    // Run deemix CLI
    return new Promise((resolve) => {
      const args = [
        deezerUrl,
        '-p', outputFolder,
        '-b', deemixQuality,
      ];

      console.log(`Running: deemix ${args.join(' ')}`);
      
      const deemixProcess = spawn('deemix', args, {
        shell: true,
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      deemixProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log('deemix stdout:', data.toString());
      });

      deemixProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        console.log('deemix stderr:', data.toString());
      });

      deemixProcess.on('close', (code) => {
        if (code === 0) {
          // Show Windows notification
          showNotification(
            '✅ Download Concluído',
            `${track.artist.name} - ${track.title}`,
            () => {
              shell.openPath(outputFolder);
            }
          );

          resolve({ 
            success: true, 
            track: {
              id: track.id,
              title: track.title,
              artist: track.artist.name,
              album: track.album.title,
              duration: track.duration,
            },
            output: stdout,
            message: `Download concluído: ${track.artist.name} - ${track.title}`
          });
        } else {
          resolve({ 
            success: false, 
            error: stderr || `deemix saiu com código ${code}`,
            output: stdout + stderr
          });
        }
      });

      deemixProcess.on('error', (error) => {
        resolve({ 
          success: false, 
          error: `Erro ao executar deemix: ${error.message}`
        });
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        deemixProcess.kill();
        resolve({ 
          success: false, 
          error: 'Timeout: download demorou mais de 2 minutos'
        });
      }, 120000);
    });
    
  } catch (error) {
    console.error('Deezer download error:', error);
    return { success: false, error: error.message || 'Erro ao baixar do Deezer' };
  }
});

// Batch download notification
ipcMain.handle('notify-batch-complete', (event, { completed, failed, total, outputFolder }) => {
  showNotification(
    '📦 Download em Lote Concluído',
    `✅ ${completed} baixadas | ❌ ${failed} falharam | Total: ${total}`,
    () => {
      if (outputFolder) {
        shell.openPath(outputFolder);
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  );
});

// Open folder in explorer
ipcMain.handle('open-folder', (event, folderPath) => {
  if (fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
    return { success: true };
  }
  return { success: false, error: 'Pasta não encontrada' };
});
