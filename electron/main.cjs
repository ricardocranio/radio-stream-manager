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

  // =============== WHITE SCREEN RECOVERY ===============
  // Auto-reload on failed loads or render crashes
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[WINDOW] Load failed: ${errorCode} - ${errorDescription}`);
    // Wait 2 seconds and try to reload
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('[WINDOW] Attempting auto-reload after failed load...');
        mainWindow.reload();
      }
    }, 2000);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error(`[WINDOW] Render process gone: ${details.reason}`);
    // Wait 1 second and try to reload
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('[WINDOW] Attempting recovery after render crash...');
        mainWindow.reload();
      }
    }, 1000);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.error('[WINDOW] Window became unresponsive');
    // Show dialog asking if user wants to reload
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Aplicação Não Responde',
      message: 'A aplicação parou de responder.',
      detail: 'Deseja recarregar a aplicação?',
      buttons: ['Recarregar', 'Aguardar'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.reload();
      }
    });
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('[WINDOW] Window became responsive again');
  });

  // Monitor for blank/white screen by checking if content loaded
  let contentCheckAttempts = 0;
  const maxContentCheckAttempts = 3;
  
  mainWindow.webContents.on('did-finish-load', () => {
    contentCheckAttempts = 0;
    // After 3 seconds, check if page rendered properly
    setTimeout(async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          // Check if document body has content
          const hasContent = await mainWindow.webContents.executeJavaScript(`
            document.body && document.body.innerHTML && document.body.innerHTML.length > 100
          `);
          
          if (!hasContent) {
            console.error('[WINDOW] Blank screen detected!');
            contentCheckAttempts++;
            
            if (contentCheckAttempts < maxContentCheckAttempts) {
              console.log(`[WINDOW] Reload attempt ${contentCheckAttempts}/${maxContentCheckAttempts}...`);
              mainWindow.reload();
            } else {
              console.error('[WINDOW] Max reload attempts reached, showing error');
              dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Erro de Carregamento',
                message: 'A aplicação não carregou corretamente.',
                detail: 'Tente reiniciar o aplicativo. Se o problema persistir, reinstale o programa.',
                buttons: ['Reiniciar', 'Fechar'],
                defaultId: 0,
              }).then(({ response }) => {
                if (response === 0) {
                  app.relaunch();
                  app.isQuitting = true;
                  app.quit();
                } else {
                  app.isQuitting = true;
                  app.quit();
                }
              });
            }
          } else {
            console.log('[WINDOW] Content loaded successfully');
          }
        } catch (e) {
          console.error('[WINDOW] Error checking content:', e.message);
        }
      }
    }, 3000);
  });

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

/**
 * Robust function to show and focus the main window
 * Handles cases where window is destroyed, minimized, or hidden
 */
function showMainWindow() {
  try {
    // If window doesn't exist or was destroyed, recreate it
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.log('[WINDOW] Window destroyed, recreating...');
      createWindow();
      return;
    }

    // Restore if minimized
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    // Show if hidden
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    // Always focus
    mainWindow.focus();

    console.log('[WINDOW] Window shown and focused');
  } catch (error) {
    console.error('[WINDOW] Error showing window:', error.message);
    // Try to recreate as last resort
    try {
      createWindow();
    } catch (recreateError) {
      console.error('[WINDOW] Failed to recreate window:', recreateError.message);
    }
  }
}

function createTray() {
  // Don't create duplicate tray
  if (tray && !tray.isDestroyed()) {
    return;
  }

  const iconPath = path.join(__dirname, '../public/favicon.ico');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Programador',
      click: () => {
        showMainWindow();
      },
    },
    {
      label: 'Status: Ativo',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Reiniciar',
      click: () => {
        app.relaunch();
        app.isQuitting = true;
        app.quit();
      },
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

  // Single click to show window
  tray.on('click', () => {
    showMainWindow();
  });

  // Double click also shows window
  tray.on('double-click', () => {
    showMainWindow();
  });

  console.log('[TRAY] System tray icon created');
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
    
    // AUTO-INSTALL DEEMIX if Python is available but deemix is not
    if (!deemixInstalled) {
      console.log('[INIT] 🔄 Auto-installing deemix silently...');
      
      // Notify renderer about auto-installation
      setTimeout(() => {
        if (mainWindow) {
          mainWindow.webContents.send('deemix-install-progress', { 
            status: 'auto-installing', 
            message: 'Instalando deemix automaticamente...' 
          });
        }
      }, 2000);
      
      // Install deemix silently
      const installResult = await installDeemix();
      
      if (installResult.success) {
        console.log('[INIT] ✓ deemix auto-installed successfully!');
        showNotification(
          'deemix Instalado!', 
          'O deemix foi instalado automaticamente. Downloads do Deezer estão prontos!'
        );
        
        setTimeout(() => {
          if (mainWindow) {
            mainWindow.webContents.send('deemix-status', { 
              installed: true, 
              command: deemixCommand,
              autoInstalled: true
            });
          }
        }, 1000);
      } else {
        console.error('[INIT] ✗ deemix auto-install failed:', installResult.error);
        setTimeout(() => {
          if (mainWindow) {
            mainWindow.webContents.send('deemix-status', { 
              installed: false, 
              error: installResult.error,
              autoInstallFailed: true
            });
          }
        }, 1000);
      }
    } else {
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

// Second instance handling - use robust showMainWindow
app.on('second-instance', () => {
  showMainWindow();
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

// IPC handler to show and focus the main window (called from browser Service Mode)
ipcMain.handle('show-window', () => {
  console.log('[IPC] show-window request received');
  showMainWindow();
  return { success: true };
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

// Save ARL to deemix config (works on Windows and Linux/Mac)
function saveArlToDeemixConfig(arl) {
  // On Windows, deemix config is in AppData/Roaming/deemix
  // On Linux/Mac, it's in ~/.config/deemix
  const isWindows = process.platform === 'win32';
  let deemixConfigDir;
  
  if (isWindows) {
    // Primary: AppData/Roaming/deemix (where deemix actually looks)
    deemixConfigDir = path.join(app.getPath('appData'), 'deemix');
  } else {
    // Linux/Mac: ~/.config/deemix
    deemixConfigDir = path.join(app.getPath('home'), '.config', 'deemix');
  }
  
  const arlFile = path.join(deemixConfigDir, '.arl');
  
  console.log(`[DEEMIX] Saving ARL to: ${arlFile}`);
  
  try {
    if (!fs.existsSync(deemixConfigDir)) {
      fs.mkdirSync(deemixConfigDir, { recursive: true });
      console.log(`[DEEMIX] Created config dir: ${deemixConfigDir}`);
    }
    fs.writeFileSync(arlFile, arl, 'utf8');
    console.log(`[DEEMIX] ARL saved successfully`);
    return true;
  } catch (error) {
    console.error('[DEEMIX] Failed to save ARL:', error);
    return false;
  }
}

// Check if a file exists in any subfolder (for anti-duplicate logic)
function checkFileExistsInSubfolders(baseFolder, searchPattern) {
  try {
    if (!fs.existsSync(baseFolder)) return { exists: false };
    
    const items = fs.readdirSync(baseFolder, { withFileTypes: true });
    const searchLower = searchPattern.toLowerCase();
    
    // Check files in base folder
    for (const item of items) {
      if (item.isFile()) {
        const fileName = path.basename(item.name, path.extname(item.name)).toLowerCase();
        if (fileName.includes(searchLower) || searchLower.includes(fileName)) {
          return { exists: true, path: path.join(baseFolder, item.name) };
        }
      }
    }
    
    // Check subfolders (station folders)
    for (const item of items) {
      if (item.isDirectory()) {
        const subfolderPath = path.join(baseFolder, item.name);
        const subFiles = fs.readdirSync(subfolderPath);
        for (const file of subFiles) {
          const fileName = path.basename(file, path.extname(file)).toLowerCase();
          if (fileName.includes(searchLower) || searchLower.includes(fileName)) {
            return { exists: true, path: path.join(subfolderPath, file), station: item.name };
          }
        }
      }
    }
    
    return { exists: false };
  } catch (error) {
    console.error('[FOLDER] Error checking subfolders:', error.message);
    return { exists: false };
  }
}

// Sanitize folder name for filesystem
function sanitizeFolderName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

// Cleanup partial/incomplete files after a timeout kill
function cleanupPartialFiles(folder, filesBefore) {
  try {
    const filesAfter = fs.readdirSync(folder);
    const newFiles = filesAfter.filter(f => !filesBefore.has(f));
    for (const file of newFiles) {
      const filePath = path.join(folder, file);
      try {
        const stat = fs.statSync(filePath);
        // Delete files smaller than 500KB (likely partial)
        if (stat.size < 500 * 1024) {
          fs.unlinkSync(filePath);
          console.log(`[DEEMIX] 🗑️ Cleaned up partial file: ${file} (${Math.round(stat.size / 1024)} KB)`);
        }
      } catch (e) {
        console.warn(`[DEEMIX] Could not check/delete: ${file}`, e.message);
      }
    }
  } catch (e) {
    console.warn('[DEEMIX] Cleanup error:', e.message);
  }
}

// IPC: Create station folders for all active stations
ipcMain.handle('ensure-station-folders', async (event, { baseFolder, stations }) => {
  console.log(`[FOLDERS] Creating station folders in: ${baseFolder}`);
  const created = [];
  
  try {
    if (!fs.existsSync(baseFolder)) {
      fs.mkdirSync(baseFolder, { recursive: true });
    }
    
    for (const stationName of stations) {
      const sanitized = sanitizeFolderName(stationName);
      const folderPath = path.join(baseFolder, sanitized);
      
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        created.push(sanitized);
        console.log(`[FOLDERS] Created: ${folderPath}`);
      }
    }
    
    return { success: true, created, total: stations.length };
  } catch (error) {
    console.error('[FOLDERS] Error creating station folders:', error.message);
    return { success: false, error: error.message };
  }
});

// IPC: Check if file exists in any station subfolder
ipcMain.handle('check-file-in-subfolders', async (event, { baseFolder, artist, title }) => {
  const searchPattern = `${artist} - ${title}`;
  return checkFileExistsInSubfolders(baseFolder, searchPattern);
});

// Deezer Download Handler using deemix CLI
ipcMain.handle('download-from-deezer', async (event, params) => {
  const { artist, title, arl, outputFolder, quality, stationName } = params;
  
  // If stationName provided, use station subfolder
  const sanitizedStation = stationName ? sanitizeFolderName(stationName) : null;
  const finalOutputFolder = sanitizedStation 
    ? path.join(outputFolder, sanitizedStation)
    : outputFolder;
  
  console.log(`[DEEMIX] === Starting download ===`);
  console.log(`[DEEMIX] Track: ${artist} - ${title}`);
  console.log(`[DEEMIX] Station: ${stationName || 'N/A'}`);
  console.log(`[DEEMIX] Output: ${finalOutputFolder}`);
  console.log(`[DEEMIX] Quality: ${quality}`);
  
  // Check if file already exists in any subfolder (anti-duplicate)
  if (stationName) {
    const existingCheck = checkFileExistsInSubfolders(outputFolder, `${artist} - ${title}`);
    if (existingCheck.exists) {
      console.log(`[DEEMIX] File already exists at: ${existingCheck.path}`);
      return {
        success: true,
        skipped: true,
        existingPath: existingCheck.path,
        existingStation: existingCheck.station,
        message: `Arquivo já existe em ${existingCheck.station || 'pasta principal'}`
      };
    }
  }
  
  try {
    // First check if deemix is installed
    const deemixInstalled = await checkDeemixInstalled();
    
    if (!deemixInstalled) {
      console.log(`[DEEMIX] ERROR: deemix not installed`);
      return { 
        success: false, 
        error: 'deemix não está instalado. Instale com: pip install deemix',
        needsInstall: true
      };
    }
    
    console.log(`[DEEMIX] Using command: ${deemixCommand}`);

    // Ensure output folder exists (use finalOutputFolder for station subfolders)
    if (!fs.existsSync(finalOutputFolder)) {
      console.log(`[DEEMIX] Creating output folder: ${finalOutputFolder}`);
      try {
        fs.mkdirSync(finalOutputFolder, { recursive: true });
      } catch (mkdirError) {
        console.error(`[DEEMIX] Failed to create folder: ${mkdirError.message}`);
        return {
          success: false,
          error: `Não foi possível criar a pasta: ${finalOutputFolder}. Verifique as permissões.`
        };
      }
    }

    // Verify folder is writable
    try {
      const testFile = path.join(finalOutputFolder, '.deemix_test');
      fs.writeFileSync(testFile, 'test', 'utf8');
      fs.unlinkSync(testFile);
      console.log(`[DEEMIX] Output folder is writable`);
    } catch (writeError) {
      console.error(`[DEEMIX] Folder not writable: ${writeError.message}`);
      return {
        success: false,
        error: `Pasta não tem permissão de escrita: ${finalOutputFolder}`
      };
    }

    // Save ARL to deemix config
    const arlSaved = saveArlToDeemixConfig(arl);
    if (!arlSaved) {
      console.log(`[DEEMIX] Warning: Failed to save ARL to config`);
    }

    // Search for track on Deezer API to get the URL
    console.log(`[DEEMIX] Searching Deezer API...`);
    let track;
    try {
      track = await searchDeezerTrack(artist, title);
      console.log(`[DEEMIX] Found: ${track.artist.name} - ${track.title} (ID: ${track.id})`);
    } catch (searchError) {
      console.error(`[DEEMIX] Search failed: ${searchError.message}`);
      return {
        success: false,
        error: `Música não encontrada no Deezer: ${artist} - ${title}`
      };
    }
    
    const deezerUrl = track.link || `https://www.deezer.com/track/${track.id}`;
    
    // Map quality setting to deemix format
    const qualityMap = {
      'MP3_128': '128',
      'MP3_320': '320',
      'FLAC': 'flac'
    };
    const deemixQuality = qualityMap[quality] || '320';

    // Get files BEFORE download to detect the new file
    let filesBefore = new Set();
    try {
      filesBefore = new Set(fs.readdirSync(finalOutputFolder));
    } catch (e) { /* folder may not exist yet */ }

    // Run deemix CLI using the detected command — NO TIMEOUT to never kill downloads
    return new Promise((resolve) => {
      // Build the full command string - use finalOutputFolder for station subfolder
      const fullCommand = `${deemixCommand} "${deezerUrl}" -p "${finalOutputFolder}" -b ${deemixQuality}`;

      console.log(`[DEEMIX] Executing: ${fullCommand}`);
      console.log(`[DEEMIX] ⏳ Sem timeout — processo será aguardado até concluir.`);
      
      const downloadStartTime = Date.now();
      let lastProgressLog = Date.now();
      
      // Use exec WITHOUT timeout — deemix must NEVER be killed
      const childProcess = exec(fullCommand, { timeout: 0, maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        const elapsedSec = Math.round((Date.now() - downloadStartTime) / 1000);
        console.log(`[DEEMIX] Process finished after ${elapsedSec}s`);
        console.log(`[DEEMIX] STDOUT: ${stdout}`);
        if (stderr) console.log(`[DEEMIX] STDERR: ${stderr}`);
        
        if (error) {
          console.error('[DEEMIX] Exec error:', error.message);
          
          // Only log — never kill. If the process was externally killed, report it
          if (error.killed || error.signal === 'SIGTERM') {
            console.error('[DEEMIX] ⚠️ Processo foi terminado EXTERNAMENTE (não por timeout)');
            cleanupPartialFiles(finalOutputFolder, filesBefore);
            resolve({ 
              success: false, 
              error: 'Processo deemix foi interrompido externamente. O download será tentado novamente.',
              output: stdout + stderr
            });
            return;
          }
          
          // Check for common error patterns
          let errorMessage = stderr || error.message;
          
          if (errorMessage.includes('arl') || errorMessage.includes('ARL') || errorMessage.includes('login')) {
            errorMessage = 'ARL inválida ou expirada. Obtenha uma nova ARL nos cookies do Deezer.';
          } else if (errorMessage.includes('premium') || errorMessage.includes('Premium')) {
            errorMessage = 'Esta música requer conta Premium do Deezer.';
          } else if (errorMessage.includes('not found') || errorMessage.includes('não encontr')) {
            errorMessage = 'Música não encontrada no Deezer.';
          }
          
          resolve({ 
            success: false, 
            error: errorMessage,
            output: stdout + stderr
          });
          return;
        }

        console.log('[DEEMIX] Process finished, verifying file integrity...');
        
        // === FILE INTEGRITY VERIFICATION ===
        // Wait a moment for filesystem sync, then verify
        setTimeout(() => {
          try {
            const filesAfter = fs.readdirSync(finalOutputFolder);
            const newFiles = filesAfter.filter(f => !filesBefore.has(f) && /\.(mp3|flac|MP3|FLAC)$/i.test(f));
            
            console.log(`[DEEMIX] New files detected: ${newFiles.length}`);
            
            if (newFiles.length === 0) {
              console.error('[DEEMIX] ❌ No new audio file found after download!');
              resolve({
                success: false,
                error: 'Download aparentemente concluiu mas nenhum arquivo de áudio foi encontrado.',
                output: stdout + stderr
              });
              return;
            }
            
            // Verify file integrity for each new file
            let validFile = null;
            for (const newFile of newFiles) {
              const filePath = path.join(finalOutputFolder, newFile);
              const stat = fs.statSync(filePath);
              const fileSizeKB = Math.round(stat.size / 1024);
              
              console.log(`[DEEMIX] Checking: ${newFile} (${fileSizeKB} KB)`);
              
              // Minimum size check: MP3 should be at least 500KB for a real song
              // (a 3-min MP3 at 128kbps ≈ 2.8MB, at 320kbps ≈ 7MB)
              if (stat.size < 500 * 1024) {
                console.error(`[DEEMIX] ❌ File too small (${fileSizeKB} KB) — likely corrupted or partial: ${newFile}`);
                // Delete the corrupt file
                try {
                  fs.unlinkSync(filePath);
                  console.log(`[DEEMIX] 🗑️ Deleted corrupt file: ${newFile}`);
                } catch (delErr) {
                  console.error(`[DEEMIX] Could not delete corrupt file: ${delErr.message}`);
                }
                continue;
              }
              
              // MP3 header verification: check for ID3 tag or MP3 sync word
              try {
                const headerBuffer = Buffer.alloc(10);
                const fd = fs.openSync(filePath, 'r');
                fs.readSync(fd, headerBuffer, 0, 10, 0);
                fs.closeSync(fd);
                
                const hasID3 = headerBuffer[0] === 0x49 && headerBuffer[1] === 0x44 && headerBuffer[2] === 0x33; // "ID3"
                const hasMP3Sync = (headerBuffer[0] === 0xFF && (headerBuffer[1] & 0xE0) === 0xE0); // MP3 sync
                const hasFLAC = headerBuffer[0] === 0x66 && headerBuffer[1] === 0x4C && headerBuffer[2] === 0x61 && headerBuffer[3] === 0x43; // "fLaC"
                
                if (!hasID3 && !hasMP3Sync && !hasFLAC) {
                  console.error(`[DEEMIX] ❌ Invalid audio header for: ${newFile}`);
                  try {
                    fs.unlinkSync(filePath);
                    console.log(`[DEEMIX] 🗑️ Deleted invalid file: ${newFile}`);
                  } catch (delErr) {
                    console.error(`[DEEMIX] Could not delete: ${delErr.message}`);
                  }
                  continue;
                }
              } catch (headerErr) {
                console.warn(`[DEEMIX] Could not verify header: ${headerErr.message}, accepting file`);
              }
              
              // File passed all checks
              validFile = newFile;
              console.log(`[DEEMIX] ✅ File integrity OK: ${newFile} (${fileSizeKB} KB)`);
              break;
            }
            
            if (!validFile) {
              console.error('[DEEMIX] ❌ All downloaded files failed integrity check');
              resolve({
                success: false,
                error: 'Download concluiu mas o arquivo está corrompido ou incompleto. Tente novamente.',
                output: stdout + stderr
              });
              return;
            }
            
            // Show Windows notification (only for manual downloads, not auto)
            if (!stationName) {
              showNotification(
                '✅ Download Concluído',
                `${track.artist.name} - ${track.title}`,
                () => {
                  shell.openPath(finalOutputFolder);
                }
              );
            }

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
              outputFolder: finalOutputFolder,
              stationFolder: sanitizedStation,
              verifiedFile: validFile,
              message: `Download concluído e verificado: ${track.artist.name} - ${track.title}`
            });
          } catch (verifyError) {
            console.error('[DEEMIX] Verification error:', verifyError.message);
            resolve({ 
              success: true, // Still return success if deemix didn't error
              track: { id: track.id, title: track.title, artist: track.artist.name, album: track.album?.title, duration: track.duration },
              output: stdout,
              outputFolder: finalOutputFolder,
              stationFolder: sanitizedStation,
              message: `Download concluído (verificação parcial): ${track.artist.name} - ${track.title}`
            });
          }
        }, 1500); // 1.5s delay for filesystem sync
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

// Strip ALL parenthetical and bracketed content from raw text BEFORE normalizing
// This handles: "(Ao Vivo Em Brasília)", "[Remix Deluxe]", "(Acústico)", etc.
function stripParenthetical(text) {
  return text
    .replace(/\s*\([^)]*\)/g, '')  // Remove (...) and content
    .replace(/\s*\[[^\]]*\]/g, '') // Remove [...] and content
    .replace(/\s+/g, ' ')
    .trim();
}

// Get a "clean" normalized version: strip parentheticals first, then normalize
function cleanNormalize(text) {
  return normalizeText(stripParenthetical(text));
}

// Calculate similarity between two strings (Levenshtein-based)
function calculateSimilarity(str1, str2) {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  // Use Levenshtein distance
  const matrix = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - matrix[s1.length][s2.length] / maxLen;
}

// Cache for music library files (reset every 5 minutes)
let musicLibraryCache = { files: [], timestamp: 0 };
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Scan music library and return all files
function scanMusicLibrary(musicFolders) {
  const now = Date.now();
  
  // Return cached if still valid
  if (musicLibraryCache.files.length > 0 && (now - musicLibraryCache.timestamp) < CACHE_DURATION) {
    return musicLibraryCache.files;
  }
  
  const files = [];
  
  const scanDir = (dir) => {
    try {
      if (!fs.existsSync(dir)) return;
      
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma'].includes(ext)) {
            const baseName = path.basename(entry.name, ext);
            files.push({
              name: entry.name,
              baseName: baseName,
              normalized: normalizeText(baseName),
              cleanNormalized: cleanNormalize(baseName), // Without (Ao Vivo), [Remix], etc.
              path: fullPath,
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning ${dir}:`, error.message);
    }
  };
  
  for (const folder of musicFolders) {
    scanDir(folder);
  }
  
  musicLibraryCache = { files, timestamp: now };
  console.log(`[LIBRARY] Scanned ${files.length} music files from ${musicFolders.length} folders`);
  
  return files;
}

// Find best matching file in library using similarity
// IMPORTANT: Artist matching is STRICT to avoid confusing different artists with same song title
function findBestMatch(artist, title, musicFolders) {
  const files = scanMusicLibrary(musicFolders);
  const normalizedArtist = normalizeText(artist);
  const normalizedTitle = normalizeText(title);
  const searchQuery = normalizeText(`${artist} ${title}`);
  
  // Create "clean" versions with ALL parenthetical content removed
  // This handles: library has "(Ao Vivo Em Brasília)" but capture has "(Ao Vivo)" or no suffix
  const cleanArtist = cleanNormalize(artist);
  const cleanTitle = cleanNormalize(title);
  const cleanQuery = cleanNormalize(`${artist} ${title}`);
  
  let bestMatch = null;
  let bestScore = 0;
  const THRESHOLD = 0.75; // 75% similarity required
  const ARTIST_MIN_SIMILARITY = 0.6; // Minimum 60% artist match required
  
  for (const file of files) {
    // PRIORITY 1: Direct match - both artist AND title present in filename
    // Check BOTH full normalized AND clean (no parenthetical) versions
    if (
      (file.normalized.includes(normalizedArtist) && file.normalized.includes(normalizedTitle)) ||
      (file.cleanNormalized.includes(cleanArtist) && file.cleanNormalized.includes(cleanTitle))
    ) {
      return { 
        exists: true, 
        path: file.path, 
        filename: file.name,
        baseName: file.baseName,
        similarity: 1.0 
      };
    }
    
    // PRIORITY 2: Similarity-based matching with ARTIST VERIFICATION
    // Check artist similarity using BOTH original and clean versions
    const artistScore = Math.max(
      calculateSimilarity(normalizedArtist, file.normalized),
      calculateSimilarity(cleanArtist, file.cleanNormalized)
    );
    
    // Only consider this file if artist has some presence in filename
    if (artistScore < ARTIST_MIN_SIMILARITY) {
      continue;
    }
    
    // Check overall similarity using BOTH original and clean versions
    const score = Math.max(
      calculateSimilarity(searchQuery, file.normalized),
      calculateSimilarity(cleanQuery, file.cleanNormalized)
    );
    
    if (score > bestScore && score >= THRESHOLD) {
      bestScore = score;
      bestMatch = file;
    }
  }
  
  if (bestMatch) {
    return { 
      exists: true, 
      path: bestMatch.path, 
      filename: bestMatch.name,
      baseName: bestMatch.baseName,
      similarity: bestScore 
    };
  }
  
  return { exists: false };
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
                return { exists: true, path: fullPath, filename: entry.name };
              }
              
              // Alternative: check for "artist - title" pattern
              const pattern1 = `${normalizedArtist} ${normalizedTitle}`;
              const pattern2 = `${normalizedTitle} ${normalizedArtist}`;
              if (fileName.includes(pattern1) || fileName.includes(pattern2)) {
                return { exists: true, path: fullPath, filename: entry.name };
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

// IPC handler to find best matching song using similarity
ipcMain.handle('find-song-match', async (event, params) => {
  const { artist, title, musicFolders } = params;
  
  try {
    console.log(`[LIBRARY] Finding best match for: ${artist} - ${title}`);
    const result = findBestMatch(artist, title, musicFolders);
    console.log(`[LIBRARY] Best match: ${result.exists ? result.filename + ' (' + (result.similarity * 100).toFixed(0) + '%)' : 'NOT FOUND'}`);
    return result;
  } catch (error) {
    console.error('Error finding match:', error);
    return { exists: false };
  }
});

// IPC handler to get music library stats
ipcMain.handle('get-music-library-stats', async (event, params) => {
  const { musicFolders } = params;
  
  try {
    const files = scanMusicLibrary(musicFolders);
    return { 
      success: true, 
      count: files.length,
      folders: musicFolders.length 
    };
  } catch (error) {
    console.error('Error getting library stats:', error);
    return { success: false, count: 0, folders: 0 };
  }
});
// =============== VOZ DO BRASIL DOWNLOAD ===============

// Download file from URL to specified folder
function downloadFile(url, outputFolder, filename, onProgress, deleteExisting = false) {
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
    
    // Delete existing file if requested (for Voz do Brasil - ensure fresh download)
    if (deleteExisting || filename.startsWith('VozDoBrasil')) {
      try {
        // Delete the target file if it exists
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[VOZ] Deleted existing file: ${filePath}`);
        }
        
        // Also delete other VozDoBrasil files from today (different naming patterns)
        if (filename.startsWith('VozDoBrasil')) {
          const files = fs.readdirSync(outputFolder);
          const today = new Date();
          const day = today.getDate().toString().padStart(2, '0');
          const month = (today.getMonth() + 1).toString().padStart(2, '0');
          const year = today.getFullYear();
          const todayPatterns = [
            `VozDoBrasil_${day}-${month}-${year}`,
            `voz_${day}${month}${year}`,
            `vozbrasil_${day}${month}${year}`,
          ];
          
          for (const file of files) {
            const lowerFile = file.toLowerCase();
            for (const pattern of todayPatterns) {
              if (lowerFile.includes(pattern.toLowerCase())) {
                const oldFilePath = path.join(outputFolder, file);
                if (oldFilePath !== filePath) {
                  try {
                    fs.unlinkSync(oldFilePath);
                    console.log(`[VOZ] Deleted old variant: ${file}`);
                  } catch (e) {
                    console.log(`[VOZ] Could not delete ${file}: ${e.message}`);
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.log(`[VOZ] Warning during cleanup: ${err.message}`);
        // Continue anyway - file might not exist or be in use
      }
    }
    
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
        downloadFile(response.headers.location, outputFolder, filename, onProgress, false) // Already deleted on first call
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
        
        // Validate minimum file size for Voz do Brasil (~45MB expected)
        const MIN_VOZ_SIZE = 40 * 1024 * 1024; // 40MB
        if (filename.startsWith('VozDoBrasil') && downloadedSize < MIN_VOZ_SIZE) {
          console.log(`[VOZ] ⚠️ Arquivo muito pequeno (${(downloadedSize / 1024 / 1024).toFixed(1)}MB < 40MB) - não é válido`);
          try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
          resolve({
            success: false,
            error: `Arquivo inválido: ${(downloadedSize / 1024 / 1024).toFixed(1)}MB (mínimo 40MB)`,
          });
          return;
        }
        
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

// Scrape EBC download page to find the correct Voz do Brasil download URL
function scrapeVozDownloadUrl() {
  return new Promise((resolve) => {
    const pageUrl = 'https://radiogov.ebc.com.br/programas/a-voz-do-brasil-download';
    console.log('[VOZ] 🔍 Scraping EBC download page for latest link...');
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      timeout: 15000,
    };
    
    https.get(pageUrl, options, (response) => {
      if (response.statusCode !== 200) {
        console.log(`[VOZ] 🔍 Scrape page returned HTTP ${response.statusCode}`);
        resolve(null);
        return;
      }
      
      let html = '';
      response.on('data', (chunk) => { html += chunk; });
      response.on('end', () => {
        try {
          const matches = [];
          
          // Pattern 1: radiogov @@download links (e.g., /06-02-2025-1/@@download/file)
          const regex1 = /href="((?:https?:\/\/radiogov\.ebc\.com\.br)?\/programas\/a-voz-do-brasil-download\/[\d]+-[\d]+-[\d]+(?:-\d+)?\/@@download\/file)"/gi;
          let match;
          while ((match = regex1.exec(html)) !== null) {
            const url = match[1].startsWith('http') ? match[1] : `https://radiogov.ebc.com.br${match[1]}`;
            matches.push(url);
          }
          
          // Pattern 2: audios.ebc.com.br direct MP3 links (e.g., audios.ebc.com.br/radiogov/2026/02/05-02-26-a-voz-do-brasil.mp3)
          const regex2 = /href="(https?:\/\/audios\.ebc\.com\.br\/radiogov\/[\d]+\/[\d]+\/[\d-]+-a-voz-do-brasil\.mp3)"/gi;
          while ((match = regex2.exec(html)) !== null) {
            matches.push(match[1]);
          }
          
          if (matches.length > 0) {
            console.log(`[VOZ] 🔍 Found ${matches.length} download link(s). Using: ${matches[0]}`);
            resolve(matches[0]);
          } else {
            console.log('[VOZ] 🔍 No download links found on page');
            resolve(null);
          }
        } catch (e) {
          console.log('[VOZ] 🔍 Parse error:', e.message);
          resolve(null);
        }
      });
    }).on('error', (err) => {
      console.log('[VOZ] 🔍 Scrape error:', err.message);
      resolve(null);
    }).on('timeout', () => {
      console.log('[VOZ] 🔍 Scrape timeout');
      resolve(null);
    });
  });
}

// IPC handler for scraping Voz do Brasil download URL
ipcMain.handle('scrape-voz-download-url', async () => {
  try {
    const url = await scrapeVozDownloadUrl();
    return { success: true, url };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

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

// IPC handler to rename a music file (remove special characters from filename)
// Searches for the original file by matching against the sanitized target name,
// then renames the physical file on disk so the grade TXT matches the actual file.
ipcMain.handle('rename-music-file', async (event, params) => {
  const { musicFolders, currentFilename, newFilename } = params;
  
  // Helper: normalize a filename for comparison (lowercase, no accents, no special chars)
  const normalizeForComparison = (name) => {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, 'e')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  };
  
  const normalizedTarget = normalizeForComparison(newFilename);
  
  console.log(`[RENAME] Looking for file matching "${newFilename}" (normalized: "${normalizedTarget}")`);
  
  try {
    // Search for any file in music folders whose normalized name matches the target
    let foundPath = null;
    let foundName = null;
    
    const searchRecursive = (dir) => {
      if (foundPath) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (foundPath) return;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            searchRecursive(fullPath);
          } else {
            const normalizedEntry = normalizeForComparison(entry.name);
            if (normalizedEntry === normalizedTarget) {
              foundPath = fullPath;
              foundName = entry.name;
            }
          }
        }
      } catch (e) {
        // Skip inaccessible directories
      }
    };
    
    for (const folder of musicFolders) {
      if (foundPath) break;
      if (fs.existsSync(folder)) {
        searchRecursive(folder);
      }
    }
    
    if (!foundPath) {
      return { success: false, renamed: false, reason: 'File not found in music folders' };
    }
    
    // If the found file already has the correct name, no rename needed
    if (foundName === newFilename) {
      return { success: true, renamed: false, reason: 'File already has correct name', path: foundPath };
    }
    
    const newPath = path.join(path.dirname(foundPath), newFilename);
    
    // Check if destination already exists (different file with same sanitized name)
    if (fs.existsSync(newPath) && foundPath !== newPath) {
      console.log(`[RENAME] Destination already exists: "${newFilename}"`);
      return { success: true, renamed: false, reason: 'Destination file already exists', path: newPath };
    }
    
    // Rename the file
    fs.renameSync(foundPath, newPath);
    console.log(`[RENAME] ✅ Renamed: "${foundName}" → "${newFilename}"`);
    
    return { success: true, renamed: true, oldPath: foundPath, newPath, oldName: foundName };
  } catch (error) {
    console.error('[RENAME] Error:', error);
    return { success: false, renamed: false, error: error.message };
  }
});
