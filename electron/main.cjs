// =============== PROGRAMADOR RADIO - MAIN PROCESS ===============
// Modular architecture: IPC handlers are in electron/modules/
const { app, BrowserWindow, Menu, Tray, ipcMain, shell, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Safe IPC handler registration - prevents "second handler" crashes
const registeredHandlers = new Set();
function safeHandle(channel, handler) {
  if (registeredHandlers.has(channel)) {
    console.warn(`[IPC] Handler already registered for '${channel}', skipping duplicate`);
    return;
  }
  registeredHandlers.add(channel);
  ipcMain.handle(channel, handler);
}

// Auto-updater (only in packaged app)
let autoUpdater = null;
if (app.isPackaged) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.log('electron-updater not available:', e.message);
  }
}

let mainWindow;
let tray = null;

// =============== SINGLE INSTANCE LOCK (MUST BE FIRST) ===============
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[INIT] Another instance is already running. Exiting...');
  app.quit();
  process.exit(0);
}

// =============== ICON RESOLVER ===============
function resolveIcon() {
  const candidates = [];
  if (app.isPackaged) {
    const appPath = app.getAppPath();
    candidates.push(
      path.join(appPath, 'dist', 'favicon.ico'),
      path.join(appPath, 'dist', 'icon.png'),
      path.join(appPath, 'dist', 'favicon.png'),
    );
  }
  // Dev mode or fallback
  candidates.push(
    path.join(__dirname, '../public/favicon.ico'),
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../public/favicon.png'),
  );
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1]; // last resort
}

// =============== SHARED NOTIFICATION HELPER ===============
function showNotification(title, body, onClick) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      icon: resolveIcon(),
      silent: false,
    });
    if (onClick) notification.on('click', onClick);
    notification.show();
    return notification;
  }
}

// =============== REGISTER ALL IPC MODULES ===============
const ctx = {
  app,
  getMainWindow: () => mainWindow,
  showNotification,
  safeHandle,
};

const pythonMonitor = require('./modules/pythonMonitor.cjs');
const deemixModule = require('./modules/deemix.cjs');
const scrapingModule = require('./modules/scraping.cjs');
const libraryModule = require('./modules/library.cjs');
const deezerDownloadModule = require('./modules/deezerDownload.cjs');
const vozBrasilModule = require('./modules/vozBrasil.cjs');
const fileOpsModule = require('./modules/fileOps.cjs');

pythonMonitor.register(ctx);
deemixModule.register(ctx);
scrapingModule.register(ctx);
libraryModule.register(ctx);
deezerDownloadModule.register(ctx);
vozBrasilModule.register(ctx);
fileOpsModule.register(ctx);

// =============== DEFAULT FOLDERS ===============
const DEFAULT_FOLDERS = [
  'C:\\Playlist\\pgm\\Grades',
  'C:\\Playlist\\Downloads',
  'C:\\Playlist\\A Voz do Brasil',
  'C:\\Playlist\\Músicas',
];

function ensureDefaultFolders() {
  console.log('[INIT] Checking/creating default folders...');
  for (const folder of DEFAULT_FOLDERS) {
    try {
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
        console.log(`[INIT] ✓ Created folder: ${folder}`);
      }
    } catch (error) {
      console.error(`[INIT] ✗ Failed to create folder ${folder}:`, error.message);
    }
  }
}

// =============== WINDOW CREATION ===============
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    icon: resolveIcon(),
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

  if (app.isPackaged) {
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, 'dist', 'index.html');
    // Use proper URL formatting for Windows paths
    const { pathToFileURL } = require('url');
    mainWindow.loadURL(pathToFileURL(indexPath).toString() + '#/');
  } else {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  }

  // =============== WHITE SCREEN RECOVERY ===============
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[WINDOW] Load failed: ${errorCode} - ${errorDescription}`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }, 2000);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error(`[WINDOW] Render process gone: ${details.reason}`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }, 1000);
  });

  mainWindow.webContents.on('unresponsive', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Aplicação Não Responde',
      message: 'A aplicação parou de responder.',
      detail: 'Deseja recarregar a aplicação?',
      buttons: ['Recarregar', 'Aguardar'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0 && mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }).catch(() => {}); // ignore if window closed before user responds
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('[WINDOW] Window became responsive again');
  });

  // Monitor for blank/white screen
  let contentCheckAttempts = 0;
  const maxContentCheckAttempts = 3;
  
  mainWindow.webContents.on('did-finish-load', () => {
    contentCheckAttempts = 0;
    setTimeout(async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          const hasContent = await mainWindow.webContents.executeJavaScript(`
            document.body && document.body.innerHTML && document.body.innerHTML.length > 100
          `);
          
          if (!hasContent) {
            contentCheckAttempts++;
            if (contentCheckAttempts < maxContentCheckAttempts) {
              mainWindow.reload();
            } else {
              dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Erro de Carregamento',
                message: 'A aplicação não carregou corretamente.',
                detail: 'Tente reiniciar o aplicativo.',
                buttons: ['Reiniciar', 'Fechar'],
                defaultId: 0,
              }).then(({ response }) => {
                if (response === 0) { app.relaunch(); }
                app.isQuitting = true;
                app.quit();
              });
            }
          }
        } catch (e) {}
      }
    }, 3000);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // =============== APPLICATION MENU ===============
  const menuTemplate = [
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); } },
        { type: 'separator' },
        { label: 'Sair', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit(); } },
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
              try { await autoUpdater.checkForUpdates(); }
              catch (error) {
                dialog.showMessageBox(mainWindow, { type: 'error', title: 'Erro', message: 'Não foi possível verificar atualizações', detail: error.message });
              }
            } else {
              dialog.showMessageBox(mainWindow, { type: 'info', title: 'Auto-Update', message: 'Auto-update não disponível', detail: 'O sistema de atualização automática só funciona na versão instalada.' });
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Sobre',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info', title: 'Sobre', message: 'Programador Rádio',
              detail: `Versão ${app.getVersion()}\n\nSistema de geração automática de grades de programação para rádios FM.\n\nTransições BPM-aware | Match de DNA ID3 | Downloads inteligentes\n\n© 2025 PGM-FM`,
            });
          },
        },
        {
          label: 'Verificar deemix',
          click: async () => {
            const installed = await deemixModule.checkDeemixInstalled();
            dialog.showMessageBox(mainWindow, {
              type: installed ? 'info' : 'warning',
              title: 'Status do deemix',
              message: installed ? 'deemix está instalado!' : 'deemix NÃO encontrado',
              detail: installed ? 'O deemix CLI está configurado corretamente.' : 'Instale o deemix com: pip install deemix',
            });
          },
        },
        { label: 'Abrir Pasta de Dados', click: () => { shell.openPath(app.getPath('userData')); } },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

// =============== SHOW/FOCUS WINDOW ===============
function showMainWindow() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  } catch (error) {
    console.error('[WINDOW] Error showing window:', error.message);
    try { createWindow(); } catch (e) {}
  }
}

// =============== SYSTEM TRAY ===============
function createTray() {
  if (tray && !tray.isDestroyed()) return;
  // Use .ico on Windows for tray, .png on other platforms
  const trayIconFile = process.platform === 'win32' ? 'favicon.ico' : 'icon.png';
  const trayIconPath = path.join(__dirname, '../public', trayIconFile);
  const resolvedTrayIcon = fs.existsSync(trayIconPath) ? trayIconPath : path.join(__dirname, '../public/favicon.png');
  tray = new Tray(resolvedTrayIcon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir Programador', click: () => showMainWindow() },
    { label: 'Status: Ativo', enabled: false },
    { type: 'separator' },
    { label: 'Reiniciar', click: () => { app.relaunch(); app.isQuitting = true; app.quit(); } },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip(`Programador Rádio - v${app.getVersion()}`);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
}

// =============== AUTO-UPDATER ===============
function setupAutoUpdater() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  
  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', { version: info.version, releaseNotes: info.releaseNotes });
    }
    showNotification('🔄 Atualização Disponível', `Nova versão ${info.version} disponível.`, () => autoUpdater.downloadUpdate());
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'Atualização Disponível',
        message: `Nova versão ${info.version} disponível!`,
        detail: `Deseja baixar e instalar?`,
        buttons: ['Baixar Agora', 'Mais Tarde'], defaultId: 0,
      }).then(({ response }) => { if (response === 0) autoUpdater.downloadUpdate(); });
    }
  });
  
  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', { percent: progress.percent });
      mainWindow.setProgressBar(progress.percent / 100);
    }
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', { version: info.version });
      mainWindow.setProgressBar(-1);
    }
    showNotification('✅ Atualização Pronta', `Versão ${info.version} pronta para instalar.`, () => autoUpdater.quitAndInstall(false, true));
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'Atualização Pronta',
        message: `Versão ${info.version} baixada!`,
        detail: 'Deseja reiniciar agora?',
        buttons: ['Reiniciar Agora', 'Mais Tarde'], defaultId: 0,
      }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(false, true); });
    }
  });
  
  autoUpdater.on('error', (error) => console.error('Erro no auto-updater:', error));
}

// =============== SIMPLE IPC HANDLERS ===============
safeHandle('get-app-version', () => app.getVersion());
safeHandle('get-app-path', (event, name) => {
  try { return app.getPath(name); }
  catch (e) { return null; }
});
safeHandle('open-external', (event, url) => shell.openExternal(url));
safeHandle('open-path', (event, filePath) => shell.openPath(filePath));

safeHandle('open-folder', async (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    await shell.openPath(folderPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

safeHandle('ensure-folder', async (event, folderPath) => {
  try {
    const existed = fs.existsSync(folderPath);
    if (!existed) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    return { success: true, created: !existed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

safeHandle('select-folder', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Selecionar pasta de download' });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

safeHandle('show-notification', (event, { title, body }) => {
  showNotification(title, body, () => { 
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show(); 
      mainWindow.focus();
    }
  });
});

safeHandle('notify-batch-complete', (event, stats) => {
  const { completed, failed, total } = stats || {};
  const title = failed > 0 ? '⚠️ Lote Finalizado' : '✅ Lote Completo';
  const body = `${completed || 0}/${total || 0} baixadas${failed ? ` (${failed} erros)` : ''}`;
  showNotification(title, body, () => showMainWindow());
  return { success: true };
});

safeHandle('show-window', () => {
  showMainWindow();
  return { success: true };
});

safeHandle('check-for-updates', async () => {
  if (autoUpdater) {
    try { await autoUpdater.checkForUpdates(); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  }
  return { success: false, error: 'Auto-updater not available' };
});

// =============== APP LIFECYCLE ===============
app.whenReady().then(async () => {
  ensureDefaultFolders();
  createWindow();
  createTray();
  setupAutoUpdater();
  
  // Check Python/pip availability
  const pythonStatus = await deemixModule.checkPythonAvailable();
  if (!pythonStatus.available) {
    console.log('[INIT] Python/pip not found');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('python-status', { 
          available: false, message: 'Python não encontrado.', downloadUrl: 'https://www.python.org/downloads/'
        });
      }
    }, 3000);
  } else {
    console.log(`[INIT] ✓ Python available: ${pythonStatus.command}`);
    const deemixInstalled = await deemixModule.checkDeemixInstalled();
    console.log(`[INIT] ${deemixInstalled ? '✓' : '✗'} deemix: ${deemixInstalled ? deemixModule.getDeemixCommand() : 'not installed'}`);
    
    if (!deemixInstalled) {
      console.log('[INIT] 🔄 Auto-installing deemix silently...');
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('deemix-install-progress', { status: 'auto-installing', message: 'Instalando deemix automaticamente...' });
      }, 2000);
      
      const installResult = await deemixModule.installDeemix();
      if (installResult.success) {
        console.log('[INIT] ✓ deemix auto-installed!');
        showNotification('deemix Instalado!', 'Downloads do Deezer estão prontos!');
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('deemix-status', { installed: true, command: deemixModule.getDeemixCommand(), autoInstalled: true });
        }, 1000);
      } else {
        console.error('[INIT] ✗ deemix auto-install failed:', installResult.error);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('deemix-status', { installed: false, error: installResult.error, autoInstallFailed: true });
        }, 1000);
      }
    } else {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('deemix-status', { installed: true, command: deemixModule.getDeemixCommand() });
      }, 3000);
    }
  }
  
  // Check for updates (production only)
  if (autoUpdater && app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => console.log('Auto-update check failed:', err.message));
    }, 5000);
  }

  // Auto-start Python monitor
  setTimeout(async () => {
    console.log('[INIT] 🎵 Auto-starting Python radio monitor...');
    const result = await pythonMonitor.startPythonMonitor(true);
    if (result.success) {
      console.log('[INIT] ✓ Python radio monitor started');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('monitor-status', pythonMonitor.getMonitorStatus());
      }
    } else {
      console.log('[INIT] ✗ Monitor failed:', result.error);
    }
  }, 10000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => showMainWindow());

app.on('window-all-closed', () => {
  // Don't quit on window close - we use close-to-tray behavior
  // Only quit when user explicitly chooses "Sair" from menu/tray
  if (process.platform === 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  pythonMonitor.killMonitorProcess();
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
});
