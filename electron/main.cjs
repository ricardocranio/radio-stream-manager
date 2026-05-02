// =============== PROGRAMADOR RADIO - MAIN PROCESS ===============
// Modular architecture: IPC handlers are in electron/modules/
const { app, BrowserWindow, Menu, Tray, ipcMain, shell, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// =============== UNCAUGHT ERROR HANDLING ===============
process.on('uncaughtException', (error) => {
  console.error('[CRITICAL] Uncaught Exception:', error);
  try {
    const logPath = path.join(app.getPath('userData'), 'error.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Uncaught Exception: ${error.stack || error}\n`);
  } catch (e) {}
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// LAN API Router - enables remote access to all IPC handlers
const { handleApiRequest, createDualHandle } = require('./modules/lanApiRouter.cjs');

// Safe IPC handler registration - prevents "second handler" crashes
const registeredHandlers = new Set();
function _baseSafeHandle(channel, handler) {
  if (registeredHandlers.has(channel)) {
    console.warn(`[IPC] Handler already registered for '${channel}', skipping duplicate`);
    return;
  }
  registeredHandlers.add(channel);
  ipcMain.handle(channel, handler);
}

// Dual handle: registers both IPC + HTTP API routes
const safeHandle = createDualHandle(_baseSafeHandle);

// Auto-updater (only in packaged app)
let autoUpdater = null;
if (app.isPackaged) {
  try {
    const { autoUpdater: updater } = require('electron-updater');
    autoUpdater = updater;
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
const radioagenciaModule = require('./modules/radioagencia.cjs');
const fileOpsModule = require('./modules/fileOps.cjs');
const { getMachineId } = require('./modules/utils.cjs');

const machineId = getMachineId(app);
console.log('[INIT] Machine ID:', machineId);

const ctx = {
  app,
  getMainWindow: () => mainWindow,
  showNotification,
  safeHandle,
  machineId,
};

pythonMonitor.register(ctx);
deemixModule.register(ctx);
scrapingModule.register(ctx);
libraryModule.register(ctx);
deezerDownloadModule.register(ctx);
vozBrasilModule.register(ctx);
radioagenciaModule.register(ctx);
fileOpsModule.register(ctx);

// Add IPC handler for frontend to get machine ID
safeHandle('get-machine-id', () => machineId);

// =============== DEFAULT FOLDERS ===============
const DEFAULT_FOLDERS = [
  'C:\\Playlist\\pgm\\Grades',
  'C:\\Playlist\\Downloads',
  'C:\\Playlist\\A Voz do Brasil',
  'C:\\Playlist\\Músicas',
  'C:\\Playlist\\Locucoes',
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
  let failLoadAttempts = 0;
  const MAX_FAIL_LOAD_ATTEMPTS = 3;

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[WINDOW] Load failed: ${errorCode} - ${errorDescription}`);
    failLoadAttempts++;
    if (failLoadAttempts < MAX_FAIL_LOAD_ATTEMPTS) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      }, 2000);
    } else {
      console.error(`[WINDOW] Max fail-load attempts (${MAX_FAIL_LOAD_ATTEMPTS}) reached, stopping reload loop`);
    }
  });

  let renderGoneAttempts = 0;
  const MAX_RENDER_GONE_ATTEMPTS = 2;

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error(`[WINDOW] Render process gone: ${details.reason}`);
    renderGoneAttempts++;
    if (renderGoneAttempts < MAX_RENDER_GONE_ATTEMPTS) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      }, 1000);
    } else {
      console.error(`[WINDOW] Max render-gone attempts (${MAX_RENDER_GONE_ATTEMPTS}) reached, stopping reload loop`);
    }
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
              detail: `Versão ${app.getVersion()}\n\nSistema de geração automática de grades de programação para rádios FM.\n\nTransições BPM-aware | Match de DNA ID3 | Downloads inteligentes\n\nAutor: Ricardo Amaral\n© 2025 PGM-FM`,
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
  tray = new Tray(resolveIcon());
  
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

safeHandle('select-file', async (event, params) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const filters = params?.filters || [
    { name: 'Áudio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'wma', 'm4a'] },
    { name: 'Todos os arquivos', extensions: ['*'] },
  ];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Selecionar arquivo',
    filters,
  });
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

// =============== LAN SERVER (acesso remoto via VPN/rede local) ===============
let lanServer = null;
const LAN_PORT = 8088;

function startLanServer() {
  try {
    const http = require('http');
    const appPath = app.getAppPath();
    const distPath = path.join(appPath, 'dist');
    
    if (!app.isPackaged || !fs.existsSync(distPath)) {
      console.log('[LAN] Skipping LAN server (dev mode or dist not found)');
      return;
    }

    lanServer = http.createServer((req, res) => {
      const reqPath = req.url.split('?')[0].split('#')[0];

      // Route API requests to the LAN API router
      if (reqPath.startsWith('/api/')) {
        handleApiRequest(req, res, { getMainWindow: () => mainWindow });
        return;
      }

      // CORS headers para acesso remoto
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const servePath = reqPath === '/' ? '/index.html' : reqPath;
      const filePath = path.join(distPath, servePath);
      const safePath = path.resolve(filePath);
      
      // Segurança: não servir fora do dist
      if (!safePath.startsWith(path.resolve(distPath))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const mimeTypes = {
        '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
        '.woff': 'font/woff', '.ttf': 'font/ttf',
      };

      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const ext = path.extname(safePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(safePath).pipe(res);
      } else {
        // SPA fallback: serve index.html para rotas do React
        const indexFile = path.join(distPath, 'index.html');
        if (fs.existsSync(indexFile)) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          fs.createReadStream(indexFile).pipe(res);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      }
    });

    lanServer.listen(LAN_PORT, '0.0.0.0', () => {
      const os = require('os');
      const interfaces = os.networkInterfaces();
      const ips = [];
      for (const iface of Object.values(interfaces)) {
        for (const addr of iface) {
          if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
        }
      }
      console.log(`[LAN] ✓ Servidor LAN ativo na porta ${LAN_PORT}`);
      console.log(`[LAN] 🌐 Acesse de qualquer dispositivo na rede:`);
      ips.forEach(ip => console.log(`[LAN]    http://${ip}:${LAN_PORT}`));
      
      // Notifica o usuário
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const lanUrl = ips.length > 0 ? `http://${ips[0]}:${LAN_PORT}` : `http://localhost:${LAN_PORT}`;
          showNotification('🌐 Acesso Remoto Ativo', `Acesse via: ${lanUrl}`);
        }
      }, 3000);
    });

    lanServer.on('error', (err) => {
      console.error(`[LAN] ✗ Erro ao iniciar servidor: ${err.message}`);
      if (err.code === 'EADDRINUSE') {
        console.log(`[LAN] Porta ${LAN_PORT} já em uso, tentando ${LAN_PORT + 1}...`);
        lanServer.listen(LAN_PORT + 1, '0.0.0.0');
      }
    });
  } catch (err) {
    console.error('[LAN] Falha ao criar servidor:', err.message);
  }
}

// =============== APP LIFECYCLE ===============
app.whenReady().then(async () => {
  ensureDefaultFolders();
  createWindow();
  createTray();
  setupAutoUpdater();
  startLanServer();
  
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

// === GRACEFUL SHUTDOWN: wait for active download to finish ===
let _activeDownloadProcess = null; // set by deezerDownload module

function setActiveDownloadProcess(proc) {
  _activeDownloadProcess = proc;
}

function getActiveDownloadProcess() {
  return _activeDownloadProcess;
}

app.on('before-quit', async (event) => {
  // If a download is in progress, wait for it to finish (max 60s)
  if (_activeDownloadProcess && !_activeDownloadProcess.killed) {
    if (!app._waitingForDownload) {
      app._waitingForDownload = true;
      event.preventDefault();
      
      console.log('[SHUTDOWN] ⏳ Aguardando download em andamento terminar (máx 60s)...');
      
      // Show notification
      showNotification('⏳ Aguardando Download', 'O app vai fechar após o download atual terminar.');
      
      const waitStart = Date.now();
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - waitStart;
        if (!_activeDownloadProcess || _activeDownloadProcess.killed || elapsed > 60000) {
          clearInterval(checkInterval);
          if (elapsed > 60000) {
            console.log('[SHUTDOWN] ⚠️ Timeout — forçando encerramento.');
            try { _activeDownloadProcess?.kill('SIGTERM'); } catch (e) {}
          } else {
            console.log('[SHUTDOWN] ✅ Download concluído, encerrando app.');
          }
          _activeDownloadProcess = null;
          app._waitingForDownload = false;
          
          // Cleanup and quit
          finalizeShutdown();
          app.quit();
        }
      }, 500);
      return;
    }
  }
  
  app.isQuitting = true;
  finalizeShutdown();
});

function finalizeShutdown() {
  console.log('[SHUTDOWN] Encerrando processos e serviços...');
  
  // Kill Python monitor definitively
  try {
    pythonMonitor.killMonitorProcess();
  } catch (e) {
    console.error('[SHUTDOWN] Erro ao encerrar monitor:', e.message);
  }
  
  // Close LAN server
  if (lanServer) {
    try { 
      lanServer.close(); 
      console.log('[SHUTDOWN] Servidor LAN encerrado.');
    } catch (e) {}
    lanServer = null;
  }
  
  // Destroy tray
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

// Export for use by deezerDownload module
module.exports = { setActiveDownloadProcess, getActiveDownloadProcess };
