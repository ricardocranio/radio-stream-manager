import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    'mix-fm': 'mixfm',
    'jovem-pan-fm-florianopolis': 'jovempan',
    'jovem-pan': 'jovempan',
    'energia-97-fm': 'energia97',
    'energia-97': 'energia97',
    'positividade-fm': 'positividade',
    'positiva-fm': 'positiva',
    'radio-liberdade-fm': 'liberdade',
    'radio-blink-102-fm': 'blink102',
    'blink-102': 'blink102',
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

function getTritonMountVariations(streamUrl: string): string[] {
  const match = streamUrl.match(/livestream-redirect\/([A-Za-z0-9_]+)/i);
  if (!match) return [];
  
  const rawMount = match[1].replace(/\.(mp3|aac|ogg)$/i, '');
  const variations = [rawMount];
  
  // Try without codec suffix (BHFMAAC -> BHFM, MIXFM_SAOPAULOAAC -> MIXFM_SAOPAULO)
  const withoutCodec = rawMount.replace(/(AAC|MP3|OGG|HLS)$/i, '');
  if (withoutCodec !== rawMount && withoutCodec.length > 2) {
    variations.push(withoutCodec);
  }
  
  // Try with _AUD suffix (common Triton pattern)
  variations.push(rawMount + '_AUD');
  if (withoutCodec !== rawMount) {
    variations.push(withoutCodec + '_AUD');
  }
  
  return [...new Set(variations)];
}

async function fetchTritonNowPlaying(streamUrl: string, stationName: string): Promise<RadioScrapeResult> {
  const mountVariations = getTritonMountVariations(streamUrl);
  if (mountVariations.length === 0) {
    return { success: false, stationName, error: 'Not a StreamTheWorld station', scrapedAt: new Date().toISOString() };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    for (const mountName of mountVariations) {
      const urls = [
        `https://np.tritondigital.com/public/nowplaying?mountName=${mountName}&numberToFetch=10&eventType=track`,
        `https://np.tritondigital.com/public/nowplaying?mountName=${mountName}&numberToFetch=10`,
      ];
      
      for (const url of urls) {
        try {
          const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml, text/xml' },
            signal: controller.signal,
          });
          
          if (!response.ok) continue;
          
          const xml = await response.text();
          if (xml.includes('<nowplaying-info-list/>') || xml.includes('<nowplaying-info-list></nowplaying-info-list>')) continue;
          
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
                console.log(`[${stationName}] Triton now playing (${mountName}): ${artist} - ${title}`);
              } else if (!songs.some(s => s.artist === artist && s.title === title)) {
                songs.push(song);
              }
              if (songs.length >= 5) break;
            }
          }
          
          if (nowPlaying) {
            clearTimeout(timeoutId);
            return {
              success: true, stationName, nowPlaying, recentSongs: songs,
              source: `triton-api(${mountName})`, scrapedAt: new Date().toISOString(),
            };
          }
        } catch { /* try next URL */ }
      }
    }
    
    clearTimeout(timeoutId);
    return { success: false, stationName, error: 'No Triton data', scrapedAt: new Date().toISOString() };
  } catch {
    return { success: false, stationName, error: 'Triton API error', scrapedAt: new Date().toISOString() };
  }
}

// ===== ICY Metadata Fallback (improved) =====

async function resolveStreamUrl(streamUrl: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    // Use GET with range header to follow redirects properly (HEAD may not redirect for streams)
    const resp = await fetch(streamUrl, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-0', 'User-Agent': 'WinampMPEG/5.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    await resp.body?.cancel();
    return resp.url || streamUrl;
  } catch {
    return streamUrl;
  }
}

async function fetchIcyMetadata(streamUrl: string, stationName: string): Promise<RadioScrapeResult> {
  // Try both the original URL and the resolved URL
  const urlsToTry = [streamUrl];
  
  try {
    const resolved = await resolveStreamUrl(streamUrl);
    if (resolved !== streamUrl) {
      urlsToTry.push(resolved);
    }
  } catch { /* continue with original */ }

  for (const url of urlsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(url, {
        headers: { 'Icy-MetaData': '1', 'User-Agent': 'WinampMPEG/5.0', 'Accept': '*/*' },
        signal: controller.signal,
      });

      const metaInt = parseInt(response.headers.get('icy-metaint') || '0', 10);
      if (!metaInt || !response.body) {
        clearTimeout(timeoutId);
        await response.body?.cancel();
        continue; // Try next URL
      }

      const reader = response.body.getReader();
      let bytesRead = 0;
      const chunks: Uint8Array[] = [];

      const targetBytes = metaInt + 16384;
      while (bytesRead < targetBytes) {
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

      if (combined.length <= metaInt) continue;

      const metaLength = combined[metaInt] * 16;
      if (metaLength === 0) continue;

      const metaBytes = combined.slice(metaInt + 1, Math.min(metaInt + 1 + metaLength, combined.length));
      const metaString = new TextDecoder('utf-8', { fatal: false }).decode(metaBytes);

      const titleMatch = metaString.match(/StreamTitle='([^']+)'/);
      if (!titleMatch?.[1]) continue;

      const streamTitle = titleMatch[1].trim();
      const dashIdx = streamTitle.indexOf(' - ');
      if (dashIdx === -1) {
        console.log(`[${stationName}] ICY no dash: ${streamTitle}`);
        continue;
      }

      const artist = streamTitle.substring(0, dashIdx).trim();
      const title = streamTitle.substring(dashIdx + 3).trim();

      if (artist.length < 2 || title.length < 2) continue;

      // Reject station name / ads
      const rejectPatterns = [
        /COMERCIAL|VINHETA|INSTITUCIONAL|PROPAGANDA|SPOT/i,
        /^(RÁDIO|RADIO)\s/i,
        /^(BH FM|BAND FM|CLUBE FM|MIX FM|GLOBO|METROPOLITANA)/i,
      ];
      if (rejectPatterns.some(p => p.test(artist) || p.test(title))) continue;

      console.log(`[${stationName}] ICY now playing: ${artist} - ${title}`);
      return {
        success: true, stationName,
        nowPlaying: { artist, title, timestamp: new Date().toISOString() },
        source: 'icy-stream', scrapedAt: new Date().toISOString(),
      };
    } catch {
      // Try next URL
    }
  }

  return { success: false, stationName, error: 'ICY fetch failed', scrapedAt: new Date().toISOString() };
}

// ===== Database Fallback: get last known song from scraped_songs =====

async function fetchFromDatabase(stationName: string): Promise<RadioScrapeResult> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try recent data first (30 min)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: songs, error } = await supabase
      .from('scraped_songs')
      .select('title, artist, scraped_at, source')
      .eq('station_name', stationName)
      .gte('scraped_at', thirtyMinAgo)
      .order('scraped_at', { ascending: false })
      .limit(6);

    if (!error && songs && songs.length > 0) {
      const nowPlaying: ScrapedSong = {
        artist: songs[0].artist, title: songs[0].title, timestamp: songs[0].scraped_at,
      };
      const recentSongs = songs.slice(1).map(s => ({ artist: s.artist, title: s.title, timestamp: s.scraped_at }));
      console.log(`[${stationName}] DB fallback: ${nowPlaying.artist} - ${nowPlaying.title}`);
      return { success: true, stationName, nowPlaying, recentSongs, source: `db-cache(${songs[0].source || 'unknown'})`, scrapedAt: new Date().toISOString() };
    }

    // Wider window: 6 hours (was 2h)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: olderSongs } = await supabase
      .from('scraped_songs')
      .select('title, artist, scraped_at, source')
      .eq('station_name', stationName)
      .gte('scraped_at', sixHoursAgo)
      .order('scraped_at', { ascending: false })
      .limit(6);

    if (olderSongs && olderSongs.length > 0) {
      const nowPlaying: ScrapedSong = {
        artist: olderSongs[0].artist, title: olderSongs[0].title, timestamp: olderSongs[0].scraped_at,
      };
      const recentSongs = olderSongs.slice(1).map(s => ({ artist: s.artist, title: s.title, timestamp: s.scraped_at }));
      console.log(`[${stationName}] DB fallback (6h): ${nowPlaying.artist} - ${nowPlaying.title}`);
      return { success: true, stationName, nowPlaying, recentSongs, source: `db-cache-6h(${olderSongs[0].source || 'unknown'})`, scrapedAt: new Date().toISOString() };
    }

    // Last resort: try radio_historico (Python monitor writes here)
    const { data: historico } = await supabase
      .from('radio_historico')
      .select('artist, title, captured_at, source')
      .eq('station_name', stationName)
      .order('captured_at', { ascending: false })
      .limit(6);

    if (historico && historico.length > 0) {
      const nowPlaying: ScrapedSong = {
        artist: historico[0].artist, title: historico[0].title, timestamp: historico[0].captured_at,
      };
      const recentSongs = historico.slice(1).map(s => ({ artist: s.artist, title: s.title, timestamp: s.captured_at }));
      console.log(`[${stationName}] DB fallback (historico): ${nowPlaying.artist} - ${nowPlaying.title}`);
      return { success: true, stationName, nowPlaying, recentSongs, source: `db-historico(${historico[0].source || 'unknown'})`, scrapedAt: new Date().toISOString() };
    }

    return { success: false, stationName, error: 'No data in database', scrapedAt: new Date().toISOString() };
  } catch (err) {
    console.error(`[${stationName}] DB fallback error:`, err);
    return { success: false, stationName, error: 'Database fallback failed', scrapedAt: new Date().toISOString() };
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

    console.log(`Scraping: ${targetUrl} (for ${safeName})${streamUrl ? ` [stream: ${streamUrl.substring(0, 60)}]` : ''}`);

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

    // === Source 2: Triton Digital API (with mount name variations) ===
    if (streamUrl) {
      console.log(`[${safeName}] ORB failed, trying Triton API`);
      const tritonResult = await fetchTritonNowPlaying(streamUrl, safeName);
      if (tritonResult.success) {
        return new Response(JSON.stringify(tritonResult), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // === Source 3: ICY Metadata (with redirect resolution) ===
    if (streamUrl) {
      console.log(`[${safeName}] Triton failed, trying ICY metadata`);
      const icyResult = await fetchIcyMetadata(streamUrl, safeName);
      if (icyResult.success) {
        return new Response(JSON.stringify(icyResult), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // === Source 4: Database Fallback (scraped_songs + radio_historico) ===
    console.log(`[${safeName}] All live sources failed, trying DB fallback`);
    const dbResult = await fetchFromDatabase(safeName);
    if (dbResult.success) {
      return new Response(JSON.stringify(dbResult), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(
      JSON.stringify({ success: false, stationName: safeName, error: 'No playlist data found', scrapedAt: new Date().toISOString() }),
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
