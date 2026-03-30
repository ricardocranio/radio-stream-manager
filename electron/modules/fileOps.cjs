// =============== FILE OPERATIONS: Grade files, folders, purge, scan-fix, rename ===============
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { sanitizeFolderName, parseID3TagsFromFile, sanitizeForDisk } = require('./utils.cjs');

// Pastas onde PkInfo deve ser removido automaticamente
const PKINFO_CLEANUP_FOLDERS = [
  'C:\\Playlist\\Locucoes',
  'C:\\Playlist\\A Voz do Brasil',
];

/**
 * Delete PkInfo folder — ONLY in the two designated folders.
 */
function deletePkInfoFolder(folder) {
  const normalized = path.resolve(folder);
  const isAllowed = PKINFO_CLEANUP_FOLDERS.some(f => path.resolve(f) === normalized);
  if (!isAllowed) return;
  try {
    const pkInfoPath = path.join(folder, 'PkInfo');
    if (fs.existsSync(pkInfoPath)) {
      fs.rmSync(pkInfoPath, { recursive: true, force: true });
      console.log(`[FILE-OPS] 🗑️ PkInfo removido: ${pkInfoPath}`);
    }
  } catch (err) {
    console.log(`[FILE-OPS] ⚠️ Erro ao remover PkInfo: ${err.message}`);
  }
}

let _getMainWindow = null;

function register({ getMainWindow, safeHandle }) {
  _getMainWindow = getMainWindow;
  const handle = safeHandle || ipcMain.handle.bind(ipcMain);

  // IPC: Create station folders
  handle('ensure-station-folders', async (event, { baseFolder, stations }) => {
    console.log(`[FOLDERS] Creating station folders in: ${baseFolder}`);
    const created = [];
    try {
      if (!fs.existsSync(baseFolder)) fs.mkdirSync(baseFolder, { recursive: true });
      for (const stationName of stations) {
        const sanitized = sanitizeFolderName(stationName);
        const folderPath = path.join(baseFolder, sanitized);
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
          created.push(sanitized);
        }
      }
      return { success: true, created, total: stations.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // IPC: Check if file exists in any station subfolder
  handle('check-file-in-subfolders', async (event, { baseFolder, artist, title }) => {
    const { checkFileExistsInSubfolders } = require('./utils.cjs');
    const searchPattern = `${artist} - ${title}`;
    return checkFileExistsInSubfolders(baseFolder, searchPattern);
  });

  // IPC: Purge blocked songs from disk
  handle('purge-blocked-files', async (event, { musicFolders, blockedSongs, forbiddenWords }) => {
    console.log('[PURGE] Starting purge of blocked files...');
    const deleted = [];
    const errors = [];
    
    const blockedList = (blockedSongs || []).map(s => s.toLowerCase().trim());
    const blockedExact = new Set(blockedList.filter(s => !s.endsWith(' - *')));
    const blockedWildcardArtists = blockedList.filter(s => s.endsWith(' - *')).map(s => s.replace(/ - \*$/, ''));
    const forbiddenLower = (forbiddenWords || []).map(w => w.toLowerCase().trim()).filter(Boolean);
    
    const isBlockedFile = (filename) => {
      const baseName = path.basename(filename, path.extname(filename)).toLowerCase();
      const dashIdx = baseName.indexOf(' - ');
      let artist = baseName;
      let title = '';
      if (dashIdx > 0) {
        artist = baseName.substring(0, dashIdx).trim();
        title = baseName.substring(dashIdx + 3).trim();
      }
      const key = dashIdx > 0 ? `${artist} - ${title}` : baseName;
      if (blockedExact.has(key)) return true;
      if (blockedWildcardArtists.some(blocked => artist === blocked || artist.includes(blocked))) return true;
      if (forbiddenLower.some(word => artist.includes(word) || title.includes(word) || baseName.includes(word))) return true;
      return false;
    };
    
    const scanFolder = (folder) => {
      try {
        if (!fs.existsSync(folder)) return;
        const items = fs.readdirSync(folder, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(folder, item.name);
          if (item.isDirectory()) {
            scanFolder(fullPath);
          } else if (/\.(mp3|flac|wav|ogg|m4a)$/i.test(item.name)) {
            if (isBlockedFile(item.name)) {
              try {
                fs.unlinkSync(fullPath);
                deleted.push(fullPath);
              } catch (delErr) {
                errors.push({ file: fullPath, error: delErr.message });
              }
            }
          }
        }
      } catch (err) {
        errors.push({ file: folder, error: err.message });
      }
    };
    
    for (const folder of (musicFolders || [])) {
      scanFolder(folder);
    }
    
    console.log(`[PURGE] Complete: ${deleted.length} files deleted, ${errors.length} errors`);
    return { success: true, deleted, errors, deletedCount: deleted.length };
  });

  // IPC: Read ID3 genre from file
  handle('read-id3-genre', async (event, { filePath, musicFolders }) => {
    try {
      let targetPath = filePath;
      if (!path.isAbsolute(filePath) && musicFolders && musicFolders.length > 0) {
        for (const folder of musicFolders) {
          const searchInFolder = (dir) => {
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  const found = searchInFolder(fullPath);
                  if (found) return found;
                } else if (entry.name.toLowerCase() === filePath.toLowerCase()) {
                  return fullPath;
                }
              }
            } catch (e) {}
            return null;
          };
          const found = searchInFolder(folder);
          if (found) { targetPath = found; break; }
        }
      }
      if (!fs.existsSync(targetPath)) return { success: false, error: 'File not found' };
      const tags = parseID3TagsFromFile(targetPath);
      return { success: true, genre: tags.genre || null, artist: tags.artist || null, title: tags.title || null, year: tags.year || null };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // IPC: Scan library — READ-ONLY audit, never renames files in the final library.
  // User-modified filenames must be preserved. Renaming only happens in _temp → final move.
  handle('scan-fix-library', async (event, { musicFolders }) => {
    console.log('[LIB-FIX] Starting library scan (audit only, NO rename to preserve user changes)...');
    const results = { scanned: 0, renamed: 0, skipped: 0, errors: 0, purged: 0, details: [] };
    const mainWindow = _getMainWindow();
    
    const scanFolder = (folder) => {
      try {
        if (!fs.existsSync(folder)) return;
        const items = fs.readdirSync(folder, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(folder, item.name);
          if (item.isDirectory()) {
            if (item.name === '_temp') continue;
            scanFolder(fullPath);
          } else if (/\.mp3$/i.test(item.name)) {
            results.scanned++;
            results.skipped++;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('lib-fix-progress', { scanned: results.scanned, renamed: 0, purged: 0, current: item.name });
            }
          }
        }
      } catch (err) {
        console.error(`[LIB-FIX] Error scanning ${folder}:`, err.message);
      }
    };
    
    for (const folder of (musicFolders || [])) { scanFolder(folder); }
    console.log(`[LIB-FIX] Done: ${results.scanned} scanned (audit only, 0 renamed to preserve user changes)`);
    return results;
  });

  // IPC: Save grade file
  handle('save-grade-file', async (event, { folder, filename, content }) => {
    try {
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
      const filePath = path.join(folder, filename);
      fs.writeFileSync(filePath, content, 'utf-8');
      // Clean PkInfo after file update
      deletePkInfoFolder(folder);
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error.message || 'Erro ao salvar arquivo' };
    }
  });

  // IPC: Read grade file
  handle('read-grade-file', async (event, { folder, filename }) => {
    try {
      const filePath = path.join(folder, filename);
      if (!fs.existsSync(filePath)) return { success: false, error: 'Arquivo não encontrado' };
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // IPC: List files in folder
  handle('list-folder-files', async (event, { folder, extension }) => {
    try {
      if (!fs.existsSync(folder)) return { success: true, files: [] };
      let files = fs.readdirSync(folder);
      if (extension) files = files.filter(f => f.endsWith(extension));
      const fileDetails = files.map(f => {
        const filePath = path.join(folder, f);
        const stats = fs.statSync(filePath);
        return { name: f, size: stats.size, modified: stats.mtime.toISOString() };
      });
      return { success: true, files: fileDetails };
    } catch (error) {
      return { success: false, error: error.message, files: [] };
    }
  });

  // IPC: Rename a music file
  handle('rename-music-file', async (event, { musicFolders, currentFilename, newFilename }) => {
    const normalizeForComparison = (name) => {
      return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'e').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    };
    
    const normalizedTarget = normalizeForComparison(newFilename);
    
    try {
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
              if (normalizeForComparison(entry.name) === normalizedTarget) {
                foundPath = fullPath;
                foundName = entry.name;
              }
            }
          }
        } catch (e) {}
      };
      
      for (const folder of musicFolders) {
        if (foundPath) break;
        if (fs.existsSync(folder)) searchRecursive(folder);
      }
      
      if (!foundPath) return { success: false, renamed: false, reason: 'File not found in music folders' };
      if (foundName === newFilename) return { success: true, renamed: false, reason: 'File already has correct name', path: foundPath };
      
      const newPath = path.join(path.dirname(foundPath), newFilename);
      if (fs.existsSync(newPath) && foundPath !== newPath) {
        return { success: true, renamed: false, reason: 'Destination file already exists', path: newPath };
      }
      
      fs.renameSync(foundPath, newPath);
      return { success: true, renamed: true, oldPath: foundPath, newPath, oldName: foundName };
    } catch (error) {
      return { success: false, renamed: false, error: error.message };
    }
  });

  // IPC: Reorganize existing files by ID3 genre (only Rock/Metal)
  handle('reorganize-by-genre', async (event, { sourceFolder, genreRoutes }) => {
    console.log(`[GENRE-REORG] 🔍 Scanning: ${sourceFolder}`);
    const results = { scanned: 0, moved: 0, skipped: 0, errors: 0, details: [] };
    try {
      if (!fs.existsSync(sourceFolder)) {
        return { success: false, error: `Pasta não encontrada: ${sourceFolder}` };
      }
      const files = fs.readdirSync(sourceFolder).filter(f => /\.(mp3|flac)$/i.test(f));
      results.scanned = files.length;
      console.log(`[GENRE-REORG] Found ${files.length} audio files`);

      // Build genre map from routes: { 'rock': 'Rock', 'metal': 'Metal' }
      const genreMap = {};
      for (const route of (genreRoutes || [])) {
        if (route.genre && route.folderName) {
          genreMap[route.genre.toLowerCase()] = route.folderName;
        }
      }

      for (const file of files) {
        try {
          const filePath = path.join(sourceFolder, file);
          const tags = parseID3TagsFromFile(filePath);
          const rawGenre = (tags.genre || '').toLowerCase().replace(/[()]/g, '').trim();
          
          if (!rawGenre) {
            results.skipped++;
            continue;
          }

          // Check if genre matches any route
          let matchedFolder = null;
          for (const [genreKey, folder] of Object.entries(genreMap)) {
            if (rawGenre.includes(genreKey)) {
              matchedFolder = folder;
              break;
            }
          }

          if (!matchedFolder) {
            results.skipped++;
            continue;
          }

          const targetFolder = path.join(sourceFolder, matchedFolder);
          if (!fs.existsSync(targetFolder)) {
            fs.mkdirSync(targetFolder, { recursive: true });
          }
          
          // PRESERVE user-modified filename — never rename files already in the final library.
          // Only _temp → final moves apply sanitization. Files in main folders keep their names.
          const finalFileName = file;
          
          const targetPath = path.join(targetFolder, finalFileName);
          if (fs.existsSync(targetPath)) {
            // If sanitized version exists, delete source
            if (finalFileName !== file) {
              try { fs.unlinkSync(filePath); } catch (e) {}
              results.skipped++;
              continue;
            }
            results.skipped++;
            continue;
          }
          try {
            fs.renameSync(filePath, targetPath);
          } catch (e) {
            fs.copyFileSync(filePath, targetPath);
            fs.unlinkSync(filePath);
          }
          results.moved++;
          results.details.push({ file: finalFileName, genre: rawGenre, folder: matchedFolder });
          console.log(`[GENRE-REORG] ✅ ${file} → ${matchedFolder}/${finalFileName} (${rawGenre})`);
        } catch (fileErr) {
          results.errors++;
          console.warn(`[GENRE-REORG] ⚠️ Erro em ${file}: ${fileErr.message}`);
        }
      }
      console.log(`[GENRE-REORG] Done: ${results.moved} moved, ${results.skipped} skipped, ${results.errors} errors`);
      return { success: true, ...results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  handle('move-file-to-genre-folder', async (event, { sourceFolder, fileName, targetSubfolder }) => {
    try {
      const sourcePath = path.join(sourceFolder, fileName);
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: `Arquivo não encontrado: ${fileName}` };
      }
      const targetFolder = path.join(sourceFolder, targetSubfolder);
      if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
        console.log(`[GENRE-ROUTE] 📁 Pasta criada: ${targetFolder}`);
      }
      const targetPath = path.join(targetFolder, fileName);
      if (fs.existsSync(targetPath)) {
        console.log(`[GENRE-ROUTE] ⏭️ Arquivo já existe no destino: ${targetPath}`);
        try { fs.unlinkSync(sourcePath); } catch (e) {}
        return { success: true, skipped: true, path: targetPath };
      }
      try {
        fs.renameSync(sourcePath, targetPath);
      } catch (renameErr) {
        fs.copyFileSync(sourcePath, targetPath);
        fs.unlinkSync(sourcePath);
      }
      console.log(`[GENRE-ROUTE] ✅ ${fileName} → ${targetSubfolder}/`);
      return { success: true, path: targetPath, folder: targetSubfolder };
    } catch (error) {
      console.error(`[GENRE-ROUTE] ❌ Erro: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // IPC: Process files in _temp folders — read ID3, rename, move to parent, return genre for routing
  // IPC: Cleanup content folder (delete all files inside)
  handle('cleanup-content-folder', async (event, { folder }) => {
    console.log(`[FILE-OPS] 🗑️ Limpando pasta de conteúdo: ${folder}`);
    try {
      if (!fs.existsSync(folder)) {
        return { success: true, deletedCount: 0 };
      }

      const items = fs.readdirSync(folder);
      let deletedCount = 0;

      for (const item of items) {
        const itemPath = path.join(folder, item);
        try {
          const stat = fs.statSync(itemPath);
          if (stat.isFile()) {
            fs.unlinkSync(itemPath);
            deletedCount++;
          } else if (stat.isDirectory()) {
            // Recursively delete subdirectories like PkInfo
            fs.rmSync(itemPath, { recursive: true, force: true });
            deletedCount++;
          }
        } catch (err) {
          console.warn(`[FILE-OPS] ⚠️ Erro ao apagar ${item}: ${err.message}`);
        }
      }

      console.log(`[FILE-OPS] ✅ Limpeza concluída: ${deletedCount} item(ns) removido(s) de ${folder}`);
      return { success: true, deletedCount };
    } catch (err) {
      console.error(`[FILE-OPS] ❌ Erro na limpeza: ${err.message}`);
      return { success: false, deletedCount: 0, error: err.message };
    }
  });

  handle('process-temp-files', async (event, { musicFolders }) => {
    const results = { processed: 0, moved: 0, skipped: 0, errors: 0, details: [], movedFiles: [] };
    const mainWindow = _getMainWindow();

    const STABILITY_MS = 2000; // file must be stable for 2s

    const isFileStable = (filePath) => {
      try {
        const stat1 = fs.statSync(filePath);
        if (stat1.size === 0) return false;
        return (Date.now() - stat1.mtimeMs) > STABILITY_MS;
      } catch { return false; }
    };

    const processTempFolder = (parentFolder, tempFolder) => {
      try {
        if (!fs.existsSync(tempFolder)) return;
        const files = fs.readdirSync(tempFolder).filter(f => /\.(mp3|flac)$/i.test(f));
        
        for (const file of files) {
          const fullPath = path.join(tempFolder, file);
          results.processed++;

          if (!isFileStable(fullPath)) {
            results.skipped++;
            results.details.push({ file, status: 'skip-unstable' });
            continue;
          }

          try {
            const tags = parseID3TagsFromFile(fullPath);
            
            if (!tags.artist || !tags.title) {
              results.skipped++;
              results.details.push({ file, status: 'skip-no-id3' });
              continue;
            }

            const sanitizedArtist = sanitizeForDisk(tags.artist, 'artist');
            const sanitizedTitle = sanitizeForDisk(tags.title, 'title');

            if (!sanitizedArtist || !sanitizedTitle) {
              results.skipped++;
              results.details.push({ file, status: 'skip-invalid-id3' });
              continue;
            }

            const ext = path.extname(file).toLowerCase();
            const correctName = `${sanitizedArtist} - ${sanitizedTitle}${ext}`;
            const destPath = path.join(parentFolder, correctName);

            if (fs.existsSync(destPath)) {
              fs.unlinkSync(fullPath);
              results.skipped++;
              results.details.push({ file, correctName, status: 'skip-exists-removed-temp' });
              console.log(`[TEMP-ID3] ⏭ Already exists, removed temp: ${file}`);
              continue;
            }

            try {
              fs.renameSync(fullPath, destPath);
            } catch (renameErr) {
              fs.copyFileSync(fullPath, destPath);
              fs.unlinkSync(fullPath);
            }

            results.moved++;
            results.details.push({ file, correctName, status: 'moved' });
            // Include genre/year info for frontend routing
            results.movedFiles.push({
              filename: correctName,
              folder: parentFolder,
              genre: tags.genre || null,
              year: tags.year || null,
              artist: sanitizedArtist,
              title: sanitizedTitle,
            });
            console.log(`[TEMP-ID3] ✅ ${file} → ${correctName} (genre: ${tags.genre || 'N/A'})`);

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('lib-fix-progress', {
                scanned: results.processed,
                renamed: results.moved,
                purged: 0,
                current: `📂 ${correctName}`,
              });
            }
          } catch (fileErr) {
            results.errors++;
            results.details.push({ file, status: 'error', error: fileErr.message });
            console.error(`[TEMP-ID3] ❌ ${file}: ${fileErr.message}`);
          }
        }
      } catch (err) {
        console.error(`[TEMP-ID3] Error scanning ${tempFolder}:`, err.message);
      }
    };

    for (const folder of (musicFolders || [])) {
      if (!fs.existsSync(folder)) continue;
      
      const directTemp = path.join(folder, '_temp');
      processTempFolder(folder, directTemp);

      try {
        const items = fs.readdirSync(folder, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory() && item.name !== '_temp') {
            const subTemp = path.join(folder, item.name, '_temp');
            processTempFolder(path.join(folder, item.name), subTemp);
          }
        }
      } catch (err) {
        console.error(`[TEMP-ID3] Error listing ${folder}:`, err.message);
      }
    }

    if (results.moved > 0) {
      console.log(`[TEMP-ID3] Done: ${results.processed} found, ${results.moved} moved, ${results.skipped} skipped, ${results.errors} errors`);
    }
    return results;
  });
}

module.exports = { register };
