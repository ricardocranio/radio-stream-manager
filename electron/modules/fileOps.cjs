// =============== FILE OPERATIONS: Grade files, folders, purge, scan-fix, rename ===============
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { sanitizeFolderName, parseID3TagsFromFile } = require('./utils.cjs');

let _getMainWindow = null;

function register({ getMainWindow }) {
  _getMainWindow = getMainWindow;

  // IPC: Create station folders
  ipcMain.handle('ensure-station-folders', async (event, { baseFolder, stations }) => {
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
  ipcMain.handle('check-file-in-subfolders', async (event, { baseFolder, artist, title }) => {
    const { checkFileExistsInSubfolders } = require('./utils.cjs');
    const searchPattern = `${artist} - ${title}`;
    return checkFileExistsInSubfolders(baseFolder, searchPattern);
  });

  // IPC: Purge blocked songs from disk
  ipcMain.handle('purge-blocked-files', async (event, { musicFolders, blockedSongs, forbiddenWords }) => {
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
  ipcMain.handle('read-id3-genre', async (event, { filePath, musicFolders }) => {
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
      return { success: true, genre: tags.genre || null, artist: tags.artist || null, title: tags.title || null };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // IPC: Scan library and rename files based on ID3 tags
  ipcMain.handle('scan-fix-library', async (event, { musicFolders }) => {
    console.log('[LIB-FIX] Starting library scan & fix...');
    const results = { scanned: 0, renamed: 0, skipped: 0, errors: 0, details: [] };
    const mainWindow = _getMainWindow();
    
    const scanFolder = (folder) => {
      try {
        if (!fs.existsSync(folder)) return;
        const items = fs.readdirSync(folder, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(folder, item.name);
          if (item.isDirectory()) {
            scanFolder(fullPath);
          } else if (/\.mp3$/i.test(item.name)) {
            results.scanned++;
            try {
              const tags = parseID3TagsFromFile(fullPath);
              if (!tags.artist || !tags.title) { results.skipped++; continue; }
              const sanitizeForDisk = (str) => str
                .replace(/&/g, 'e')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[<>:"/\\|?*]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              const sanitizedArtist = sanitizeForDisk(tags.artist);
              const sanitizedTitle = sanitizeForDisk(tags.title);
              const correctName = `${sanitizedArtist} - ${sanitizedTitle}.mp3`;
              if (item.name === correctName) { results.skipped++; continue; }
              const newPath = path.join(folder, correctName);
              if (fs.existsSync(newPath) && newPath !== fullPath) {
                results.skipped++;
                results.details.push({ old: item.name, new: correctName, status: 'skip-exists' });
                continue;
              }
              fs.renameSync(fullPath, newPath);
              results.renamed++;
              results.details.push({ old: item.name, new: correctName, status: 'renamed' });
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('lib-fix-progress', { scanned: results.scanned, renamed: results.renamed, current: item.name });
              }
            } catch (fileErr) {
              results.errors++;
              results.details.push({ old: item.name, new: '', status: 'error', error: fileErr.message });
            }
          }
        }
      } catch (err) {
        console.error(`[LIB-FIX] Error scanning ${folder}:`, err.message);
      }
    };
    
    for (const folder of (musicFolders || [])) { scanFolder(folder); }
    console.log(`[LIB-FIX] Done: ${results.scanned} scanned, ${results.renamed} renamed, ${results.skipped} skipped, ${results.errors} errors`);
    return results;
  });

  // IPC: Save grade file
  ipcMain.handle('save-grade-file', async (event, { folder, filename, content }) => {
    try {
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
      const filePath = path.join(folder, filename);
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error.message || 'Erro ao salvar arquivo' };
    }
  });

  // IPC: Read grade file
  ipcMain.handle('read-grade-file', async (event, { folder, filename }) => {
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
  ipcMain.handle('list-folder-files', async (event, { folder, extension }) => {
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
  ipcMain.handle('rename-music-file', async (event, { musicFolders, currentFilename, newFilename }) => {
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
}

module.exports = { register };
