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
        track = await deemixModule.searchDeezerTrack(artist, title);
        console.log(`[DEEMIX] Found: ${track.artist.name} - ${track.title} (ID: ${track.id})`);
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
          const waitForStableFile = (filePath, maxWaitMs = 10000) => {
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
              const MIN_FILE_SIZE = 1.5 * 1024 * 1024; // 1.5MB min (a real song at 128kbps ~3min = ~2.8MB)
              const MAX_FILE_SIZE = 25 * 1024 * 1024;   // 25MB max
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
                console.log(`[DEEMIX] ✅ File integrity OK: ${newFile} (${fileSizeMB} MB)`);
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
                const buf = Buffer.alloc(4096);
                const fd = fs.openSync(tempFilePath, 'r');
                fs.readSync(fd, buf, 0, 4096, 0);
                fs.closeSync(fd);
                
                if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
                  const parseID3Frames = (buffer, headerSize) => {
                    let offset = 10;
                    const result = {};
                    while (offset < headerSize - 10) {
                      const frameId = buffer.slice(offset, offset + 4).toString('ascii');
                      if (frameId === '\x00\x00\x00\x00') break;
                      const frameSize = (buffer[offset+4] << 24) | (buffer[offset+5] << 16) | (buffer[offset+6] << 8) | buffer[offset+7];
                      if (frameSize <= 0 || frameSize > headerSize) break;
                      const frameData = buffer.slice(offset + 10, offset + 10 + frameSize);
                      
                      if (frameId === 'TPE1' || frameId === 'TIT2') {
                        const encoding = frameData[0];
                        let text = '';
                        if (encoding === 0) {
                          text = frameData.slice(1).toString('latin1').replace(/\0/g, '');
                        } else if (encoding === 1) {
                          // UTF-16 with BOM — detect byte order
                          const bom1 = frameData[1], bom2 = frameData[2];
                          if (bom1 === 0xFE && bom2 === 0xFF) {
                            // Big-endian: swap bytes to read as utf16le
                            const beData = frameData.slice(3);
                            const swapped = Buffer.alloc(beData.length);
                            for (let b = 0; b < beData.length - 1; b += 2) {
                              swapped[b] = beData[b + 1];
                              swapped[b + 1] = beData[b];
                            }
                            text = swapped.toString('utf16le').replace(/\0/g, '');
                          } else {
                            // Little-endian (FF FE) or missing BOM — default utf16le
                            const startOffset = (bom1 === 0xFF && bom2 === 0xFE) ? 3 : 1;
                            text = frameData.slice(startOffset).toString('utf16le').replace(/\0/g, '');
                          }
                        } else if (encoding === 2) {
                          // UTF-16BE without BOM
                          const beData = frameData.slice(1);
                          const swapped = Buffer.alloc(beData.length);
                          for (let b = 0; b < beData.length - 1; b += 2) {
                            swapped[b] = beData[b + 1];
                            swapped[b + 1] = beData[b];
                          }
                          text = swapped.toString('utf16le').replace(/\0/g, '');
                        } else if (encoding === 3) {
                          text = frameData.slice(1).toString('utf8').replace(/\0/g, '');
                        }
                        if (frameId === 'TPE1') result.artist = text.trim();
                        if (frameId === 'TIT2') result.title = text.trim();
                      }
                      offset += 10 + frameSize;
                    }
                    return result;
                  };
                  
                  const id3Size = ((buf[6] & 0x7F) << 21) | ((buf[7] & 0x7F) << 14) | ((buf[8] & 0x7F) << 7) | (buf[9] & 0x7F);
                  const tags = parseID3Frames(buf, Math.min(id3Size + 10, 4096));
                  if (tags.artist) id3Artist = tags.artist;
                  if (tags.title) id3Title = tags.title;
                  console.log(`[DEEMIX] 🏷️ ID3 Tags: Artist="${id3Artist || '?'}", Title="${id3Title || '?'}"`);
                }
              } catch (tagErr) {
                console.warn(`[DEEMIX] ⚠️ Could not read ID3 tags: ${tagErr.message}`);
              }
              
              // Sanitize: remove filesystem chars, accents, & → e
              const sanitizeForDisk = (str) => str
                .replace(/&/g, 'e')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[<>:"/\\|?*]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

              // Validation: reject ID3 text with unexpected characters (Ø, ø, ð, þ, etc.)
              // These indicate encoding corruption and should NOT be used for filenames
              const hasCorruptedChars = (str) => /[^\x20-\x7E\u00C0-\u024F\u1E00-\u1EFF]/.test(
                str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
              );

              // Priority: Deezer API names > ID3 tags > original search params
              // ID3 tags can have encoding corruption (e.g., Ø instead of o)
              const safeId3Artist = id3Artist && !hasCorruptedChars(id3Artist) ? id3Artist : null;
              const safeId3Title = id3Title && !hasCorruptedChars(id3Title) ? id3Title : null;
              
              // Prefer Deezer API (clean and reliable), fall back to validated ID3, then original params
              const finalArtist = sanitizeForDisk(track.artist.name || safeId3Artist || artist);
              const finalTitle = sanitizeForDisk(track.title || safeId3Title || title);
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
      });
      
    } catch (error) {
      console.error('[DEEMIX] Download error:', error);
      return { success: false, error: error.message || 'Erro ao baixar do Deezer' };
    }
  });

}

module.exports = { register };
