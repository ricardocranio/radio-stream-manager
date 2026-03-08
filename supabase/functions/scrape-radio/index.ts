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

const ALLOWED_DOMAINS = [
  'mytuner-radio.com', 'www.mytuner-radio.com',
  'onlineradiobox.com', 'www.onlineradiobox.com',
  'radio-browser.info', 'www.radio-browser.info',
  'tunein.com', 'www.tunein.com',
  'playerservices.streamtheworld.com',
];

function isValidRadioUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return { valid: false, error: 'Invalid protocol' };
    const hostname = url.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname)) return { valid: false, error: 'Invalid URL' };
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('169.254.')) return { valid: false, error: 'Invalid URL' };
    if (!ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) return { valid: false, error: 'Domain not supported' };
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

function sanitizeStationName(name: string): string {
  if (!name || typeof name !== 'string') return 'Unknown';
  return name.slice(0, 100).replace(/[<>'"&\\]/g, '').trim() || 'Unknown';
}

function getOnlineRadioBoxUrl(scrapeUrl: string, stationName: string): string | null {
  if (scrapeUrl.includes('onlineradiobox.com')) {
    if (scrapeUrl.includes('/playlist')) return scrapeUrl;
    return scrapeUrl.replace(/\/?$/, '/playlist/');
  }

  const slugMap: Record<string, string> = {
    'band-fm': 'bandfm',
    'radio-bh-fm': 'bh',
    'radio-clube-fm-brasilia': 'clubefm',
    'radio-metropolitana-fm': 'metropolitana',
    'radio-globo-rj': 'globo',
    'mix-fm-sao-paulo': 'mixfm',
    'jovem-pan-fm-florianopolis': 'jovempan',
    'energia-97-fm': 'energia97',
    'positividade-fm': 'positividade',
    'positiva-fm': 'positiva',
    'radio-liberdade-fm': 'liberdade',
    'radio-blink-102-fm': 'blink102',
  };

  for (const [pattern, slug] of Object.entries(slugMap)) {
    if (scrapeUrl.includes(pattern)) {
      return `https://onlineradiobox.com/br/${slug}/playlist/`;
    }
  }

  const normalized = stationName
    .toLowerCase()
    .replace(/\s*(fm|am)\s*/gi, '').replace(/rádio\s*/gi, '')
    .replace(/[^a-z0-9]/gi, '').trim();
  return normalized ? `https://onlineradiobox.com/br/${normalized}/playlist/` : null;
}

function isValidSongText(text: string): boolean {
  if (!text || text.length < 3 || text.length > 150) return false;
  if (!text.includes(' - ')) return false;
  const rejectPatterns = [
    /^(METROPOLITANA|BH FM|BAND FM|CLUBE FM|GLOBO|MIX FM|ENERGIA|JOVEM PAN)/i,
    /^(RÁDIO|RADIO)\s/i,
    /COMERCIAL|VINHETA|INSTITUCIONAL|PROPAGANDA/i,
  ];
  return !rejectPatterns.some(p => p.test(text));
}

function parseOnlineRadioBoxHtml(html: string, stationName: string): RadioScrapeResult {
  const songs: ScrapedSong[] = [];
  let nowPlaying: ScrapedSong | undefined;

  if (html.includes('did not provide a playlist')) {
    return { success: false, stationName, error: 'Station has no playlist on ORB', scrapedAt: new Date().toISOString() };
  }

  const trackMatches = html.matchAll(/class="track_history_item"[^>]*>(?:\s*<a[^>]*>)?([^<]+)(?:<\/a>)?/gi);

  for (const match of trackMatches) {
    const rawText = match[1].trim();
    if (!isValidSongText(rawText)) continue;

    const dashIndex = rawText.indexOf(' - ');
    if (dashIndex === -1) continue;

    const artist = rawText.substring(0, dashIndex).trim();
    const title = rawText.substring(dashIndex + 3).trim();
    if (artist.length < 2 || title.length < 2) continue;
    if (/^(METROPOLITANA|BH FM|BAND FM|CLUBE FM|GLOBO|MIX FM) - /i.test(rawText)) continue;

    const song: ScrapedSong = { artist, title, timestamp: new Date().toISOString() };

    if (!nowPlaying) {
      nowPlaying = song;
      console.log(`[${stationName}] Now playing: ${artist} - ${title}`);
    } else if (!songs.some(s => s.title === title && s.artist === artist)) {
      songs.push(song);
    }
    if (songs.length >= 5) break;
  }

  return {
    success: !!nowPlaying || songs.length > 0,
    stationName,
    nowPlaying,
    recentSongs: songs,
    source: 'onlineradiobox',
    scrapedAt: new Date().toISOString(),
  };
}

// ===== Triton Digital Now Playing API =====

function getMountName(streamUrl: string): string | null {
  const match = streamUrl.match(/livestream-redirect\/([A-Z0-9_]+)/i);
  if (match) return match[1].replace(/\.(mp3|aac|ogg)$/i, '');
  return null;
}

async function fetchTritonNowPlaying(streamUrl: string, stationName: string): Promise<RadioScrapeResult> {
  const mountName = getMountName(streamUrl);
  if (!mountName) {
    return { success: false, stationName, error: 'Not a StreamTheWorld station', scrapedAt: new Date().toISOString() };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const url = `https://np.tritondigital.com/public/nowplaying?mountName=${mountName}&numberToFetch=10&eventType=track`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml, text/xml' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return { success: false, stationName, error: `Triton HTTP ${response.status}`, scrapedAt: new Date().toISOString() };
    }
    
    const xml = await response.text();
    const blocks = xml.split('</nowplaying-info>');
    const songs: ScrapedSong[] = [];
    let nowPlaying: ScrapedSong | undefined;
    
    for (const block of blocks) {
      const artistMatch = block.match(/<property\s+name="track_artist_name"[^>]*>([^<]+)<\/property>/i);
      const titleMatch = block.match(/<property\s+name="cue_title"[^>]*>([^<]+)<\/property>/i);
      
      if (artistMatch?.[1] && titleMatch?.[1]) {
        const artist = artistMatch[1].trim();
        const title = titleMatch[1].trim();
        if (artist.length < 2 || title.length < 2) continue;
        
        const rejectPatterns = [
          /COMERCIAL|VINHETA|INSTITUCIONAL|PROPAGANDA|SPOT|BREAK/i,
          /^(RÁDIO|RADIO)\s/i,
          /^(BH FM|BAND FM|CLUBE FM|MIX FM|GLOBO|METROPOLITANA)/i,
        ];
        if (rejectPatterns.some(p => p.test(artist) || p.test(title))) continue;
        
        const song: ScrapedSong = { artist, title, timestamp: new Date().toISOString() };
        
        if (!nowPlaying) {
          nowPlaying = song;
          console.log(`[${stationName}] Triton now playing: ${artist} - ${title}`);
        } else if (!songs.some(s => s.artist === artist && s.title === title)) {
          songs.push(song);
        }
        if (songs.length >= 5) break;
      }
    }
    
    return {
      success: !!nowPlaying,
      stationName,
      nowPlaying,
      recentSongs: songs,
      source: 'triton-api',
      scrapedAt: new Date().toISOString(),
    };
  } catch {
    return { success: false, stationName, error: 'Triton API error', scrapedAt: new Date().toISOString() };
  }
}

// ===== ICY Metadata Fallback (improved) =====

async function resolveStreamUrl(streamUrl: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(streamUrl, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    clearTimeout(timeoutId);
    return resp.url || streamUrl;
  } catch {
    return streamUrl;
  }
}

async function fetchIcyMetadata(streamUrl: string, stationName: string): Promise<RadioScrapeResult> {
  try {
    const resolvedUrl = await resolveStreamUrl(streamUrl);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(resolvedUrl, {
      headers: { 'Icy-MetaData': '1', 'User-Agent': 'WinampMPEG/5.0', 'Accept': '*/*' },
      signal: controller.signal,
    });

    const metaInt = parseInt(response.headers.get('icy-metaint') || '0', 10);
    if (!metaInt || !response.body) {
      clearTimeout(timeoutId);
      await response.body?.cancel();
      return { success: false, stationName, error: 'No ICY support', scrapedAt: new Date().toISOString() };
    }

    const reader = response.body.getReader();
    let bytesRead = 0;
    const chunks: Uint8Array[] = [];

    while (bytesRead < metaInt + 8192) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      bytesRead += value.length;
    }

    clearTimeout(timeoutId);
    await reader.cancel();

    const combined = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }

    if (combined.length <= metaInt) return { success: false, stationName, error: 'No metadata', scrapedAt: new Date().toISOString() };

    const metaLength = combined[metaInt] * 16;
    if (metaLength === 0) return { success: false, stationName, error: 'Empty metadata', scrapedAt: new Date().toISOString() };

    const metaBytes = combined.slice(metaInt + 1, Math.min(metaInt + 1 + metaLength, combined.length));
    const metaString = new TextDecoder('utf-8', { fatal: false }).decode(metaBytes);

    const titleMatch = metaString.match(/StreamTitle='([^']+)'/);
    if (!titleMatch?.[1]) return { success: false, stationName, error: 'No StreamTitle', scrapedAt: new Date().toISOString() };

    const streamTitle = titleMatch[1].trim();
    const dashIdx = streamTitle.indexOf(' - ');
    if (dashIdx === -1) return { success: false, stationName, error: `No dash in: ${streamTitle}`, scrapedAt: new Date().toISOString() };

    const artist = streamTitle.substring(0, dashIdx).trim();
    const title = streamTitle.substring(dashIdx + 3).trim();

    return {
      success: true, stationName,
      nowPlaying: { artist, title, timestamp: new Date().toISOString() },
      source: 'icy-stream', scrapedAt: new Date().toISOString(),
    };
  } catch {
    return { success: false, stationName, error: 'ICY fetch failed', scrapedAt: new Date().toISOString() };
  }
}

// ===== Main Handler =====

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { stationUrl, stationName, streamUrl } = body;

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
        JSON.stringify({ success: false, error: urlValidation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const safeName = sanitizeStationName(stationName);
    const orbUrl = getOnlineRadioBoxUrl(formattedUrl, safeName);
    const targetUrl = orbUrl || formattedUrl;

    console.log(`Scraping: ${targetUrl} (for ${safeName})`);

    // === Source 1: OnlineRadioBox ===
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    let orbResult: RadioScrapeResult | null = null;
    
    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const html = await response.text();
        if (html.includes('track_history_item') && !html.includes('did not provide a playlist')) {
          orbResult = parseOnlineRadioBoxHtml(html, safeName);
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }
    
    if (orbResult?.success) {
      return new Response(JSON.stringify(orbResult), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // === Source 2: Triton Digital API ===
    if (streamUrl) {
      console.log(`[${safeName}] ORB failed, trying Triton API`);
      const tritonResult = await fetchTritonNowPlaying(streamUrl, safeName);
      if (tritonResult.success) {
        return new Response(JSON.stringify(tritonResult), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // === Source 3: ICY Metadata ===
    if (streamUrl) {
      console.log(`[${safeName}] Triton failed, trying ICY metadata`);
      const icyResult = await fetchIcyMetadata(streamUrl, safeName);
      if (icyResult.success) {
        return new Response(JSON.stringify(icyResult), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(
      JSON.stringify({ success: false, stationName: safeName, error: 'No data from any source', scrapedAt: new Date().toISOString() }),
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
