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
];

// Validate URL to prevent SSRF attacks
function isValidRadioUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'Invalid URL protocol' };
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return { valid: false, error: 'Invalid URL' };
    }
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('169.254.')) {
      return { valid: false, error: 'Invalid URL' };
    }
    if (hostname.startsWith('172.')) {
      const parts = hostname.split('.');
      const second = parseInt(parts[1]);
      if (!isNaN(second) && second >= 16 && second <= 31) {
        return { valid: false, error: 'Invalid URL' };
      }
    }
    const isAllowedDomain = ALLOWED_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
    if (!isAllowedDomain) {
      return { valid: false, error: 'Domain not supported' };
    }
    if (urlString.length > 500) {
      return { valid: false, error: 'URL too long' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

function sanitizeStationName(name: string): string {
  if (!name || typeof name !== 'string') return 'Unknown';
  return name.slice(0, 100).replace(/[<>'"&\\]/g, '').trim() || 'Unknown';
}

// Decode HTML entities
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

// Clean text for song title/artist
function cleanText(text: string): string {
  if (!text) return '';
  return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim();
}

// Validate if text looks like a valid song part
function isValidSongPart(text: string): boolean {
  if (!text || text.length < 2 || text.length > 150) return false;
  const alphaCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  if (alphaCount < text.length * 0.3) return false;
  return true;
}

// Extract song info from a single history-song HTML block
function extractSongFromEntry(entry: string): { title: string; artist: string } | null {
  // Try span-based extraction
  const songNameMatch = entry.match(/<span[^>]*class="song-name"[^>]*>[\s\S]*?<p>([^<]+)<\/p>/i);
  const artistNameMatch = entry.match(/<span[^>]*class="artist-name"[^>]*>([^<]+)<\/span>/i);
  if (songNameMatch && artistNameMatch) {
    const title = cleanText(songNameMatch[1]);
    const artist = cleanText(artistNameMatch[1]);
    if (isValidSongPart(title) && isValidSongPart(artist)) return { title, artist };
  }
  // Fallback: img alt text "Artist - Title"
  const altMatch = entry.match(/<img[^>]*alt="([^"]+)"[^>]*>/i);
  if (altMatch) {
    const altText = decodeHtmlEntities(altMatch[1]);
    const dashParts = altText.match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (dashParts) {
      const artist = cleanText(dashParts[1]);
      const title = cleanText(dashParts[2]);
      if (isValidSongPart(title) && isValidSongPart(artist)) return { title, artist };
    }
  }
  return null;
}

// Parse HTML directly — no Firecrawl needed
function parseMyTunerHtml(html: string, stationName: string): { nowPlaying?: ScrapedSong; recentSongs: ScrapedSong[] } {
  let nowPlaying: ScrapedSong | undefined;
  const recentSongs: ScrapedSong[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  // Find ALL history-song entries globally (works regardless of nesting)
  const allEntries = html.match(/<div[^>]*class="history-song"[^>]*>[\s\S]*?<\/a>\s*<\/div>/gi) || [];
  console.log(`[${stationName}] Found ${allEntries.length} history-song entries`);

  for (let i = 0; i < allEntries.length && i < 8; i++) {
    const extracted = extractSongFromEntry(allEntries[i]);
    if (!extracted) continue;
    const key = `${extracted.title.toLowerCase()}|${extracted.artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isLive = allEntries[i].includes('live-song') || allEntries[i].includes('>LIVE<');
    if (!nowPlaying && (i === 0 || isLive)) {
      nowPlaying = { title: extracted.title, artist: extracted.artist, timestamp: now };
    } else {
      recentSongs.push({ title: extracted.title, artist: extracted.artist, timestamp: now });
    }
  }

  // Fallback: if no history-song divs found, try img alt text with height="100" (song artwork images)
  if (!nowPlaying && allEntries.length === 0) {
    const imgMatches = html.match(/<img[^>]*alt="([^"]{5,})"[^>]*height="100"[^>]*>/gi) || [];
    for (const imgTag of imgMatches.slice(0, 6)) {
      const altMatch = imgTag.match(/alt="([^"]+)"/i);
      if (!altMatch) continue;
      const altText = decodeHtmlEntities(altMatch[1]);
      if (altText.match(/^(Rádio|Play|Pause|Error|Volume|Like|Dislike|Favorite|star|Bars|Playlist)/i)) continue;
      const dashParts = altText.match(/^(.+?)\s*[-–]\s*(.+)$/);
      if (!dashParts) continue;
      const artist = cleanText(dashParts[1]);
      const title = cleanText(dashParts[2]);
      if (!isValidSongPart(title) || !isValidSongPart(artist)) continue;
      const key = `${title.toLowerCase()}|${artist.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!nowPlaying) {
        nowPlaying = { title, artist, timestamp: now };
      } else {
        recentSongs.push({ title, artist, timestamp: now });
      }
    }
  }

  return { nowPlaying, recentSongs };
}

// Fetch HTML directly from MyTuner Radio (no Firecrawl needed!)
async function fetchRadioHtml(url: string, timeout = 15000): Promise<{ success: boolean; html?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    return { success: true, html };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: msg.includes('abort') ? 'Timeout' : msg };
  }
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
    console.log(`[${safeName}] Fetching HTML: ${formattedUrl}`);

    // Try primary URL
    let fetchResult = await fetchRadioHtml(formattedUrl);

    // Fallback: try without /pt/
    if (!fetchResult.success && formattedUrl.includes('/pt/')) {
      const altUrl = formattedUrl.replace('/pt/', '/');
      console.log(`[${safeName}] Retrying without /pt/: ${altUrl}`);
      fetchResult = await fetchRadioHtml(altUrl);
    }

    if (!fetchResult.success || !fetchResult.html) {
      return new Response(
        JSON.stringify({
          success: false,
          stationName: safeName,
          error: fetchResult.error || 'Failed to fetch station page',
          scrapedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const parsed = parseMyTunerHtml(fetchResult.html, safeName);

    const result: RadioScrapeResult = {
      success: !!parsed.nowPlaying,
      stationName: safeName,
      nowPlaying: parsed.nowPlaying,
      recentSongs: parsed.recentSongs,
      source: 'direct-fetch',
      scrapedAt: new Date().toISOString(),
    };

    if (parsed.nowPlaying) {
      console.log(`[${safeName}] ✓ ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title} (+${parsed.recentSongs.length} recent)`);
    } else {
      console.warn(`[${safeName}] ✗ No song data found in HTML (${fetchResult.html.length} bytes)`);
    }

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
