// =============== MUSIC LIBRARY CHECK + DURATION + BPM ===============
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { normalizeText, cleanNormalize, calculateSimilarity, parseID3TagsFromFile } = require('./utils.cjs');

// Cache for music library files (reset every 5 minutes)
let musicLibraryCache = { files: [], timestamp: 0 };
const CACHE_DURATION = 5 * 60 * 1000;

const durationCache = new Map();
const MAX_DURATION_CACHE = 10000; // Prevent unbounded growth

function scanMusicLibrary(musicFolders) {
  const now = Date.now();
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
              baseName,
              normalized: normalizeText(baseName),
              cleanNormalized: cleanNormalize(baseName),
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
// Match strategy counters for diagnostics
const matchStats = { prefix: 0, includes: 0, word: 0, levenshtein: 0, miss: 0, total: 0, lastReport: Date.now() };

function reportMatchStats() {
  const now = Date.now();
  // Report every 30 seconds if there were searches
  if (matchStats.total > 0 && (now - matchStats.lastReport) > 30000) {
    const { prefix, includes, word, levenshtein, miss, total } = matchStats;
    console.log(`[LIBRARY] 📊 Match stats (${total} buscas): Prefix=${prefix} | Includes=${includes} | Word=${word} | Levenshtein=${levenshtein} | Miss=${miss}`);
    matchStats.lastReport = now;
  }
}

function findBestMatch(artist, title, musicFolders, threshold) {
  const files = scanMusicLibrary(musicFolders);
  const normalizedArtist = normalizeText(artist);
  const normalizedTitle = normalizeText(title);
  const searchQuery = normalizeText(`${artist} ${title}`);
  const cleanArtist = cleanNormalize(artist);
  const cleanTitle = cleanNormalize(title);
  const cleanQuery = cleanNormalize(`${artist} ${title}`);
  
  // Build prefix pattern: "artist - title" normalized for prefix matching
  const prefixPattern = normalizeText(`${artist} - ${title}`);
  const cleanPrefixPattern = cleanNormalize(`${artist} - ${title}`);
  
  let bestMatch = null;
  let bestScore = 0;
  const THRESHOLD = threshold || 0.75;
  const ARTIST_MIN_SIMILARITY = Math.max(0.4, THRESHOLD - 0.2);
  
  // Pre-compute significant words for word-level matching (words > 2 chars)
  const titleWords = normalizedTitle.split(' ').filter(w => w.length > 2);
  const artistWords = normalizedArtist.split(' ').filter(w => w.length > 2);
  const allSignificantWords = [...artistWords, ...titleWords];
  
  matchStats.total++;
  
  for (const file of files) {
    // Strategy 0 (HIGHEST PRIORITY): Prefix match
    if (
      file.normalized.startsWith(prefixPattern) ||
      file.cleanNormalized.startsWith(cleanPrefixPattern)
    ) {
      matchStats.prefix++;
      reportMatchStats();
      console.log(`[LIBRARY] ✅ Prefix-match: "${artist} - ${title}" → ${file.name}`);
      return { exists: true, path: file.path, filename: file.name, baseName: file.baseName, similarity: 1.0, strategy: 'prefix' };
    }
    
    // Strategy 1: Direct includes (exact substring match)
    if (
      (file.normalized.includes(normalizedArtist) && file.normalized.includes(normalizedTitle)) ||
      (file.cleanNormalized.includes(cleanArtist) && file.cleanNormalized.includes(cleanTitle))
    ) {
      matchStats.includes++;
      reportMatchStats();
      return { exists: true, path: file.path, filename: file.name, baseName: file.baseName, similarity: 1.0, strategy: 'includes' };
    }
    
    // Strategy 1.5: Word-level matching
    if (allSignificantWords.length >= 3) {
      const matchedWords = allSignificantWords.filter(w => file.normalized.includes(w));
      if (matchedWords.length === allSignificantWords.length) {
        matchStats.word++;
        reportMatchStats();
        console.log(`[LIBRARY] ✅ Word-match: "${artist} - ${title}" → ${file.name}`);
        return { exists: true, path: file.path, filename: file.name, baseName: file.baseName, similarity: 0.95, strategy: 'word' };
      }
    }
    
    const artistScore = Math.max(
      calculateSimilarity(normalizedArtist, file.normalized),
      calculateSimilarity(cleanArtist, file.cleanNormalized)
    );
    if (artistScore < ARTIST_MIN_SIMILARITY) continue;
    
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
    matchStats.levenshtein++;
    reportMatchStats();
    return { exists: true, path: bestMatch.path, filename: bestMatch.name, baseName: bestMatch.baseName, similarity: bestScore, strategy: 'levenshtein' };
  }
  
  matchStats.miss++;
  reportMatchStats();
  console.log(`[LIBRARY] ❌ No match: "${artist} - ${title}" | prefix: "${prefixPattern}" | ${files.length} files | threshold: ${THRESHOLD}`);
  return { exists: false };
}

async function checkSongInLibrary(artist, title, musicFolders) {
  const normalizedArtist = normalizeText(artist);
  const normalizedTitle = normalizeText(title);
  
  for (const folder of musicFolders) {
    try {
      if (!fs.existsSync(folder)) continue;
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
              if (fileName.includes(normalizedArtist) && fileName.includes(normalizedTitle)) {
                return { exists: true, path: fullPath, filename: entry.name };
              }
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

// =============== MP3 DURATION READER ===============
function getMP3Duration(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(16384);
    fs.readSync(fd, headerBuf, 0, 16384, 0);
    fs.closeSync(fd);
    
    let offset = 0;
    if (headerBuf[0] === 0x49 && headerBuf[1] === 0x44 && headerBuf[2] === 0x33) {
      const size = (headerBuf[6] << 21) | (headerBuf[7] << 14) | (headerBuf[8] << 7) | headerBuf[9];
      offset = 10 + size;
    }
    
    let searchBuf = headerBuf;
    if (offset > 0 && offset < fileSize) {
      const fd2 = fs.openSync(filePath, 'r');
      searchBuf = Buffer.alloc(Math.min(4096, fileSize - offset));
      fs.readSync(fd2, searchBuf, 0, searchBuf.length, offset);
      fs.closeSync(fd2);
    }
    const searchStart = offset > 0 ? 0 : offset;
    
    for (let i = searchStart; i < searchBuf.length - 4; i++) {
      if (searchBuf[i] === 0xFF && (searchBuf[i + 1] & 0xE0) === 0xE0) {
        const b1 = searchBuf[i + 1];
        const b2 = searchBuf[i + 2];
        const versionBits = (b1 >> 3) & 0x03;
        const layerBits = (b1 >> 1) & 0x03;
        const bitrateIndex = (b2 >> 4) & 0x0F;
        const sampleRateIndex = (b2 >> 2) & 0x03;
        
        if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) continue;
        if (layerBits === 0 || versionBits === 1) continue;
        
        const bitrateTables = {
          '3_1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
          '3_3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
          '3_2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
          '2_1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
          '2_3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
          '2_2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
        };
        const sampleRates = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
        
        const version = versionBits === 3 ? 3 : 2;
        const layer = layerBits;
        const tableKey = `${version}_${layer}`;
        const bitrateTable = bitrateTables[tableKey] || bitrateTables['3_3'];
        const bitrate = bitrateTable[bitrateIndex];
        const sampleRateArr = sampleRates[versionBits] || sampleRates[3];
        const sampleRate = sampleRateArr[sampleRateIndex];
        
        if (bitrate > 0 && sampleRate > 0) {
          const audioSize = fileSize - (offset > 0 ? offset : i);
          const durationSec = (audioSize * 8) / (bitrate * 1000);
          if (durationSec > 0 && durationSec < 3600) return Math.round(durationSec);
        }
        break;
      }
    }
    
    const estimatedDuration = (fileSize * 8) / (192 * 1000);
    if (estimatedDuration > 0 && estimatedDuration < 3600) return Math.round(estimatedDuration);
    return 0;
  } catch (error) {
    console.error(`[DURATION] Error reading ${filePath}:`, error.message);
    return 0;
  }
}

function getFileDuration(filename, musicFolders) {
  const cacheKey = filename.toLowerCase().replace(/^"|"$/g, '');
  if (durationCache.has(cacheKey)) return durationCache.get(cacheKey);
  
  const cleanName = filename.replace(/^"|"$/g, '');
  
  for (const folder of musicFolders) {
    const findFile = (dir) => {
      try {
        if (!fs.existsSync(dir)) return null;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const result = findFile(fullPath);
            if (result) return result;
          } else if (entry.name.toLowerCase() === cleanName.toLowerCase()) {
            return fullPath;
          }
        }
        return null;
      } catch (e) { return null; }
    };
    
    const filePath = findFile(folder);
    if (filePath) {
      const ext = path.extname(filePath).toLowerCase();
      let duration = 0;
      if (ext === '.mp3') {
        duration = getMP3Duration(filePath);
      } else {
        try {
          const stat = fs.statSync(filePath);
          duration = Math.round((stat.size * 8) / (192 * 1000));
        } catch (e) {}
      }
      if (duration > 0) {
        if (durationCache.size > MAX_DURATION_CACHE) {
          const firstKey = durationCache.keys().next().value;
          durationCache.delete(firstKey);
        }
        durationCache.set(cacheKey, duration);
        return duration;
      }
    }
  }
  return 0;
}

function register({ safeHandle }) {
  const handle = safeHandle || ipcMain.handle.bind(ipcMain);
  handle('check-song-exists', async (event, params) => {
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

  handle('find-song-match', async (event, params) => {
    const { artist, title, musicFolders, threshold } = params;
    try {
      console.log(`[LIBRARY] Finding best match for: ${artist} - ${title} (threshold: ${Math.round((threshold || 0.75) * 100)}%)`);
      const result = findBestMatch(artist, title, musicFolders, threshold);
      console.log(`[LIBRARY] Best match: ${result.exists ? result.filename + ' (' + (result.similarity * 100).toFixed(0) + '%)' : 'NOT FOUND'}`);
      return result;
    } catch (error) {
      console.error('Error finding match:', error);
      return { exists: false };
    }
  });

  handle('get-music-library-stats', async (event, params) => {
    const { musicFolders } = params;
    try {
      const files = scanMusicLibrary(musicFolders);
      return { success: true, count: files.length, folders: musicFolders.length };
    } catch (error) {
      console.error('Error getting library stats:', error);
      return { success: false, count: 0, folders: 0 };
    }
  });

  handle('get-file-duration', async (event, { filename, musicFolders }) => {
    try {
      const duration = getFileDuration(filename, musicFolders);
      return { success: true, duration };
    } catch (error) {
      return { success: false, duration: 0, error: error.message };
    }
  });

  handle('get-file-durations-batch', async (event, { filenames, musicFolders }) => {
    try {
      const results = {};
      for (const filename of filenames) {
        results[filename] = getFileDuration(filename, musicFolders);
      }
      return { success: true, durations: results };
    } catch (error) {
      return { success: false, durations: {}, error: error.message };
    }
  });

  // =============== BPM SCANNER ===============
  handle('scan-bpm-tags', async (event, { musicFolders }) => {
    console.log('[BPM] Scanning BPM tags from music library...');
    const results = {};
    let scanned = 0;
    
    const scanDir = (dir) => {
      try {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (/\.mp3$/i.test(entry.name)) {
            scanned++;
            const tags = parseID3TagsFromFile(fullPath);
            if (tags.bpm) {
              const bpmNum = parseInt(tags.bpm, 10);
              if (bpmNum > 0 && bpmNum < 300) {
                results[entry.name] = bpmNum;
              }
            }
          }
        }
      } catch (e) {
        console.error(`[BPM] Error scanning ${dir}:`, e.message);
      }
    };
    
    for (const folder of (musicFolders || [])) {
      scanDir(folder);
    }
    
    console.log(`[BPM] Done: scanned ${scanned} files, found ${Object.keys(results).length} with BPM tags`);
    return { success: true, bpmData: results, scanned, found: Object.keys(results).length };
  });

  // =============== FULL METADATA SCANNER (Artist, Title, BPM, Genre) ===============
  handle('scan-library-metadata', async (event, { musicFolders }) => {
    console.log('[META] Scanning full metadata from music library...');
    const songs = [];
    let scanned = 0;
    
    const scanDir = (dir) => {
      try {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (/\.mp3$/i.test(entry.name)) {
            scanned++;
            try {
              const tags = parseID3TagsFromFile(fullPath);
              const baseName = path.basename(entry.name, '.mp3');
              let artist = tags.artist || '';
              let title = tags.title || '';
              if (!artist && !title && baseName.includes(' - ')) {
                const parts = baseName.split(' - ');
                artist = parts[0].trim();
                title = parts.slice(1).join(' - ').trim();
              } else if (!artist && !title) {
                title = baseName;
              }
              songs.push({
                filename: entry.name,
                artist: artist || 'Desconhecido',
                title: title || baseName,
                bpm: tags.bpm ? parseInt(tags.bpm, 10) || null : null,
                genre: tags.genre || null,
                folder: dir,
              });
            } catch (e) {
              songs.push({
                filename: entry.name,
                artist: 'Desconhecido',
                title: path.basename(entry.name, '.mp3'),
                bpm: null,
                genre: null,
                folder: dir,
              });
            }
          }
        }
      } catch (e) {
        console.error(`[META] Error scanning ${dir}:`, e.message);
      }
    };
    
    for (const folder of (musicFolders || [])) {
      scanDir(folder);
    }
    
    // Build genre summary
    const genreCounts = {};
    for (const song of songs) {
      const genre = song.genre || 'Sem gênero';
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    }
    const genreSummary = Object.entries(genreCounts)
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count);
    
    console.log(`[META] Done: ${scanned} scanned, ${songs.length} indexed, ${genreSummary.length} genres found`);
    return { success: true, songs, scanned, genreSummary };
  });

  handle('save-bpm-cache', async (event, { cachePath, data }) => {
    try {
      const dir = path.dirname(cachePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`[BPM] Cache saved to: ${cachePath}`);
      return { success: true };
    } catch (error) {
      console.error('[BPM] Save cache error:', error.message);
      return { success: false, error: error.message };
    }
  });

  handle('load-bpm-cache', async (event, { cachePath }) => {
    try {
      if (!fs.existsSync(cachePath)) {
        return { success: true, data: null };
      }
      const content = fs.readFileSync(cachePath, 'utf-8');
      const data = JSON.parse(content);
      console.log(`[BPM] Cache loaded from: ${cachePath}`);
      return { success: true, data };
    } catch (error) {
      console.error('[BPM] Load cache error:', error.message);
      return { success: false, error: error.message };
    }
  });

  // =============== DUPLICATE SCANNER ===============
  handle('scan-duplicates', async (event, { musicFolders, threshold }) => {
    console.log('[DUPLICATES] Scanning for duplicate songs...');
    const files = scanMusicLibrary(musicFolders);
    const THRESH = threshold || 0.85;
    const duplicates = [];
    const processed = new Set();

    for (let i = 0; i < files.length; i++) {
      if (processed.has(i)) continue;
      
      // Extract artist-title from filename pattern "Artist - Title (extras).mp3"
      const parts = files[i].baseName.split(' - ');
      if (parts.length < 2) continue;
      
      const baseArtist = normalizeText(parts[0]);
      const baseTitle = cleanNormalize(parts.slice(1).join(' - '));
      
      const group = [files[i]];
      
      for (let j = i + 1; j < files.length; j++) {
        if (processed.has(j)) continue;
        
        const partsJ = files[j].baseName.split(' - ');
        if (partsJ.length < 2) continue;
        
        const artistJ = normalizeText(partsJ[0]);
        const titleJ = cleanNormalize(partsJ.slice(1).join(' - '));
        
        // Artist must be very similar
        const artistSim = calculateSimilarity(baseArtist, artistJ);
        if (artistSim < 0.8) continue;
        
        // Title (without parentheticals) must match above threshold
        const titleSim = calculateSimilarity(baseTitle, titleJ);
        if (titleSim >= THRESH) {
          group.push(files[j]);
          processed.add(j);
        }
      }
      
      if (group.length > 1) {
        // Get file sizes
        const groupWithSize = group.map(f => {
          try {
            const stat = fs.statSync(f.path);
            return { ...f, size: stat.size };
          } catch {
            return { ...f, size: 0 };
          }
        });
        
        // Sort by size descending - largest first (best quality)
        groupWithSize.sort((a, b) => b.size - a.size);
        
        duplicates.push({
          keep: { name: groupWithSize[0].name, path: groupWithSize[0].path, size: groupWithSize[0].size },
          remove: groupWithSize.slice(1).map(f => ({ name: f.name, path: f.path, size: f.size })),
        });
      }
      processed.add(i);
    }
    
    console.log(`[DUPLICATES] Found ${duplicates.length} duplicate groups from ${files.length} files`);
    return { success: true, duplicates, totalFiles: files.length };
  });

  handle('delete-duplicates', async (event, { filePaths }) => {
    console.log(`[DUPLICATES] Deleting ${filePaths.length} duplicate files...`);
    let deleted = 0;
    const errors = [];
    
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch (error) {
        errors.push({ path: filePath, error: error.message });
      }
    }
    
    // Invalidate library cache after deletion
    musicLibraryCache = { files: [], timestamp: 0 };
    
    console.log(`[DUPLICATES] Deleted ${deleted}/${filePaths.length} files (${errors.length} errors)`);
    return { success: true, deleted, errors };
  });
}

module.exports = { register };
