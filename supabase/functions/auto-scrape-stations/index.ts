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
}

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 2,
  retryDelay: 1000,
  timeout: 45000,
};

async function scrapeWithFirecrawl(
  apiKey: string,
  url: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      console.log(`[Attempt ${attempt}/${RETRY_CONFIG.maxRetries}] Scraping: ${url}`);
      
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
          formats: ['markdown', 'html'],
          onlyMainContent: false,
          // Increase wait times to allow JavaScript to fully load
          waitFor: 10000, // Wait 10 seconds for initial page load
          actions: [
            { type: 'wait', milliseconds: 6000 }, // Wait 6s for dynamic content
            { type: 'scroll', direction: 'down', amount: 500 }, // Scroll to trigger lazy loading
            { type: 'wait', milliseconds: 3000 }, // Wait 3s after scroll
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (response.ok && data.success !== false) {
        return { success: true, data };
      }

      console.warn(`[Attempt ${attempt}] API returned error:`, data.error);
      
      if (attempt < RETRY_CONFIG.maxRetries) {
        await new Promise(r => setTimeout(r, RETRY_CONFIG.retryDelay * attempt));
      }
    } catch (error) {
      console.error(`[Attempt ${attempt}] Request failed:`, error);
      
      if (attempt < RETRY_CONFIG.maxRetries) {
        await new Promise(r => setTimeout(r, RETRY_CONFIG.retryDelay * attempt));
      }
    }
  }

  return { success: false, error: 'All retry attempts failed' };
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
  
  // Log first part of markdown for debugging
  if (markdown.length > 0) {
    const tocandoIdx = markdown.toLowerCase().indexOf('tocando agora');
    const ultimasIdx = markdown.toLowerCase().indexOf('últimas tocadas');
    console.log(`[${stationName}] Markdown indexes - tocando: ${tocandoIdx}, ultimas: ${ultimasIdx}`);
    
    if (tocandoIdx > -1) {
      const snippet = markdown.substring(tocandoIdx, Math.min(tocandoIdx + 500, markdown.length));
      console.log(`[${stationName}] Markdown snippet around "tocando agora":`, snippet.substring(0, 200));
    }
  }

  // PRIORITY 1: Parse markdown - usually more reliable with Firecrawl
  // Look for "Tocando agora" section
  const tocandoMatch = markdown.match(/(?:Tocando agora|Now Playing)[:\s]*\n+(?:\!\[.*?\]\([^)]+\)\s*)?([^\n]+)\n+([^\n]+)/im);
  if (tocandoMatch) {
    const title = cleanText(tocandoMatch[1]);
    const artist = cleanText(tocandoMatch[2]);
    if (isValidSongPart(title) && isValidSongPart(artist)) {
      nowPlaying = { title, artist, timestamp: new Date().toISOString() };
      console.log(`[${stationName}] Found now playing from markdown: ${artist} - ${title}`);
    }
  }
  
  // Alternative pattern: **Title** \n Artist
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
  
  // Alternative: look for [ Title Artist ] pattern
  if (!nowPlaying) {
    const bracketPattern = markdown.match(/Tocando agora[:\s\n]+\[([^\]]+)\]\s*\n?\s*([^\n\[]+)/im);
    if (bracketPattern) {
      const title = cleanText(bracketPattern[1]);
      const artist = cleanText(bracketPattern[2]);
      if (isValidSongPart(title) && isValidSongPart(artist)) {
        nowPlaying = { title, artist, timestamp: new Date().toISOString() };
        console.log(`[${stationName}] Found now playing (bracket): ${artist} - ${title}`);
      }
    }
  }
  
  // Look for "As últimas tocadas" / song history section
  const historyMatch = markdown.match(/(?:As últimas tocadas|Recently Played)[:\s]*\n+([\s\S]*?)(?=\n\n\n|\n##|$)/im);
  if (historyMatch) {
    const historySection = historyMatch[1];
    console.log(`[${stationName}] Found history section, length: ${historySection.length}`);
    
    // Pattern 1: **Title** \n Artist
    const songMatches = historySection.matchAll(/\*\*([^*\n]+)\*\*\s*\n+([^\n*\[]+)/g);
    for (const match of songMatches) {
      const title = cleanText(match[1]);
      const artist = cleanText(match[2]);
      if (isValidSongPart(title) && isValidSongPart(artist) && 
          !songs.some(s => s.title === title && s.artist === artist)) {
        songs.push({ title, artist, timestamp: new Date().toISOString() });
      }
    }
    
    // Pattern 2: [Title] Artist or Title - Artist
    if (songs.length < 3) {
      const lineMatches = historySection.matchAll(/\[([^\]]+)\]\s*\n?\s*([^\n\[]+)/g);
      for (const match of lineMatches) {
        const title = cleanText(match[1]);
        const artist = cleanText(match[2]);
        if (isValidSongPart(title) && isValidSongPart(artist) && 
            !songs.some(s => s.title === title && s.artist === artist)) {
          songs.push({ title, artist, timestamp: new Date().toISOString() });
        }
      }
    }
  }

  // PRIORITY 2: HTML parsing as fallback
  if (!nowPlaying && html) {
    // Try to extract now playing from .latest-song
    const latestSongMatch = html.match(/<div[^>]*class="[^"]*latest-song[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
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
  
  if (songs.length < 3 && html) {
    // Extract song history from #song-history
    const historySection = html.match(/id="song-history"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div[^>]*class="(?!song))/i);
    if (historySection) {
      const historyHtml = historySection[1];
      const songEntries = historyHtml.match(/<div[^>]*class="[^"]*song[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
      
      for (const entry of songEntries.slice(0, 10)) {
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
  }

  // Fallback markdown parsing
  if (!nowPlaying && songs.length === 0) {
    console.log(`[${stationName}] Using markdown fallback...`);
    
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
    
    const afterHistory = markdown.match(/As últimas tocadas:?\s*\n+([\s\S]*?)(?:\n\s*\n\s*\n|$)/i);
    if (afterHistory) {
      const section = afterHistory[1];
      const songPatterns = section.match(/\*\*([^*\n]+)\*\*\s*\n+([^\n*]+)/g) || [];
      
      for (const pattern of songPatterns.slice(0, 10)) {
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

  if (!nowPlaying && songs.length > 0) {
    nowPlaying = songs.shift();
  }

  console.log(`[${stationName}] Parsed: nowPlaying=${nowPlaying ? 'yes' : 'no'}, songs=${songs.length}`);
  
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

    const results: { station: string; success: boolean; songs: number; error?: string }[] = [];
    
    // Process stations sequentially to avoid rate limits
    for (const station of (stations || []) as RadioStation[]) {
      console.log(`\n--- Scraping ${station.name} ---`);
      
      const scrapeResult = await scrapeWithFirecrawl(firecrawlApiKey, station.scrape_url);
      
      if (!scrapeResult.success || !scrapeResult.data) {
        console.error(`[${station.name}] Scrape failed: ${scrapeResult.error}`);
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

    const elapsed = Date.now() - startTime;
    console.log(`\n=== AUTO-SCRAPE COMPLETED in ${elapsed}ms ===`);
    console.log('Results:', JSON.stringify(results, null, 2));

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        totalStations: stations?.length || 0,
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
