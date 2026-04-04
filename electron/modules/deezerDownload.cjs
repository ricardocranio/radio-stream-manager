// =============== DEEZER DOWNLOAD HANDLER ===============
const { ipcMain, shell } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sanitizeFolderName, checkFileExistsInSubfolders, cleanupPartialFiles, parseID3TagsFromFile, sanitizeForDisk } = require('./utils.cjs');
const deemixModule = require('./deemix.cjs');

let _getMainWindow = null;
let _showNotification = null;

function register({ getMainWindow, showNotification, safeHandle }) {
  _getMainWindow = getMainWindow;
  _showNotification = showNotification;
  const handle = safeHandle || ipcMain.handle.bind(ipcMain);

  handle('download-from-deezer', async (event, params) => {
    const { artist, title, arl, outputFolder, quality, stationName } = params;
    
    const sanitizedStation = stationName ? sanitizeFolderName(stationName) : null;
    const finalOutputFolder = sanitizedStation 
      ? path.join(outputFolder, sanitizedStation)
      : outputFolder;
    const tempDownloadFolder = path.join(finalOutputFolder, '_temp');
    const desiredFilename = `${artist} - ${title}.mp3`;
    
    console.log(`[DEEMIX] === Starting download ===`);
    console.log(`[DEEMIX] Track: ${artist} - ${title}`);
    console.log(`[DEEMIX] Station: ${stationName || 'N/A'}`);
    console.log(`[DEEMIX] Temp: ${tempDownloadFolder}`);
    console.log(`[DEEMIX] Final: ${finalOutputFolder}/${desiredFilename}`);
    console.log(`[DEEMIX] Quality: ${quality}`);
    
    if (stationName) {
      const existingCheck = checkFileExistsInSubfolders(outputFolder, `${artist} - ${title}`);
      if (existingCheck.exists) {
        console.log(`[DEEMIX] File already exists at: ${existingCheck.path}`);
        return {
          success: true, skipped: true, existingPath: existingCheck.path,
          existingStation: existingCheck.station,
          message: `Arquivo já existe em ${existingCheck.station || 'pasta principal'}`
        };
      }
    }
    
    try {
      const deemixInstalled = await deemixModule.checkDeemixInstalled();
      if (!deemixInstalled) {
        return { success: false, error: 'deemix não está instalado. Instale com: pip install deemix', needsInstall: true };
      }
      
      const deemixCommand = deemixModule.getDeemixCommand();
      console.log(`[DEEMIX] Using command: ${deemixCommand}`);

      for (const folder of [finalOutputFolder, tempDownloadFolder]) {
        if (!fs.existsSync(folder)) {
          try { fs.mkdirSync(folder, { recursive: true }); }
          catch (mkdirError) {
            return { success: false, error: `Não foi possível criar a pasta: ${folder}. Verifique as permissões.` };
          }
        }
      }

      // === Auto-cleanup _temp: remove 0-byte and oversized files ===
      try {
        const tempFiles = fs.existsSync(tempDownloadFolder) ? fs.readdirSync(tempDownloadFolder) : [];
        const MAX_TEMP_SIZE = 25 * 1024 * 1024; // 25MB
        const MAX_TEMP_AGE_MS = 10 * 60 * 1000; // 10 minutes
        const now = Date.now();
        for (const tf of tempFiles) {
          try {
            const tfPath = path.join(tempDownloadFolder, tf);
            const stat = fs.statSync(tfPath);
            const ageMins = (now - stat.mtimeMs) / 60000;
            if (stat.size === 0 || stat.size > MAX_TEMP_SIZE || ageMins > 10) {
              fs.unlinkSync(tfPath);
              const reason = stat.size === 0 ? '0 bytes' : stat.size > MAX_TEMP_SIZE ? `${(stat.size / 1024 / 1024).toFixed(1)}MB (oversized)` : `${ageMins.toFixed(0)}min old`;
              console.log(`[DEEMIX] 🧹 Temp cleanup: ${tf} (${reason})`);
            }
          } catch (e) {}
        }
      } catch (e) {}

      try {
        const testFile = path.join(tempDownloadFolder, '.deemix_test');
        fs.writeFileSync(testFile, 'test', 'utf8');
        fs.unlinkSync(testFile);
      } catch (writeError) {
        return { success: false, error: `Pasta não tem permissão de escrita: ${tempDownloadFolder}` };
      }

      deemixModule.saveArlToDeemixConfig(arl);

      console.log(`[DEEMIX] Searching Deezer API...`);
      let track;
      try {
        track = await deemixModule.searchDeezerTrack(artist, title, { minDurationSec: 150 });
        const durMin = Math.floor(track.duration / 60);
        const durSec = track.duration % 60;
        console.log(`[DEEMIX] Found: ${track.artist.name} - ${track.title} (ID: ${track.id}, Duration: ${durMin}:${String(durSec).padStart(2, '0')})`);
        
        // Warn dashboard about short tracks
        const mainWindow = _getMainWindow();
        if (track.duration < 150 && mainWindow) {
          mainWindow.webContents.send('download-warning', {
            artist, title,
            duration: track.duration,
            message: `⚠️ Faixa curta: ${durMin}:${String(durSec).padStart(2, '0')} — pode ser versão rádio/preview`
          });
        }
      } catch (searchError) {
        return { success: false, error: `Música não encontrada no Deezer: ${artist} - ${title}` };
      }
      
      const deezerUrl = track.link || `https://www.deezer.com/track/${track.id}`;
      const qualityMap = { 'MP3_128': '128', 'MP3_320': '320', 'FLAC': 'flac' };
      const deemixQuality = qualityMap[quality] || '320';

      let filesBefore = new Set();
      try { filesBefore = new Set(fs.readdirSync(tempDownloadFolder)); } catch (e) {}

      return new Promise((resolve) => {
        const fullCommand = `${deemixCommand} "${deezerUrl}" -p "${tempDownloadFolder}" -b ${deemixQuality}`;
        console.log(`[DEEMIX] Executing: ${fullCommand}`);
        
        const downloadStartTime = Date.now();
        
        const childProcess = exec(fullCommand, { timeout: 0, maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
          // Clear active process tracker on completion
          try {
            const mainModule = require('../main.cjs');
            if (mainModule.setActiveDownloadProcess) mainModule.setActiveDownloadProcess(null);
          } catch (e) {}
          
          const elapsedSec = Math.round((Date.now() - downloadStartTime) / 1000);
          console.log(`[DEEMIX] Process finished after ${elapsedSec}s`);
          console.log(`[DEEMIX] STDOUT: ${stdout}`);
          if (stderr) console.log(`[DEEMIX] STDERR: ${stderr}`);
          
          if (error) {
            if (error.killed || error.signal === 'SIGTERM') {
              cleanupPartialFiles(tempDownloadFolder, filesBefore);
              resolve({ success: false, error: 'Processo deemix foi interrompido externamente.', output: stdout + stderr });
              return;
            }
            
            let errorMessage = stderr || error.message;
            if (errorMessage.includes('arl') || errorMessage.includes('ARL') || errorMessage.includes('login')) {
              errorMessage = 'ARL inválida ou expirada. Obtenha uma nova ARL nos cookies do Deezer.';
            } else if (errorMessage.includes('premium') || errorMessage.includes('Premium')) {
              errorMessage = 'Esta música requer conta Premium do Deezer.';
            } else if (errorMessage.includes('not found') || errorMessage.includes('não encontr')) {
              errorMessage = 'Música não encontrada no Deezer.';
            }
            
            resolve({ success: false, error: errorMessage, output: stdout + stderr });
            return;
          }

          // Wait for file to be fully written to disk
          const waitForStableFile = (filePath, maxWaitMs = 180000) => { // 3 minutes max
            return new Promise((resolveWait) => {
              let lastSize = -1;
              let stableCount = 0;
              const interval = setInterval(() => {
                try {
                  const stat = fs.statSync(filePath);
                  if (stat.size === lastSize && stat.size > 0) {
                    stableCount++;
                    if (stableCount >= 3) { // stable for 1.5s
                      clearInterval(interval);
                      resolveWait(true);
                    }
                  } else {
                    stableCount = 0;
                    lastSize = stat.size;
                  }
                } catch (e) {
                  clearInterval(interval);
                  resolveWait(false);
                }
              }, 500);
              setTimeout(() => { clearInterval(interval); resolveWait(true); }, maxWaitMs);
            });
          };

          setTimeout(async () => {
            try {
              const filesAfter = fs.readdirSync(tempDownloadFolder);
              const newFiles = filesAfter.filter(f => !filesBefore.has(f) && /\.(mp3|flac|MP3|FLAC)$/i.test(f));
              
              if (newFiles.length === 0) {
                resolve({ success: false, error: 'Download aparentemente concluiu mas nenhum arquivo de áudio foi encontrado.', output: stdout + stderr });
                return;
              }
              
              let validFile = null;
              const MIN_FILE_SIZE = 1.5 * 1024 * 1024; // 1.5MB min
              const MAX_FILE_SIZE = 25 * 1024 * 1024;   // 25MB max
              
              // Calculate expected file size range from Deezer API duration
              const expectedDurationSec = track.duration || 0;
              const bitrateMap = { '128': 128000, '320': 320000, 'flac': 800000 };
              const bitrateBps = bitrateMap[deemixQuality] || 320000;
              const expectedSizeBytes = (expectedDurationSec * bitrateBps) / 8;
              const expectedSizeMB = (expectedSizeBytes / (1024 * 1024)).toFixed(1);
              // Allow 30% tolerance below, but flag if file is >1.7x expected (doubled)
              const minExpectedSize = expectedSizeBytes * 0.7;
              const maxExpectedSize = expectedSizeBytes * 1.7; // anything above 1.7x is likely doubled
              
              if (expectedDurationSec > 0) {
                const expMin = Math.floor(expectedDurationSec / 60);
                const expSec = expectedDurationSec % 60;
                console.log(`[DEEMIX] 📏 Expected: ${expMin}:${String(expSec).padStart(2, '0')} (~${expectedSizeMB}MB at ${deemixQuality}kbps)`);
              }

              for (const newFile of newFiles) {
                const filePath = path.join(tempDownloadFolder, newFile);
                
                // Wait for file to stabilize (stop growing)
                await waitForStableFile(filePath);
                
                const stat = fs.statSync(filePath);
                const fileSizeMB = (stat.size / (1024 * 1024)).toFixed(1);
                
                if (stat.size < MIN_FILE_SIZE) {
                  console.log(`[DEEMIX] ⚠️ File too small (${fileSizeMB} MB), skipping: ${newFile}`);
                  try { fs.unlinkSync(filePath); } catch (e) {}
                  continue;
                }
                if (stat.size > MAX_FILE_SIZE) {
                  console.log(`[DEEMIX] ⚠️ File too large (${fileSizeMB} MB), skipping: ${newFile}`);
                  try { fs.unlinkSync(filePath); } catch (e) {}
                  continue;
                }
                
                // Duration validation: reject files with doubled duration
                if (expectedDurationSec > 0 && stat.size > maxExpectedSize) {
                  const estimatedDuration = Math.round((stat.size * 8) / bitrateBps);
                  const estMin = Math.floor(estimatedDuration / 60);
                  const estSec = estimatedDuration % 60;
                  console.log(`[DEEMIX] ❌ DURATION MISMATCH: file ~${estMin}:${String(estSec).padStart(2, '0')} but expected ~${Math.floor(expectedDurationSec / 60)}:${String(expectedDurationSec % 60).padStart(2, '0')} — likely doubled! Rejecting: ${newFile}`);
                  try { fs.unlinkSync(filePath); } catch (e) {}
                  
                  const mainWindow = _getMainWindow();
                  if (mainWindow) {
                    mainWindow.webContents.send('download-warning', {
                      artist, title,
                      message: `❌ Arquivo com duração dobrada detectado e removido (${estMin}:${String(estSec).padStart(2, '0')} vs esperado ${Math.floor(expectedDurationSec / 60)}:${String(expectedDurationSec % 60).padStart(2, '0')})`
                    });
                  }
                  continue;
                }
                
                try {
                  const headerBuffer = Buffer.alloc(10);
                  const fd = fs.openSync(filePath, 'r');
                  fs.readSync(fd, headerBuffer, 0, 10, 0);
                  fs.closeSync(fd);
                  
                  const hasID3 = headerBuffer[0] === 0x49 && headerBuffer[1] === 0x44 && headerBuffer[2] === 0x33;
                  const hasMP3Sync = (headerBuffer[0] === 0xFF && (headerBuffer[1] & 0xE0) === 0xE0);
                  const hasFLAC = headerBuffer[0] === 0x66 && headerBuffer[1] === 0x4C && headerBuffer[2] === 0x61 && headerBuffer[3] === 0x43;
                  
                  if (!hasID3 && !hasMP3Sync && !hasFLAC) {
                    console.log(`[DEEMIX] ⚠️ Invalid audio header, skipping: ${newFile}`);
                    try { fs.unlinkSync(filePath); } catch (e) {}
                    continue;
                  }
                } catch (headerErr) {
                  // Accept file if header check fails
                }
                
                validFile = newFile;
                const estimatedDur = expectedDurationSec > 0 ? Math.round((stat.size * 8) / bitrateBps) : 0;
                const edMin = Math.floor(estimatedDur / 60);
                const edSec = estimatedDur % 60;
                console.log(`[DEEMIX] ✅ File integrity OK: ${newFile} (${fileSizeMB} MB, ~${edMin}:${String(edSec).padStart(2, '0')})`);
                break;
              }
              
              if (!validFile) {
                resolve({ success: false, error: 'Download concluiu mas o arquivo está corrompido ou incompleto.', output: stdout + stderr });
                return;
              }
              
              // Read ID3 tags from downloaded file
              const tempFilePath = path.join(tempDownloadFolder, validFile);
              let id3Artist = null;
              let id3Title = null;
              
              try {
                const tags = parseID3TagsFromFile(tempFilePath);
                id3Artist = tags.artist || null;
                id3Title = tags.title || null;
                console.log(`[DEEMIX] 🏷️ ID3 Tags: Artist="${id3Artist || '?'}", Title="${id3Title || '?'}"`);
              } catch (tagErr) {
                console.warn(`[DEEMIX] ⚠️ Could not read ID3 tags: ${tagErr.message}`);
              }

              // Sanitize: use shared utility from utils.cjs (handles accents, &, filesystem chars)
              // Detect corrupted ID3 chars (encoding artifacts like Ø, ÿ in unexpected positions)
              const hasCorruptedChars = (str) => {
                if (!str) return true;
                const corruptPatterns = /[\x00-\x08\x0E-\x1F\x7F-\x9F]|\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]/;
                return corruptPatterns.test(str);
              };

              // Priority: Deezer API names > ID3 tags > original search params
              // ID3 tags can have encoding corruption (e.g., Ø instead of o)
              const safeId3Artist = id3Artist && !hasCorruptedChars(id3Artist) ? id3Artist : null;
              const safeId3Title = id3Title && !hasCorruptedChars(id3Title) ? id3Title : null;
              
              // Use shared disk sanitization from utils.cjs
              const finalArtist = sanitizeForDisk(track.artist.name || safeId3Artist || artist, 'artist');
              const finalTitle = sanitizeForDisk(track.title || safeId3Title || title, 'title');
              const finalFilename = `${finalArtist} - ${finalTitle}.mp3`;
              const finalFilePath = path.join(finalOutputFolder, finalFilename);
              
              if (safeId3Artist !== id3Artist || safeId3Title !== id3Title) {
                console.log(`[DEEMIX] ⚠️ ID3 tags had corrupted chars, using Deezer API names instead`);
                console.log(`[DEEMIX]   ID3: "${id3Artist}" / "${id3Title}"`);
                console.log(`[DEEMIX]   API: "${track.artist.name}" / "${track.title}"`);
              }
              
              console.log(`[DEEMIX] 📛 Rename: "${validFile}" → "${finalFilename}"`);
              
              try {
                if (fs.existsSync(finalFilePath)) {
                  fs.unlinkSync(finalFilePath);
                }
                
                try {
                  fs.renameSync(tempFilePath, finalFilePath);
                  console.log(`[DEEMIX] ✅ Moved (rename): ${finalFilename}`);
                } catch (renameErr) {
                  fs.copyFileSync(tempFilePath, finalFilePath);
                  fs.unlinkSync(tempFilePath);
                  console.log(`[DEEMIX] ✅ Moved (copy+delete): ${finalFilename}`);
                }
                
                for (const f of newFiles) {
                  if (f !== validFile) {
                    try { fs.unlinkSync(path.join(tempDownloadFolder, f)); } catch (e) {}
                  }
                }
                try {
                  const remaining = fs.readdirSync(tempDownloadFolder);
                  if (remaining.length === 0) fs.rmdirSync(tempDownloadFolder);
                } catch (e) {}
              } catch (moveError) {
                try {
                  if (!fs.existsSync(finalFilePath) && fs.existsSync(tempFilePath)) {
                    fs.copyFileSync(tempFilePath, finalFilePath);
                  }
                } catch (emergencyErr) {}
              }
              
              if (!stationName) {
                _showNotification('✅ Download Concluído', `${finalArtist} - ${finalTitle}`, () => { shell.openPath(finalOutputFolder); });
              }

              resolve({ 
                success: true, 
                track: { id: track.id, title: track.title, artist: track.artist.name, album: track.album.title, duration: track.duration },
                output: stdout, outputFolder: finalOutputFolder, stationFolder: sanitizedStation,
                verifiedFile: finalFilename,
                message: `Download concluído: ${finalArtist} - ${finalTitle}`
              });
            } catch (verifyError) {
              resolve({ 
                success: true,
                track: { id: track.id, title: track.title, artist: track.artist.name, album: track.album?.title, duration: track.duration },
                output: stdout, outputFolder: finalOutputFolder, stationFolder: sanitizedStation,
                message: `Download concluído (verificação parcial): ${artist} - ${title}`
              });
            }
          }, 3000);
        });
        
        // Track active download process for graceful shutdown
        try {
          const mainModule = require('../main.cjs');
          if (mainModule.setActiveDownloadProcess) mainModule.setActiveDownloadProcess(childProcess);
        } catch (e) {}
      });
      
    } catch (error) {
      console.error('[DEEMIX] Download error:', error);
      return { success: false, error: error.message || 'Erro ao baixar do Deezer' };
    }
  });

}

module.exports = { register };
