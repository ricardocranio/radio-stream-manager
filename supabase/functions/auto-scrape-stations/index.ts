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
  const currentHour = now.getUTCHours() - 3; // Convert to BRT (UTC-3)
  const adjustedHour = currentHour < 0 ? currentHour + 24 : currentHour;
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay(); // 0 = Sunday

  // Map day of week
  const dayMap: Record<number, string> = {
    0: 'dom',
    1: 'seg',
    2: 'ter',
    3: 'qua',
    4: 'qui',
    5: 'sex',
    6: 'sab',
  };

  // Check if current day is in weekDays
  if (schedule.week_days && schedule.week_days.length > 0) {
    if (!schedule.week_days.includes(dayMap[currentDay])) {
      return false;
    }
  }

  // Convert to minutes for easier comparison
  const currentMins = adjustedHour * 60 + currentMinute;
  const startMins = schedule.start_hour * 60 + schedule.start_minute;
  const endMins = schedule.end_hour * 60 + schedule.end_minute;

  return currentMins >= startMins && currentMins <= endMins;
}

// Helper to check if station should be monitored now (based on its schedule)
function isStationActiveNow(station: RadioStation, now: Date): boolean {
  // If no schedule configured (start_hour is null), monitor 24/7
  if (station.monitoring_start_hour === null || station.monitoring_end_hour === null) {
    return true;
  }

  const currentHour = now.getUTCHours() - 3; // Convert to BRT (UTC-3)
  const adjustedHour = currentHour < 0 ? currentHour + 24 : currentHour;
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay(); // 0 = Sunday

  // Map day of week
  const dayMap: Record<number, string> = {
    0: 'dom',
    1: 'seg',
    2: 'ter',
    3: 'qua',
    4: 'qui',
    5: 'sex',
    6: 'sab',
  };

  // Check if current day is in weekDays
  if (station.monitoring_week_days && station.monitoring_week_days.length > 0) {
    if (!station.monitoring_week_days.includes(dayMap[currentDay])) {
      console.log(`[${station.name}] Skipping: not active on ${dayMap[currentDay]}`);
      return false;
    }
  }

  // Convert to minutes for easier comparison
  const currentMins = adjustedHour * 60 + currentMinute;
  const startMins = station.monitoring_start_hour * 60 + station.monitoring_start_minute;
  const endMins = station.monitoring_end_hour * 60 + station.monitoring_end_minute;

  const isActive = currentMins >= startMins && currentMins <= endMins;
  
  if (!isActive) {
    console.log(`[${station.name}] Skipping: outside schedule (${station.monitoring_start_hour}:${station.monitoring_start_minute}-${station.monitoring_end_hour}:${station.monitoring_end_minute})`);
  }

  return isActive;
}

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,  // Increased from 2
  retryDelay: 2000, // Increased from 1000
  timeout: 60000,   // Increased from 45000
};

// Known fallback URLs for problematic stations
const STATION_FALLBACK_URLS: Record<string, string[]> = {
  'Band FM': [
    'https://mytuner-radio.com/pt/radio/band-fm-413397/',
    'https://mytuner-radio.com/radio/band-fm-413397/',
    'https://mytuner-radio.com/radio/band-fm/',
  ],
  'BH FM': [
    'https://mytuner-radio.com/pt/radio/radio-bh-fm-402270/',
    'https://mytuner-radio.com/radio/radio-bh-fm-402270/',
    'https://mytuner-radio.com/radio/bh-fm/',
  ],
  'Clube FM': [
    'https://mytuner-radio.com/pt/radio/radio-clube-fm-brasilia-1055-406812/',
    'https://mytuner-radio.com/radio/radio-clube-fm-brasilia-1055-406812/',
    'https://mytuner-radio.com/radio/clube-fm/',
  ],
};

async function scrapeWithFirecrawl(
  apiKey: string,
  url: string,
  stationName?: string
): Promise<{ success: boolean; data?: any; error?: string; usedUrl?: string }> {
  // Build list of URLs to try: primary URL first, then fallbacks
  const urlsToTry: string[] = [url];
  
  // Add station-specific fallback URLs
  if (stationName && STATION_FALLBACK_URLS[stationName]) {
    for (const fallbackUrl of STATION_FALLBACK_URLS[stationName]) {
      if (fallbackUrl !== url && !urlsToTry.includes(fallbackUrl)) {
        urlsToTry.push(fallbackUrl);
      }
    }
  }
  
  // Also add generic URL variations
  if (url.includes('/pt/')) {
    const withoutPt = url.replace('/pt/', '/');
    if (!urlsToTry.includes(withoutPt)) urlsToTry.push(withoutPt);
  }

  for (const currentUrl of urlsToTry) {
    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        console.log(`[Attempt ${attempt}/${RETRY_CONFIG.maxRetries}] Scraping: ${currentUrl}`);
        
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
            // Increase wait times to allow JavaScript to fully load
            waitFor: 12000, // Wait 12 seconds for initial page load
            actions: [
              { type: 'wait', milliseconds: 8000 }, // Wait 8s for dynamic content
              { type: 'scroll', direction: 'down', amount: 500 }, // Scroll to trigger lazy loading
              { type: 'wait', milliseconds: 4000 }, // Wait 4s after scroll
            ],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const data = await response.json();

        if (response.ok && data.success !== false) {
          return { success: true, data, usedUrl: currentUrl };
        }

        console.warn(`[Attempt ${attempt}] API returned error:`, data.error || 'Unknown error');
        
        if (attempt < RETRY_CONFIG.maxRetries) {
          const delay = RETRY_CONFIG.retryDelay * attempt;
          console.log(`[Waiting ${delay}ms before retry...]`);
          await new Promise(r => setTimeout(r, delay));
        }
      } catch (error) {
        console.error(`[Attempt ${attempt}] Request failed:`, error instanceof Error ? error.message : 'Unknown');
        
        if (attempt < RETRY_CONFIG.maxRetries) {
          const delay = RETRY_CONFIG.retryDelay * attempt;
          console.log(`[Waiting ${delay}ms before retry...]`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    
    // If primary URL failed all retries, try next fallback URL
    if (urlsToTry.indexOf(currentUrl) < urlsToTry.length - 1) {
      console.log(`[Fallback] Trying next URL in list...`);
    }
  }

  return { success: false, error: `All ${urlsToTry.length} URLs and retry attempts failed` };
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
    // Remove time indicators like "6 min ago", "3 min ago", "LIVE", "1 hour ago"
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

function extractSongFromHtml(html: string): { title: string; artist: string } | null {
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
  
  const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const dashMatch = textContent.match(/([^-–]+)\s*[-–]\s*([^-–]+)/);
  if (dashMatch) {
    const part1 = cleanText(dashMatch[1]);
    const part2 = cleanText(dashMatch[2]);
    if (isValidSongPart(part1) && isValidSongPart(part2)) {
      return { title: part1, artist: part2 };
    }
  }
  
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

function parseRadioContent(data: any, stationName: string, url: string): { nowPlaying?: ScrapedSong; recentSongs: ScrapedSong[] } {
  const markdown = data.data?.markdown || '';
  const html = data.data?.html || '';
  
  const songs: ScrapedSong[] = [];
  let nowPlaying: ScrapedSong | undefined;

  console.log(`[${stationName}] Parsing content, HTML length: ${html.length}, Markdown length: ${markdown.length}`);
  
  // MyTuner Radio specific pattern: "Tocando agora:" followed by song info
  // Format: [![Artist - Title](image_url)]\n\nTitle
  
  // Pattern 1: Look for "Tocando agora:" section with image and song info
  const tocandoSection = markdown.match(/Tocando agora:?\s*\n+([\s\S]*?)(?=As últimas tocadas|Últimas tocadas|Recently|Playlist|\n\n\n)/i);
  
  if (tocandoSection) {
    const section = tocandoSection[1];
    console.log(`[${stationName}] Found tocando section:`, section.substring(0, 300));
    
    // Pattern: [![Artist - Title](image)] followed by \n\nTitle or just extract from the alt text
    const altTextMatch = section.match(/\[!\[([^\]]+)\]/);
    if (altTextMatch) {
      const altText = altTextMatch[1];
      console.log(`[${stationName}] Alt text found: ${altText}`);
      
      // Alt text format: "Artist - Title" or "Title - Artist"
      const dashMatch = altText.match(/^([^-–]+?)\s*[-–]\s*(.+)$/);
      if (dashMatch) {
        let part1 = cleanText(dashMatch[1]);
        let part2 = cleanText(dashMatch[2]);
        
        if (isValidSongPart(part1) && isValidSongPart(part2)) {
          // Usually format is "Artist - Title"
          nowPlaying = { title: part2, artist: part1, timestamp: new Date().toISOString() };
          console.log(`[${stationName}] Now playing from alt text: ${part1} - ${part2}`);
        }
      }
    }
    
    // Fallback: look for bold text or standalone lines after the image
    if (!nowPlaying) {
      const afterImage = section.replace(/\[!\[.*?\]\([^)]+\)\s*\\?\s*\\?\s*/g, '').trim();
      const lines = afterImage.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 2 && !l.startsWith('[') && !l.startsWith('!'));
      
      if (lines.length >= 2) {
        const title = cleanText(lines[0]);
        const artist = cleanText(lines[1]);
        if (isValidSongPart(title) && isValidSongPart(artist)) {
          nowPlaying = { title, artist, timestamp: new Date().toISOString() };
          console.log(`[${stationName}] Now playing from lines: ${artist} - ${title}`);
        }
      }
    }
  }
  
  // Pattern 2: Direct "Tocando agora" with **bold** format
  if (!nowPlaying) {
    const boldPattern = markdown.match(/Tocando agora[:\s]*\n+(?:.*\n)*?\*\*([^*\n]+)\*\*\s*\n+([^\n*]+)/im);
    if (boldPattern) {
      const title = cleanText(boldPattern[1]);
      const artist = cleanText(boldPattern[2]);
      if (isValidSongPart(title) && isValidSongPart(artist)) {
        nowPlaying = { title, artist, timestamp: new Date().toISOString() };
        console.log(`[${stationName}] Found now playing (bold pattern): ${artist} - ${title}`);
      }
    }
  }
  
  // Look for "As últimas tocadas" / song history section
  const historyMatch = markdown.match(/(?:As últimas tocadas|Últimas tocadas|Recently Played)[:\s]*\n+([\s\S]*?)(?=\n\n\n|\n##|Programas|$)/im);
  if (historyMatch) {
    const historySection = historyMatch[1];
    console.log(`[${stationName}] Found history section, length: ${historySection.length}`);
    
    // Pattern for MyTuner: [![Artist - Title](image)] blocks
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
    
    // Fallback: **Title** \n Artist pattern
    if (songs.length < 3) {
      const songMatches = historySection.matchAll(/\*\*([^*\n]+)\*\*\s*\n+([^\n*\[]+)/g);
      for (const match of songMatches) {
        const title = cleanText(match[1]);
        const artist = cleanText(match[2]);
        if (isValidSongPart(title) && isValidSongPart(artist) && 
            !songs.some(s => s.title === title && s.artist === artist)) {
          songs.push({ title, artist, timestamp: new Date().toISOString() });
        }
      }
    }
  }

  // HTML fallback for now playing
  if (!nowPlaying && html) {
    // Look for latest-song or now-playing class
    const latestSongMatch = html.match(/<div[^>]*class="[^"]*(?:latest-song|now-playing|current-song)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (latestSongMatch) {
      const extracted = extractSongFromHtml(latestSongMatch[1]);
      if (extracted) {
        nowPlaying = {
          title: extracted.title,
          artist: extracted.artist,
          timestamp: new Date().toISOString(),
        };
        console.log(`[${stationName}] Now playing from HTML: ${nowPlaying.artist} - ${nowPlaying.title}`);
      }
    }
  }
  
  // If no songs in history but we have now playing, that's fine
  if (!nowPlaying && songs.length > 0) {
    nowPlaying = songs.shift();
  }

  console.log(`[${stationName}] Parsed: nowPlaying=${nowPlaying ? `${nowPlaying.artist} - ${nowPlaying.title}` : 'no'}, songs=${songs.length}`);
  
  return { nowPlaying, recentSongs: songs.slice(0, 5) };
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
      console.error('FIRECRAWL_API_KEY not configured');
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
      console.error('Error fetching stations:', stationsError);
      return new Response(
        JSON.stringify({ success: false, error: stationsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${stations?.length || 0} enabled stations to scrape`);

    const results: { station: string; success: boolean; songs: number; error?: string; skipped?: boolean }[] = [];
    const now = new Date();
    
    // Process stations sequentially to avoid rate limits
    for (const station of (stations || []) as RadioStation[]) {
      console.log(`\n--- Processing ${station.name} ---`);
      
      // Check if station should be monitored at current time
      if (!isStationActiveNow(station, now)) {
        results.push({ station: station.name, success: true, songs: 0, skipped: true });
        continue;
      }
      
      console.log(`[${station.name}] Scraping...`);
      const scrapeResult = await scrapeWithFirecrawl(firecrawlApiKey, station.scrape_url, station.name);
      
      if (!scrapeResult.success || !scrapeResult.data) {
        console.error(`[${station.name}] Scrape failed: ${scrapeResult.error}`);
        results.push({ station: station.name, success: false, songs: 0, error: scrapeResult.error });
        results.push({ station: station.name, success: false, songs: 0, error: scrapeResult.error });
        continue;
      }

      const parsed = parseRadioContent(scrapeResult.data, station.name, station.scrape_url);
      let songsInserted = 0;

      // Insert now playing
      if (parsed.nowPlaying) {
        // Check if this song was already scraped recently (within last 10 minutes)
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

          if (insertError) {
            console.error(`[${station.name}] Insert error:`, insertError);
          } else {
            songsInserted++;
            console.log(`[${station.name}] Inserted now playing: ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title}`);
          }
        } else {
          console.log(`[${station.name}] Song already exists, skipping`);
        }
      }

      // Insert recent songs
      for (const song of parsed.recentSongs) {
        const { data: existing } = await supabase
          .from('scraped_songs')
          .select('id')
          .eq('station_id', station.id)
          .eq('title', song.title)
          .eq('artist', song.artist)
          .gte('scraped_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // 1 hour
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

      results.push({ station: station.name, success: true, songs: songsInserted });
      
      // Small delay between stations to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    // === SPECIAL MONITORING: Same capture logic ===
    console.log('\n=== Processing Special Monitoring Schedules ===');
    
    const specialNow = new Date();
    
    // Get all enabled special monitoring schedules
    const { data: specialMonitoring, error: specialError } = await supabase
      .from('special_monitoring')
      .select('*')
      .eq('enabled', true);

    if (specialError) {
      console.error('Error fetching special monitoring:', specialError);
    } else {
      console.log(`Found ${specialMonitoring?.length || 0} special monitoring schedules`);
      
      // Filter schedules that are active right now
      const activeSchedules = (specialMonitoring || []).filter((schedule: SpecialMonitoring) => 
        isWithinSchedule(schedule, specialNow)
      );
      
      console.log(`${activeSchedules.length} schedules are active right now`);
      
      // Process each active special monitoring schedule
      for (const schedule of activeSchedules as SpecialMonitoring[]) {
        console.log(`\n--- Special Monitoring: ${schedule.station_name} (${schedule.label || 'No label'}) ---`);
        console.log(`Time window: ${schedule.start_hour}:${schedule.start_minute.toString().padStart(2, '0')} - ${schedule.end_hour}:${schedule.end_minute.toString().padStart(2, '0')}`);
        
        const scrapeResult = await scrapeWithFirecrawl(firecrawlApiKey, schedule.scrape_url, schedule.station_name);
        
        if (!scrapeResult.success || !scrapeResult.data) {
          console.error(`[${schedule.station_name}] Scrape failed: ${scrapeResult.error}`);
          results.push({ station: `[ESPECIAL] ${schedule.station_name}`, success: false, songs: 0, error: scrapeResult.error });
          continue;
        }

        const parsed = parseRadioContent(scrapeResult.data, schedule.station_name, schedule.scrape_url);
        let songsInserted = 0;

        // Insert now playing
        if (parsed.nowPlaying) {
          // Check if this song was already scraped recently (within last 10 minutes)
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

            if (insertError) {
              console.error(`[${schedule.station_name}] Insert error:`, insertError);
            } else {
              songsInserted++;
              console.log(`[${schedule.station_name}] Inserted now playing: ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title}`);
            }
          } else {
            console.log(`[${schedule.station_name}] Song already exists, skipping`);
          }
        }

        // Insert recent songs
        for (const song of parsed.recentSongs) {
          const { data: existing } = await supabase
            .from('scraped_songs')
            .select('id')
            .eq('station_name', schedule.station_name)
            .eq('title', song.title)
            .eq('artist', song.artist)
            .gte('scraped_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // 1 hour
            .limit(1);

          if (!existing || existing.length === 0) {
            const { error: insertError } = await supabase.from('scraped_songs').insert({
              station_name: schedule.station_name,
              title: song.title,
              artist: song.artist,
              is_now_playing: false,
              source: schedule.scrape_url,
            });

            if (!insertError) {
              songsInserted++;
            }
          }
        }

        results.push({ station: `[ESPECIAL] ${schedule.station_name}`, success: true, songs: songsInserted });
        
        // Small delay between stations to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`\n=== AUTO-SCRAPE COMPLETED in ${elapsed}ms ===`);
    console.log('Results:', JSON.stringify(results, null, 2));

    const specialCount = results.filter(r => r.station.startsWith('[ESPECIAL]')).length;
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        totalStations: stations?.length || 0,
        totalSpecialMonitoring: specialCount,
        totalSongs: results.reduce((sum, r) => sum + r.songs, 0),
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
