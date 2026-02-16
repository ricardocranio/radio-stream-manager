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

function sanitizeStationName(name: string): string {
  if (!name || typeof name !== 'string') return 'Unknown';
  return name.slice(0, 100).replace(/[<>'"&\\]/g, '').trim() || 'Unknown';
}

function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function isValidSongPart(text: string): boolean {
  if (!text || text.length < 2 || text.length > 150) return false;
  const alphaCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  return alphaCount >= text.length * 0.3;
}

function parseSongString(raw: string): { artist: string; title: string } | null {
  const dashMatch = raw.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    const artist = cleanText(dashMatch[1]);
    const title = cleanText(dashMatch[2]);
    if (isValidSongPart(artist) && isValidSongPart(title)) {
      return { artist, title };
    }
  }
  return null;
}

function parseIcyMetadata(raw: string): { artist: string; title: string } | null {
  const titleMatch = raw.match(/StreamTitle='([^']*(?:''[^']*)*)'/);
  if (!titleMatch) return null;
  const streamTitle = titleMatch[1].replace(/''/g, "'").trim();
  if (!streamTitle || streamTitle.length < 3) return null;
  return parseSongString(streamTitle);
}

function isValidStreamUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname)) return false;
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('169.254.')) return false;
    if (urlString.length > 500) return false;
    return true;
  } catch {
    return false;
  }
}

// ── Resolve redirects manually (re-adding Icy-MetaData header on each hop) ──
async function resolveStreamUrl(
  url: string,
  maxRedirects = 5,
  timeout = 8000,
): Promise<{ finalUrl: string; response: Response } | { error: string }> {
  let currentUrl = url;

  for (let i = 0; i <= maxRedirects; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(currentUrl, {
        headers: {
          'Icy-MetaData': '1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RadioMonitor/1.0',
          'Accept': '*/*',
        },
        signal: controller.signal,
        redirect: 'manual',
      });
      clearTimeout(timeoutId);

      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          if (response.body) await response.body.cancel();
          return { error: `Redirect ${response.status} without Location header` };
        }
        currentUrl = new URL(location, currentUrl).toString();
        if (response.body) await response.body.cancel();
        continue;
      }

      if (response.status >= 200 && response.status < 300) {
        return { finalUrl: currentUrl, response };
      }

      if (response.body) await response.body.cancel();
      return { error: `HTTP ${response.status}` };
    } catch (error) {
      clearTimeout(timeoutId);
      const msg = error instanceof Error ? error.message : 'Unknown';
      return { error: msg.includes('abort') ? 'Timeout' : msg };
    }
  }

  return { error: `Too many redirects (>${maxRedirects})` };
}

// ── Read ICY metadata from a connected stream ──
async function readIcyFromResponse(
  response: Response,
  stationName: string,
): Promise<{ song?: { artist: string; title: string }; error?: string }> {
  const icyMetaint = parseInt(response.headers.get('icy-metaint') || '0', 10);

  if (!icyMetaint || !response.body) {
    if (response.body) await response.body.cancel();
    return { error: 'No icy-metaint header' };
  }

  const reader = response.body.getReader();
  const maxBytes = icyMetaint + 4096 + 256;
  const buffer = new Uint8Array(maxBytes);
  let bufferOffset = 0;

  try {
    while (bufferOffset < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const toCopy = Math.min(value.length, maxBytes - bufferOffset);
      buffer.set(value.subarray(0, toCopy), bufferOffset);
      bufferOffset += toCopy;
      if (bufferOffset >= icyMetaint + 1) break;
    }
  } finally {
    reader.cancel();
  }

  if (bufferOffset <= icyMetaint) return { error: 'Not enough data' };

  const metaLength = buffer[icyMetaint] * 16;
  if (metaLength === 0) return { error: 'empty' };
  if (bufferOffset < icyMetaint + 1 + metaLength) return { error: 'Incomplete metadata' };

  const metaBytes = buffer.slice(icyMetaint + 1, icyMetaint + 1 + metaLength);
  const metaString = new TextDecoder('utf-8').decode(metaBytes).replace(/\0+$/, '');
  console.log(`[${stationName}] ICY raw: "${metaString}"`);

  const parsed = parseIcyMetadata(metaString);
  if (parsed) return { song: parsed };
  return { error: `Unparseable: "${metaString}"` };
}

// ── ICY metadata with retry ──
async function fetchIcyMetadata(
  streamUrl: string,
  stationName: string,
  maxRetries = 1,
): Promise<{ success: boolean; song?: { artist: string; title: string }; error?: string }> {
  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1500));
    }

    const resolved = await resolveStreamUrl(streamUrl);
    if ('error' in resolved) {
      lastError = resolved.error;
      continue;
    }

    const result = await readIcyFromResponse(resolved.response, stationName);
    if (result.song) return { success: true, song: result.song };

    lastError = result.error || 'Unknown';
    // Only retry on transient errors
    if (lastError !== 'empty' && !lastError.includes('Not enough')) break;
  }

  return { success: false, error: lastError };
}

// ── Shoutcast/Icecast stats endpoint fallback ──
// Try common metadata endpoints: /stats?json=1, /status-json.xsl, /currentsong
async function fetchStatsMetadata(
  streamUrl: string,
  stationName: string,
): Promise<{ success: boolean; song?: { artist: string; title: string }; error?: string }> {
  try {
    const url = new URL(streamUrl);
    const baseUrl = `${url.protocol}//${url.host}`;

    // Try Shoutcast stats JSON
    const endpoints = [
      `${baseUrl}/stats?json=1`,
      `${baseUrl}/status-json.xsl`,
      `${baseUrl}/7.html`,
      `${baseUrl}/currentsong`,
    ];

    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const resp = await fetch(endpoint, {
          headers: { 'User-Agent': 'Mozilla/5.0 RadioMonitor/1.0' },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!resp.ok) { await resp.body?.cancel(); continue; }

        const text = await resp.text();

        // Shoutcast JSON stats
        if (endpoint.includes('stats?json') || endpoint.includes('status-json')) {
          try {
            const json = JSON.parse(text);
            // Shoutcast format
            const songTitle = json.songtitle || json.servertitle;
            if (songTitle) {
              const parsed = parseSongString(songTitle);
              if (parsed) {
                console.log(`[${stationName}] Stats API: ${parsed.artist} - ${parsed.title}`);
                return { success: true, song: parsed };
              }
            }
            // Icecast format
            const source = json.icestats?.source;
            const src = Array.isArray(source) ? source[0] : source;
            if (src?.artist && src?.title) {
              const artist = cleanText(src.artist);
              const title = cleanText(src.title);
              if (isValidSongPart(artist) && isValidSongPart(title)) {
                console.log(`[${stationName}] Icecast API: ${artist} - ${title}`);
                return { success: true, song: { artist, title } };
              }
            }
          } catch { /* not JSON */ }
        }

        // Shoutcast 7.html format: "<html><body>X,X,X,X,X,X,current song</body></html>"
        if (endpoint.includes('7.html')) {
          const match = text.match(/<body>[\d,]+,(.+?)<\/body>/i);
          if (match) {
            const parsed = parseSongString(cleanText(match[1]));
            if (parsed) {
              console.log(`[${stationName}] 7.html: ${parsed.artist} - ${parsed.title}`);
              return { success: true, song: parsed };
            }
          }
        }

        // /currentsong returns plain text "Artist - Title"
        if (endpoint.includes('currentsong') && text.trim().length > 3) {
          const parsed = parseSongString(cleanText(text));
          if (parsed) {
            console.log(`[${stationName}] currentsong: ${parsed.artist} - ${parsed.title}`);
            return { success: true, song: parsed };
          }
        }
      } catch { /* next endpoint */ }
    }
  } catch { /* ignore */ }

  return { success: false, error: 'No stats endpoint available' };
}

// ── Triton Digital Now Playing API (for StreamTheWorld stations) ──
async function fetchTritonNowPlaying(
  streamUrl: string,
  stationName: string,
): Promise<{ success: boolean; song?: { artist: string; title: string }; error?: string }> {
  // Extract mount/callsign from StreamTheWorld URL
  const stwMatch = streamUrl.match(/livestream-redirect\/([A-Z0-9_]+)/i);
  if (!stwMatch) return { success: false, error: 'Not a StreamTheWorld URL' };

  // Remove format suffix (AAC, .mp3, .aac, etc.)
  const rawMount = stwMatch[1].replace(/\.(mp3|aac)$/i, '');

  // Try multiple mount name variations
  const variations = [rawMount];
  // Add without AAC suffix
  if (rawMount.endsWith('AAC')) variations.push(rawMount.slice(0, -3));
  // Add with AAC suffix
  if (!rawMount.endsWith('AAC')) variations.push(`${rawMount}AAC`);

  for (const mount of variations) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const apiUrl = `https://np.tritondigital.com/public/nowplaying?mountName=${mount}&numberToFetch=1&eventType=track&format=json`;
      const resp = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 RadioMonitor/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!resp.ok) { await resp.body?.cancel(); continue; }

      const data = await resp.json();
      const nowplaying = data?.nowplaying;
      if (Array.isArray(nowplaying) && nowplaying.length > 0) {
        const track = nowplaying[0];
        const artist = cleanText(track.artistName || '');
        const title = cleanText(track.cueTitle || track.title || '');
        if (isValidSongPart(artist) && isValidSongPart(title)) {
          console.log(`[${stationName}] Triton API (${mount}): ${artist} - ${title}`);
          return { success: true, song: { artist, title } };
        }
      }
    } catch { /* next variation */ }
  }

  return { success: false, error: 'Triton API returned no tracks' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { stationName, streamUrl } = body;
    const safeName = sanitizeStationName(stationName);
    const now = new Date().toISOString();

    if (!streamUrl || typeof streamUrl !== 'string') {
      return new Response(
        JSON.stringify({ success: false, stationName: safeName, error: 'No stream URL configured', scrapedAt: now }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let formattedUrl = streamUrl.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    if (!isValidStreamUrl(formattedUrl)) {
      return new Response(
        JSON.stringify({ success: false, stationName: safeName, error: 'Invalid stream URL', scrapedAt: now }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[${safeName}] Scraping: ${formattedUrl}`);

    // Strategy 1: ICY metadata (works for Icecast/Shoutcast direct streams)
    const icyResult = await fetchIcyMetadata(formattedUrl, safeName);
    if (icyResult.success && icyResult.song) {
      console.log(`[${safeName}] ✓ ICY: ${icyResult.song.artist} - ${icyResult.song.title}`);
      return jsonResponse({ success: true, stationName: safeName, nowPlaying: { ...icyResult.song, timestamp: now }, recentSongs: [], source: 'icy-metadata', scrapedAt: now });
    }

    console.log(`[${safeName}] ICY failed (${icyResult.error}), trying fallbacks...`);

    // Strategy 2: Triton Digital Now Playing API (for StreamTheWorld stations)
    if (formattedUrl.includes('streamtheworld.com')) {
      const tritonResult = await fetchTritonNowPlaying(formattedUrl, safeName);
      if (tritonResult.success && tritonResult.song) {
        console.log(`[${safeName}] ✓ Triton: ${tritonResult.song.artist} - ${tritonResult.song.title}`);
        return jsonResponse({ success: true, stationName: safeName, nowPlaying: { ...tritonResult.song, timestamp: now }, recentSongs: [], source: 'triton-api', scrapedAt: now });
      }
      console.log(`[${safeName}] Triton failed (${tritonResult.error})`);
    }

    // Strategy 3: Shoutcast/Icecast stats endpoints
    const statsResult = await fetchStatsMetadata(formattedUrl, safeName);
    if (statsResult.success && statsResult.song) {
      console.log(`[${safeName}] ✓ Stats: ${statsResult.song.artist} - ${statsResult.song.title}`);
      return jsonResponse({ success: true, stationName: safeName, nowPlaying: { ...statsResult.song, timestamp: now }, recentSongs: [], source: 'stats-api', scrapedAt: now });
    }

    // All strategies failed
    console.warn(`[${safeName}] ✗ All methods failed`);
    return jsonResponse({ success: false, stationName: safeName, error: icyResult.error || 'No metadata available', source: 'none', scrapedAt: now });
  } catch (error) {
    console.error('Error scraping radio:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An error occurred', scrapedAt: new Date().toISOString() }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

function jsonResponse(data: RadioScrapeResult) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
