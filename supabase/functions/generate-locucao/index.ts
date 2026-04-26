// Edge function: gera locução TTS com ElevenLabs
// Recebe { text, voiceId, modelId? } e retorna { audioBase64, mimeType }

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Prioridade: chave do utilizador (header) > chave do servidor (fallback de demo)
    const userKey = req.headers.get("x-elevenlabs-key")?.trim();
    const apiKey = userKey || Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Nenhuma chave ElevenLabs configurada. Configure em 'Voz & Configurações'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const keySource = userKey ? "user" : "server";

    const body = await req.json();
    const text: string = (body?.text ?? "").toString().trim();
    const voiceId: string = (body?.voiceId ?? "JBFqnCBsd6RMkjVDRZzb").toString();
    const modelId: string = (body?.modelId ?? "eleven_multilingual_v2").toString();
    const stability = typeof body?.stability === "number" ? body.stability : 0.5;
    const similarity = typeof body?.similarityBoost === "number" ? body.similarityBoost : 0.75;
    const style = typeof body?.style === "number" ? body.style : 0.4;
    const speed = typeof body?.speed === "number" ? body.speed : 1.0;

    if (!text) {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (text.length > 4500) {
      return new Response(JSON.stringify({ error: "text too long (max 4500 chars)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    const elRes = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarity,
          style,
          use_speaker_boost: true,
          speed,
        },
      }),
    });

    if (!elRes.ok) {
      const errText = await elRes.text();
      console.error("ElevenLabs error", elRes.status, errText);
      return new Response(
        JSON.stringify({ error: `ElevenLabs ${elRes.status}: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await elRes.arrayBuffer();
    const audioBase64 = encodeBase64(new Uint8Array(audioBuffer));

    return new Response(
      JSON.stringify({
        audioBase64,
        mimeType: "audio/mpeg",
        sizeBytes: audioBuffer.byteLength,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-locucao crash:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
