const { app, BrowserWindow, Menu, Tray, ipcMain, shell, Notification, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');

// Auto-updater (only in packaged app)
let autoUpdater = null;
if (app.isPackaged) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.log('electron-updater not available:', e.message);
  }
}

// Scraped songs cache to avoid duplicates
let scrapedSongsCache = new Map();

let mainWindow;
let tray = null;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Check if deemix is installed and return the command to use
let deemixCommand = 'deemix';

function checkDeemixInstalled() {
  return new Promise((resolve) => {
    // Try direct deemix command first
    exec('deemix --help', (error) => {
      if (!error) {
        deemixCommand = 'deemix';
        resolve(true);
        return;
      }
      // Try python -m deemix
      exec('python -m deemix --help', (error2) => {
        if (!error2) {
          deemixCommand = 'python -m deemix';
          resolve(true);
          return;
        }
        // Try python3 -m deemix
        exec('python3 -m deemix --help', (error3) => {
          if (!error3) {
            deemixCommand = 'python3 -m deemix';
            resolve(true);
            return;
          }
          resolve(false);
        });
      });
    });
  });
}

// Check if Python/pip is available
function checkPythonAvailable() {
  return new Promise((resolve) => {
    // Try pip first
    exec('pip --version', (error) => {
      if (!error) {
        resolve({ available: true, command: 'pip' });
        return;
      }
      // Try pip3
      exec('pip3 --version', (error2) => {
        if (!error2) {
          resolve({ available: true, command: 'pip3' });
          return;
        }
        // Try python -m pip
        exec('python -m pip --version', (error3) => {
          if (!error3) {
            resolve({ available: true, command: 'python -m pip' });
            return;
          }
          // Try python3 -m pip
          exec('python3 -m pip --version', (error4) => {
            if (!error4) {
              resolve({ available: true, command: 'python3 -m pip' });
              return;
            }
            resolve({ available: false, command: null });
          });
        });
      });
    });
  });
}

// Install deemix via pip
function installDeemix() {
  return new Promise(async (resolve) => {
    const pythonStatus = await checkPythonAvailable();
    
    if (!pythonStatus.available) {
      resolve({ 
        success: false, 
        error: 'Python/pip não encontrado. Instale Python primeiro: https://www.python.org/downloads/',
        needsPython: true 
      });
      return;
    }

    // Send progress update
    if (mainWindow) {
      mainWindow.webContents.send('deemix-install-progress', { 
        status: 'installing', 
        message: `Instalando deemix usando ${pythonStatus.command}...` 
      });
    }

    const installCommand = `${pythonStatus.command} install deemix --user`;
    console.log(`Installing deemix with: ${installCommand}`);

    exec(installCommand, { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('deemix installation error:', error);
        console.error('stderr:', stderr);
        console.error('stdout:', stdout);
        
        // Try without --user flag
        const fallbackCommand = `${pythonStatus.command} install deemix`;
        console.log(`Trying fallback: ${fallbackCommand}`);
        
        exec(fallbackCommand, { timeout: 300000 }, (error2, stdout2, stderr2) => {
          if (error2) {
            resolve({ 
              success: false, 
              error: `Erro na instalação: ${stderr2 || stderr || error2.message}`,
              output: stdout2 || stdout 
            });
            return;
          }
          
          verifyAndResolve(stdout2, resolve);
        });
        return;
      }

      verifyAndResolve(stdout, resolve);
    });

    function verifyAndResolve(stdout, resolveFunc) {
      console.log('deemix installation output:', stdout);
      
      // Give the system a moment to register the command
      setTimeout(() => {
        // Verify installation - try multiple methods
        exec('deemix --help', (verifyError) => {
          if (verifyError) {
            // Try python -m deemix
            exec('python -m deemix --help', (verifyError2) => {
              if (verifyError2) {
                exec('python3 -m deemix --help', (verifyError3) => {
                  if (verifyError3) {
                    resolveFunc({ 
                      success: false, 
                      error: 'Instalação concluída mas deemix não está no PATH. Reinicie o aplicativo ou adicione Python Scripts ao PATH.',
                      output: stdout,
                      needsRestart: true
                    });
                  } else {
                    resolveFunc({ 
                      success: true, 
                      output: stdout,
                      message: 'deemix instalado com sucesso! Use python3 -m deemix.'
                    });
                  }
                });
              } else {
                resolveFunc({ 
                  success: true, 
                  output: stdout,
                  message: 'deemix instalado com sucesso! Use python -m deemix.'
                });
              }
            });
          } else {
            resolveFunc({ 
              success: true, 
              output: stdout,
              message: 'deemix instalado com sucesso!'
            });
          }
        });
      }, 2000); // Wait 2 seconds for system to register
    }
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
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, 'dist', 'index.html');
    // Use loadURL with file:// protocol and hash to ensure HashRouter works
    mainWindow.loadURL(`file://${indexPath}#/`);
  } else {
    mainWindow.loadURL('http://localhost:5173');
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
          label: 'Verificar Atualizações',
          click: async () => {
            if (autoUpdater) {
              try {
                await autoUpdater.checkForUpdates();
              } catch (error) {
                dialog.showMessageBox(mainWindow, {
                  type: 'error',
                  title: 'Erro',
                  message: 'Não foi possível verificar atualizações',
                  detail: error.message,
                });
              }
            } else {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Auto-Update',
                message: 'Auto-update não disponível',
                detail: 'O sistema de atualização automática só funciona na versão instalada.',
              });
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Sobre',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Sobre',
              message: 'Programador Rádio',
              detail: `Versão ${app.getVersion()}\n\nSistema de geração automática de grades de programação para rádios FM.\n\nIntegração Deezer via deemix.\n\n© 2024 PGM-FM`,
            });
          },
        },
        {
          label: 'Verificar deemix',
          click: async () => {
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

  tray.setToolTip(`Programador Rádio - v${app.getVersion()}`);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });
}

// Configure auto-updater
function setupAutoUpdater() {
  if (!autoUpdater) return;
  
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  
  autoUpdater.on('checking-for-update', () => {
    console.log('Verificando atualizações...');
  });
  
  autoUpdater.on('update-available', (info) => {
    console.log('Atualização disponível:', info.version);
    
    // Send to renderer
    if (mainWindow) {
      mainWindow.webContents.send('update-available', { 
        version: info.version, 
        releaseNotes: info.releaseNotes 
      });
    }
    
    showNotification(
      '🔄 Atualização Disponível',
      `Nova versão ${info.version} disponível. Clique para baixar.`,
      () => {
        autoUpdater.downloadUpdate();
      }
    );
    
    // Also show dialog
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Atualização Disponível',
      message: `Nova versão ${info.version} disponível!`,
      detail: `Deseja baixar e instalar a atualização agora?\n\nNotas: ${info.releaseNotes || 'Sem notas de versão.'}`,
      buttons: ['Baixar Agora', 'Mais Tarde'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });
  
  autoUpdater.on('update-not-available', () => {
    console.log('Nenhuma atualização disponível.');
  });
  
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    console.log(`Download: ${percent}%`);
    
    // Send progress to renderer
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', { percent: progress.percent });
      mainWindow.setProgressBar(progress.percent / 100);
    }
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    console.log('Atualização baixada:', info.version);
    
    // Send to renderer
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', { version: info.version });
      mainWindow.setProgressBar(-1); // Remove progress bar
    }
    
    showNotification(
      '✅ Atualização Pronta',
      `Versão ${info.version} pronta para instalar. Reinicie o aplicativo.`,
      () => {
        autoUpdater.quitAndInstall(false, true);
      }
    );
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Atualização Pronta',
      message: `Versão ${info.version} baixada com sucesso!`,
      detail: 'A atualização será instalada quando você reiniciar o aplicativo. Deseja reiniciar agora?',
      buttons: ['Reiniciar Agora', 'Mais Tarde'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });
  
  autoUpdater.on('error', (error) => {
    console.error('Erro no auto-updater:', error);
  });
}

// =============== FOLDER INITIALIZATION ===============

// Default folders to ensure exist on startup
const DEFAULT_FOLDERS = [
  'C:\\Playlist\\pgm\\Grades',
  'C:\\Playlist\\Downloads',
  'C:\\Playlist\\A Voz do Brasil',
  'C:\\Playlist\\Músicas',
];

// Ensure required folders exist
function ensureDefaultFolders() {
  console.log('[INIT] Checking/creating default folders...');
  
  for (const folder of DEFAULT_FOLDERS) {
    try {
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
        console.log(`[INIT] ✓ Created folder: ${folder}`);
      } else {
        console.log(`[INIT] ✓ Folder exists: ${folder}`);
      }
    } catch (error) {
      console.error(`[INIT] ✗ Failed to create folder ${folder}:`, error.message);
    }
  }
}

// App ready
app.whenReady().then(async () => {
  // Ensure default folders exist
  ensureDefaultFolders();
  
  createWindow();
  createTray();
  setupAutoUpdater();
  
  // Check Python/pip availability on startup and notify if missing
  const pythonStatus = await checkPythonAvailable();
  if (!pythonStatus.available) {
    console.log('[INIT] Python/pip not found - will prompt user when needed');
    // Notify renderer about Python status when window is ready
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.webContents.send('python-status', { 
          available: false, 
          message: 'Python não encontrado. Necessário para downloads do Deezer.',
          downloadUrl: 'https://www.python.org/downloads/'
        });
      }
    }, 3000);
  } else {
    console.log(`[INIT] ✓ Python available: ${pythonStatus.command}`);
    // Also check deemix on startup
    const deemixInstalled = await checkDeemixInstalled();
    console.log(`[INIT] ${deemixInstalled ? '✓' : '✗'} deemix: ${deemixInstalled ? deemixCommand : 'not installed'}`);
    
    // Notify renderer about deemix status
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.webContents.send('deemix-status', { 
          installed: deemixInstalled, 
          command: deemixInstalled ? deemixCommand : null 
        });
      }
    }, 3000);
  }
  
  // Check for updates after window is ready (only in production)
  if (autoUpdater && app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.log('Auto-update check failed:', err.message);
      });
    }, 5000); // Wait 5 seconds after startup
  }

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

// Select folder dialog
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Selecionar pasta de download',
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  
  return result.filePaths[0];
});

// Check if deemix is available
ipcMain.handle('check-deemix', async () => {
  const installed = await checkDeemixInstalled();
  return installed;
});

// Get the deemix command being used
ipcMain.handle('get-deemix-command', async () => {
  const installed = await checkDeemixInstalled();
  return installed ? deemixCommand : null;
});

// Check if Python is available
ipcMain.handle('check-python', async () => {
  return await checkPythonAvailable();
});

// Install deemix automatically
ipcMain.handle('install-deemix', async () => {
  // Send notification that installation is starting
  if (mainWindow) {
    mainWindow.webContents.send('deemix-install-progress', { status: 'starting', message: 'Iniciando instalação do deemix...' });
  }

  const result = await installDeemix();
  
  if (result.success) {
    showNotification('deemix Instalado!', 'O deemix foi instalado com sucesso. Você pode começar a baixar músicas!');
    if (mainWindow) {
      mainWindow.webContents.send('deemix-install-progress', { status: 'success', message: result.message });
    }
  } else {
    if (mainWindow) {
      mainWindow.webContents.send('deemix-install-progress', { status: 'error', message: result.error });
    }
  }

  return result;
});

// Test deemix with a simple help check (--version not supported)
ipcMain.handle('test-deemix', async () => {
  try {
    const installed = await checkDeemixInstalled();
    
    if (!installed) {
      return { 
        success: false, 
        error: 'deemix não está instalado' 
      };
    }

    // Run a simple test command - use --help since --version is not supported
    return new Promise((resolve) => {
      const testCommand = `${deemixCommand} --help`;
      console.log(`Testing deemix with: ${testCommand}`);
      
      exec(testCommand, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          console.error('deemix test error:', error);
          resolve({ 
            success: false, 
            error: `Erro ao testar deemix: ${stderr || error.message}`,
            command: deemixCommand
          });
          return;
        }

        // Check if the help output contains expected deemix text
        const isWorking = stdout.includes('deemix') || stdout.includes('Usage') || stdout.includes('URL');
        
        if (isWorking) {
          console.log('deemix test passed');
          resolve({ 
            success: true, 
            version: 'instalado',
            command: deemixCommand,
            message: `deemix funcionando corretamente!`
          });
        } else {
          resolve({ 
            success: false, 
            error: 'deemix não respondeu corretamente',
            command: deemixCommand
          });
        }
      });
    });
  } catch (error) {
    return { 
      success: false, 
      error: error.message || 'Erro desconhecido ao testar deemix'
    };
  }
});

// Test deemix with a real search (no download)
ipcMain.handle('test-deemix-search', async (event, { artist, title }) => {
  try {
    // Just test the Deezer API search
    const track = await searchDeezerTrack(artist, title);
    
    return {
      success: true,
      track: {
        id: track.id,
        title: track.title,
        artist: track.artist.name,
        album: track.album.title,
        preview: track.preview,
        link: track.link,
      },
      message: `Encontrado: ${track.artist.name} - ${track.title}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Música não encontrada'
    };
  }
});

// Show notification from renderer
ipcMain.handle('show-notification', (event, { title, body }) => {
  showNotification(title, body, () => {
    mainWindow.show();
    mainWindow.focus();
  });
});

// Auto-update IPC handler
ipcMain.handle('check-for-updates', async () => {
  if (autoUpdater) {
    try {
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Auto-updater not available' };
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

    // Run deemix CLI using the detected command
    return new Promise((resolve) => {
      // Build the full command string
      const fullCommand = `${deemixCommand} "${deezerUrl}" -p "${outputFolder}" -b ${deemixQuality}`;

      console.log(`[DEEMIX] Running: ${fullCommand}`);
      console.log(`[DEEMIX] Output folder: ${outputFolder}`);
      
      exec(fullCommand, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
          console.error('[DEEMIX] Error:', error);
          console.error('[DEEMIX] Stderr:', stderr);
          resolve({ 
            success: false, 
            error: stderr || error.message,
            output: stdout + stderr
          });
          return;
        }

        console.log('[DEEMIX] Success output:', stdout);
        
        // Verify the file was created
        try {
          const files = fs.readdirSync(outputFolder);
          console.log(`[DEEMIX] Files in output folder: ${files.join(', ')}`);
        } catch (e) {
          console.log('[DEEMIX] Could not list output folder:', e.message);
        }
        
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
          outputFolder: outputFolder,
          message: `Download concluído: ${track.artist.name} - ${track.title}`
        });
      });
    });
    
  } catch (error) {
    console.error('[DEEMIX] Download error:', error);
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

// Open folder in explorer (create if not exists)
ipcMain.handle('open-folder', (event, folderPath) => {
  try {
    // Create folder if it doesn't exist
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      console.log(`[FOLDER] Created: ${folderPath}`);
    }
    shell.openPath(folderPath);
    return { success: true };
  } catch (error) {
    console.error(`[FOLDER] Error opening ${folderPath}:`, error.message);
    return { success: false, error: error.message };
  }
});

// Ensure folder exists (create if not)
ipcMain.handle('ensure-folder', (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      console.log(`[FOLDER] Created: ${folderPath}`);
      return { success: true, created: true };
    }
    return { success: true, created: false };
  } catch (error) {
    console.error(`[FOLDER] Error creating ${folderPath}:`, error.message);
    return { success: false, error: error.message };
  }
});

// =============== RADIO SCRAPING ===============

// Fetch HTML from URL
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 15000,
    };
    
    protocol.get(url, options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchHtml(res.headers.location).then(resolve).catch(reject);
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

// Parse songs from Online Radio Box HTML
function parseOnlineRadioBox(html, stationName) {
  const songs = [];
  // Look for playlist items - pattern: <a class="track_history_item">...</a>
  const trackRegex = /<a[^>]*class="[^"]*track_history[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
  const matches = html.match(trackRegex) || [];
  
  for (const match of matches.slice(0, 20)) {
    // Extract artist and title
    const artistMatch = match.match(/<span[^>]*class="[^"]*artist[^"]*"[^>]*>([^<]+)<\/span>/i);
    const titleMatch = match.match(/<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/span>/i);
    
    if (artistMatch && titleMatch) {
      const artist = artistMatch[1].trim();
      const title = titleMatch[1].trim();
      if (artist && title && artist.length > 1 && title.length > 1) {
        songs.push({
          artist,
          title,
          station: stationName,
          timestamp: new Date(),
        });
      }
    }
  }
  
  // Alternative pattern for different layout
  if (songs.length === 0) {
    const altRegex = /<li[^>]*class="[^"]*(?:track|song|item)[^"]*"[^>]*>[\s\S]*?<\/li>/gi;
    const altMatches = html.match(altRegex) || [];
    
    for (const match of altMatches.slice(0, 20)) {
      // Try to find artist - title pattern
      const textContent = match.replace(/<[^>]+>/g, ' ').trim();
      const parts = textContent.split(/\s*[-–—]\s*/);
      if (parts.length >= 2) {
        const artist = parts[0].trim();
        const title = parts[1].trim();
        if (artist && title && artist.length > 1 && title.length > 1) {
          songs.push({
            artist,
            title,
            station: stationName,
            timestamp: new Date(),
          });
        }
      }
    }
  }
  
  return songs;
}

// Parse songs from generic radio sites
function parseGenericRadioSite(html, stationName) {
  const songs = [];
  
  // Pattern 1: Look for "artist - title" in various elements
  const patterns = [
    /<(?:div|span|p|li)[^>]*class="[^"]*(?:song|track|music|playing|current|now)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|p|li)>/gi,
    /<h[1-6][^>]*class="[^"]*(?:song|track|music)[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && songs.length < 20) {
      const content = match[1].replace(/<[^>]+>/g, ' ').trim();
      const parts = content.split(/\s*[-–—]\s*/);
      if (parts.length >= 2) {
        const artist = parts[0].trim();
        const title = parts.slice(1).join(' - ').trim();
        if (artist && title && artist.length > 1 && title.length > 1 && artist.length < 100) {
          songs.push({
            artist,
            title,
            station: stationName,
            timestamp: new Date(),
          });
        }
      }
    }
  }
  
  return songs;
}

// Scrape songs from a station URL
async function scrapeStation(stationConfig) {
  const allSongs = [];
  
  for (const url of stationConfig.urls) {
    try {
      console.log(`[SCRAPE] Fetching ${url}...`);
      const html = await fetchHtml(url);
      
      let songs = [];
      if (url.includes('onlineradiobox.com')) {
        songs = parseOnlineRadioBox(html, stationConfig.name);
      } else {
        songs = parseGenericRadioSite(html, stationConfig.name);
      }
      
      // Filter out duplicates and already seen songs
      for (const song of songs) {
        const key = `${song.artist.toLowerCase()}-${song.title.toLowerCase()}`;
        if (!scrapedSongsCache.has(key)) {
          scrapedSongsCache.set(key, Date.now());
          allSongs.push({
            ...song,
            id: `${stationConfig.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            status: 'found',
          });
        }
      }
      
      if (songs.length > 0) {
        console.log(`[SCRAPE] Found ${songs.length} songs from ${stationConfig.name} (${url})`);
        break; // Got songs from this URL, don't need to try others
      }
    } catch (error) {
      console.error(`[SCRAPE] Error fetching ${url}:`, error.message);
    }
  }
  
  // Clean old entries from cache (older than 1 hour)
  const oneHourAgo = Date.now() - 3600000;
  for (const [key, timestamp] of scrapedSongsCache.entries()) {
    if (timestamp < oneHourAgo) {
      scrapedSongsCache.delete(key);
    }
  }
  
  return allSongs;
}

// IPC handler to scrape all stations
ipcMain.handle('scrape-stations', async (event, stations) => {
  const results = {
    songs: [],
    errors: [],
    timestamp: new Date().toISOString(),
  };
  
  for (const station of stations) {
    if (!station.enabled) continue;
    
    try {
      const songs = await scrapeStation(station);
      results.songs.push(...songs);
    } catch (error) {
      results.errors.push({
        station: station.name,
        error: error.message,
      });
    }
  }
  
  console.log(`[SCRAPE] Total: ${results.songs.length} new songs from ${stations.length} stations`);
  return results;
});

// IPC handler to scrape single station
ipcMain.handle('scrape-station', async (event, station) => {
  try {
    const songs = await scrapeStation(station);
    return { success: true, songs };
  } catch (error) {
    return { success: false, error: error.message, songs: [] };
  }
});

// =============== MUSIC LIBRARY CHECK ===============

// Normalize text for file matching (remove accents, special chars, etc.)
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, ' ')
    .trim();
}

// Check if a song exists in the music library folders
async function checkSongInLibrary(artist, title, musicFolders) {
  const normalizedArtist = normalizeText(artist);
  const normalizedTitle = normalizeText(title);
  
  for (const folder of musicFolders) {
    try {
      if (!fs.existsSync(folder)) continue;
      
      // Recursive function to scan directories
      const scanDir = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            const result = scanDir(fullPath);
            if (result) return result;
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma'].includes(ext)) {
              const fileName = normalizeText(path.basename(entry.name, ext));
              
              // Check if filename contains both artist and title
              if (fileName.includes(normalizedArtist) && fileName.includes(normalizedTitle)) {
                return { exists: true, path: fullPath };
              }
              
              // Alternative: check for "artist - title" pattern
              const pattern1 = `${normalizedArtist} ${normalizedTitle}`;
              const pattern2 = `${normalizedTitle} ${normalizedArtist}`;
              if (fileName.includes(pattern1) || fileName.includes(pattern2)) {
                return { exists: true, path: fullPath };
              }
            }
          }
        }
        return null;
      };
      
      const result = scanDir(folder);
      if (result) return result;
      
    } catch (error) {
      console.error(`Error scanning folder ${folder}:`, error.message);
    }
  }
  
  return { exists: false };
}

// IPC handler to check if a song exists in the music library
ipcMain.handle('check-song-exists', async (event, params) => {
  const { artist, title, musicFolders } = params;
  
  try {
    console.log(`[LIBRARY] Checking: ${artist} - ${title}`);
    const result = await checkSongInLibrary(artist, title, musicFolders);
    console.log(`[LIBRARY] Result: ${result.exists ? 'FOUND at ' + result.path : 'NOT FOUND'}`);
    return result;
  } catch (error) {
    console.error('Error checking song:', error);
    return { exists: false };
  }
});

// =============== VOZ DO BRASIL DOWNLOAD ===============

// Download file from URL to specified folder
function downloadFile(url, outputFolder, filename, onProgress) {
  return new Promise((resolve, reject) => {
    // Ensure output folder exists
    if (!fs.existsSync(outputFolder)) {
      try {
        fs.mkdirSync(outputFolder, { recursive: true });
        console.log(`[VOZ] Created folder: ${outputFolder}`);
      } catch (err) {
        reject(new Error(`Não foi possível criar a pasta: ${err.message}`));
        return;
      }
    }

    const filePath = path.join(outputFolder, filename);
    const protocol = url.startsWith('https') ? https : http;
    
    console.log(`[VOZ] Starting download from: ${url}`);
    console.log(`[VOZ] Saving to: ${filePath}`);
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      },
      timeout: 60000,
    };

    const request = protocol.get(url, options, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log(`[VOZ] Redirect to: ${response.headers.location}`);
        downloadFile(response.headers.location, outputFolder, filename, onProgress)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;
      
      console.log(`[VOZ] Total size: ${totalSize} bytes`);

      const fileStream = fs.createWriteStream(filePath);
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize > 0 && onProgress) {
          const progress = Math.round((downloadedSize / totalSize) * 100);
          onProgress(progress, downloadedSize, totalSize);
        }
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`[VOZ] Download complete: ${filePath} (${downloadedSize} bytes)`);
        resolve({
          success: true,
          filePath,
          fileSize: downloadedSize,
        });
      });

      fileStream.on('error', (err) => {
        fs.unlink(filePath, () => {}); // Delete partial file
        reject(err);
      });
    });

    request.on('error', (err) => {
      reject(err);
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Timeout: download demorou demais'));
    });
  });
}

// IPC handler for Voz do Brasil download
ipcMain.handle('download-voz-brasil', async (event, params) => {
  const { url, outputFolder, filename } = params;
  
  console.log(`[VOZ] Download request: ${filename}`);
  console.log(`[VOZ] URL: ${url}`);
  console.log(`[VOZ] Folder: ${outputFolder}`);
  
  try {
    const result = await downloadFile(url, outputFolder, filename, (progress, downloaded, total) => {
      // Send progress to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('voz-download-progress', { progress, downloaded, total });
      }
    });
    
    // Show notification
    showNotification(
      '📻 A Voz do Brasil',
      `Download concluído: ${filename}`,
      () => {
        shell.openPath(outputFolder);
      }
    );
    
    return result;
  } catch (error) {
    console.error('[VOZ] Download error:', error);
    return {
      success: false,
      error: error.message || 'Erro ao baixar arquivo',
    };
  }
});

// IPC handler to delete old Voz do Brasil files
ipcMain.handle('cleanup-voz-brasil', async (event, params) => {
  const { folder, maxAgeDays } = params;
  
  console.log(`[VOZ] Cleanup request: folder=${folder}, maxAgeDays=${maxAgeDays}`);
  
  try {
    if (!fs.existsSync(folder)) {
      return { success: true, deletedCount: 0 };
    }
    
    const files = fs.readdirSync(folder);
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    
    for (const file of files) {
      const filePath = path.join(folder, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        console.log(`[VOZ] Deleted old file: ${file}`);
        deletedCount++;
      }
    }
    
    return { success: true, deletedCount };
  } catch (error) {
    console.error('[VOZ] Cleanup error:', error);
    return { success: false, error: error.message };
  }
});

// =============== GRADE FILE SAVING ===============

// IPC handler to save grade file
ipcMain.handle('save-grade-file', async (event, params) => {
  const { folder, filename, content } = params;
  
  console.log(`[GRADE] Save request: ${filename} to ${folder}`);
  
  try {
    // Ensure folder exists
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
      console.log(`[GRADE] Created folder: ${folder}`);
    }
    
    const filePath = path.join(folder, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    
    console.log(`[GRADE] File saved: ${filePath}`);
    
    return {
      success: true,
      filePath,
    };
  } catch (error) {
    console.error('[GRADE] Save error:', error);
    return {
      success: false,
      error: error.message || 'Erro ao salvar arquivo',
    };
  }
});

// IPC handler to read grade file
ipcMain.handle('read-grade-file', async (event, params) => {
  const { folder, filename } = params;
  
  try {
    const filePath = path.join(folder, filename);
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'Arquivo não encontrado' };
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    console.error('[GRADE] Read error:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler to list files in folder
ipcMain.handle('list-folder-files', async (event, params) => {
  const { folder, extension } = params;
  
  try {
    if (!fs.existsSync(folder)) {
      return { success: true, files: [] };
    }
    
    let files = fs.readdirSync(folder);
    
    if (extension) {
      files = files.filter(f => f.endsWith(extension));
    }
    
    const fileDetails = files.map(f => {
      const filePath = path.join(folder, f);
      const stats = fs.statSync(filePath);
      return {
        name: f,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      };
    });
    
    return { success: true, files: fileDetails };
  } catch (error) {
    console.error('[FOLDER] List error:', error);
    return { success: false, error: error.message, files: [] };
  }
});
