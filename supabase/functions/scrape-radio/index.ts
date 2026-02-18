const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScrapedSong {
  title: string;
  artist: string;
  timestamp: string;
}

interface RadioScrapeResult {
  success: boolean;
  stationName: string;
  nowPlaying?: ScrapedSong;
  recentSongs?: ScrapedSong[];
  error?: string;
  source?: string;
  scrapedAt?: string;
}

// Allowed domains for radio scraping (security: prevent SSRF)
const ALLOWED_DOMAINS = [
  'mytuner-radio.com',
  'www.mytuner-radio.com',
  'onlineradiobox.com',
  'www.onlineradiobox.com',
  'radio-browser.info',
  'www.radio-browser.info',
  'tunein.com',
  'www.tunein.com',
];

function isValidRadioUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return { valid: false, error: 'Invalid URL protocol' };
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return { valid: false, error: 'Invalid URL' };
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('169.254.')) return { valid: false, error: 'Invalid URL' };
    if (hostname.startsWith('172.')) {
      const parts = hostname.split('.');
      const second = parseInt(parts[1]);
      if (!isNaN(second) && second >= 16 && second <= 31) return { valid: false, error: 'Invalid URL' };
    }
    const isAllowedDomain = ALLOWED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
    if (!isAllowedDomain) return { valid: false, error: 'Domain not supported' };
    if (urlString.length > 500) return { valid: false, error: 'URL too long' };
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

function sanitizeStationName(name: string): string {
  if (!name || typeof name !== 'string') return 'Unknown';
  return name.slice(0, 100).replace(/[<>'"&\\]/g, '').trim() || 'Unknown';
}

function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/\.(jpg|jpeg|png|gif|webp|svg|ico)[^\s]*/gi, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidSongPart(text: string): boolean {
  if (!text || text.length < 2 || text.length > 100) return false;
  const alphaCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  if (alphaCount < text.length * 0.3) return false;
  if (text.match(/https?:|www\.|\.com|\.jpg|\.png|\.gif|\.webp|\.svg|\/\/|mzstatic|image\/|thumb\/|rgb\.|!\[|\]\(/i)) return false;
  if (text.match(/\.[a-f0-9]{6,}$/i)) return false;
  const rejectPatterns = [
    /^(tocando agora|now playing|recently|últimas|recentes)/i,
    /^\d+\s*(min|hour|hora|segundo)/i,
    /^(min ago|hour ago)/i,
    /^[\d:]+$/,
    /^v4\/|^Music\d+|^24UMGIM/i,
    /^programas?\s+(em\s+)?destaque/i,
    /^radio|^fm\s*\d|^\d+\.\d+\s*fm/i,
    /^-\s*[A-Za-z]/,
    /klassik|schweiz|globo.*fm/i,
  ];
  for (const pattern of rejectPatterns) {
    if (pattern.test(text)) return false;
  }
  return true;
}

// Extract song info from HTML snippet
function extractSongFromHtml(html: string): { title: string; artist: string } | null {
  // Try title/artist class pattern
  const titleMatch = html.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</i) ||
                     html.match(/<b>([^<]+)<\/b>/i);
  const artistMatch = html.match(/class="[^"]*artist[^"]*"[^>]*>([^<]+)</i) ||
                      html.match(/<span[^>]*>([^<]+)<\/span>/i);

  if (titleMatch && artistMatch) {
    const title = cleanText(titleMatch[1]);
    const artist = cleanText(artistMatch[1]);
    if (isValidSongPart(title) && isValidSongPart(artist)) {
      return { title, artist };
    }
  }

  // Try alt text pattern: "Artist - Title"
  const altMatch = html.match(/alt="([^"]+)"/i);
  if (altMatch) {
    const dashParts = altMatch[1].match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (dashParts) {
      const artist = cleanText(dashParts[1]);
      const title = cleanText(dashParts[2]);
      if (isValidSongPart(title) && isValidSongPart(artist)) {
        return { title, artist };
      }
    }
  }

  return null;
}

// Direct HTTP fetch instead of Firecrawl
async function fetchPageHtml(url: string, stationName: string): Promise<{ success: boolean; html?: string; error?: string }> {
  const urlsToTry = [url];
  if (url.includes('/pt/')) {
    urlsToTry.push(url.replace('/pt/', '/'));
  } else if (!url.includes('/pt/')) {
    urlsToTry.push(url.replace('mytuner-radio.com/', 'mytuner-radio.com/pt/'));
  }

  for (const currentUrl of urlsToTry) {
    try {
      console.log(`[${stationName}] Fetching: ${currentUrl}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[${stationName}] HTTP ${response.status} for ${currentUrl}`);
        continue;
      }

      const html = await response.text();
      if (html && html.length > 500) {
        return { success: true, html };
      }
      console.warn(`[${stationName}] Page too short (${html.length} chars)`);
    } catch (error) {
      console.error(`[${stationName}] Fetch error:`, error instanceof Error ? error.message : 'Unknown');
    }
  }

  return { success: false, error: `Failed to fetch ${stationName}` };
}

function parseMyTunerHtml(html: string, stationName: string, url: string): RadioScrapeResult {
  const songs: ScrapedSong[] = [];
  let nowPlaying: ScrapedSong | undefined;

  // Method 1: Look for "now playing" / latest-song section in HTML
  const latestSongMatch = html.match(/<div[^>]*class="[^"]*latest-song[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (latestSongMatch) {
    const extracted = extractSongFromHtml(latestSongMatch[1]);
    if (extracted) {
      nowPlaying = { ...extracted, timestamp: new Date().toISOString() };
      console.log(`[${stationName}] Now playing (HTML): ${extracted.artist} - ${extracted.title}`);
    }
  }

  // Method 2: Try JSON-LD or meta tags
  if (!nowPlaying) {
    const ogTitleMatch = html.match(/property="og:title"[^>]*content="([^"]+)"/i) ||
                         html.match(/content="([^"]+)"[^>]*property="og:title"/i);
    if (ogTitleMatch) {
      // Sometimes og:title has "Artist - Title | Station"
      const ogText = ogTitleMatch[1].split('|')[0].trim();
      const dashParts = ogText.match(/^(.+?)\s*[-–]\s*(.+)$/);
      if (dashParts) {
        const artist = cleanText(dashParts[1]);
        const title = cleanText(dashParts[2]);
        if (isValidSongPart(title) && isValidSongPart(artist)) {
          nowPlaying = { title, artist, timestamp: new Date().toISOString() };
          console.log(`[${stationName}] Now playing (og:title): ${artist} - ${title}`);
        }
      }
    }
  }

  // Method 3: Parse alt text from images (MyTuner uses "Artist - Title" in img alt)
  const altTextMatches = html.matchAll(/alt="([^"]+)"[^>]*class="[^"]*(?:song|track|album)[^"]*"/gi);
  for (const match of altTextMatches) {
    const dashParts = match[1].match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (dashParts) {
      const artist = cleanText(dashParts[1]);
      const title = cleanText(dashParts[2]);
      if (isValidSongPart(title) && isValidSongPart(artist) &&
          !songs.some(s => s.title.toLowerCase() === title.toLowerCase() && s.artist.toLowerCase() === artist.toLowerCase())) {
        if (!nowPlaying) {
          nowPlaying = { title, artist, timestamp: new Date().toISOString() };
          console.log(`[${stationName}] Now playing (alt): ${artist} - ${title}`);
        } else {
          songs.push({ title, artist, timestamp: new Date().toISOString() });
        }
      }
    }
  }

  // Method 4: Parse song-history section
  const historySection = html.match(/id="song-history"[^>]*>([\s\S]*?)(?:<\/section>|<section|<footer)/i);
  if (historySection) {
    const songDivs = historySection[1].match(/<div[^>]*class="[^"]*song[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
    for (const div of songDivs.slice(0, 5)) {
      const extracted = extractSongFromHtml(div);
      if (extracted &&
          !songs.some(s => s.title.toLowerCase() === extracted.title.toLowerCase() && s.artist.toLowerCase() === extracted.artist.toLowerCase()) &&
          (!nowPlaying || nowPlaying.title.toLowerCase() !== extracted.title.toLowerCase() || nowPlaying.artist.toLowerCase() !== extracted.artist.toLowerCase())) {
        songs.push({ ...extracted, timestamp: new Date().toISOString() });
      }
    }
  }

  // Method 5: Generic alt text scan for any img with "Artist - Title" pattern
  if (!nowPlaying && songs.length === 0) {
    const allAltTexts = html.matchAll(/alt="([^"]{5,80})"/gi);
    for (const match of allAltTexts) {
      const altText = match[1];
      const dashParts = altText.match(/^(.+?)\s*[-–]\s*(.+)$/);
      if (dashParts) {
        const artist = cleanText(dashParts[1]);
        const title = cleanText(dashParts[2]);
        if (isValidSongPart(title) && isValidSongPart(artist) &&
            !songs.some(s => s.title.toLowerCase() === title.toLowerCase())) {
          if (!nowPlaying) {
            nowPlaying = { title, artist, timestamp: new Date().toISOString() };
          } else {
            songs.push({ title, artist, timestamp: new Date().toISOString() });
          }
          if (songs.length >= 5) break;
        }
      }
    }
  }

  return {
    success: !!nowPlaying || songs.length > 0,
    stationName,
    nowPlaying,
    recentSongs: songs.slice(0, 5),
    source: 'direct-fetch',
    scrapedAt: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { stationUrl, stationName } = body;

    if (!stationUrl || typeof stationUrl !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Station URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let formattedUrl = stationUrl.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    const urlValidation = isValidRadioUrl(formattedUrl);
    if (!urlValidation.valid) {
      return new Response(
        JSON.stringify({ success: false, error: urlValidation.error || 'Invalid URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const safeName = sanitizeStationName(stationName);
    console.log(`Scraping radio station: ${formattedUrl}`);

    const fetchResult = await fetchPageHtml(formattedUrl, safeName);

    if (!fetchResult.success || !fetchResult.html) {
      return new Response(
        JSON.stringify({
          success: false,
          stationName: safeName,
          error: fetchResult.error || 'Failed to retrieve station data',
          scrapedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = parseMyTunerHtml(fetchResult.html, safeName, formattedUrl);

    console.log(`Scrape result: ${result.nowPlaying ? `${result.nowPlaying.artist} - ${result.nowPlaying.title}` : 'no song found'}`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error scraping radio:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An error occurred', scrapedAt: new Date().toISOString() }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
