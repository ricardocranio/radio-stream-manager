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
  const dayMap: Record<number, string> = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab' };
  if (station.monitoring_week_days?.length > 0 && !station.monitoring_week_days.includes(dayMap[currentDay])) return false;
  const currentMins = adjustedHour * 60 + currentMinute;
  const startMins = station.monitoring_start_hour * 60 + station.monitoring_start_minute;
  const endMins = station.monitoring_end_hour * 60 + station.monitoring_end_minute;
  return currentMins >= startMins && currentMins <= endMins;
}

const BATCH_SIZE = 4;

// ===== Direct HTTP Scraping (no Firecrawl) =====

function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/\.(jpg|jpeg|png|gif|webp|svg|ico)[^\s]*/gi, '')
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/\s+/g, ' ').trim();
}

function isValidSongPart(text: string): boolean {
  if (!text || text.length < 2 || text.length > 100) return false;
  const alphaCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  if (alphaCount < text.length * 0.3) return false;
  if (text.match(/https?:|www\.|\.com|\.jpg|\.png|\.gif|\.webp|\.svg|\/\/|mzstatic|image\/|thumb\/|rgb\.|!\[|\]\(/i)) return false;
  if (text.match(/\.[a-f0-9]{6,}$/i)) return false;
  const rejectPatterns = [
    /^(tocando agora|now playing|recently|últimas|recentes)/i,
    /^\d+\s*(min|hour|hora|segundo)/i, /^(min ago|hour ago)/i, /^[\d:]+$/,
    /^v4\/|^Music\d+|^24UMGIM/i, /^programas?\s+(em\s+)?destaque/i,
    /^radio|^fm\s*\d|^\d+\.\d+\s*fm/i, /^-\s*[A-Za-z]/,
    /klassik|schweiz|globo.*fm/i,
  ];
  return !rejectPatterns.some(p => p.test(text));
}

function extractSongFromHtml(html: string): { title: string; artist: string } | null {
  const titleMatch = html.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</i) || html.match(/<b>([^<]+)<\/b>/i);
  const artistMatch = html.match(/class="[^"]*artist[^"]*"[^>]*>([^<]+)</i) || html.match(/<span[^>]*>([^<]+)<\/span>/i);
  if (titleMatch && artistMatch) {
    const title = cleanText(titleMatch[1]);
    const artist = cleanText(artistMatch[1]);
    if (isValidSongPart(title) && isValidSongPart(artist)) return { title, artist };
  }
  const altMatch = html.match(/alt="([^"]+)"/i);
  if (altMatch) {
    const dashParts = altMatch[1].match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (dashParts) {
      const artist = cleanText(dashParts[1]);
      const title = cleanText(dashParts[2]);
      if (isValidSongPart(title) && isValidSongPart(artist)) return { title, artist };
    }
  }
  return null;
}

async function fetchPageHtml(url: string, stationName: string): Promise<string | null> {
  const urlsToTry = [url];
  if (url.includes('/pt/')) urlsToTry.push(url.replace('/pt/', '/'));
  else urlsToTry.push(url.replace('mytuner-radio.com/', 'mytuner-radio.com/pt/'));

  for (const currentUrl of urlsToTry) {
    try {
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
      if (!response.ok) { console.warn(`[${stationName}] HTTP ${response.status}`); continue; }
      const html = await response.text();
      if (html.length > 500) return html;
    } catch (e) {
      console.error(`[${stationName}] Fetch error:`, e instanceof Error ? e.message : 'Unknown');
    }
  }
  return null;
}

function parseHtmlForSongs(html: string, stationName: string): { nowPlaying?: ScrapedSong; recentSongs: ScrapedSong[] } {
  const songs: ScrapedSong[] = [];
  let nowPlaying: ScrapedSong | undefined;

  // Method 1: latest-song div
  const latestSongMatch = html.match(/<div[^>]*class="[^"]*latest-song[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (latestSongMatch) {
    const extracted = extractSongFromHtml(latestSongMatch[1]);
    if (extracted) {
      nowPlaying = { ...extracted, timestamp: new Date().toISOString() };
      console.log(`[${stationName}] Now playing: ${extracted.artist} - ${extracted.title}`);
    }
  }

  // Method 2: og:title meta tag
  if (!nowPlaying) {
    const ogMatch = html.match(/property="og:title"[^>]*content="([^"]+)"/i) ||
                    html.match(/content="([^"]+)"[^>]*property="og:title"/i);
    if (ogMatch) {
      const ogText = ogMatch[1].split('|')[0].trim();
      const dashParts = ogText.match(/^(.+?)\s*[-–]\s*(.+)$/);
      if (dashParts) {
        const artist = cleanText(dashParts[1]);
        const title = cleanText(dashParts[2]);
        if (isValidSongPart(title) && isValidSongPart(artist)) {
          nowPlaying = { title, artist, timestamp: new Date().toISOString() };
          console.log(`[${stationName}] Now playing (og): ${artist} - ${title}`);
        }
      }
    }
  }

  // Method 3: all alt text with "Artist - Title" pattern
  const allAltTexts = html.matchAll(/alt="([^"]{5,80})"/gi);
  for (const match of allAltTexts) {
    const dashParts = match[1].match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (dashParts) {
      const artist = cleanText(dashParts[1]);
      const title = cleanText(dashParts[2]);
      if (isValidSongPart(title) && isValidSongPart(artist) &&
          !songs.some(s => s.title.toLowerCase() === title.toLowerCase() && s.artist.toLowerCase() === artist.toLowerCase()) &&
          (!nowPlaying || nowPlaying.title.toLowerCase() !== title.toLowerCase() || nowPlaying.artist.toLowerCase() !== artist.toLowerCase())) {
        if (!nowPlaying) {
          nowPlaying = { title, artist, timestamp: new Date().toISOString() };
          console.log(`[${stationName}] Now playing (alt): ${artist} - ${title}`);
        } else {
          songs.push({ title, artist, timestamp: new Date().toISOString() });
        }
        if (songs.length >= 5) break;
      }
    }
  }

  // Method 4: song-history section
  const historySection = html.match(/id="song-history"[^>]*>([\s\S]*?)(?:<\/section>|<section|<footer)/i);
  if (historySection) {
    const songDivs = historySection[1].match(/<div[^>]*class="[^"]*song[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
    for (const div of songDivs.slice(0, 5)) {
      const extracted = extractSongFromHtml(div);
      if (extracted &&
          !songs.some(s => s.title.toLowerCase() === extracted.title.toLowerCase()) &&
          (!nowPlaying || nowPlaying.title.toLowerCase() !== extracted.title.toLowerCase())) {
        songs.push({ ...extracted, timestamp: new Date().toISOString() });
      }
    }
  }

  return { nowPlaying, recentSongs: songs.slice(0, 5) };
}

// ===== Station Processing =====

async function processStation(
  station: RadioStation,
  supabase: any,
  now: Date
): Promise<{ station: string; success: boolean; songs: number; error?: string; skipped?: boolean }> {
  if (!isStationActiveNow(station, now)) {
    return { station: station.name, success: true, songs: 0, skipped: true };
  }

  console.log(`[${station.name}] Scraping...`);
  const html = await fetchPageHtml(station.scrape_url, station.name);

  if (!html) {
    console.error(`[${station.name}] Failed to fetch page`);
    return { station: station.name, success: false, songs: 0, error: 'Failed to fetch' };
  }

  const parsed = parseHtmlForSongs(html, station.name);
  let songsInserted = 0;

  if (parsed.nowPlaying) {
    const { data: existing } = await supabase
      .from('scraped_songs').select('id')
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
        console.log(`[${station.name}] ✅ Inserted: ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title}`);
      }
    } else {
      console.log(`[${station.name}] Already exists, skipping`);
    }
  }

  for (const song of parsed.recentSongs) {
    const { data: existing } = await supabase
      .from('scraped_songs').select('id')
      .eq('station_id', station.id)
      .eq('title', song.title).eq('artist', song.artist)
      .gte('scraped_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .limit(1);
    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_id: station.id, station_name: station.name,
        title: song.title, artist: song.artist,
        is_now_playing: false, source: station.scrape_url,
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
  console.log(`[ESPECIAL ${schedule.station_name}] Scraping...`);
  const html = await fetchPageHtml(schedule.scrape_url, schedule.station_name);

  if (!html) {
    return { station: `[ESPECIAL] ${schedule.station_name}`, success: false, songs: 0, error: 'Failed to fetch' };
  }

  const parsed = parseHtmlForSongs(html, schedule.station_name);
  let songsInserted = 0;

  if (parsed.nowPlaying) {
    const { data: existing } = await supabase
      .from('scraped_songs').select('id')
      .eq('station_name', schedule.station_name)
      .eq('title', parsed.nowPlaying.title).eq('artist', parsed.nowPlaying.artist)
      .gte('scraped_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1);
    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_name: schedule.station_name,
        title: parsed.nowPlaying.title, artist: parsed.nowPlaying.artist,
        is_now_playing: true, source: schedule.scrape_url,
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
  console.log('=== AUTO-SCRAPE STATIONS STARTED (Direct HTTP) ===');

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
