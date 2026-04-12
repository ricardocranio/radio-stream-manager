// =============== DEEMIX / PYTHON SETUP ===============
const { ipcMain } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

let deemixCommand = 'deemix';
let _getMainWindow = null;
let _app = null;
let _showNotification = null;

function getDeemixCommand() {
  return deemixCommand;
}

function checkDeemixInstalled() {
  return new Promise((resolve) => {
    exec('deemix --help', (error) => {
      if (!error) { deemixCommand = 'deemix'; resolve(true); return; }
      exec('python -m deemix --help', (error2) => {
        if (!error2) { deemixCommand = 'python -m deemix'; resolve(true); return; }
        exec('python3 -m deemix --help', (error3) => {
          if (!error3) { deemixCommand = 'python3 -m deemix'; resolve(true); return; }
          resolve(false);
        });
      });
    });
  });
}

function checkPythonAvailable() {
  return new Promise((resolve) => {
    exec('pip --version', (error) => {
      if (!error) { resolve({ available: true, command: 'pip' }); return; }
      exec('pip3 --version', (error2) => {
        if (!error2) { resolve({ available: true, command: 'pip3' }); return; }
        exec('python -m pip --version', (error3) => {
          if (!error3) { resolve({ available: true, command: 'python -m pip' }); return; }
          exec('python3 -m pip --version', (error4) => {
            if (!error4) { resolve({ available: true, command: 'python3 -m pip' }); return; }
            resolve({ available: false, command: null });
          });
        });
      });
    });
  });
}

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

    const mainWindow = _getMainWindow();
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
      setTimeout(() => {
        exec('deemix --help', (verifyError) => {
          if (verifyError) {
            exec('python -m deemix --help', (verifyError2) => {
              if (verifyError2) {
                exec('python3 -m deemix --help', (verifyError3) => {
                  if (verifyError3) {
                    resolveFunc({ success: false, error: 'Instalação concluída mas deemix não está no PATH. Reinicie o aplicativo.', output: stdout, needsRestart: true });
                  } else {
                    resolveFunc({ success: true, output: stdout, message: 'deemix instalado com sucesso! Use python3 -m deemix.' });
                  }
                });
              } else {
                resolveFunc({ success: true, output: stdout, message: 'deemix instalado com sucesso! Use python -m deemix.' });
              }
            });
          } else {
            resolveFunc({ success: true, output: stdout, message: 'deemix instalado com sucesso!' });
          }
        });
      }, 2000);
    }
  });
}

function searchDeezerTrack(artist, title, options = {}) {
  const { minDurationSec = 150, returnAll = false } = options; // 2:30 minimum by default
  return new Promise((resolve, reject) => {
    const { calculateSimilarity, cleanNormalize, normalizeText } = require('./utils.cjs');
    const searchQuery = encodeURIComponent(`${artist} ${title}`);
    const searchUrl = `https://api.deezer.com/search?q=${searchQuery}&limit=10`;

    const containsEitherWay = (a, b) => {
      if (!a || !b) return false;
      return a.includes(b) || b.includes(a);
    };

    https.get(searchUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (!result.data || result.data.length === 0) {
            reject(new Error('Música não encontrada no Deezer'));
            return;
          }

          const searchArtistNorm = normalizeText(artist);
          const searchTitleNorm = cleanNormalize(title);

          const rankedTracks = result.data
            .map((track) => {
              const resultArtist = track.artist?.name || '';
              const resultTitle = track.title || '';
              const resultArtistNorm = normalizeText(resultArtist);
              const resultTitleNorm = cleanNormalize(resultTitle);

              const artistSim = calculateSimilarity(artist, resultArtist);
              const titleSim = Math.max(
                calculateSimilarity(title, resultTitle),
                calculateSimilarity(searchTitleNorm, resultTitleNorm)
              );
              const artistExact = searchArtistNorm === resultArtistNorm;
              const titleContained = containsEitherWay(searchTitleNorm, resultTitleNorm);
              const durationPenalty = track.duration >= minDurationSec ? 0 : 0.08;

              const score =
                artistSim * 0.5 +
                titleSim * 0.4 +
                (artistExact ? 0.08 : 0) +
                (titleContained ? 0.07 : 0) -
                durationPenalty;

              const accepted = artistSim >= 0.72 && (titleSim >= 0.58 || titleContained);

              return {
                ...track,
                _match: {
                  artistSim,
                  titleSim,
                  score,
                  accepted,
                  artistExact,
                  titleContained,
                },
              };
            })
            .sort((a, b) => b._match.score - a._match.score);

          if (returnAll) {
            resolve(rankedTracks);
            return;
          }

          const chosen = rankedTracks[0];
          if (!chosen) {
            reject(new Error('Música não encontrada no Deezer'));
            return;
          }

          console.log(
            `[DEEZER] 🔎 Top match: ${chosen.artist.name} - ${chosen.title} ` +
            `(artist=${(chosen._match.artistSim * 100).toFixed(0)}%, title=${(chosen._match.titleSim * 100).toFixed(0)}%, score=${(chosen._match.score * 100).toFixed(0)}%)`
          );

          if (!chosen._match.accepted) {
            reject(
              new Error(
                `Resultado inseguro no Deezer para "${artist} - ${title}" → "${chosen.artist.name} - ${chosen.title}"`
              )
            );
            return;
          }

          const mins = Math.floor(chosen.duration / 60);
          const secs = chosen.duration % 60;
          if (chosen.duration >= minDurationSec) {
            console.log(`[DEEZER] ✅ Selected: ${chosen.artist.name} - ${chosen.title} (${mins}:${String(secs).padStart(2, '0')}) — match seguro`);
          } else {
            console.log(`[DEEZER] ⚠️ Selected short track: ${chosen.artist.name} - ${chosen.title} (${mins}:${String(secs).padStart(2, '0')}) — match seguro, mas abaixo de ${minDurationSec}s`);
          }

          resolve(chosen);
        } catch (e) {
          reject(new Error('Falha ao parsear resposta do Deezer'));
        }
      });
    }).on('error', reject);
  });
}

function saveArlToDeemixConfig(arl) {
  const isWindows = process.platform === 'win32';
  let deemixConfigDir;
  
  if (isWindows) {
    deemixConfigDir = path.join(_app.getPath('appData'), 'deemix');
  } else {
    deemixConfigDir = path.join(_app.getPath('home'), '.config', 'deemix');
  }
  
  const arlFile = path.join(deemixConfigDir, '.arl');
  console.log(`[DEEMIX] Saving ARL to: ${arlFile}`);
  
  try {
    if (!fs.existsSync(deemixConfigDir)) {
      fs.mkdirSync(deemixConfigDir, { recursive: true });
    }
    fs.writeFileSync(arlFile, arl, 'utf8');
    console.log(`[DEEMIX] ARL saved successfully`);
    return true;
  } catch (error) {
    console.error('[DEEMIX] Failed to save ARL:', error);
    return false;
  }
}

function register({ app, getMainWindow, showNotification, safeHandle }) {
  _app = app;
  _getMainWindow = getMainWindow;
  _showNotification = showNotification;
  const handle = safeHandle || ipcMain.handle.bind(ipcMain);

  handle('check-deemix', async () => {
    return await checkDeemixInstalled();
  });

  handle('get-deemix-command', async () => {
    const installed = await checkDeemixInstalled();
    return installed ? deemixCommand : null;
  });

  handle('check-python', async () => {
    return await checkPythonAvailable();
  });

  handle('install-deemix', async () => {
    const mainWindow = _getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('deemix-install-progress', { status: 'starting', message: 'Iniciando instalação do deemix...' });
    }

    const result = await installDeemix();
    
    if (result.success) {
      _showNotification('deemix Instalado!', 'O deemix foi instalado com sucesso. Você pode começar a baixar músicas!');
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

  handle('test-deemix', async () => {
    try {
      const installed = await checkDeemixInstalled();
      if (!installed) return { success: false, error: 'deemix não está instalado' };

      return new Promise((resolve) => {
        const testCommand = `${deemixCommand} --help`;
        exec(testCommand, { timeout: 30000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: `Erro ao testar deemix: ${stderr || error.message}`, command: deemixCommand });
            return;
          }
          const isWorking = stdout.includes('deemix') || stdout.includes('Usage') || stdout.includes('URL');
          if (isWorking) {
            resolve({ success: true, version: 'instalado', command: deemixCommand, message: `deemix funcionando corretamente!` });
          } else {
            resolve({ success: false, error: 'deemix não respondeu corretamente', command: deemixCommand });
          }
        });
      });
    } catch (error) {
      return { success: false, error: error.message || 'Erro desconhecido ao testar deemix' };
    }
  });

  handle('test-deemix-search', async (event, { artist, title }) => {
    try {
      const track = await searchDeezerTrack(artist, title);
      return {
        success: true,
        track: { id: track.id, title: track.title, artist: track.artist.name, album: track.album.title, preview: track.preview, link: track.link },
        message: `Encontrado: ${track.artist.name} - ${track.title}`
      };
    } catch (error) {
      return { success: false, error: error.message || 'Música não encontrada' };
    }
  });
}

module.exports = {
  register,
  checkDeemixInstalled,
  checkPythonAvailable,
  installDeemix,
  searchDeezerTrack,
  saveArlToDeemixConfig,
  getDeemixCommand,
};
