import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { action } = await req.json();

    if (action === "classify-batch") {
      // Buscar músicas sem classificação (últimas 50)
      const { data: songs, error } = await supabase
        .from("scraped_songs")
        .select("id, artist, title, station_name")
        .is("ai_genre", null)
        .order("scraped_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      if (!songs || songs.length === 0) {
        return new Response(JSON.stringify({ classified: 0, message: "No songs to classify" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Preparar prompt com lista de músicas
      const songList = songs.map((s, i) => `${i + 1}. "${s.title}" by ${s.artist} (station: ${s.station_name})`).join("\n");

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            {
              role: "system",
              content: `You are a music genre classifier. For each song, determine:
- genre: one of [POP, ROCK, SERTANEJO, PAGODE, MPB, RAP/HIP-HOP, ELETRONICA, FUNK, GOSPEL, FORRO, REGGAETON, R&B, COUNTRY, JAZZ, CLASSICA, INDIE, METAL, REGGAE, LATINA, OUTRO]
- energy: one of [LOW, MEDIUM, HIGH, VERY_HIGH]

Base your classification on the artist name, song title, and station context.
Respond ONLY with a valid JSON array, no markdown, no explanation.
Format: [{"index":1,"genre":"POP","energy":"HIGH"},...]`
            },
            {
              role: "user",
              content: `Classify these songs:\n${songList}`
            }
          ],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (response.status === 402) {
          return new Response(JSON.stringify({ error: "Payment required for AI credits" }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await response.text();
        console.error("AI gateway error:", response.status, t);
        throw new Error(`AI gateway error: ${response.status}`);
      }

      const aiResult = await response.json();
      const content = aiResult.choices?.[0]?.message?.content || "";

      // Parse JSON from AI response
      let classifications: Array<{ index: number; genre: string; energy: string }> = [];
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          classifications = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error("Failed to parse AI classification:", e, content);
        throw new Error("Failed to parse AI classification response");
      }

      // Update songs with classifications
      let classified = 0;
      for (const cls of classifications) {
        const song = songs[cls.index - 1];
        if (!song) continue;

        const { error: updateError } = await supabase
          .from("scraped_songs")
          .update({ ai_genre: cls.genre, ai_energy: cls.energy })
          .eq("id", song.id);

        if (!updateError) classified++;
      }

      return new Response(JSON.stringify({ classified, total: songs.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "compress-history") {
      // Chamar a função de compressão
      const { data, error } = await supabase.rpc("compress_radio_historico");
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, result: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-song error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
