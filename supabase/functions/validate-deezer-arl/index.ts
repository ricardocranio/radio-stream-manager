import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { arl } = await req.json();

    if (!arl || typeof arl !== 'string') {
      return new Response(
        JSON.stringify({ valid: false, error: 'ARL não fornecida' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Validate ARL format (should be 192 alphanumeric characters)
    if (arl.length < 100 || !/^[a-zA-Z0-9]+$/.test(arl)) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Formato de ARL inválido (deve ter ~192 caracteres alfanuméricos)' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Test ARL by making a request to Deezer's private API
    const testResponse = await fetch('https://www.deezer.com/ajax/gw-light.php?method=deezer.getUserData&input=3&api_version=1.0&api_token=', {
      method: 'POST',
      headers: {
        'Cookie': `arl=${arl}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!testResponse.ok) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Não foi possível conectar ao Deezer' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const data = await testResponse.json();
    
    // Check if user data was returned (indicates valid ARL)
    if (data?.results?.USER?.USER_ID && data.results.USER.USER_ID !== 0) {
      const userName = data.results.USER.BLOG_NAME || data.results.USER.FIRSTNAME || 'Usuário';
      const country = data.results.USER.SETTING?.global?.country || 'N/A';
      const isPremium = data.results.USER.OPTIONS?.web_hq || false;
      
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
      return new Response(
        JSON.stringify({ valid: false, error: 'ARL expirada ou inválida. Obtenha uma nova no Deezer.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

  } catch (error) {
    console.error('Error validating ARL:', error);
    return new Response(
      JSON.stringify({ valid: false, error: 'Erro ao validar ARL' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
