import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AudDResponse {
  status: string;
  result?: {
    artist: string;
    title: string;
    album?: string;
    release_date?: string;
    label?: string;
    timecode?: string;
    song_link?: string;
    spotify?: {
      id: string;
      name: string;
      artists: { name: string }[];
    };
    deezer?: {
      id: number;
      title: string;
      artist: { name: string };
    };
  };
  error?: {
    error_code: number;
    error_message: string;
  };
}

interface RecognitionResult {
  success: boolean;
  stationName: string;
  song?: {
    title: string;
    artist: string;
    album?: string;
    spotifyId?: string;
    deezerId?: number;
  };
  error?: string;
  source: 'audd' | 'acrcloud';
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { streamUrl, stationName, mode } = await req.json();

    if (!streamUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'streamUrl is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Get API key from secrets
    const auddApiToken = Deno.env.get('AUDD_API_TOKEN');
    
    if (!auddApiToken) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'AUDD_API_TOKEN not configured. Please add your AudD API token in secrets.',
          needsConfig: true 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`[AudioRecognition] Identifying song from stream: ${stationName} (${streamUrl})`);

    // Mode 1: Direct stream recognition (for live radio streams)
    // This uses AudD's stream recognition endpoint
    if (mode === 'stream') {
      // For continuous monitoring, use the addStream endpoint
      const response = await fetch('https://api.audd.io/addStream/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          api_token: auddApiToken,
          url: streamUrl,
          name: stationName || 'Unknown Station',
        }),
      });

      const data = await response.json();
      console.log('[AudioRecognition] AddStream response:', JSON.stringify(data));

      return new Response(
        JSON.stringify({
          success: data.status === 'success',
          stationName,
          streamId: data.stream_id,
          message: 'Stream added for monitoring. Songs will be identified in real-time.',
          source: 'audd',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mode 2: Single recognition (for one-time identification)
    // This captures a sample from the stream and identifies it
    const response = await fetch('https://api.audd.io/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        api_token: auddApiToken,
        url: streamUrl,
        return: 'spotify,deezer',
      }),
    });

    const data: AudDResponse = await response.json();
    console.log('[AudioRecognition] Recognition response:', JSON.stringify(data));

    if (data.status === 'success' && data.result) {
      const result: RecognitionResult = {
        success: true,
        stationName: stationName || 'Unknown',
        song: {
          title: data.result.title,
          artist: data.result.artist,
          album: data.result.album,
          spotifyId: data.result.spotify?.id,
          deezerId: data.result.deezer?.id,
        },
        source: 'audd',
      };

      console.log(`[AudioRecognition] Identified: ${result.song?.artist} - ${result.song?.title}`);

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No result found
    return new Response(
      JSON.stringify({
        success: false,
        stationName: stationName || 'Unknown',
        error: data.error?.error_message || 'No song identified',
        source: 'audd',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[AudioRecognition] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});