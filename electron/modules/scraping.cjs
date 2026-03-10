// =============== RADIO SCRAPING ===============
const { ipcMain } = require('electron');
const https = require('https');
const http = require('http');

let scrapedSongsCache = new Map();
const MAX_CACHE_SIZE = 5000; // Prevent unbounded growth in 24/7 operation

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 15000,
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

function parseOnlineRadioBox(html, stationName) {
  const songs = [];
  const trackRegex = /<a[^>]*class="[^"]*track_history[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
  const matches = html.match(trackRegex) || [];
  
  for (const match of matches.slice(0, 20)) {
    const artistMatch = match.match(/<span[^>]*class="[^"]*artist[^"]*"[^>]*>([^<]+)<\/span>/i);
    const titleMatch = match.match(/<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/span>/i);
    
    if (artistMatch && titleMatch) {
      const artist = artistMatch[1].trim();
      const title = titleMatch[1].trim();
      if (artist && title && artist.length > 1 && title.length > 1) {
        songs.push({ artist, title, station: stationName, timestamp: new Date() });
      }
    }
  }
  
  if (songs.length === 0) {
    const altRegex = /<li[^>]*class="[^"]*(?:track|song|item)[^"]*"[^>]*>[\s\S]*?<\/li>/gi;
    const altMatches = html.match(altRegex) || [];
    
    for (const match of altMatches.slice(0, 20)) {
      const textContent = match.replace(/<[^>]+>/g, ' ').trim();
      const parts = textContent.split(/\s*[-–—]\s*/);
      if (parts.length >= 2) {
        const artist = parts[0].trim();
        const title = parts[1].trim();
        if (artist && title && artist.length > 1 && title.length > 1) {
          songs.push({ artist, title, station: stationName, timestamp: new Date() });
        }
      }
    }
  }
  
  return songs;
}

function parseGenericRadioSite(html, stationName) {
  const songs = [];
  const patterns = [
    /<(?:div|span|p|li)[^>]*class="[^"]*(?:song|track|music|playing|current|now)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|p|li)>/gi,
    /<h[1-6][^>]*class="[^"]*(?:song|track|music)[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && songs.length < 20) {
      const content = match[1].replace(/<[^>]+>/g, ' ').trim();
      const parts = content.split(/\s*[-–—]\s*/);
      if (parts.length >= 2) {
        const artist = parts[0].trim();
        const title = parts.slice(1).join(' - ').trim();
        if (artist && title && artist.length > 1 && title.length > 1 && artist.length < 100) {
          songs.push({ artist, title, station: stationName, timestamp: new Date() });
        }
      }
    }
  }
  
  return songs;
}

async function scrapeStation(stationConfig) {
  const allSongs = [];
  
  for (const url of stationConfig.urls) {
    try {
      console.log(`[SCRAPE] Fetching ${url}...`);
      const html = await fetchHtml(url);
      
      let songs = [];
      if (url.includes('onlineradiobox.com')) {
        songs = parseOnlineRadioBox(html, stationConfig.name);
      } else {
        songs = parseGenericRadioSite(html, stationConfig.name);
      }
      
      for (const song of songs) {
        const key = `${song.artist.toLowerCase()}-${song.title.toLowerCase()}`;
        if (!scrapedSongsCache.has(key)) {
          scrapedSongsCache.set(key, Date.now());
          allSongs.push({
            ...song,
            id: `${stationConfig.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            status: 'found',
          });
        }
      }
      
      if (songs.length > 0) {
        console.log(`[SCRAPE] Found ${songs.length} songs from ${stationConfig.name} (${url})`);
        break;
      }
    } catch (error) {
      console.error(`[SCRAPE] Error fetching ${url}:`, error.message);
    }
  }
  
  // Clean old entries from cache (older than 1 hour)
  const oneHourAgo = Date.now() - 3600000;
  for (const [key, timestamp] of scrapedSongsCache.entries()) {
    if (timestamp < oneHourAgo) {
      scrapedSongsCache.delete(key);
    }
  }
  
  return allSongs;
}

function register() {
  ipcMain.handle('scrape-stations', async (event, stations) => {
    const results = { songs: [], errors: [], timestamp: new Date().toISOString() };
    
    for (const station of stations) {
      if (!station.enabled) continue;
      try {
        const songs = await scrapeStation(station);
        results.songs.push(...songs);
      } catch (error) {
        results.errors.push({ station: station.name, error: error.message });
      }
    }
    
    console.log(`[SCRAPE] Total: ${results.songs.length} new songs from ${stations.length} stations`);
    return results;
  });

  ipcMain.handle('scrape-station', async (event, station) => {
    try {
      const songs = await scrapeStation(station);
      return { success: true, songs };
    } catch (error) {
      return { success: false, error: error.message, songs: [] };
    }
  });
}

module.exports = { register };
