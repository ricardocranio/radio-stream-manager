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

  const dayMap: Record<number, string> = {
    0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab',
  };

  if (schedule.week_days && schedule.week_days.length > 0) {
    if (!schedule.week_days.includes(dayMap[currentDay])) return false;
  }

  const currentMins = adjustedHour * 60 + currentMinute;
  const startMins = schedule.start_hour * 60 + schedule.start_minute;
  const endMins = schedule.end_hour * 60 + schedule.end_minute;

  return currentMins >= startMins && currentMins <= endMins;
}

function isStationActiveNow(station: RadioStation, now: Date): boolean {
  if (station.monitoring_start_hour === null || station.monitoring_end_hour === null) return true;

  const currentHour = now.getUTCHours() - 3;
  const adjustedHour = currentHour < 0 ? currentHour + 24 : currentHour;
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay();

  const dayMap: Record<number, string> = {
    0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab',
  };

  if (station.monitoring_week_days && station.monitoring_week_days.length > 0) {
    if (!station.monitoring_week_days.includes(dayMap[currentDay])) return false;
  }

  const currentMins = adjustedHour * 60 + currentMinute;
  const startMins = station.monitoring_start_hour * 60 + station.monitoring_start_minute;
  const endMins = station.monitoring_end_hour * 60 + station.monitoring_end_minute;

  return currentMins >= startMins && currentMins <= endMins;
}

const BATCH_SIZE = 4;

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

function cleanText(text: string): string {
  if (!text) return '';
  return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim();
}

function isValidSongPart(text: string): boolean {
  if (!text || text.length < 2 || text.length > 150) return false;
  const alphaCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  if (alphaCount < text.length * 0.3) return false;
  return true;
}

function extractSongFromEntry(entry: string): { title: string; artist: string } | null {
  const songNameMatch = entry.match(/<span[^>]*class="song-name"[^>]*>[\s\S]*?<p>([^<]+)<\/p>/i);
  const artistNameMatch = entry.match(/<span[^>]*class="artist-name"[^>]*>([^<]+)<\/span>/i);
  if (songNameMatch && artistNameMatch) {
    const title = cleanText(songNameMatch[1]);
    const artist = cleanText(artistNameMatch[1]);
    if (isValidSongPart(title) && isValidSongPart(artist)) return { title, artist };
  }
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

function parseMyTunerHtml(html: string, stationName: string): { nowPlaying?: ScrapedSong; recentSongs: ScrapedSong[] } {
  let nowPlaying: ScrapedSong | undefined;
  const recentSongs: ScrapedSong[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

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

// Fetch HTML directly — fast, free, no API key needed!
async function fetchRadioHtml(url: string, timeout = 12000): Promise<{ success: boolean; html?: string; error?: string }> {
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

async function processStation(
  station: RadioStation,
  supabase: any,
  now: Date
): Promise<{ station: string; success: boolean; songs: number; error?: string; skipped?: boolean }> {
  if (!isStationActiveNow(station, now)) {
    return { station: station.name, success: true, songs: 0, skipped: true };
  }

  console.log(`[${station.name}] Fetching...`);

  let fetchResult = await fetchRadioHtml(station.scrape_url);

  // Fallback: try without /pt/
  if (!fetchResult.success && station.scrape_url.includes('/pt/')) {
    const altUrl = station.scrape_url.replace('/pt/', '/');
    console.log(`[${station.name}] Retrying without /pt/`);
    fetchResult = await fetchRadioHtml(altUrl);
  }

  if (!fetchResult.success || !fetchResult.html) {
    console.error(`[${station.name}] Failed: ${fetchResult.error}`);
    return { station: station.name, success: false, songs: 0, error: fetchResult.error };
  }

  const parsed = parseMyTunerHtml(fetchResult.html, station.name);
  let songsInserted = 0;

  if (parsed.nowPlaying) {
    const { data: existing } = await supabase
      .from('scraped_songs')
      .select('id')
      .eq('station_id', station.id)
      .eq('title', parsed.nowPlaying.title)
      .eq('artist', parsed.nowPlaying.artist)
      .gte('scraped_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1);

    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_id: station.id,
        station_name: station.name,
        title: parsed.nowPlaying.title,
        artist: parsed.nowPlaying.artist,
        is_now_playing: true,
        source: station.scrape_url,
      });

      if (!insertError) {
        songsInserted++;
        console.log(`[${station.name}] ✓ ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title}`);
      }
    } else {
      console.log(`[${station.name}] Already exists, skipping`);
    }
  } else {
    console.warn(`[${station.name}] No song data found`);
  }

  for (const song of parsed.recentSongs) {
    const { data: existing } = await supabase
      .from('scraped_songs')
      .select('id')
      .eq('station_id', station.id)
      .eq('title', song.title)
      .eq('artist', song.artist)
      .gte('scraped_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .limit(1);

    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_id: station.id,
        station_name: station.name,
        title: song.title,
        artist: song.artist,
        is_now_playing: false,
        source: station.scrape_url,
      });

      if (!insertError) songsInserted++;
    }
  }

  return { station: station.name, success: true, songs: songsInserted };
}

async function processSpecialMonitoring(
  schedule: SpecialMonitoring,
  supabase: any
): Promise<{ station: string; success: boolean; songs: number; error?: string }> {
  console.log(`[ESPECIAL ${schedule.station_name}] Fetching...`);

  let fetchResult = await fetchRadioHtml(schedule.scrape_url);

  if (!fetchResult.success && schedule.scrape_url.includes('/pt/')) {
    const altUrl = schedule.scrape_url.replace('/pt/', '/');
    fetchResult = await fetchRadioHtml(altUrl);
  }

  if (!fetchResult.success || !fetchResult.html) {
    return { station: `[ESPECIAL] ${schedule.station_name}`, success: false, songs: 0, error: fetchResult.error };
  }

  const parsed = parseMyTunerHtml(fetchResult.html, schedule.station_name);
  let songsInserted = 0;

  if (parsed.nowPlaying) {
    const { data: existing } = await supabase
      .from('scraped_songs')
      .select('id')
      .eq('station_name', schedule.station_name)
      .eq('title', parsed.nowPlaying.title)
      .eq('artist', parsed.nowPlaying.artist)
      .gte('scraped_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1);

    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_name: schedule.station_name,
        title: parsed.nowPlaying.title,
        artist: parsed.nowPlaying.artist,
        is_now_playing: true,
        source: schedule.scrape_url,
      });

      if (!insertError) {
        songsInserted++;
        console.log(`[ESPECIAL ${schedule.station_name}] ✓ ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title}`);
      }
    }
  }

  return { station: `[ESPECIAL] ${schedule.station_name}`, success: true, songs: songsInserted };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('=== AUTO-SCRAPE STATIONS STARTED (Direct Fetch - No Firecrawl) ===');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all enabled stations
    const { data: stations, error: stationsError } = await supabase
      .from('radio_stations')
      .select('*')
      .eq('enabled', true);

    if (stationsError) {
      return new Response(
        JSON.stringify({ success: false, error: stationsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${stations?.length || 0} enabled stations`);

    const results: { station: string; success: boolean; songs: number; error?: string; skipped?: boolean }[] = [];
    const now = new Date();

    const stationList = (stations || []) as RadioStation[];

    for (let i = 0; i < stationList.length; i += BATCH_SIZE) {
      const batch = stationList.slice(i, i + BATCH_SIZE);
      console.log(`\n--- Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.map(s => s.name).join(', ')}) ---`);

      const batchResults = await Promise.all(
        batch.map(station => processStation(station, supabase, now))
      );

      results.push(...batchResults);

      if (i + BATCH_SIZE < stationList.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // === SPECIAL MONITORING ===
    console.log('\n=== Processing Special Monitoring ===');

    const { data: specialMonitoring } = await supabase
      .from('special_monitoring')
      .select('*')
      .eq('enabled', true);

    if (specialMonitoring && specialMonitoring.length > 0) {
      const activeSchedules = (specialMonitoring as SpecialMonitoring[]).filter(s => isWithinSchedule(s, now));

      if (activeSchedules.length > 0) {
        console.log(`${activeSchedules.length} active special monitoring schedules`);

        for (let i = 0; i < activeSchedules.length; i += BATCH_SIZE) {
          const batch = activeSchedules.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(schedule => processSpecialMonitoring(schedule, supabase))
          );
          results.push(...batchResults);
        }
      } else {
        console.log('No active special monitoring schedules');
      }
    }

    const successCount = results.filter(r => r.success && !r.skipped).length;
    const failedCount = results.filter(r => !r.success).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const totalSongs = results.reduce((sum, r) => sum + r.songs, 0);
    const elapsed = Date.now() - startTime;

    console.log(`\n=== COMPLETED in ${elapsed}ms ===`);
    console.log(`Success: ${successCount}, Failed: ${failedCount}, Skipped: ${skippedCount}, Songs: ${totalSongs}`);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        summary: { success: successCount, failed: failedCount, skipped: skippedCount, totalSongs, elapsed },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Fatal error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
