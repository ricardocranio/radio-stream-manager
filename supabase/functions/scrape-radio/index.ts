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
        waitFor: 2000, // Wait for dynamic content to load
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
    
    console.log('Scrape successful:', result);
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

  // Try to parse mytuner-radio.com format
  if (url.includes('mytuner-radio.com')) {
    // Look for "Tocando agora" or "Now Playing" section
    const nowPlayingMatch = markdown.match(/(?:Tocando agora|Now Playing|Currently Playing)[:\s]*\n+([^\n]+)\n+([^\n]+)/i);
    if (nowPlayingMatch) {
      nowPlaying = {
        title: nowPlayingMatch[1].trim(),
        artist: nowPlayingMatch[2].trim(),
        timestamp: new Date().toISOString(),
      };
    }

    // Look for "As últimas tocadas" or "Recently Played" section
    const recentSection = markdown.match(/(?:As últimas tocadas|Recently Played|Last Played)[:\s]*\n+([\s\S]*?)(?:\n\n|\n#|$)/i);
    if (recentSection) {
      const lines = recentSection[1].split('\n').filter((l: string) => l.trim());
      for (let i = 0; i < lines.length - 1; i += 2) {
        const title = lines[i]?.trim();
        const artist = lines[i + 1]?.trim();
        if (title && artist && !title.includes('min ago') && !title.includes('hour ago')) {
          songs.push({
            title,
            artist,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // Alternative parsing: look for song patterns in markdown
    const songPatterns = markdown.match(/\*\*([^*]+)\*\*\s*\n\s*([^\n*]+)/g);
    if (songPatterns && songs.length === 0) {
      for (const pattern of songPatterns.slice(0, 10)) {
        const match = pattern.match(/\*\*([^*]+)\*\*\s*\n\s*([^\n*]+)/);
        if (match) {
          const title = match[1].trim();
          const artist = match[2].trim();
          if (title && artist && title.length > 2 && artist.length > 2) {
            if (!nowPlaying) {
              nowPlaying = { title, artist, timestamp: new Date().toISOString() };
            } else {
              songs.push({ title, artist, timestamp: new Date().toISOString() });
            }
          }
        }
      }
    }
  }

  // Generic parsing for other radio sites
  if (!nowPlaying && !songs.length) {
    // Look for common patterns like "Artist - Title" or "Title by Artist"
    const patterns = [
      /(?:Now Playing|Tocando|Em reprodução)[:\s]*([^-\n]+)\s*[-–]\s*([^\n]+)/gi,
      /(?:Artist|Artista)[:\s]*([^\n]+)\n+(?:Song|Track|Música|Title)[:\s]*([^\n]+)/gi,
    ];

    for (const pattern of patterns) {
      const matches = markdown.matchAll(pattern);
      for (const match of matches) {
        if (!nowPlaying) {
          nowPlaying = {
            title: match[2]?.trim() || match[1]?.trim(),
            artist: match[1]?.trim() || 'Unknown Artist',
            timestamp: new Date().toISOString(),
          };
        }
      }
    }
  }

  return {
    success: true,
    stationName,
    nowPlaying,
    recentSongs: songs.slice(0, 10),
  };
}
