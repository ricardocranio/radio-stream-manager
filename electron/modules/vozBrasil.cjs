// =============== VOZ DO BRASIL DOWNLOAD ===============
const { ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

let _getMainWindow = null;
let _showNotification = null;

function downloadFile(url, outputFolder, filename, onProgress, deleteExisting = false) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputFolder)) {
      try { fs.mkdirSync(outputFolder, { recursive: true }); }
      catch (err) { reject(new Error(`Não foi possível criar a pasta: ${err.message}`)); return; }
    }

    const filePath = path.join(outputFolder, filename);
    
    if (deleteExisting || filename.startsWith('VozDoBrasil')) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[VOZ] Deleted existing file: ${filePath}`);
        }
        if (filename.startsWith('VozDoBrasil')) {
          const files = fs.readdirSync(outputFolder);
          const today = new Date();
          const day = today.getDate().toString().padStart(2, '0');
          const month = (today.getMonth() + 1).toString().padStart(2, '0');
          const year = today.getFullYear();
          const todayPatterns = [
            `VozDoBrasil_${day}-${month}-${year}`,
            `voz_${day}${month}${year}`,
            `vozbrasil_${day}${month}${year}`,
          ];
          for (const file of files) {
            const lowerFile = file.toLowerCase();
            for (const pattern of todayPatterns) {
              if (lowerFile.includes(pattern.toLowerCase())) {
                const oldFilePath = path.join(outputFolder, file);
                if (oldFilePath !== filePath) {
                  try { fs.unlinkSync(oldFilePath); } catch (e) {}
                }
              }
            }
          }
        }
      } catch (err) {
        console.log(`[VOZ] Warning during cleanup: ${err.message}`);
      }
    }
    
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*' },
      timeout: 60000,
    };

    const request = protocol.get(url, options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, outputFolder, filename, onProgress, false).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;
      const fileStream = fs.createWriteStream(filePath);
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize > 0 && onProgress) {
          onProgress(Math.round((downloadedSize / totalSize) * 100), downloadedSize, totalSize);
        }
      });
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        const MIN_VOZ_SIZE = 40 * 1024 * 1024;
        if (filename.startsWith('VozDoBrasil') && downloadedSize < MIN_VOZ_SIZE) {
          try { fs.unlinkSync(filePath); } catch (e) {}
          resolve({ success: false, error: `Arquivo inválido: ${(downloadedSize / 1024 / 1024).toFixed(1)}MB (mínimo 40MB)` });
          return;
        }
        resolve({ success: true, filePath, fileSize: downloadedSize });
      });
      fileStream.on('error', (err) => { fs.unlink(filePath, () => {}); reject(err); });
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Timeout: download demorou demais')); });
  });
}

function scrapeVozDownloadUrl() {
  return new Promise((resolve) => {
    const pageUrl = 'https://radiogov.ebc.com.br/programas/a-voz-do-brasil-download';
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
      timeout: 15000,
    };
    
    https.get(pageUrl, options, (response) => {
      if (response.statusCode !== 200) { resolve(null); return; }
      let html = '';
      response.on('data', (chunk) => { html += chunk; });
      response.on('end', () => {
        try {
          const matches = [];
          const regex1 = /href="((?:https?:\/\/radiogov\.ebc\.com\.br)?\/programas\/a-voz-do-brasil-download\/[\d]+-[\d]+-[\d]+(?:-\d+)?\/@@download\/file)"/gi;
          let match;
          while ((match = regex1.exec(html)) !== null) {
            const url = match[1].startsWith('http') ? match[1] : `https://radiogov.ebc.com.br${match[1]}`;
            matches.push(url);
          }
          const regex2 = /href="(https?:\/\/audios\.ebc\.com\.br\/radiogov\/[\d]+\/[\d]+\/[\d-]+-a-voz-do-brasil\.mp3)"/gi;
          while ((match = regex2.exec(html)) !== null) { matches.push(match[1]); }
          
          resolve(matches.length > 0 ? matches[0] : null);
        } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null)).on('timeout', () => resolve(null));
  });
}

function register({ getMainWindow, showNotification, safeHandle }) {
  _getMainWindow = getMainWindow;
  _showNotification = showNotification;
  const handle = safeHandle || ipcMain.handle.bind(ipcMain);

  handle('scrape-voz-download-url', async () => {
    try {
      const url = await scrapeVozDownloadUrl();
      return { success: true, url };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('download-voz-brasil', async (event, params) => {
    const { url, outputFolder, filename, tempFolder } = params;
    const tempDir = tempFolder || path.join(outputFolder, '_temp');
    const tempFilename = `voz_download_${Date.now()}.mp3`;
    
    try {
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
      
      const mainWindow = _getMainWindow();
      const result = await downloadFile(url, tempDir, tempFilename, (progress, downloaded, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('voz-download-progress', { progress, downloaded, total });
        }
      });
      
      if (!result.success) {
        // Clean temp file on failure
        try {
          const failedTemp = path.join(tempDir, tempFilename);
          if (fs.existsSync(failedTemp)) fs.unlinkSync(failedTemp);
        } catch (e) {}
        return result;
      }
      
      const tempFilePath = path.join(tempDir, tempFilename);
      const finalFilePath = path.join(outputFolder, filename);
      
      if (fs.existsSync(tempFilePath)) {
        const stats = fs.statSync(tempFilePath);
        const MIN_VOZ_SIZE = 25 * 1024 * 1024; // 25MB minimum
        
        // Reject and clean temp if file is too small (error page or incomplete)
        if (stats.size < MIN_VOZ_SIZE) {
          console.log(`[VOZ] File too small: ${(stats.size / 1024 / 1024).toFixed(1)}MB < 25MB, deleting temp`);
          try { fs.unlinkSync(tempFilePath); } catch (e) {}
          return { success: false, error: `Arquivo muito pequeno: ${(stats.size / 1024 / 1024).toFixed(1)}MB (mínimo 25MB)`, fileSize: stats.size };
        }
        
        if (fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath);
        
        try {
          fs.renameSync(tempFilePath, finalFilePath);
        } catch (renameErr) {
          fs.copyFileSync(tempFilePath, finalFilePath);
          fs.unlinkSync(tempFilePath);
        }
        
        // Clean empty _temp folder
        try {
          const remaining = fs.readdirSync(tempDir);
          if (remaining.length === 0) fs.rmdirSync(tempDir);
        } catch (e) {}
        
        _showNotification('📻 A Voz do Brasil', `Download concluído: ${filename}`, () => { shell.openPath(outputFolder); });
        return { success: true, fileSize: stats.size };
      }
      
      return { success: false, error: 'Arquivo temporário não encontrado após download' };
    } catch (error) {
      try {
        const tempFilePath = path.join(tempDir, tempFilename);
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch (e) {}
      return { success: false, error: error.message || 'Erro ao baixar arquivo' };
    }
  });

  handle('cleanup-voz-brasil', async (event, params) => {
    const { folder, maxAgeDays } = params;
    try {
      if (!fs.existsSync(folder)) return { success: true, deletedCount: 0 };
      const files = fs.readdirSync(folder);
      const now = Date.now();
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      let deletedCount = 0;
      for (const file of files) {
        const filePath = path.join(folder, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }
      return { success: true, deletedCount };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  handle('recover-temp-files', async (event, params) => {
    const { baseFolder } = params;
    let recovered = 0;
    try {
      if (!fs.existsSync(baseFolder)) return { success: true, recovered: 0 };
      const tempFolder = path.join(baseFolder, '_temp');
      if (fs.existsSync(tempFolder)) {
        const tempFiles = fs.readdirSync(tempFolder).filter(f => /\.(mp3|flac)$/i.test(f));
        for (const file of tempFiles) {
          const tempPath = path.join(tempFolder, file);
          const finalPath = path.join(baseFolder, file);
          try {
            const stat = fs.statSync(tempPath);
            if (stat.size > 500 * 1024) {
              if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
              fs.renameSync(tempPath, finalPath);
              recovered++;
            } else {
              fs.unlinkSync(tempPath);
            }
          } catch (e) {}
        }
        try {
          const remaining = fs.readdirSync(tempFolder);
          if (remaining.length === 0) fs.rmdirSync(tempFolder);
        } catch (e) {}
      }
      return { success: true, recovered };
    } catch (error) {
      return { success: false, error: error.message, recovered };
    }
  });
}

module.exports = { register };
