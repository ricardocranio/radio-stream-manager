// =============== RADIOAGÊNCIA NACIONAL - AUTO DOWNLOAD ===============
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

let _getMainWindow = null;
let _showNotification = null;

// Cache of downloaded URLs to avoid re-downloading
const downloadedUrlsCache = new Set();
const CACHE_FILE_NAME = 'radioagencia_downloaded.json';

function getCachePath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), CACHE_FILE_NAME);
  } catch (e) {
    return null;
  }
}

function loadCache() {
  try {
    const cachePath = getCachePath();
    if (cachePath && fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (Array.isArray(data)) {
        data.forEach(url => downloadedUrlsCache.add(url));
        console.log(`[RADIOAGENCIA] Cache loaded: ${downloadedUrlsCache.size} entries`);
      }
    }
  } catch (e) {
    console.log('[RADIOAGENCIA] No cache found, starting fresh');
  }
}

function saveCache() {
  try {
    const cachePath = getCachePath();
    if (cachePath) {
      // Keep only last 500 entries
      const entries = [...downloadedUrlsCache];
      const trimmed = entries.slice(Math.max(0, entries.length - 500));
      fs.writeFileSync(cachePath, JSON.stringify(trimmed), 'utf-8');
    }
  } catch (e) {
    console.error('[RADIOAGENCIA] Error saving cache:', e.message);
  }
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 20000,
    };

    protocol.get(url, options, (res) => {
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

function downloadFile(url, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      },
      timeout: 120000,
    };

    const request = protocol.get(url, options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, outputPath, onProgress).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;
      const fileStream = fs.createWriteStream(outputPath);

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize > 0 && onProgress) {
          onProgress(Math.round((downloadedSize / totalSize) * 100), downloadedSize, totalSize);
        }
      });
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve({ success: true, filePath: outputPath, fileSize: downloadedSize });
      });
      fileStream.on('error', (err) => { fs.unlink(outputPath, () => {}); reject(err); });
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Scrape the Radioagência page and extract audio entries.
 * Returns array of { title, url, editoria, duration }
 */
function scrapeRadioagencia(html) {
  const entries = [];

  // Pattern 1: Look for direct MP3 download links from audios.ebc.com.br
  const downloadLinkRegex = /href=\"(https?:\/\/audios\.ebc\.com\.br\/[^\"]+\.mp3[^\"]*)\"/gi;
  const allMp3Links = [];
  let match;
  while ((match = downloadLinkRegex.exec(html)) !== null) {
    let url = match[1];
    // Clean the URL: remove ?download&filename=... if present for deduplication
    const cleanUrl = url.split('?')[0];
    allMp3Links.push({ url, cleanUrl });
  }

  // Pattern 2: Parse structured entries with title + download link
  // The page has sections like: <a href="...audio-page-url">Title</a> ... <a href="...mp3?download">Baixar</a>
  const sectionRegex = /<a[^>]*class=\"[^\"]*capa-noticia[^\"]*\"[^>]*href=\"([^\"]*)\"[^>]*>[\s\S]*?<\/a>[\s\S]*?<a[^>]*href=\"(https?:\/\/audios\.ebc\.com\.br\/[^\"]+\.mp3[^\"]*)\"[^>]*>/gi;
  
  while ((match = sectionRegex.exec(html)) !== null) {
    const pageUrl = match[1];
    const mp3Url = match[2];
    const cleanUrl = mp3Url.split('?')[0];

    // Extract title from HTML near this match
    const titleMatch = html.substring(Math.max(0, match.index - 500), match.index + match[0].length + 500)
      .match(/<(?:strong|b|h[1-6])[^>]*>\s*([^<]{5,150})\s*<\/(?:strong|b|h[1-6])>/i);
    
    const title = titleMatch ? titleMatch[1].trim() : null;
    
    // Try to get editoria
    const editoriaMatch = html.substring(Math.max(0, match.index - 300), match.index)
      .match(/(?:Política|Economia|Saúde|Educação|Cultura|Esportes|Meio Ambiente|Geral|Ciência|Direitos Humanos|Internacional)/i);

    entries.push({
      title: title || `Radioagencia_${Date.now()}`,
      url: mp3Url,
      cleanUrl,
      editoria: editoriaMatch ? editoriaMatch[0] : 'Geral',
    });
  }

  // Fallback: if structured parsing failed, use raw MP3 links
  if (entries.length === 0 && allMp3Links.length > 0) {
    for (const link of allMp3Links) {
      // Try to extract a filename from the URL query param
      const filenameMatch = link.url.match(/filename=([^&]+)/);
      const filename = filenameMatch 
        ? decodeURIComponent(filenameMatch[1]).replace(/\.mp3$/i, '').replace(/[-_]/g, ' ')
        : `Radioagencia_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      entries.push({
        title: filename,
        url: link.url,
        cleanUrl: link.cleanUrl,
        editoria: 'Geral',
      });
    }
  }

  // Deduplicate by cleanUrl
  const seen = new Set();
  const unique = [];
  for (const entry of entries) {
    if (!seen.has(entry.cleanUrl)) {
      seen.add(entry.cleanUrl);
      unique.push(entry);
    }
  }

  return unique;
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 120);
}

function register({ getMainWindow, showNotification, safeHandle }) {
  _getMainWindow = getMainWindow;
  _showNotification = showNotification;
  const handle = safeHandle || ipcMain.handle.bind(ipcMain);

  // Load saved cache on registration
  loadCache();

  /**
   * Check for new audios on the Radioagência page
   * Returns: { success, entries: [{ title, url, editoria, isNew }] }
   */
  handle('radioagencia-check', async () => {
    try {
      console.log('[RADIOAGENCIA] Checking for new audios...');
      const html = await fetchHtml('https://agenciabrasil.ebc.com.br/radioagencia-nacional');
      const entries = scrapeRadioagencia(html);

      // Mark which ones are new
      const result = entries.map(e => ({
        ...e,
        isNew: !downloadedUrlsCache.has(e.cleanUrl),
      }));

      const newCount = result.filter(e => e.isNew).length;
      console.log(`[RADIOAGENCIA] Found ${entries.length} audios, ${newCount} new`);

      return { success: true, entries: result, totalFound: entries.length, newCount };
    } catch (error) {
      console.error('[RADIOAGENCIA] Check failed:', error.message);
      return { success: false, error: error.message, entries: [], totalFound: 0, newCount: 0 };
    }
  });

  /**
   * Download a specific audio from Radioagência
   * Params: { url, cleanUrl, title, outputFolder }
   */
  handle('radioagencia-download', async (event, params) => {
    const { url, cleanUrl, title, outputFolder } = params;

    try {
      if (!fs.existsSync(outputFolder)) {
        fs.mkdirSync(outputFolder, { recursive: true });
      }

      const safeTitle = sanitizeFilename(title);
      const filename = `${safeTitle}.mp3`;
      const outputPath = path.join(outputFolder, filename);

      // Skip if already exists on disk
      if (fs.existsSync(outputPath)) {
        console.log(`[RADIOAGENCIA] Already exists: ${filename}`);
        downloadedUrlsCache.add(cleanUrl);
        saveCache();
        return { success: true, skipped: true, filename };
      }

      console.log(`[RADIOAGENCIA] Downloading: ${filename}`);

      const mainWindow = _getMainWindow ? _getMainWindow() : null;
      const result = await downloadFile(url, outputPath, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('radioagencia-download-progress', { progress, filename });
        }
      });

      if (result.success) {
        // Validate minimum size (at least 50KB for a real audio)
        const stats = fs.statSync(outputPath);
        if (stats.size < 50 * 1024) {
          console.log(`[RADIOAGENCIA] File too small (${(stats.size / 1024).toFixed(0)}KB), deleting`);
          fs.unlinkSync(outputPath);
          return { success: false, error: 'Arquivo muito pequeno (provavelmente página de erro)' };
        }

        downloadedUrlsCache.add(cleanUrl);
        saveCache();
        console.log(`[RADIOAGENCIA] ✅ Downloaded: ${filename} (${(stats.size / 1024).toFixed(0)}KB)`);
        return { success: true, filename, fileSize: stats.size };
      }

      return { success: false, error: 'Download falhou' };
    } catch (error) {
      console.error(`[RADIOAGENCIA] Download error:`, error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Cleanup old Radioagência files
   * Params: { folder, maxAgeDays }
   */
  handle('radioagencia-cleanup', async (event, params) => {
    const { folder, maxAgeDays } = params;
    try {
      if (!fs.existsSync(folder)) return { success: true, deletedCount: 0 };
      const files = fs.readdirSync(folder);
      const now = Date.now();
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.mp3')) continue;
        const filePath = path.join(folder, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch (e) {}
      }

      console.log(`[RADIOAGENCIA] Cleanup: removed ${deletedCount} old file(s)`);
      return { success: true, deletedCount };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
