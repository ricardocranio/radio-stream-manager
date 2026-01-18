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

    // Use Firecrawl to scrape the page
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        waitFor: 3000, // Wait for dynamic content to load
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

function parseRadioContent(data: any, stationName: string, url: string): RadioScrapeResult {
  const markdown = data.data?.markdown || '';
  const html = data.data?.html || '';
  
  const songs: ScrapedSong[] = [];
  let nowPlaying: ScrapedSong | undefined;

  console.log('Parsing content for:', stationName);
  console.log('Markdown length:', markdown.length);

  // Try to parse mytuner-radio.com format
  if (url.includes('mytuner-radio.com')) {
    // Method 1: Look for bold title followed by artist pattern (most common in mytuner)
    // Pattern: **Song Title**\nArtist Name
    const boldPatterns = markdown.match(/\*\*([^*\n]+)\*\*\s*\n+([^\n*]+)/g);
    if (boldPatterns) {
      console.log('Found bold patterns:', boldPatterns.length);
      for (const pattern of boldPatterns) {
        const match = pattern.match(/\*\*([^*\n]+)\*\*\s*\n+([^\n*]+)/);
        if (match) {
          const title = match[1].trim();
          const artist = match[2].trim();
          
          // Filter out non-song entries
          if (title && artist && 
              title.length > 2 && artist.length > 2 &&
              !title.toLowerCase().includes('tocando agora') &&
              !title.toLowerCase().includes('now playing') &&
              !title.toLowerCase().includes('recently') &&
              !title.toLowerCase().includes('últimas') &&
              !artist.includes('min ago') &&
              !artist.includes('hour ago') &&
              !artist.match(/^\d+\s*(min|hour|hora)/i)) {
            
            songs.push({
              title,
              artist,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }

    // Method 2: Look for "Tocando agora" or "Now Playing" specific section
    const nowPlayingMatch = markdown.match(/(?:Tocando agora|Now Playing|A tocar agora)[:\s]*\n+\*?\*?([^\n*]+)\*?\*?\s*\n+([^\n*]+)/i);
    if (nowPlayingMatch) {
      const title = nowPlayingMatch[1].replace(/\*\*/g, '').trim();
      const artist = nowPlayingMatch[2].replace(/\*\*/g, '').trim();
      if (title && artist && !artist.match(/^\d+\s*(min|hour)/i)) {
        nowPlaying = {
          title,
          artist,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Method 3: Look for list patterns with timestamps like "2 min ago"
    const listPattern = markdown.match(/([^\n]+)\n([^\n]+)\n\d+\s*(min|hour|hora)/gi);
    if (listPattern && songs.length < 5) {
      for (const item of listPattern) {
        const lines = item.split('\n').filter((l: string) => l.trim());
        if (lines.length >= 2) {
          const title = lines[0].replace(/\*\*/g, '').trim();
          const artist = lines[1].replace(/\*\*/g, '').trim();
          if (title && artist && 
              !title.match(/^\d+\s*(min|hour)/i) &&
              !songs.some(s => s.title === title && s.artist === artist)) {
            songs.push({
              title,
              artist,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }

    // Method 4: Parse HTML for structured data if markdown didn't work well
    if (songs.length < 3 && html) {
      // Look for song items in HTML - common patterns in mytuner
      const songItemRegex = /<div[^>]*class="[^"]*song[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
      const songItems = html.match(songItemRegex) || [];
      
      for (const item of songItems.slice(0, 10)) {
        // Extract title and artist from song item
        const titleMatch = item.match(/<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)</i);
        const artistMatch = item.match(/<[^>]*class="[^"]*artist[^"]*"[^>]*>([^<]+)</i);
        
        if (titleMatch && artistMatch) {
          const title = titleMatch[1].trim();
          const artist = artistMatch[1].trim();
          if (title && artist && !songs.some(s => s.title === title && s.artist === artist)) {
            songs.push({
              title,
              artist,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }
  }

  // Generic parsing for other radio sites
  if (songs.length === 0) {
    // Look for common patterns like "Artist - Title" or "Title by Artist"
    const dashPatterns = markdown.match(/([^\n\-–]+)\s*[-–]\s*([^\n]+)/g);
    if (dashPatterns) {
      for (const pattern of dashPatterns.slice(0, 10)) {
        const match = pattern.match(/([^\-–]+)\s*[-–]\s*(.+)/);
        if (match) {
          const part1 = match[1].replace(/\*\*/g, '').trim();
          const part2 = match[2].replace(/\*\*/g, '').trim();
          if (part1 && part2 && 
              part1.length > 2 && part2.length > 2 &&
              part1.length < 100 && part2.length < 100 &&
              !part1.match(/^\d+:\d+/) && // Not a time
              !part2.match(/^\d+:\d+/)) {
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
