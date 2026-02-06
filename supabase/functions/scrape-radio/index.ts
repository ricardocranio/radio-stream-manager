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

interface FallbackSource {
  name: string;
  urlPattern: (stationName: string) => string | null;
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

// Validate URL to prevent SSRF attacks
function isValidRadioUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    
    // Only allow http and https
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'Invalid URL protocol' };
    }
    
    // Block private/internal IPs
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return { valid: false, error: 'Invalid URL' };
    }
    
    // Block internal IP ranges
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('169.254.')) {
      return { valid: false, error: 'Invalid URL' };
    }
    
    // Block 172.16.0.0 - 172.31.255.255 range
    if (hostname.startsWith('172.')) {
      const parts = hostname.split('.');
      const second = parseInt(parts[1]);
      if (!isNaN(second) && second >= 16 && second <= 31) {
        return { valid: false, error: 'Invalid URL' };
      }
    }
    
    // Check against allowed domains
    const isAllowedDomain = ALLOWED_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
    
    if (!isAllowedDomain) {
      return { valid: false, error: 'Domain not supported' };
    }
    
    // URL length limit
    if (urlString.length > 500) {
      return { valid: false, error: 'URL too long' };
    }
    
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

// Sanitize station name to prevent injection
function sanitizeStationName(name: string): string {
  if (!name || typeof name !== 'string') return 'Unknown';
  // Remove any special characters, keep only alphanumeric, spaces, and basic punctuation
  return name.slice(0, 100).replace(/[<>'"&\\]/g, '').trim() || 'Unknown';
}

// Multiple fallback sources for radio stations
const fallbackSources: FallbackSource[] = [
  {
    name: 'mytuner-radio',
    urlPattern: (name) => null, // Primary URL provided by user
  },
  {
    name: 'radio-browser',
    urlPattern: (name) => `https://www.radio-browser.info/search?name=${encodeURIComponent(name)}&order=votes`,
  },
  {
    name: 'tunein',
    urlPattern: (name) => `https://tunein.com/search/?query=${encodeURIComponent(name)}`,
  },
];

// CSS Selectors based on Python monitor script for MyTuner Radio
const MYTUNER_SELECTORS = {
  nowPlaying: [
    '.latest-song',
    '#now-playing + .latest-song',
    '.now-playing-song',
    '.current-song',
    '.slogan-metadata .latest-song',
    '[class*="latest"]',
    '[class*="current-song"]',
  ],
  songHistory: [
    '#song-history',
    '.song-history',
    '.playlist-history',
    '.history-list',
    '.playlist #song-history',
    '[id*="history"]',
  ],
  stationName: ['h1'],
};

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 1, // Single attempt per URL (was 2 - prevents edge function timeout)
  retryDelay: 500,
  timeout: 20000, // 20 seconds (was 45s - edge functions have ~60s limit)
};

async function scrapeWithRetry(
  apiKey: string,
  url: string,
  retries = RETRY_CONFIG.maxRetries
): Promise<{ success: boolean; data?: any; error?: string }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Attempt ${attempt}/${retries}] Scraping: ${url}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RETRY_CONFIG.timeout);

      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown', 'html'], // Need both - markdown is more reliable for parsing
          onlyMainContent: false,
          // Reduced wait times to fit within edge function timeout
          waitFor: 4000, // Wait for page to load (was 6s)
          actions: [
            { type: 'wait', milliseconds: 3000 }, // Wait for dynamic content (was 4s)
            { type: 'scroll', direction: 'down', amount: 400 }, // Scroll to trigger lazy load
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (response.ok && data.success !== false) {
        return { success: true, data };
      }

      console.warn(`[Attempt ${attempt}] API returned error`);
      
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, RETRY_CONFIG.retryDelay * attempt));
      }
    } catch (error) {
      console.error(`[Attempt ${attempt}] Request failed`);
      
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, RETRY_CONFIG.retryDelay * attempt));
      }
    }
  }

  return { success: false, error: 'All retry attempts failed' };
}

async function tryFallbackSources(
  apiKey: string,
  stationName: string,
  primaryUrl: string
): Promise<{ success: boolean; data?: any; source?: string; error?: string }> {
  // Try primary URL first (single attempt)
  const primaryResult = await scrapeWithRetry(apiKey, primaryUrl, 1);
  if (primaryResult.success && primaryResult.data) {
    const parsed = parseRadioContent(primaryResult.data, stationName, primaryUrl);
    if (parsed.nowPlaying) {
      return { success: true, data: primaryResult.data, source: 'primary' };
    }
  }

  console.log('[Fallback] Primary source failed or returned no data, trying one fallback...');

  // Try only ONE fallback: remove /pt/ from URL (most effective variation)
  const altUrl = primaryUrl.replace('/pt/', '/');
  if (altUrl !== primaryUrl) {
    const validation = isValidRadioUrl(altUrl);
    if (validation.valid) {
      console.log(`[Fallback] Trying MyTuner variation`);
      const result = await scrapeWithRetry(apiKey, altUrl, 1);
      if (result.success && result.data) {
        const parsed = parseRadioContent(result.data, stationName, altUrl);
        if (parsed.nowPlaying) {
          return { success: true, data: result.data, source: 'mytuner-alt' };
        }
      }
    }
  }

  return { success: false, error: 'No sources returned valid data' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { stationUrl, stationName, forceRefresh } = body;

    if (!stationUrl || typeof stationUrl !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Station URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format and validate URL
    let formattedUrl = stationUrl.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    // Validate URL (SSRF prevention)
    const urlValidation = isValidRadioUrl(formattedUrl);
    if (!urlValidation.valid) {
      return new Response(
        JSON.stringify({ success: false, error: urlValidation.error || 'Invalid URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sanitize station name
    const safeName = sanitizeStationName(stationName);

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Service temporarily unavailable' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Scraping radio station:', formattedUrl);

    // Try with fallback sources if primary fails
    const scrapeResult = await tryFallbackSources(apiKey, safeName, formattedUrl);

    if (!scrapeResult.success || !scrapeResult.data) {
      console.error('All scrape attempts failed');
      // Return success:false with 200 instead of 500 to prevent edge function error spam
      return new Response(
        JSON.stringify({ 
          success: false, 
          stationName: safeName,
          error: 'Failed to retrieve station data',
          scrapedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the scraped content
    const result = parseRadioContent(scrapeResult.data, safeName, formattedUrl);
    result.source = scrapeResult.source;
    result.scrapedAt = new Date().toISOString();
    
    console.log('Scrape successful');
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error scraping radio');
    return new Response(
      JSON.stringify({ success: false, error: 'An error occurred', scrapedAt: new Date().toISOString() }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper to clean song title/artist - removes URLs, images, markdown artifacts
function cleanText(text: string): string {
  if (!text) return '';
  
  return text
    // Remove markdown image syntax ![alt](url)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // Remove markdown links [text](url)
    .replace(/\[[^\]]*\]\([^)]+\)/g, '')
    // Remove plain URLs
    .replace(/https?:\/\/[^\s]+/gi, '')
    // Remove image file references
    .replace(/\.(jpg|jpeg|png|gif|webp|svg|ico)[^\s]*/gi, '')
    // Remove markdown bold/italic
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// Validate if text looks like a valid song title or artist
function isValidSongPart(text: string): boolean {
  if (!text || text.length < 2 || text.length > 100) return false;
  
  // Reject if it's mostly special characters or numbers
  const alphaCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  if (alphaCount < text.length * 0.3) return false;
  
  // Reject URLs, file paths, technical strings, markdown artifacts
  if (text.match(/https?:|www\.|\.com|\.jpg|\.png|\.gif|\.webp|\.svg|\/\/|mzstatic|image\/|thumb\/|rgb\.|!\[|\]\(/i)) return false;
  
  // Reject if contains file extensions or hash-like patterns
  if (text.match(/\.[a-f0-9]{6,}$/i)) return false;
  
  // Reject common non-song patterns
  const rejectPatterns = [
    /^(tocando agora|now playing|recently|últimas|recentes)/i,
    /^\d+\s*(min|hour|hora|segundo)/i,
    /^(min ago|hour ago)/i,
    /^[\d:]+$/,  // Just timestamps like 14:30
    /^v4\/|^Music\d+|^24UMGIM/i,  // Technical codes
    /^programas?\s+(em\s+)?destaque/i, // Program names
    /^radio|^fm\s*\d|^\d+\.\d+\s*fm/i, // Radio names
    /^-\s*[A-Za-z]/,  // Starts with dash (often technical)
    /klassik|schweiz|globo.*fm/i, // Known false positives
  ];
  
  for (const pattern of rejectPatterns) {
    if (pattern.test(text)) return false;
  }
  
  return true;
}

function parseRadioContent(data: any, stationName: string, url: string): RadioScrapeResult {
  const markdown = data.data?.markdown || '';
  const html = data.data?.html || '';
  
  const songs: ScrapedSong[] = [];
  let nowPlaying: ScrapedSong | undefined;

  console.log('Parsing content for:', stationName);

  // Try to parse mytuner-radio.com format
  if (url.includes('mytuner-radio.com')) {
    console.log('Using mytuner-radio.com parser');
    
    // Method 1: Parse HTML for #now-playing / .latest-song and #song-history elements
    if (html) {
      // Extract "Tocando agora" / now playing section
      const nowPlayingSection = html.match(/id="now-playing"[^>]*>[\s\S]*?<\/div>\s*<div[^>]*class="[^"]*latest-song[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (nowPlayingSection) {
        const songHtml = nowPlayingSection[1];
        const extracted = extractSongFromHtml(songHtml);
        if (extracted) {
          nowPlaying = {
            title: extracted.title,
            artist: extracted.artist,
            timestamp: new Date().toISOString(),
          };
        }
      }
      
      // Also try looking for latest-song directly
      if (!nowPlaying) {
        const latestSongMatch = html.match(/<div[^>]*class="[^"]*latest-song[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (latestSongMatch) {
          const extracted = extractSongFromHtml(latestSongMatch[1]);
          if (extracted) {
            nowPlaying = {
              title: extracted.title,
              artist: extracted.artist,
              timestamp: new Date().toISOString(),
            };
          }
        }
      }
      
      // Extract "As últimas tocadas" / song history
      const historySection = html.match(/id="song-history"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div[^>]*class="(?!song))/i);
      if (historySection) {
        const historyHtml = historySection[1];
        const songEntries = historyHtml.match(/<div[^>]*class="[^"]*song[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
        
        for (const entry of songEntries.slice(0, 5)) {
          const extracted = extractSongFromHtml(entry);
          if (extracted && !songs.some(s => s.title === extracted.title && s.artist === extracted.artist)) {
            songs.push({
              title: extracted.title,
              artist: extracted.artist,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
      
      // Method 2: Look for any song divs with title/artist classes
      if (songs.length < 3) {
        const songDivs = html.match(/<div[^>]*class="[^"]*song[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
        
        for (const div of songDivs.slice(0, 10)) {
          const extracted = extractSongFromHtml(div);
          if (extracted && 
              !songs.some(s => s.title === extracted.title && s.artist === extracted.artist) &&
              (!nowPlaying || (nowPlaying.title !== extracted.title || nowPlaying.artist !== extracted.artist))) {
            songs.push({
              title: extracted.title,
              artist: extracted.artist,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }
    
    // Method 3: Fallback to markdown parsing (updated for current MyTuner format)
    if (!nowPlaying && songs.length === 0) {
      // Method 3a: Extract from image alt text "Artist - Title" pattern
      // Format: ![Artist - Title](image_url) or [![Artist - Title](image_url)
      const afterHistory = markdown.match(/As últimas tocadas[\s\S]*$/i);
      const historySection = afterHistory ? afterHistory[0] : markdown;
      
      // Pattern: image alt text contains "Artist - Title", followed by Title\nArtistXX min ago
      const altTextSongs = historySection.match(/!\[([^\]]+)\]\(https:\/\/is\d+-ssl\.mzstatic[^)]+\)/g) || [];
      
      for (const imgTag of altTextSongs.slice(0, 8)) {
        const altMatch = imgTag.match(/!\[([^\]]+)\]/);
        if (!altMatch) continue;
        
        const altText = altMatch[1];
        // Alt text format: "Artist - Title" (e.g., "Jorge & Mateus - Todo Seu (Ao Vivo)")
        const dashParts = altText.match(/^(.+?)\s*[-–]\s*(.+)$/);
        if (dashParts) {
          const artist = cleanText(dashParts[1]);
          const title = cleanText(dashParts[2]);
          if (isValidSongPart(title) && isValidSongPart(artist) && 
              !songs.some(s => s.title.toLowerCase() === title.toLowerCase() && s.artist.toLowerCase() === artist.toLowerCase())) {
            songs.push({ title, artist, timestamp: new Date().toISOString() });
          }
        }
      }
      
      // Method 3b: Legacy **bold** pattern fallback
      if (songs.length === 0) {
        const afterNowPlaying = markdown.match(/Tocando agora:?\s*\n+([\s\S]*?)(?:\n\s*\n|As últimas|Playlist)/i);
        if (afterNowPlaying) {
          const section = afterNowPlaying[1];
          const songMatch = section.match(/\*\*([^*\n]+)\*\*\s*\n+([^\n*]+)/);
          if (songMatch) {
            const title = cleanText(songMatch[1]);
            const artist = cleanText(songMatch[2]);
            if (isValidSongPart(title) && isValidSongPart(artist)) {
              nowPlaying = { title, artist, timestamp: new Date().toISOString() };
            }
          }
        }
        
        const afterHistoryLegacy = markdown.match(/As últimas tocadas:?\s*\n+([\s\S]*?)(?:\n\s*\n\s*\n|$)/i);
        if (afterHistoryLegacy) {
          const section = afterHistoryLegacy[1];
          const songPatterns = section.match(/\*\*([^*\n]+)\*\*\s*\n+([^\n*]+)/g) || [];
          
          for (const pattern of songPatterns.slice(0, 5)) {
            const match = pattern.match(/\*\*([^*\n]+)\*\*\s*\n+([^\n*]+)/);
            if (match) {
              const title = cleanText(match[1]);
              const artist = cleanText(match[2]);
              if (isValidSongPart(title) && isValidSongPart(artist) && 
                  !songs.some(s => s.title === title && s.artist === artist)) {
                songs.push({ title, artist, timestamp: new Date().toISOString() });
              }
            }
          }
        }
      }
    }
  }

  // Generic parsing for other radio sites
  if (!nowPlaying && songs.length === 0) {
    // Look for common patterns like "Artist - Title" or "Title by Artist"
    const dashPatterns = markdown.match(/([^\n\-–]+)\s*[-–]\s*([^\n]+)/g);
    if (dashPatterns) {
      for (const pattern of dashPatterns.slice(0, 10)) {
        const match = pattern.match(/([^\-–]+)\s*[-–]\s*(.+)/);
        if (match) {
          const part1 = cleanText(match[1]);
          const part2 = cleanText(match[2]);
          if (isValidSongPart(part1) && isValidSongPart(part2)) {
            songs.push({
              title: part2,
              artist: part1,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }
  }

  // Set now playing as first song if not already set
  if (!nowPlaying && songs.length > 0) {
    nowPlaying = songs.shift();
  }

  // Deduplicate songs
  const uniqueSongs = songs.reduce((acc: ScrapedSong[], song) => {
    if (!acc.some(s => s.title.toLowerCase() === song.title.toLowerCase() && 
                       s.artist.toLowerCase() === song.artist.toLowerCase())) {
      acc.push(song);
    }
    return acc;
  }, []);

  // Get last 5 songs (excluding now playing)
  const recentSongs = uniqueSongs.slice(0, 5);

  return {
    success: true,
    stationName,
    nowPlaying,
    recentSongs,
  };
}

// Extract song title and artist from an HTML snippet
function extractSongFromHtml(html: string): { title: string; artist: string } | null {
  // Try different patterns to extract title and artist
  
  // Pattern 1: Look for elements with title/artist classes
  const titleMatch = html.match(/<[^>]*class="[^"]*(?:title|song-title|track-title)[^"]*"[^>]*>([^<]+)</i) ||
                     html.match(/<strong[^>]*>([^<]+)<\/strong>/i) ||
                     html.match(/<b[^>]*>([^<]+)<\/b>/i);
  
  const artistMatch = html.match(/<[^>]*class="[^"]*(?:artist|song-artist|track-artist)[^"]*"[^>]*>([^<]+)</i) ||
                      html.match(/<span[^>]*>([^<]+)<\/span>/i);
  
  if (titleMatch && artistMatch) {
    const title = cleanText(titleMatch[1]);
    const artist = cleanText(artistMatch[1]);
    if (isValidSongPart(title) && isValidSongPart(artist)) {
      return { title, artist };
    }
  }
  
  // Pattern 2: Look for text content with "Title - Artist" or "Artist - Title" format
  const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const dashMatch = textContent.match(/([^-–]+)\s*[-–]\s*([^-–]+)/);
  if (dashMatch) {
    const part1 = cleanText(dashMatch[1]);
    const part2 = cleanText(dashMatch[2]);
    if (isValidSongPart(part1) && isValidSongPart(part2)) {
      // Assume format is "Artist - Title" (padrão do sistema)
      return { title: part2, artist: part1 };
    }
  }
  
  // Pattern 3: Look for two separate text blocks (title on first line, artist on second)
  const lines = textContent.split(/\s{2,}/).map(l => l.trim()).filter(l => l.length > 2);
  if (lines.length >= 2) {
    const title = cleanText(lines[0]);
    const artist = cleanText(lines[1]);
    if (isValidSongPart(title) && isValidSongPart(artist)) {
      return { title, artist };
    }
  }
  
  return null;
}
