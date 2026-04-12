// =============== FILE OPERATIONS: Grade files, folders, purge, scan-fix, rename ===============
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { sanitizeFolderName, parseID3TagsFromFile, sanitizeForDisk, calculateSimilarity, cleanNormalize } = require('./utils.cjs');

// Pastas onde PkInfo deve ser removido automaticamente
const PKINFO_CLEANUP_FOLDERS = [
  'C:\\Playlist\\Locucoes',
  'C:\\Playlist\\A Voz do Brasil',
];
const QUARANTINE_FOLDER_NAME = '_QUARENTENA_SUSPEITAS';

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

function isAudioFile(name) {
  return /\.(mp3|flac|wav|ogg|m4a|aac|wma)$/i.test(name);
}

function parseArtistTitleFromFilename(filename) {
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  const dashIdx = baseName.indexOf(' - ');

  if (dashIdx <= 0) {
    return { artist: '', title: baseName };
  }

  return {
    artist: baseName.substring(0, dashIdx).trim(),
    title: baseName.substring(dashIdx + 3).trim(),
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildUniqueTargetPath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;

  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  let counter = 2;

  while (counter < 10000) {
    const candidate = path.join(dir, `${base} (${counter})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    counter++;
  }

  return path.join(dir, `${base} (${Date.now()})${ext}`);
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
          } else if (isAudioFile(item.name)) {
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

  // IPC: Scan library and move suspicious files to quarantine based on filename vs ID3 mismatch.
  handle('scan-quarantine-library', async (event, { musicFolders }) => {
    console.log('[LIB-QUAR] Starting suspicious library scan...');
    const results = {
      success: true,
      scanned: 0,
      quarantined: 0,
      skipped: 0,
      errors: 0,
      quarantineFolderName: QUARANTINE_FOLDER_NAME,
      details: [],
    };
    const mainWindow = _getMainWindow();

    const sendProgress = (current) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lib-fix-progress', {
          scanned: results.scanned,
          quarantined: results.quarantined,
          current,
        });
      }
    };

    const scanFolder = (folder, rootFolder) => {
      try {
        if (!fs.existsSync(folder)) return;
        const items = fs.readdirSync(folder, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(folder, item.name);

          if (item.isDirectory()) {
            if (item.name === '_temp' || item.name === QUARANTINE_FOLDER_NAME) continue;
            scanFolder(fullPath, rootFolder);
            continue;
          }

          if (!isAudioFile(item.name)) continue;

          results.scanned++;
          sendProgress(item.name);

          try {
            const parsed = parseArtistTitleFromFilename(item.name);
            if (!parsed.artist || !parsed.title) {
              results.skipped++;
              continue;
            }

            const tags = parseID3TagsFromFile(fullPath);
            const id3Artist = (tags.artist || '').trim();
            const id3Title = (tags.title || '').trim();
            if (!id3Artist || !id3Title) {
              results.skipped++;
              continue;
            }

            const artistSimilarity = Math.max(
              calculateSimilarity(parsed.artist, id3Artist),
              calculateSimilarity(cleanNormalize(parsed.artist), cleanNormalize(id3Artist))
            );
            const titleSimilarity = Math.max(
              calculateSimilarity(parsed.title, id3Title),
              calculateSimilarity(cleanNormalize(parsed.title), cleanNormalize(id3Title))
            );
            const combinedSimilarity = (artistSimilarity + titleSimilarity) / 2;
            const isSuspicious = artistSimilarity < 0.55 || titleSimilarity < 0.5 || combinedSimilarity < 0.62;

            if (!isSuspicious) {
              results.skipped++;
              continue;
            }

            const quarantineRoot = path.join(rootFolder, QUARANTINE_FOLDER_NAME);
            const relativePath = path.relative(rootFolder, fullPath);
            const targetPath = buildUniqueTargetPath(path.join(quarantineRoot, relativePath));
            ensureDir(path.dirname(targetPath));
            fs.renameSync(fullPath, targetPath);

            results.quarantined++;
            results.details.push({
              from: fullPath,
              to: targetPath,
              filenameArtist: parsed.artist,
              filenameTitle: parsed.title,
              id3Artist,
              id3Title,
              artistSimilarity,
              titleSimilarity,
              status: 'quarantined',
            });

            console.warn(
              `[LIB-QUAR] 🚨 ${item.name} → ID3="${id3Artist} - ${id3Title}" ` +
              `(artist=${Math.round(artistSimilarity * 100)}%, title=${Math.round(titleSimilarity * 100)}%)`
            );
          } catch (fileErr) {
            results.errors++;
            results.details.push({
              from: fullPath,
              to: '',
              filenameArtist: '',
              filenameTitle: item.name,
              id3Artist: '',
              id3Title: '',
              artistSimilarity: 0,
              titleSimilarity: 0,
              status: 'error',
              error: fileErr.message,
            });
          }
        }
      } catch (err) {
        results.errors++;
        results.details.push({
          from: folder,
          to: '',
          filenameArtist: '',
          filenameTitle: '',
          id3Artist: '',
          id3Title: '',
          artistSimilarity: 0,
          titleSimilarity: 0,
          status: 'error',
          error: err.message,
        });
      }
    };

    for (const folder of (musicFolders || [])) {
      scanFolder(folder, folder);
    }

    console.log(`[LIB-QUAR] Done: ${results.quarantined} quarantined from ${results.scanned} scanned`);
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

  // ── Genre normalization map (mirrors id3GenreUtils.ts) ──
  const ID3_GENRE_TEXT_MAP = {
    pop:'POP','synth-pop':'POP','indie pop':'POP','dance pop':'POP','pop rock':'POP','electropop':'POP','teen pop':'POP','power pop':'POP','j-pop':'POP','k-pop':'POP','art pop':'POP','dream pop':'POP','chamber pop':'POP','sunshine pop':'POP','bubblegum pop':'POP',
    rock:'ROCK','rock and roll':'ROCK','classic rock':'ROCK','alternative rock':'ROCK','alternative':'ROCK','indie rock':'ROCK','punk rock':'ROCK',punk:'ROCK','post-punk':'ROCK',grunge:'ROCK','hard rock':'ROCK','soft rock':'ROCK','progressive rock':'ROCK','psychedelic rock':'ROCK','garage rock':'ROCK','southern rock':'ROCK','stoner rock':'ROCK','folk rock':'ROCK','blues rock':'ROCK','new wave':'ROCK','brit pop':'ROCK',britpop:'ROCK','post-rock':'ROCK',emo:'ROCK','pop punk':'ROCK',ska:'ROCK',
    metal:'METAL','heavy metal':'METAL','death metal':'METAL','black metal':'METAL','thrash metal':'METAL','power metal':'METAL','doom metal':'METAL','symphonic metal':'METAL','nu metal':'METAL','nu-metal':'METAL',metalcore:'METAL','progressive metal':'METAL','gothic metal':'METAL','folk metal':'METAL','speed metal':'METAL','groove metal':'METAL','industrial metal':'METAL','melodic death metal':'METAL',deathcore:'METAL',djent:'METAL',hardcore:'METAL',
    sertanejo:'SERTANEJO','sertanejo universitário':'SERTANEJO','sertanejo universitario':'SERTANEJO','sertanejo raiz':'SERTANEJO','sertanejo pop':'SERTANEJO','country brasileiro':'SERTANEJO','música sertaneja':'SERTANEJO','musica sertaneja':'SERTANEJO',
    pagode:'PAGODE',samba:'PAGODE','samba rock':'PAGODE','samba de roda':'PAGODE','partido alto':'PAGODE',
    mpb:'MPB','música popular brasileira':'MPB','musica popular brasileira':'MPB','bossa nova':'MPB','tropicalia':'MPB','tropicália':'MPB',blues:'MPB',brazilian:'MPB',
    'hip-hop':'RAP/HIP-HOP','hip hop':'RAP/HIP-HOP',rap:'RAP/HIP-HOP',trap:'RAP/HIP-HOP','boom bap':'RAP/HIP-HOP','rap brasileiro':'RAP/HIP-HOP','gangsta rap':'RAP/HIP-HOP','conscious hip hop':'RAP/HIP-HOP',
    electronic:'ELETRONICA',dance:'ELETRONICA',edm:'ELETRONICA',house:'ELETRONICA','deep house':'ELETRONICA',techno:'ELETRONICA',trance:'ELETRONICA',dubstep:'ELETRONICA','drum and bass':'ELETRONICA','drum & bass':'ELETRONICA',dnb:'ELETRONICA',ambient:'ELETRONICA','lo-fi':'ELETRONICA',lofi:'ELETRONICA',chillout:'ELETRONICA','future bass':'ELETRONICA',synthwave:'ELETRONICA',disco:'ELETRONICA','nu-disco':'ELETRONICA','progressive house':'ELETRONICA','electro house':'ELETRONICA','tropical house':'ELETRONICA',
    funk:'FUNK','funk carioca':'FUNK','funk brasileiro':'FUNK','funk melody':'FUNK','funk ostentação':'FUNK','funk ostentacao':'FUNK','baile funk':'FUNK','funk pop':'FUNK',
    gospel:'GOSPEL',christian:'GOSPEL',worship:'GOSPEL','música gospel':'GOSPEL','musica gospel':'GOSPEL',ccm:'GOSPEL','christian rock':'GOSPEL',praise:'GOSPEL',
    'forró':'FORRO',forro:'FORRO','forró eletrônico':'FORRO','forro eletronico':'FORRO','axé':'FORRO',axe:'FORRO',arrocha:'FORRO',piseiro:'FORRO',pisadinha:'FORRO',
    reggaeton:'REGGAETON','reggaetón':'REGGAETON','latin pop':'REGGAETON',latin:'LATINA',latina:'LATINA','latin urban':'REGGAETON',bachata:'REGGAETON',salsa:'LATINA',cumbia:'LATINA',merengue:'LATINA',
    'r&b':'R&B',rnb:'R&B',soul:'R&B','neo soul':'R&B','neo-soul':'R&B','contemporary r&b':'R&B',motown:'R&B',
    country:'COUNTRY','country pop':'COUNTRY',americana:'COUNTRY',bluegrass:'COUNTRY',
    jazz:'JAZZ','smooth jazz':'JAZZ','jazz fusion':'JAZZ','acid jazz':'JAZZ','cool jazz':'JAZZ','free jazz':'JAZZ',
    classical:'CLASSICA','clássica':'CLASSICA',classica:'CLASSICA',erudita:'CLASSICA',opera:'CLASSICA','ópera':'CLASSICA',orchestral:'CLASSICA','chamber music':'CLASSICA',
    indie:'INDIE','indie folk':'INDIE','indie electronic':'INDIE',
    reggae:'REGGAE','roots reggae':'REGGAE',dub:'REGGAE',dancehall:'REGGAE',
    brega:'FORRO',tecnobrega:'FORRO','brega funk':'FUNK',lambada:'FORRO',manguebeat:'MPB',maracatu:'MPB',
  };

  function normalizeGenreCJS(raw) {
    if (!raw || raw.trim().length === 0) return 'OUTRO';
    const lower = raw.toLowerCase().replace(/[()]/g, '').trim();
    // Numeric ID3v1
    const num = parseInt(lower);
    if (!isNaN(num) && lower === String(num)) {
      const numMap = {0:'MPB',1:'ROCK',2:'POP',3:'ELETRONICA',4:'ELETRONICA',5:'FUNK',6:'RAP/HIP-HOP',7:'R&B',8:'JAZZ',9:'METAL',10:'POP',11:'POP',13:'POP',14:'R&B',15:'RAP/HIP-HOP',16:'REGGAE',17:'ROCK',18:'ELETRONICA',20:'ROCK',32:'CLASSICA',37:'R&B',38:'ROCK',40:'ROCK',52:'ELETRONICA',80:'COUNTRY',86:'LATINA',100:'PAGODE',101:'MPB',129:'METAL',131:'INDIE',137:'METAL',138:'METAL',144:'METAL'};
      return numMap[num] || 'OUTRO';
    }
    // Direct match
    if (ID3_GENRE_TEXT_MAP[lower]) return ID3_GENRE_TEXT_MAP[lower];
    // Combined genres: "Samba/Pagode"
    const sep = /[;\\/|,&]/;
    if (sep.test(lower)) {
      const parts = lower.split(sep).map(p => p.trim()).filter(Boolean);
      for (const part of parts) {
        if (ID3_GENRE_TEXT_MAP[part]) return ID3_GENRE_TEXT_MAP[part];
      }
    }
    // Partial match
    for (const [key, value] of Object.entries(ID3_GENRE_TEXT_MAP)) {
      if (lower.includes(key) && key.length >= 3) return value;
    }
    return 'OUTRO';
  }

  // IPC: Reorganize existing files by ID3 genre (all configured genres + default folder)
  handle('reorganize-by-genre', async (event, { sourceFolder, genreRoutes, defaultFolder }) => {
    console.log(`[GENRE-REORG] 🔍 Scanning: ${sourceFolder}`);
    const results = { scanned: 0, moved: 0, skipped: 0, errors: 0, details: [] };
    try {
      if (!fs.existsSync(sourceFolder)) {
        return { success: false, error: `Pasta não encontrada: ${sourceFolder}` };
      }
      const files = fs.readdirSync(sourceFolder).filter(f => /\.(mp3|flac|wav|ogg|m4a|aac|wma)$/i.test(f));
      results.scanned = files.length;
      console.log(`[GENRE-REORG] Found ${files.length} audio files`);

      // Build normalized genre → folder map
      const genreToFolder = {};
      for (const route of (genreRoutes || [])) {
        if (route.genre && route.folderName) {
          genreToFolder[route.genre.toUpperCase()] = route.folderName;
        }
      }
      const fallbackFolder = defaultFolder || null;

      for (const file of files) {
        try {
          const filePath = path.join(sourceFolder, file);
          const tags = parseID3TagsFromFile(filePath);
          const rawGenre = tags.genre || '';

          if (!rawGenre.trim()) {
            // No genre tag — use default folder if configured
            if (fallbackFolder) {
              const targetFolder = path.join(sourceFolder, fallbackFolder);
              if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
              const targetPath = path.join(targetFolder, file);
              if (fs.existsSync(targetPath)) { results.skipped++; continue; }
              try { fs.renameSync(filePath, targetPath); } catch (e) { fs.copyFileSync(filePath, targetPath); fs.unlinkSync(filePath); }
              results.moved++;
              results.details.push({ file, genre: 'sem tag', folder: fallbackFolder });
              console.log(`[GENRE-REORG] ✅ ${file} → ${fallbackFolder}/ (sem tag)`);
            } else {
              results.skipped++;
            }
            continue;
          }

          // Normalize using full logic
          const normalized = normalizeGenreCJS(rawGenre);
          const matchedFolder = genreToFolder[normalized] || fallbackFolder;

          if (!matchedFolder) {
            results.skipped++;
            continue;
          }

          const targetFolder = path.join(sourceFolder, matchedFolder);
          if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
          const targetPath = path.join(targetFolder, file);
          if (fs.existsSync(targetPath)) { results.skipped++; continue; }
          try { fs.renameSync(filePath, targetPath); } catch (e) { fs.copyFileSync(filePath, targetPath); fs.unlinkSync(filePath); }
          results.moved++;
          results.details.push({ file, genre: `${rawGenre} → ${normalized}`, folder: matchedFolder });
          console.log(`[GENRE-REORG] ✅ ${file} → ${matchedFolder}/ (${rawGenre} → ${normalized})`);
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

  // IPC: Validate ID3 tags vs filename — quarantine mismatches
  handle('validate-id3-integrity', async (event, { folders, threshold }) => {
    const { calculateSimilarity } = require('./utils.cjs');
    const minSim = threshold || 0.40;
    const results = { scanned: 0, quarantined: 0, valid: 0, errors: 0, details: [] };
    console.log(`[ID3-VALIDATE] 🔍 Starting validation (threshold: ${(minSim * 100).toFixed(0)}%) on ${folders.length} folders`);

    for (const folder of folders) {
      if (!fs.existsSync(folder)) continue;

      // Scan recursively
      const walk = (dir) => {
        let files = [];
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (entry.name.startsWith('_') || entry.name === 'PkInfo') continue;
              files = files.concat(walk(full));
            } else if (/\.(mp3|flac)$/i.test(entry.name)) {
              files.push(full);
            }
          }
        } catch (e) {}
        return files;
      };

      const audioFiles = walk(folder);

      for (const filePath of audioFiles) {
        results.scanned++;
        try {
          const fileName = path.basename(filePath, path.extname(filePath));
          const parsed = parseArtistTitleFromFilename(fileName + path.extname(filePath));
          if (!parsed.artist || !parsed.title) { results.valid++; continue; }

          const tags = parseID3TagsFromFile(filePath);
          if (!tags.artist && !tags.title) { results.valid++; continue; }

          const id3Artist = tags.artist || '';
          const id3Title = tags.title || '';

          const artistSim = id3Artist ? calculateSimilarity(parsed.artist, id3Artist) : 1;
          const titleSim = id3Title ? calculateSimilarity(parsed.title, id3Title) : 1;

          // Both artist AND title must fail to be quarantined
          if (artistSim < minSim && titleSim < minSim) {
            // Move to quarantine
            const parentDir = path.dirname(filePath);
            const quarantineDir = path.join(parentDir, QUARANTINE_FOLDER_NAME);
            if (!fs.existsSync(quarantineDir)) fs.mkdirSync(quarantineDir, { recursive: true });

            const destPath = path.join(quarantineDir, path.basename(filePath));
            try { fs.renameSync(filePath, destPath); } catch (e) { fs.copyFileSync(filePath, destPath); fs.unlinkSync(filePath); }

            results.quarantined++;
            const detail = {
              file: path.basename(filePath),
              folder: path.relative(folders[0] || folder, parentDir) || '.',
              fileArtist: parsed.artist,
              fileTitle: parsed.title,
              id3Artist,
              id3Title,
              artistSim: Math.round(artistSim * 100),
              titleSim: Math.round(titleSim * 100),
            };
            results.details.push(detail);
            console.log(`[ID3-VALIDATE] ❌ QUARENTENA: "${parsed.artist} - ${parsed.title}" → ID3: "${id3Artist} - ${id3Title}" (art=${detail.artistSim}%, tit=${detail.titleSim}%)`);
          } else {
            results.valid++;
          }
        } catch (fileErr) {
          results.errors++;
        }
      }
    }
    console.log(`[ID3-VALIDATE] Done: ${results.scanned} scanned, ${results.quarantined} quarantined, ${results.valid} valid, ${results.errors} errors`);
    return { success: true, ...results };
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
  // IPC: Cleanup PkInfo folder inside content folder (only PkInfo, nothing else)
  handle('cleanup-content-folder', async (event, { folder }) => {
    console.log(`[FILE-OPS] 🗑️ Removendo PkInfo de: ${folder}`);
    try {
      const pkInfoPath = path.join(folder, 'PkInfo');
      if (!fs.existsSync(pkInfoPath)) {
        return { success: true, deletedCount: 0 };
      }

      fs.rmSync(pkInfoPath, { recursive: true, force: true });
      console.log(`[FILE-OPS] ✅ PkInfo removido: ${pkInfoPath}`);
      return { success: true, deletedCount: 1 };
    } catch (err) {
      console.error(`[FILE-OPS] ❌ Erro ao remover PkInfo: ${err.message}`);
      return { success: false, deletedCount: 0, error: err.message };
    }
  });

  // IPC: Delete files from past weekdays in content folder
  // E.g. if today is Thursday (QUINTA), delete files containing SEGUNDA, TERCA, QUARTA
  handle('cleanup-old-day-files', async (event, { folder, onlyKeepToday }) => {
    const DAY_NAMES = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];
    // Also match accented variants
    const DAY_VARIANTS = {
      'SABADO': ['SABADO', 'SÁBADO', 'SAB', 'SÁB'],
      'TERCA': ['TERCA', 'TERÇA', 'TER'],
      'QUARTA': ['QUARTA', 'QUA'],
      'QUINTA': ['QUINTA', 'QUI'],
      'SEXTA': ['SEXTA', 'SEX'],
      'SEGUNDA': ['SEGUNDA', 'SEG'],
      'DOMINGO': ['DOMINGO', 'DOM'],
    };

    const today = new Date().getDay(); // 0=Sun, 1=Mon...6=Sat
    const todayName = DAY_NAMES[today];

    // Build set of days to KEEP
    const keepDays = new Set();
    if (onlyKeepToday) {
      // Grade mode: keep ONLY today's file
      keepDays.add(todayName);
    } else {
      // Content folder mode: keep today + future days
      for (let i = today; i <= 6; i++) {
        keepDays.add(DAY_NAMES[i]);
      }
      if (today >= 1) {
        keepDays.add('DOMINGO');
      }
    }

    // Days to delete = all days NOT in keepDays
    const deleteDays = DAY_NAMES.filter(d => !keepDays.has(d));

    if (deleteDays.length === 0) {
      console.log(`[FILE-OPS] ✅ Nenhum dia passado para limpar (hoje: ${todayName})`);
      return { success: true, deletedCount: 0, deletedFiles: [], keptDays: [...keepDays] };
    }

    console.log(`[FILE-OPS] 🗓️ Hoje: ${todayName} — Apagar arquivos de: ${deleteDays.join(', ')} — Manter: ${[...keepDays].join(', ')}${onlyKeepToday ? ' (somente hoje)' : ''}`);

    try {
      if (!fs.existsSync(folder)) {
        return { success: false, deletedCount: 0, error: 'Pasta não encontrada' };
      }

      // Build patterns to match (all variants of days to delete)
      const deletePatterns = [];
      for (const day of deleteDays) {
        const variants = DAY_VARIANTS[day] || [day];
        for (const v of variants) {
          deletePatterns.push(v.toUpperCase());
          deletePatterns.push(v.toLowerCase());
          // Mixed case
          deletePatterns.push(v.charAt(0).toUpperCase() + v.slice(1).toLowerCase());
        }
      }

      const allFiles = fs.readdirSync(folder);
      const deletedFiles = [];

      for (const file of allFiles) {
        const filePath = path.join(folder, file);
        const stat = fs.statSync(filePath);
        
        // Skip directories (like PkInfo) — only delete files
        if (stat.isDirectory()) continue;

        // Check if filename contains any of the delete-day patterns
        const upperFile = file.toUpperCase();
        const shouldDelete = deletePatterns.some(pattern => upperFile.includes(pattern.toUpperCase()));

        if (shouldDelete) {
          try {
            fs.unlinkSync(filePath);
            deletedFiles.push(file);
            console.log(`[FILE-OPS] 🗑️ Arquivo removido: ${file}`);
          } catch (err) {
            console.error(`[FILE-OPS] ❌ Erro ao remover ${file}: ${err.message}`);
          }
        }
      }

      console.log(`[FILE-OPS] ✅ Limpeza de dias passados: ${deletedFiles.length} arquivo(s) removido(s)`);
      return { success: true, deletedCount: deletedFiles.length, deletedFiles, keptDays: [...keepDays] };
    } catch (err) {
      console.error(`[FILE-OPS] ❌ Erro na limpeza de dias passados: ${err.message}`);
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
