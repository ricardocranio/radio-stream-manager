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
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function isValidSongPart(text: string): boolean {
  if (!text || text.length < 2 || text.length > 150) return false;
  const alphaCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  return alphaCount >= text.length * 0.3;
}

// Parse ICY metadata string: "StreamTitle='Artist - Title';StreamUrl='';"
function parseIcyMetadata(raw: string): { artist: string; title: string } | null {
  const titleMatch = raw.match(/StreamTitle='([^']*(?:''[^']*)*)'/);
  if (!titleMatch) return null;

  const streamTitle = titleMatch[1].replace(/''/g, "'").trim();
  if (!streamTitle || streamTitle.length < 3) return null;

  // Try "Artist - Title" format
  const dashMatch = streamTitle.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    const artist = cleanText(dashMatch[1]);
    const title = cleanText(dashMatch[2]);
    if (isValidSongPart(artist) && isValidSongPart(title)) {
      return { artist, title };
    }
  }

  // Fallback: entire string as title
  return null;
}

// Fetch ICY metadata from an audio stream URL
async function fetchIcyMetadata(
  streamUrl: string,
  stationName: string,
  timeout = 10000
): Promise<{ success: boolean; song?: { artist: string; title: string }; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(streamUrl, {
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RadioMonitor/1.0',
        'Accept': '*/*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Get the metadata interval from response headers
    const icyMetaint = parseInt(response.headers.get('icy-metaint') || '0', 10);
    
    if (!icyMetaint || !response.body) {
      // No ICY metadata support - try to get info from icy-name, icy-description headers
      const icyName = response.headers.get('icy-name');
      const icyDesc = response.headers.get('icy-description');
      console.log(`[${stationName}] No icy-metaint. Headers: icy-name=${icyName}, icy-desc=${icyDesc}`);
      
      // Must consume the body to avoid resource leak
      if (response.body) {
        await response.body.cancel();
      }
      return { success: false, error: 'Stream does not support ICY metadata' };
    }

    console.log(`[${stationName}] icy-metaint: ${icyMetaint}`);

    // Read the stream until we find metadata
    const reader = response.body.getReader();
    let bytesRead = 0;
    const maxBytes = icyMetaint + 4096 + 256; // Read one interval + metadata block
    const buffer = new Uint8Array(maxBytes);
    let bufferOffset = 0;

    try {
      while (bufferOffset < maxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;

        const remaining = maxBytes - bufferOffset;
        const toCopy = Math.min(value.length, remaining);
        buffer.set(value.subarray(0, toCopy), bufferOffset);
        bufferOffset += toCopy;

        if (bufferOffset >= icyMetaint + 1) {
          // We have enough data to check for metadata
          break;
        }
      }
    } finally {
      reader.cancel();
    }

    // Parse ICY metadata from the buffer
    // After icyMetaint bytes of audio, there's 1 byte indicating metadata length * 16
    if (bufferOffset > icyMetaint) {
      const metaLength = buffer[icyMetaint] * 16;
      if (metaLength > 0 && bufferOffset >= icyMetaint + 1 + metaLength) {
        const metaBytes = buffer.slice(icyMetaint + 1, icyMetaint + 1 + metaLength);
        const metaString = new TextDecoder('utf-8').decode(metaBytes).replace(/\0+$/, '');
        console.log(`[${stationName}] ICY metadata: "${metaString}"`);

        const parsed = parseIcyMetadata(metaString);
        if (parsed) {
          return { success: true, song: parsed };
        } else {
          return { success: false, error: `Could not parse: "${metaString}"` };
        }
      } else if (metaLength === 0) {
        return { success: false, error: 'Metadata block is empty (stream between songs)' };
      }
    }

    return { success: false, error: 'Not enough data read from stream' };
  } catch (error) {
    clearTimeout(timeoutId);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: msg.includes('abort') ? 'Timeout' : msg };
  }
}

// Validate stream URL (allow common streaming domains)
function isValidStreamUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return false;
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('169.254.')) return false;
    if (urlString.length > 500) return false;
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { stationUrl, stationName, streamUrl } = body;

    const safeName = sanitizeStationName(stationName);
    const now = new Date().toISOString();

    // Prefer streamUrl (ICY metadata) over stationUrl (MyTuner HTML scraping)
    if (streamUrl && typeof streamUrl === 'string') {
      let formattedStreamUrl = streamUrl.trim();
      if (!formattedStreamUrl.startsWith('http://') && !formattedStreamUrl.startsWith('https://')) {
        formattedStreamUrl = `https://${formattedStreamUrl}`;
      }

      if (!isValidStreamUrl(formattedStreamUrl)) {
        return new Response(
          JSON.stringify({ success: false, stationName: safeName, error: 'Invalid stream URL', scrapedAt: now }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[${safeName}] Fetching ICY metadata from stream: ${formattedStreamUrl}`);
      const icyResult = await fetchIcyMetadata(formattedStreamUrl, safeName);

      if (icyResult.success && icyResult.song) {
        const result: RadioScrapeResult = {
          success: true,
          stationName: safeName,
          nowPlaying: { title: icyResult.song.title, artist: icyResult.song.artist, timestamp: now },
          recentSongs: [],
          source: 'icy-metadata',
          scrapedAt: now,
        };
        console.log(`[${safeName}] ✓ ICY: ${icyResult.song.artist} - ${icyResult.song.title}`);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.warn(`[${safeName}] ✗ ICY failed: ${icyResult.error}`);
      // Fall through to error response (no MyTuner fallback since it doesn't work without JS)
      return new Response(
        JSON.stringify({
          success: false,
          stationName: safeName,
          error: icyResult.error || 'No metadata from stream',
          source: 'icy-metadata',
          scrapedAt: now,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Legacy fallback: if no streamUrl, return error directing to configure stream_url
    return new Response(
      JSON.stringify({
        success: false,
        stationName: safeName,
        error: 'No stream URL configured. Add stream_url to the station.',
        scrapedAt: now,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error scraping radio:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An error occurred', scrapedAt: new Date().toISOString() }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
