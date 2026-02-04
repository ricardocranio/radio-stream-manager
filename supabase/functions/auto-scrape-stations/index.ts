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

// Helper to check if current time is within a schedule
function isWithinSchedule(schedule: SpecialMonitoring, now: Date): boolean {
  const currentHour = now.getUTCHours() - 3;
  const adjustedHour = currentHour < 0 ? currentHour + 24 : currentHour;
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay();

  const dayMap: Record<number, string> = {
    0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab',
  };

  if (schedule.week_days && schedule.week_days.length > 0) {
    if (!schedule.week_days.includes(dayMap[currentDay])) {
      return false;
    }
  }

  const currentMins = adjustedHour * 60 + currentMinute;
  const startMins = schedule.start_hour * 60 + schedule.start_minute;
  const endMins = schedule.end_hour * 60 + schedule.end_minute;

  return currentMins >= startMins && currentMins <= endMins;
}

// Helper to check if station should be monitored now
function isStationActiveNow(station: RadioStation, now: Date): boolean {
  if (station.monitoring_start_hour === null || station.monitoring_end_hour === null) {
    return true;
  }

  const currentHour = now.getUTCHours() - 3;
  const adjustedHour = currentHour < 0 ? currentHour + 24 : currentHour;
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay();

  const dayMap: Record<number, string> = {
    0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab',
  };

  if (station.monitoring_week_days && station.monitoring_week_days.length > 0) {
    if (!station.monitoring_week_days.includes(dayMap[currentDay])) {
      return false;
    }
  }

  const currentMins = adjustedHour * 60 + currentMinute;
  const startMins = station.monitoring_start_hour * 60 + station.monitoring_start_minute;
  const endMins = station.monitoring_end_hour * 60 + station.monitoring_end_minute;

  return currentMins >= startMins && currentMins <= endMins;
}

// Retry config - slightly longer for problematic stations
const RETRY_CONFIG = {
  maxRetries: 2,
  retryDelay: 1000,
  timeout: 30000, // 30s per request max
};

// Batch processing config
const BATCH_SIZE = 4; // Process 4 stations in parallel

// Stations that need longer wait times
const SLOW_STATIONS = ['Clube FM', 'BH FM', 'Band FM', '105 FM'];

async function scrapeWithFirecrawl(
  apiKey: string,
  url: string,
  stationName?: string
): Promise<{ success: boolean; data?: any; error?: string; usedUrl?: string }> {
  const urlsToTry: string[] = [url];
  
  // Add URL without /pt/ as fallback
  if (url.includes('/pt/')) {
    urlsToTry.push(url.replace('/pt/', '/'));
  }

  // Determine if this is a slow station that needs more wait time
  const isSlowStation = stationName && SLOW_STATIONS.includes(stationName);
  const waitTime = isSlowStation ? 8000 : 4000;
  const actionWait = isSlowStation ? 5000 : 2000;

  for (const currentUrl of urlsToTry) {
    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        console.log(`[${stationName}] Attempt ${attempt}/${RETRY_CONFIG.maxRetries}: ${currentUrl}${isSlowStation ? ' (slow mode)' : ''}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), RETRY_CONFIG.timeout);

        const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: currentUrl,
            formats: ['markdown', 'html'],
            onlyMainContent: false,
            // Dynamic wait times based on station
            waitFor: waitTime,
            actions: [
              { type: 'wait', milliseconds: actionWait },
              ...(isSlowStation ? [{ type: 'scroll', direction: 'down', amount: 300 }] : []),
            ],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const data = await response.json();

        if (response.ok && data.success !== false) {
          return { success: true, data, usedUrl: currentUrl };
        }

        console.warn(`[${stationName}] API error:`, data.error || 'Unknown');
        
        if (attempt < RETRY_CONFIG.maxRetries) {
          await new Promise(r => setTimeout(r, RETRY_CONFIG.retryDelay));
        }
      } catch (error) {
        console.error(`[${stationName}] Request failed:`, error instanceof Error ? error.message : 'Unknown');
        
        if (attempt < RETRY_CONFIG.maxRetries) {
          await new Promise(r => setTimeout(r, RETRY_CONFIG.retryDelay));
        }
      }
    }
  }

  return { success: false, error: `All attempts failed for ${stationName}` };
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
    .replace(/\d+\s*(min|hour|hora|segundo|sec)\s*(ago)?/gi, '')
    .replace(/LIVE$/i, '')
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

function parseRadioContent(data: any, stationName: string, url: string): { nowPlaying?: ScrapedSong; recentSongs: ScrapedSong[] } {
  const markdown = data.data?.markdown || '';
  const html = data.data?.html || '';
  
  const songs: ScrapedSong[] = [];
  let nowPlaying: ScrapedSong | undefined;

  console.log(`[${stationName}] Parsing: HTML=${html.length}, MD=${markdown.length}`);
  
  // Pattern 1: Tocando agora section
  const tocandoSection = markdown.match(/Tocando agora:?\s*\n+([\s\S]*?)(?=As últimas tocadas|Últimas tocadas|Recently|Playlist|\n\n\n)/i);
  
  if (tocandoSection) {
    const section = tocandoSection[1];
    
    // Extract from alt text: [![Artist - Title](image)]
    const altTextMatch = section.match(/\[!\[([^\]]+)\]/);
    if (altTextMatch) {
      const altText = altTextMatch[1];
      const dashMatch = altText.match(/^([^-–]+?)\s*[-–]\s*(.+)$/);
      if (dashMatch) {
        let part1 = cleanText(dashMatch[1]);
        let part2 = cleanText(dashMatch[2]);
        
        if (isValidSongPart(part1) && isValidSongPart(part2)) {
          nowPlaying = { title: part2, artist: part1, timestamp: new Date().toISOString() };
          console.log(`[${stationName}] Found: ${part1} - ${part2}`);
        }
      }
    }
    
    // Fallback: lines after image
    if (!nowPlaying) {
      const afterImage = section.replace(/\[!\[.*?\]\([^)]+\)\s*\\?\s*\\?\s*/g, '').trim();
      const lines = afterImage.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 2 && !l.startsWith('[') && !l.startsWith('!'));
      
      if (lines.length >= 2) {
        const title = cleanText(lines[0]);
        const artist = cleanText(lines[1]);
        if (isValidSongPart(title) && isValidSongPart(artist)) {
          nowPlaying = { title, artist, timestamp: new Date().toISOString() };
          console.log(`[${stationName}] Found from lines: ${artist} - ${title}`);
        }
      }
    }
  }
  
  // Pattern 2: Bold format
  if (!nowPlaying) {
    const boldPattern = markdown.match(/Tocando agora[:\s]*\n+(?:.*\n)*?\*\*([^*\n]+)\*\*\s*\n+([^\n*]+)/im);
    if (boldPattern) {
      const title = cleanText(boldPattern[1]);
      const artist = cleanText(boldPattern[2]);
      if (isValidSongPart(title) && isValidSongPart(artist)) {
        nowPlaying = { title, artist, timestamp: new Date().toISOString() };
      }
    }
  }
  
  // History section
  const historyMatch = markdown.match(/(?:As últimas tocadas|Últimas tocadas|Recently Played)[:\s]*\n+([\s\S]*?)(?=\n\n\n|\n##|Programas|$)/im);
  if (historyMatch) {
    const historySection = historyMatch[1];
    
    const altMatches = historySection.matchAll(/\[!\[([^\]]+)\]/g);
    for (const match of altMatches) {
      const altText = match[1];
      const dashMatch = altText.match(/^([^-–]+?)\s*[-–]\s*(.+)$/);
      if (dashMatch) {
        const artist = cleanText(dashMatch[1]);
        const title = cleanText(dashMatch[2]);
        if (isValidSongPart(artist) && isValidSongPart(title) && 
            !songs.some(s => s.title === title && s.artist === artist)) {
          songs.push({ title, artist, timestamp: new Date().toISOString() });
        }
      }
    }
  }

  if (!nowPlaying && songs.length > 0) {
    nowPlaying = songs.shift();
  }

  console.log(`[${stationName}] Result: ${nowPlaying ? `${nowPlaying.artist} - ${nowPlaying.title}` : 'no song'}`);
  
  return { nowPlaying, recentSongs: songs.slice(0, 3) };
}

async function processStation(
  station: RadioStation,
  firecrawlApiKey: string,
  supabase: any,
  now: Date
): Promise<{ station: string; success: boolean; songs: number; error?: string; skipped?: boolean }> {
  // Check schedule
  if (!isStationActiveNow(station, now)) {
    return { station: station.name, success: true, songs: 0, skipped: true };
  }
  
  console.log(`[${station.name}] Scraping...`);
  const scrapeResult = await scrapeWithFirecrawl(firecrawlApiKey, station.scrape_url, station.name);
  
  if (!scrapeResult.success || !scrapeResult.data) {
    console.error(`[${station.name}] Failed: ${scrapeResult.error}`);
    return { station: station.name, success: false, songs: 0, error: scrapeResult.error };
  }

  const parsed = parseRadioContent(scrapeResult.data, station.name, station.scrape_url);
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
        console.log(`[${station.name}] Inserted: ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title}`);
      }
    } else {
      console.log(`[${station.name}] Already exists, skipping`);
    }
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

      if (!insertError) {
        songsInserted++;
      }
    }
  }

  return { station: station.name, success: true, songs: songsInserted };
}

async function processSpecialMonitoring(
  schedule: SpecialMonitoring,
  firecrawlApiKey: string,
  supabase: any
): Promise<{ station: string; success: boolean; songs: number; error?: string }> {
  console.log(`[ESPECIAL ${schedule.station_name}] Scraping...`);
  
  const scrapeResult = await scrapeWithFirecrawl(firecrawlApiKey, schedule.scrape_url, schedule.station_name);
  
  if (!scrapeResult.success || !scrapeResult.data) {
    return { station: `[ESPECIAL] ${schedule.station_name}`, success: false, songs: 0, error: scrapeResult.error };
  }

  const parsed = parseRadioContent(scrapeResult.data, schedule.station_name, schedule.scrape_url);
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
        console.log(`[ESPECIAL ${schedule.station_name}] Inserted: ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title}`);
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
  console.log('=== AUTO-SCRAPE STATIONS STARTED ===');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');

    if (!firecrawlApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
    
    // OPTIMIZED: Process stations in parallel batches
    const stationList = (stations || []) as RadioStation[];
    
    for (let i = 0; i < stationList.length; i += BATCH_SIZE) {
      const batch = stationList.slice(i, i + BATCH_SIZE);
      console.log(`\n--- Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.map(s => s.name).join(', ')}) ---`);
      
      const batchResults = await Promise.all(
        batch.map(station => processStation(station, firecrawlApiKey, supabase, now))
      );
      
      results.push(...batchResults);
      
      // Small delay between batches
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
      console.log(`${activeSchedules.length} active special schedules`);
      
      // Process special monitoring in parallel too
      for (let i = 0; i < activeSchedules.length; i += BATCH_SIZE) {
        const batch = activeSchedules.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(schedule => processSpecialMonitoring(schedule, firecrawlApiKey, supabase))
        );
        results.push(...batchResults);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`\n=== COMPLETED in ${elapsed}ms ===`);
    
    const successCount = results.filter(r => r.success && !r.skipped).length;
    const failCount = results.filter(r => !r.success).length;
    const totalSongs = results.reduce((sum, r) => sum + r.songs, 0);
    
    console.log(`Success: ${successCount}, Failed: ${failCount}, Songs: ${totalSongs}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        totalStations: stations?.length || 0,
        totalSongs,
        elapsedMs: elapsed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in auto-scrape:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
