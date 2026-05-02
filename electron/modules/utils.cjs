// =============== SHARED UTILITY FUNCTIONS ===============
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Get unique machine ID (persisted in userData)
function getMachineId(app) {
  const idPath = path.join(app.getPath('userData'), 'machine_id.txt');
  if (fs.existsSync(idPath)) {
    return fs.readFileSync(idPath, 'utf8').trim();
  }
  const newId = crypto.randomUUID();
  fs.writeFileSync(idPath, newId, 'utf8');
  return newId;
}

// Sanitize folder name for filesystem
function sanitizeFolderName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

// Normalize raw metadata text from API/ID3 before sanitizing for disk
function normalizeMetadataText(text, field = 'generic') {
  if (!text) return '';

  let result = String(text)
    .replace(/\uFEFF/g, '')
    .replace(/\0+/g, field === 'artist' ? ' feat ' : ' ')
    .trim();

  if (field === 'artist') {
    // Turn multi-artist separators into something readable, but avoid breaking short names like AC/DC
    result = result
      .replace(
        /([A-Za-zÀ-ÿ0-9&'.-]{3,}(?:\s+[A-Za-zÀ-ÿ0-9&'.-]{2,})*)\s*\/\s*([A-Za-zÀ-ÿ0-9&'.-]{3,}(?:\s+[A-Za-zÀ-ÿ0-9&'.-]{2,})*)/g,
        '$1 feat $2'
      )
      .replace(/\s*(?:feat\.?|ft\.?)\s*/gi, ' feat ')
      .replace(/\s*[;|]+\s*/g, ' feat ');
  } else {
    result = result.replace(/\s*[|]+\s*/g, ' ');
  }

  return result.replace(/\s+/g, ' ').trim();
}

function sanitizeForDisk(text, field = 'generic') {
  const normalized = normalizeMetadataText(text, field);
  if (!normalized) return '';

  return normalized
    .replace(/&/g, 'e')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalize text for file matching (remove accents, special chars, etc.)
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strip ALL parenthetical and bracketed content
function stripParenthetical(text) {
  return text
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Get a "clean" normalized version: strip parentheticals first, then normalize
function cleanNormalize(text) {
  return normalizeText(stripParenthetical(text));
}

// Calculate similarity between two strings (Levenshtein-based)
function calculateSimilarity(str1, str2) {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  const matrix = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - matrix[s1.length][s2.length] / maxLen;
}

// Parse ID3v2 tags from an MP3 file (artist, title, genre)
function parseID3TagsFromFile(filePath) {
  try {
    const buf = Buffer.alloc(4096);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) { // "ID3"
      let offset = 10;
      const id3Size = ((buf[6] & 0x7F) << 21) | ((buf[7] & 0x7F) << 14) | ((buf[8] & 0x7F) << 7) | (buf[9] & 0x7F);
      const headerSize = Math.min(id3Size + 10, 4096);
      const result = {};
      while (offset < headerSize - 10) {
        const frameId = buf.slice(offset, offset + 4).toString('ascii');
        if (frameId === '\x00\x00\x00\x00') break;
        const frameSize = (buf[offset+4] << 24) | (buf[offset+5] << 16) | (buf[offset+6] << 8) | buf[offset+7];
        if (frameSize <= 0 || frameSize > headerSize) break;
        const frameData = buf.slice(offset + 10, offset + 10 + frameSize);
        
        if (frameId === 'TPE1' || frameId === 'TIT2' || frameId === 'TCON' || frameId === 'TBPM' || frameId === 'TDRC' || frameId === 'TYER') {
          const encoding = frameData[0];
          let text = '';
          if (encoding === 0) {
            text = frameData.slice(1).toString('latin1').replace(/\0/g, ' ');
          } else if (encoding === 1) {
            // UTF-16 with BOM — detect byte order
            const bom1 = frameData[1], bom2 = frameData[2];
            if (bom1 === 0xFE && bom2 === 0xFF) {
              // Big-endian: swap bytes
              const beData = frameData.slice(3);
              const swapped = Buffer.alloc(beData.length);
              for (let b = 0; b < beData.length - 1; b += 2) {
                swapped[b] = beData[b + 1];
                swapped[b + 1] = beData[b];
              }
              text = swapped.toString('utf16le').replace(/\0/g, ' ');
            } else {
              const startOffset = (bom1 === 0xFF && bom2 === 0xFE) ? 3 : 1;
              text = frameData.slice(startOffset).toString('utf16le').replace(/\0/g, ' ');
            }
          } else if (encoding === 2) {
            // UTF-16BE without BOM
            const beData = frameData.slice(1);
            const swapped = Buffer.alloc(beData.length);
            for (let b = 0; b < beData.length - 1; b += 2) {
              swapped[b] = beData[b + 1];
              swapped[b + 1] = beData[b];
            }
            text = swapped.toString('utf16le').replace(/\0/g, ' ');
          } else if (encoding === 3) {
            text = frameData.slice(1).toString('utf8').replace(/\0/g, ' ');
          }

          const normalizedText = normalizeMetadataText(
            text.trim(),
            frameId === 'TPE1' ? 'artist' : frameId === 'TIT2' ? 'title' : 'generic'
          );

          if (frameId === 'TPE1') result.artist = normalizedText;
          if (frameId === 'TIT2') result.title = normalizedText;
          if (frameId === 'TCON') result.genre = normalizedText;
          if (frameId === 'TBPM') result.bpm = normalizedText;
          if (frameId === 'TDRC' || frameId === 'TYER') {
            const yearMatch = normalizedText.match(/^(\d{4})/);
            if (yearMatch) result.year = yearMatch[1];
          }
        }
        offset += 10 + frameSize;
      }
      return result;
    }
    return {};
  } catch (e) {
    return {};
  }
}

// Check if a file exists in any subfolder (for anti-duplicate logic)
function checkFileExistsInSubfolders(baseFolder, searchPattern) {
  try {
    if (!fs.existsSync(baseFolder)) return { exists: false };
    
    const items = fs.readdirSync(baseFolder, { withFileTypes: true });
    const searchLower = searchPattern.toLowerCase();
    
    for (const item of items) {
      if (item.isFile()) {
        const fileName = path.basename(item.name, path.extname(item.name)).toLowerCase();
        if (fileName.includes(searchLower) || searchLower.includes(fileName)) {
          return { exists: true, path: path.join(baseFolder, item.name) };
        }
      }
    }
    
    for (const item of items) {
      if (item.isDirectory()) {
        const subfolderPath = path.join(baseFolder, item.name);
        const subFiles = fs.readdirSync(subfolderPath);
        for (const file of subFiles) {
          const fileName = path.basename(file, path.extname(file)).toLowerCase();
          if (fileName.includes(searchLower) || searchLower.includes(fileName)) {
            return { exists: true, path: path.join(subfolderPath, file), station: item.name };
          }
        }
      }
    }
    
    return { exists: false };
  } catch (error) {
    console.error('[FOLDER] Error checking subfolders:', error.message);
    return { exists: false };
  }
}

// Cleanup partial/incomplete files after a timeout kill
function cleanupPartialFiles(folder, filesBefore) {
  try {
    const filesAfter = fs.readdirSync(folder);
    const newFiles = filesAfter.filter(f => !filesBefore.has(f));
    for (const file of newFiles) {
      const filePath = path.join(folder, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < 500 * 1024) {
          fs.unlinkSync(filePath);
          console.log(`[DEEMIX] 🗑️ Cleaned up partial file: ${file} (${Math.round(stat.size / 1024)} KB)`);
        }
      } catch (e) {
        console.warn(`[DEEMIX] Could not check/delete: ${file}`, e.message);
      }
    }
  } catch (e) {
    console.warn('[DEEMIX] Cleanup error:', e.message);
  }
}

module.exports = {
  sanitizeFolderName,
  normalizeMetadataText,
  sanitizeForDisk,
  normalizeText,
  stripParenthetical,
  cleanNormalize,
  calculateSimilarity,
  parseID3TagsFromFile,
  checkFileExistsInSubfolders,
  cleanupPartialFiles,
};
