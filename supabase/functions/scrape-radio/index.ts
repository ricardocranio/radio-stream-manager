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
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { stationUrl, stationName } = await req.json();

    if (!stationUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'Station URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl connector not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format URL
    let formattedUrl = stationUrl.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Scraping radio station:', formattedUrl);

    // Use Firecrawl to scrape the page with extended wait for dynamic content
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ['markdown', 'html'],
        onlyMainContent: false, // Get full page to capture all dynamic elements
        waitFor: 8000, // Wait 8 seconds for JavaScript to populate song data
        actions: [
          // Wait for the song history element to be populated
          { type: 'wait', milliseconds: 5000 },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Firecrawl API error:', data);
      return new Response(
        JSON.stringify({ 
          success: false, 
          stationName: stationName || 'Unknown',
          error: data.error || `Request failed with status ${response.status}` 
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the scraped content to extract song information
    const result = parseRadioContent(data, stationName || 'Unknown', formattedUrl);
    
    console.log('Scrape successful:', JSON.stringify(result, null, 2));
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error scraping radio:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to scrape';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper to clean song title/artist - removes URLs, images, markdown artifacts
function cleanText(text: string): string {
  if (!text) return '';
  
  return text
    // Remove markdown image syntax ![alt](url)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // Remove markdown links [text](url)
    .replace(/\[[^\]]*\]\([^)]+\)/g, '')
    // Remove plain URLs
    .replace(/https?:\/\/[^\s]+/gi, '')
    // Remove image file references
    .replace(/\.(jpg|jpeg|png|gif|webp|svg|ico)[^\s]*/gi, '')
    // Remove markdown bold/italic
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// Validate if text looks like a valid song title or artist
function isValidSongPart(text: string): boolean {
  if (!text || text.length < 2 || text.length > 100) return false;
  
  // Reject if it's mostly special characters or numbers
  const alphaCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  if (alphaCount < text.length * 0.3) return false;
  
  // Reject URLs, file paths, technical strings
  if (text.match(/https?:|www\.|\.com|\.jpg|\.png|\/\/|mzstatic|image\/|thumb\/|rgb\./i)) return false;
  
  // Reject common non-song patterns
  const rejectPatterns = [
    /^(tocando agora|now playing|recently|últimas|recentes)/i,
    /^\d+\s*(min|hour|hora|segundo)/i,
    /^(min ago|hour ago)/i,
    /^[\d:]+$/,  // Just timestamps like 14:30
    /^v4\/|^Music\d+|^24UMGIM/i,  // Technical codes
  ];
  
  for (const pattern of rejectPatterns) {
    if (pattern.test(text)) return false;
  }
  
  return true;
}

function parseRadioContent(data: any, stationName: string, url: string): RadioScrapeResult {
  const markdown = data.data?.markdown || '';
  const html = data.data?.html || '';
  
  const songs: ScrapedSong[] = [];
  let nowPlaying: ScrapedSong | undefined;

  console.log('Parsing content for:', stationName);
  console.log('Markdown length:', markdown.length);
  console.log('HTML length:', html.length);

  // Try to parse mytuner-radio.com format
  if (url.includes('mytuner-radio.com')) {
    console.log('Using mytuner-radio.com parser');
    
    // Method 1: Parse HTML for #now-playing / .latest-song and #song-history elements
    if (html) {
      console.log('Parsing HTML structure...');
      
      // Extract "Tocando agora" / now playing section
      // Look for: <div id="now-playing">...</div> followed by <div class="latest-song">...</div>
      const nowPlayingSection = html.match(/id="now-playing"[^>]*>[\s\S]*?<\/div>\s*<div[^>]*class="[^"]*latest-song[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (nowPlayingSection) {
        const songHtml = nowPlayingSection[1];
        const extracted = extractSongFromHtml(songHtml);
        if (extracted) {
          nowPlaying = {
            title: extracted.title,
            artist: extracted.artist,
            timestamp: new Date().toISOString(),
          };
          console.log('Found now playing from HTML:', nowPlaying);
        }
      }
      
      // Also try looking for latest-song directly
      if (!nowPlaying) {
        const latestSongMatch = html.match(/<div[^>]*class="[^"]*latest-song[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (latestSongMatch) {
          const extracted = extractSongFromHtml(latestSongMatch[1]);
          if (extracted) {
            nowPlaying = {
              title: extracted.title,
              artist: extracted.artist,
              timestamp: new Date().toISOString(),
            };
            console.log('Found latest-song from HTML:', nowPlaying);
          }
        }
      }
      
      // Extract "As últimas tocadas" / song history
      // Look for: <div id="song-history">...</div>
      const historySection = html.match(/id="song-history"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div[^>]*class="(?!song))/i);
      if (historySection) {
        const historyHtml = historySection[1];
        // Look for individual song entries within the history
        const songEntries = historyHtml.match(/<div[^>]*class="[^"]*song[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
        
        for (const entry of songEntries.slice(0, 5)) {
          const extracted = extractSongFromHtml(entry);
          if (extracted && !songs.some(s => s.title === extracted.title && s.artist === extracted.artist)) {
            songs.push({
              title: extracted.title,
              artist: extracted.artist,
              timestamp: new Date().toISOString(),
            });
          }
        }
        console.log('Found songs from song-history:', songs.length);
      }
      
      // Method 2: Look for any song divs with title/artist classes
      if (songs.length < 3) {
        const songDivs = html.match(/<div[^>]*class="[^"]*song[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
        console.log('Found song divs:', songDivs.length);
        
        for (const div of songDivs.slice(0, 10)) {
          const extracted = extractSongFromHtml(div);
          if (extracted && 
              !songs.some(s => s.title === extracted.title && s.artist === extracted.artist) &&
              (!nowPlaying || (nowPlaying.title !== extracted.title || nowPlaying.artist !== extracted.artist))) {
            songs.push({
              title: extracted.title,
              artist: extracted.artist,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }
    
    // Method 3: Fallback to markdown parsing
    if (!nowPlaying && songs.length === 0) {
      console.log('Falling back to markdown parsing...');
      
      // Look for patterns after "Tocando agora" text
      const afterNowPlaying = markdown.match(/Tocando agora:?\s*\n+([\s\S]*?)(?:\n\s*\n|As últimas|Playlist)/i);
      if (afterNowPlaying) {
        const section = afterNowPlaying[1];
        // Look for **Title**\nArtist pattern
        const songMatch = section.match(/\*\*([^*\n]+)\*\*\s*\n+([^\n*]+)/);
        if (songMatch) {
          const title = cleanText(songMatch[1]);
          const artist = cleanText(songMatch[2]);
          if (isValidSongPart(title) && isValidSongPart(artist)) {
            nowPlaying = { title, artist, timestamp: new Date().toISOString() };
          }
        }
      }
      
      // Look for patterns after "As últimas tocadas"
      const afterHistory = markdown.match(/As últimas tocadas:?\s*\n+([\s\S]*?)(?:\n\s*\n\s*\n|$)/i);
      if (afterHistory) {
        const section = afterHistory[1];
        const songPatterns = section.match(/\*\*([^*\n]+)\*\*\s*\n+([^\n*]+)/g) || [];
        
        for (const pattern of songPatterns.slice(0, 5)) {
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
  }

  // Generic parsing for other radio sites
  if (!nowPlaying && songs.length === 0) {
    console.log('Using generic parser...');
    // Look for common patterns like "Artist - Title" or "Title by Artist"
    const dashPatterns = markdown.match(/([^\n\-–]+)\s*[-–]\s*([^\n]+)/g);
    if (dashPatterns) {
      for (const pattern of dashPatterns.slice(0, 10)) {
        const match = pattern.match(/([^\-–]+)\s*[-–]\s*(.+)/);
        if (match) {
          const part1 = cleanText(match[1]);
          const part2 = cleanText(match[2]);
          if (isValidSongPart(part1) && isValidSongPart(part2)) {
            songs.push({
              title: part2,
              artist: part1,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }
  }

  // Set now playing as first song if not already set
  if (!nowPlaying && songs.length > 0) {
    nowPlaying = songs.shift();
  }

  // Deduplicate songs
  const uniqueSongs = songs.reduce((acc: ScrapedSong[], song) => {
    if (!acc.some(s => s.title.toLowerCase() === song.title.toLowerCase() && 
                       s.artist.toLowerCase() === song.artist.toLowerCase())) {
      acc.push(song);
    }
    return acc;
  }, []);

  // Get last 5 songs (excluding now playing)
  const recentSongs = uniqueSongs.slice(0, 5);

  console.log('Parsed result:', {
    nowPlaying: nowPlaying ? `${nowPlaying.artist} - ${nowPlaying.title}` : 'none',
    recentSongsCount: recentSongs.length,
    recentSongs: recentSongs.map(s => `${s.artist} - ${s.title}`),
  });

  return {
    success: true,
    stationName,
    nowPlaying,
    recentSongs,
  };
}

// Extract song title and artist from an HTML snippet
function extractSongFromHtml(html: string): { title: string; artist: string } | null {
  // Try different patterns to extract title and artist
  
  // Pattern 1: Look for elements with title/artist classes
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
  
  // Pattern 2: Look for text content with "Title - Artist" or "Artist - Title" format
  const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const dashMatch = textContent.match(/([^-–]+)\s*[-–]\s*([^-–]+)/);
  if (dashMatch) {
    const part1 = cleanText(dashMatch[1]);
    const part2 = cleanText(dashMatch[2]);
    if (isValidSongPart(part1) && isValidSongPart(part2)) {
      // Assume format is "Title - Artist" (more common in BR radios)
      return { title: part1, artist: part2 };
    }
  }
  
  // Pattern 3: Look for two separate text blocks (title on first line, artist on second)
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
