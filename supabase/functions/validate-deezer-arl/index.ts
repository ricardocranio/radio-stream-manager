import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  console.log('[ARL Validation] Request received');
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[ARL Validation] Parsing request body');
    const { arl } = await req.json();

    if (!arl || typeof arl !== 'string') {
      console.log('[ARL Validation] Invalid input - no ARL provided');
      return new Response(
        JSON.stringify({ valid: false, error: 'ARL não fornecida' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`[ARL Validation] Validating ARL format (length: ${arl.length})`);
    
    // Validate ARL format (should be 192 alphanumeric characters)
    if (arl.length < 100 || !/^[a-zA-Z0-9]+$/.test(arl)) {
      console.log('[ARL Validation] Invalid ARL format');
      return new Response(
        JSON.stringify({ valid: false, error: 'Formato de ARL inválido (deve ter ~192 caracteres alfanuméricos)' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log('[ARL Validation] Making request to Deezer API');
    
    // Test ARL by making a request to Deezer's private API
    const testResponse = await fetch('https://www.deezer.com/ajax/gw-light.php?method=deezer.getUserData&input=3&api_version=1.0&api_token=', {
      method: 'POST',
      headers: {
        'Cookie': `arl=${arl}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    console.log(`[ARL Validation] Deezer API response status: ${testResponse.status}`);

    if (!testResponse.ok) {
      console.error(`[ARL Validation] Deezer API error: ${testResponse.status} ${testResponse.statusText}`);
      return new Response(
        JSON.stringify({ valid: false, error: `Erro na conexão com Deezer (${testResponse.status})` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const data = await testResponse.json();
    console.log('[ARL Validation] Parsing Deezer response');
    
    // Check if user data was returned (indicates valid ARL)
    if (data?.results?.USER?.USER_ID && data.results.USER.USER_ID !== 0) {
      const userName = data.results.USER.BLOG_NAME || data.results.USER.FIRSTNAME || 'Usuário';
      const country = data.results.USER.SETTING?.global?.country || 'N/A';
      const isPremium = data.results.USER.OPTIONS?.web_hq || false;
      
      console.log(`[ARL Validation] ✓ Valid ARL - User: ${userName}, Premium: ${isPremium}`);
      
      return new Response(
        JSON.stringify({ 
          valid: true, 
          user: userName,
          country: country,
          premium: isPremium,
          message: `Conectado como: ${userName}${isPremium ? ' (Premium)' : ''}`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    } else {
      console.log('[ARL Validation] ✗ Invalid ARL - No user data returned');
      return new Response(
        JSON.stringify({ valid: false, error: 'ARL expirada ou inválida. Obtenha uma nova no Deezer.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

  } catch (error) {
    console.error('[ARL Validation] Exception caught:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ valid: false, error: `Erro ao validar ARL: ${errorMessage}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});
