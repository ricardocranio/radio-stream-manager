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

// Check if deemix is installed
function checkDeemixInstalled() {
  return new Promise((resolve) => {
    exec('deemix --help', (error) => {
      resolve(!error);
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

    const installCommand = `${pythonStatus.command} install deemix`;
    console.log(`Installing deemix with: ${installCommand}`);

    exec(installCommand, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('deemix installation error:', error);
        resolve({ 
          success: false, 
          error: stderr || error.message,
          output: stdout 
        });
        return;
      }

      console.log('deemix installation output:', stdout);
      
      // Verify installation
      exec('deemix --help', (verifyError) => {
        if (verifyError) {
          resolve({ 
            success: false, 
            error: 'Instalação concluída mas deemix não está no PATH. Reinicie o aplicativo.',
            output: stdout,
            needsRestart: true
          });
        } else {
          resolve({ 
            success: true, 
            output: stdout,
            message: 'deemix instalado com sucesso!'
          });
        }
      });
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

// App ready
app.whenReady().then(() => {
  createWindow();
  createTray();
  setupAutoUpdater();
  
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
  return await checkDeemixInstalled();
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
