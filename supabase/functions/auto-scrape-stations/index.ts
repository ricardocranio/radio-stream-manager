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

interface RadioStation {
  id: string;
  name: string;
  scrape_url: string;
  styles: string[];
  enabled: boolean;
  monitoring_start_hour: number | null;
  monitoring_start_minute: number;
  monitoring_end_hour: number | null;
  monitoring_end_minute: number;
  monitoring_week_days: string[];
}

interface SpecialMonitoring {
  id: string;
  station_name: string;
  scrape_url: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  week_days: string[];
  label: string | null;
  enabled: boolean;
}

function isWithinSchedule(schedule: SpecialMonitoring, now: Date): boolean {
  const currentHour = now.getUTCHours() - 3;
  const adjustedHour = currentHour < 0 ? currentHour + 24 : currentHour;
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay();
  const dayMap: Record<number, string> = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab' };
  if (schedule.week_days?.length > 0 && !schedule.week_days.includes(dayMap[currentDay])) return false;
  const currentMins = adjustedHour * 60 + currentMinute;
  return currentMins >= schedule.start_hour * 60 + schedule.start_minute && currentMins <= schedule.end_hour * 60 + schedule.end_minute;
}

function isStationActiveNow(station: RadioStation, now: Date): boolean {
  if (station.monitoring_start_hour === null || station.monitoring_end_hour === null) return true;
  const currentHour = now.getUTCHours() - 3;
  const adjustedHour = currentHour < 0 ? currentHour + 24 : currentHour;
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay();
  const dayMap: Record<number, string> = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab' };
  if (station.monitoring_week_days?.length > 0 && !station.monitoring_week_days.includes(dayMap[currentDay])) return false;
  const currentMins = adjustedHour * 60 + currentMinute;
  return currentMins >= station.monitoring_start_hour * 60 + station.monitoring_start_minute && currentMins <= station.monitoring_end_hour * 60 + station.monitoring_end_minute;
}

const BATCH_SIZE = 4;

// ===== ICY Metadata Fallback =====

async function fetchIcyMetadata(streamUrl: string, stationName: string): Promise<{ artist: string; title: string } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(streamUrl, {
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: controller.signal,
    });

    const metaInt = parseInt(response.headers.get('icy-metaint') || '0', 10);
    if (!metaInt || !response.body) {
      clearTimeout(timeoutId);
      await response.body?.cancel();
      console.warn(`[${stationName}] No ICY metadata support (metaint=${metaInt})`);
      return null;
    }

    const reader = response.body.getReader();
    let bytesRead = 0;
    const chunks: Uint8Array[] = [];

    // Read until we pass the first metaInt boundary + metadata block
    while (bytesRead < metaInt + 4096) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      bytesRead += value.length;
    }

    clearTimeout(timeoutId);
    await reader.cancel();

    // Combine all chunks
    const combined = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // The metadata block starts at position metaInt
    if (combined.length <= metaInt) return null;

    const metaLength = combined[metaInt] * 16;
    if (metaLength === 0) return null;

    const metaStart = metaInt + 1;
    const metaEnd = Math.min(metaStart + metaLength, combined.length);
    const metaBytes = combined.slice(metaStart, metaEnd);
    const metaString = new TextDecoder('utf-8', { fatal: false }).decode(metaBytes);

    // Parse StreamTitle='Artist - Title';
    const titleMatch = metaString.match(/StreamTitle='([^']+)'/);
    if (!titleMatch || !titleMatch[1]) return null;

    const streamTitle = titleMatch[1].trim();
    if (!streamTitle || streamTitle.length < 3) return null;

    // Split "Artist - Title"
    const dashIdx = streamTitle.indexOf(' - ');
    if (dashIdx === -1) {
      console.log(`[${stationName}] ICY title without dash: "${streamTitle}"`);
      return null;
    }

    const artist = streamTitle.substring(0, dashIdx).trim();
    const title = streamTitle.substring(dashIdx + 3).trim();

    if (artist.length < 2 || title.length < 2) return null;

    // Reject non-song entries
    const rejectPatterns = [
      /COMERCIAL|VINHETA|INSTITUCIONAL|PROPAGANDA|SPOT|BREAK/i,
      /^(RÁDIO|RADIO)\s/i,
    ];
    if (rejectPatterns.some(p => p.test(artist) || p.test(title))) return null;

    console.log(`[${stationName}] ICY metadata: ${artist} - ${title}`);
    return { artist, title };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      console.warn(`[${stationName}] ICY timeout`);
    } else {
      console.warn(`[${stationName}] ICY error:`, e instanceof Error ? e.message : 'Unknown');
    }
    return null;
  }
}

// ===== OnlineRadioBox Parsing =====

// Convert a scrape_url (mytuner or onlineradiobox) to an OnlineRadioBox playlist URL
function getOnlineRadioBoxUrl(scrapeUrl: string, stationName: string): string | null {
  // If already an onlineradiobox URL, use it
  if (scrapeUrl.includes('onlineradiobox.com')) {
    if (scrapeUrl.includes('/playlist')) return scrapeUrl;
    return scrapeUrl.replace(/\/?$/, '/playlist/');
  }

  // Map known stations from mytuner URLs to OnlineRadioBox slugs
  const slugMap: Record<string, string> = {
    'band-fm': 'bandfm',
    'radio-bh-fm': 'bh',
    'radio-clube-fm-brasilia': 'clubefm',
    'radio-metropolitana-fm': 'metropolitana',
    'radio-globo-rj': 'globo',
    'mix-fm-sao-paulo': 'mixfm',
    'jovem-pan-fm-florianopolis': 'jovempan',
    'energia-97-fm': 'energia97',
  };

  for (const [pattern, slug] of Object.entries(slugMap)) {
    if (scrapeUrl.includes(pattern)) {
      return `https://onlineradiobox.com/br/${slug}/playlist/`;
    }
  }

  // Fallback: try to derive slug from station name
  const normalized = stationName
    .toLowerCase()
    .replace(/\s*(fm|am)\s*/gi, '')
    .replace(/rádio\s*/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .trim();
  if (normalized) {
    return `https://onlineradiobox.com/br/${normalized}/playlist/`;
  }

  return null;
}

async function fetchPageHtml(url: string, stationName: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) { console.warn(`[${stationName}] HTTP ${response.status}`); return null; }
    const html = await response.text();
    if (html.length > 500) return html;
    console.warn(`[${stationName}] Page too short`);
    return null;
  } catch (e) {
    console.error(`[${stationName}] Fetch error:`, e instanceof Error ? e.message : 'Unknown');
    return null;
  }
}

function isValidSongText(text: string): boolean {
  if (!text || text.length < 3 || text.length > 120) return false;
  // Reject station name/promo entries (no dash = not a song)
  if (!text.includes(' - ')) return false;
  // Reject known non-song patterns
  const rejectPatterns = [
    /^(METROPOLITANA|BH FM|BAND FM|CLUBE FM|GLOBO|MIX FM|ENERGIA|JOVEM PAN)/i,
    /^(RÁDIO|RADIO)\s/i,
    /COMERCIAL|VINHETA|INSTITUCIONAL|PROPAGANDA/i,
  ];
  return !rejectPatterns.some(p => p.test(text));
}

function parseOnlineRadioBoxHtml(html: string, stationName: string): { nowPlaying?: ScrapedSong; recentSongs: ScrapedSong[] } {
  const songs: ScrapedSong[] = [];
  let nowPlaying: ScrapedSong | undefined;

  // Parse track_history_item entries from OnlineRadioBox
  // Format: <td class="track_history_item">ARTIST - TITLE</td>
  // or: <td class="track_history_item"><a href="...">ARTIST - TITLE</a></td>
  const trackMatches = html.matchAll(/class="track_history_item"[^>]*>(?:<a[^>]*>)?([^<]+)(?:<\/a>)?/gi);

  for (const match of trackMatches) {
    const rawText = match[1].trim();
    if (!isValidSongText(rawText)) continue;

    const dashIndex = rawText.indexOf(' - ');
    if (dashIndex === -1) continue;

    const artist = rawText.substring(0, dashIndex).trim();
    const title = rawText.substring(dashIndex + 3).trim();

    if (artist.length < 2 || title.length < 2) continue;

    // Remove " feat. XXX" from title for cleaner matching but keep for display
    const song: ScrapedSong = { artist, title, timestamp: new Date().toISOString() };

    if (!nowPlaying) {
      nowPlaying = song;
      console.log(`[${stationName}] Now playing: ${artist} - ${title}`);
    } else if (!songs.some(s => s.title === title && s.artist === artist)) {
      songs.push(song);
    }

    if (songs.length >= 5) break;
  }

  return { nowPlaying, recentSongs: songs };
}

// ===== Station Processing =====

async function processStation(
  station: RadioStation & { stream_url?: string },
  supabase: any,
  now: Date
): Promise<{ station: string; success: boolean; songs: number; error?: string; skipped?: boolean; source?: string }> {
  if (!isStationActiveNow(station, now)) {
    return { station: station.name, success: true, songs: 0, skipped: true };
  }

  // Try OnlineRadioBox first
  const orbUrl = getOnlineRadioBoxUrl(station.scrape_url, station.name);
  let parsed: { nowPlaying?: ScrapedSong; recentSongs: ScrapedSong[] } = { recentSongs: [] };
  let sourceUsed = 'onlineradiobox';

  if (orbUrl) {
    console.log(`[${station.name}] Fetching: ${orbUrl}`);
    const html = await fetchPageHtml(orbUrl, station.name);
    if (html && (html.includes('track_history_item') || html.includes('tablelist-schedule'))) {
      parsed = parseOnlineRadioBoxHtml(html, station.name);
    } else {
      console.warn(`[${station.name}] No playlist data found in page`);
    }
  }

  // Fallback to ICY metadata if OnlineRadioBox had no data
  if (!parsed.nowPlaying && station.stream_url) {
    console.log(`[${station.name}] Falling back to ICY metadata from stream`);
    const icyResult = await fetchIcyMetadata(station.stream_url, station.name);
    if (icyResult) {
      parsed.nowPlaying = { ...icyResult, timestamp: new Date().toISOString() };
      sourceUsed = 'icy-stream';
    }
  }

  if (!parsed.nowPlaying && parsed.recentSongs.length === 0) {
    return { station: station.name, success: false, songs: 0, error: 'No song data from any source' };
  }

  let songsInserted = 0;

  if (parsed.nowPlaying) {
    const { data: existing } = await supabase
      .from('scraped_songs').select('id')
      .eq('station_id', station.id)
      .ilike('title', parsed.nowPlaying.title)
      .ilike('artist', parsed.nowPlaying.artist)
      .gte('scraped_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1);

    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_id: station.id,
        station_name: station.name,
        title: parsed.nowPlaying.title,
        artist: parsed.nowPlaying.artist,
        is_now_playing: true,
        source: sourceUsed === 'icy-stream' ? station.stream_url : orbUrl,
      });
      if (!insertError) {
        songsInserted++;
        console.log(`[${station.name}] ✅ Inserted: ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title} (${sourceUsed})`);
      }
    }
  }

  for (const song of parsed.recentSongs) {
    const { data: existing } = await supabase
      .from('scraped_songs').select('id')
      .eq('station_id', station.id)
      .ilike('title', song.title).ilike('artist', song.artist)
      .gte('scraped_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .limit(1);
    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_id: station.id, station_name: station.name,
        title: song.title, artist: song.artist,
        is_now_playing: false, source: orbUrl,
      });
      if (!insertError) songsInserted++;
    }
  }

  return { station: station.name, success: true, songs: songsInserted, source: sourceUsed };
}

async function processSpecialMonitoring(
  schedule: SpecialMonitoring,
  supabase: any
): Promise<{ station: string; success: boolean; songs: number; error?: string }> {
  const orbUrl = getOnlineRadioBoxUrl(schedule.scrape_url, schedule.station_name);
  if (!orbUrl) {
    return { station: `[ESPECIAL] ${schedule.station_name}`, success: false, songs: 0, error: 'No ORB URL' };
  }

  console.log(`[ESPECIAL ${schedule.station_name}] Fetching: ${orbUrl}`);
  const html = await fetchPageHtml(orbUrl, schedule.station_name);

  if (!html || (!html.includes('track_history_item') && !html.includes('tablelist-schedule'))) {
    return { station: `[ESPECIAL] ${schedule.station_name}`, success: false, songs: 0, error: 'Failed to fetch' };
  }

  const parsed = parseOnlineRadioBoxHtml(html, schedule.station_name);
  let songsInserted = 0;

  if (parsed.nowPlaying) {
    const { data: existing } = await supabase
      .from('scraped_songs').select('id')
      .eq('station_name', schedule.station_name)
      .ilike('title', parsed.nowPlaying.title).ilike('artist', parsed.nowPlaying.artist)
      .gte('scraped_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1);
    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_name: schedule.station_name,
        title: parsed.nowPlaying.title, artist: parsed.nowPlaying.artist,
        is_now_playing: true, source: orbUrl,
      });
      if (!insertError) {
        songsInserted++;
        console.log(`[ESPECIAL ${schedule.station_name}] ✅ Inserted: ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title}`);
      }
    }
  }

  return { station: `[ESPECIAL] ${schedule.station_name}`, success: true, songs: songsInserted };
}

// ===== Main Handler =====

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('=== AUTO-SCRAPE STATIONS STARTED (OnlineRadioBox) ===');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: stations, error: stationsError } = await supabase
      .from('radio_stations').select('*').eq('enabled', true);

    if (stationsError) {
      return new Response(
        JSON.stringify({ success: false, error: stationsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${stations?.length || 0} enabled stations`);

    const results: any[] = [];
    const now = new Date();
    const stationList = (stations || []) as RadioStation[];

    for (let i = 0; i < stationList.length; i += BATCH_SIZE) {
      const batch = stationList.slice(i, i + BATCH_SIZE);
      console.log(`\n--- Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.map(s => s.name).join(', ')}) ---`);
      const batchResults = await Promise.all(
        batch.map(station => processStation(station, supabase, now))
      );
      results.push(...batchResults);
      if (i + BATCH_SIZE < stationList.length) await new Promise(r => setTimeout(r, 200));
    }

    // Special monitoring
    console.log('\n=== Processing Special Monitoring ===');
    const { data: specialMonitoring } = await supabase
      .from('special_monitoring').select('*').eq('enabled', true);

    if (specialMonitoring && specialMonitoring.length > 0) {
      const activeSchedules = (specialMonitoring as SpecialMonitoring[]).filter(s => isWithinSchedule(s, now));
      if (activeSchedules.length > 0) {
        console.log(`Active special schedules: ${activeSchedules.map(s => s.station_name).join(', ')}`);
        const specialResults = await Promise.all(
          activeSchedules.map(s => processSpecialMonitoring(s, supabase))
        );
        results.push(...specialResults);
      } else {
        console.log('No active special monitoring schedules');
      }
    }

    const successCount = results.filter(r => r.success && !r.skipped).length;
    const failedCount = results.filter(r => !r.success).length;
    const totalSongs = results.reduce((sum, r) => sum + (r.songs || 0), 0);
    const elapsed = Date.now() - startTime;

    console.log(`\n=== COMPLETED in ${elapsed}ms ===`);
    console.log(`Success: ${successCount}, Failed: ${failedCount}, Songs: ${totalSongs}`);

    return new Response(
      JSON.stringify({ success: true, results, totalSongs, elapsed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Auto-scrape error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
