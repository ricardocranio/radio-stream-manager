import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Map station styles to normalized genres
const STYLE_TO_GENRE: Record<string, string> = {
  SERTANEJO: "SERTANEJO",
  PAGODE: "PAGODE",
  AGRONEJO: "SERTANEJO",
  POP: "POP",
  DANCE: "ELETRONICA",
  HITS: "POP",
  "POP/VARIADO": "POP",
  VARIADO: "POP",
  MPB: "MPB",
  ROCK: "ROCK",
  FUNK: "FUNK",
  GOSPEL: "GOSPEL",
  FORRO: "FORRO",
  "RAP/HIP-HOP": "RAP/HIP-HOP",
  REGGAETON: "REGGAETON",
  "R&B": "R&B",
  COUNTRY: "COUNTRY",
  JAZZ: "JAZZ",
  CLASSICA: "CLASSICA",
  INDIE: "INDIE",
  METAL: "METAL",
  REGGAE: "REGGAE",
  LATINA: "LATINA",
};

// Map genres to typical energy levels
const GENRE_TO_ENERGY: Record<string, string> = {
  SERTANEJO: "MEDIUM",
  PAGODE: "MEDIUM",
  POP: "HIGH",
  ELETRONICA: "VERY_HIGH",
  MPB: "LOW",
  ROCK: "HIGH",
  FUNK: "VERY_HIGH",
  GOSPEL: "MEDIUM",
  FORRO: "HIGH",
  "RAP/HIP-HOP": "HIGH",
  REGGAETON: "HIGH",
  "R&B": "MEDIUM",
  COUNTRY: "MEDIUM",
  JAZZ: "LOW",
  CLASSICA: "LOW",
  INDIE: "MEDIUM",
  METAL: "VERY_HIGH",
  REGGAE: "LOW",
  LATINA: "HIGH",
  OUTRO: "MEDIUM",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { action } = await req.json();

    if (action === "classify-batch") {
      // 1. Load station styles mapping
      const { data: stations, error: stError } = await supabase
        .from("radio_stations")
        .select("name, styles");
      if (stError) throw stError;

      const stationStyleMap: Record<string, string[]> = {};
      (stations || []).forEach(s => {
        stationStyleMap[s.name] = s.styles || [];
      });

      // 2. Fetch unclassified songs
      const { data: songs, error } = await supabase
        .from("scraped_songs")
        .select("id, artist, title, station_name")
        .is("ai_genre", null)
        .order("scraped_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      if (!songs || songs.length === 0) {
        return new Response(JSON.stringify({ classified: 0, message: "No songs to classify" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 3. Classify based on station styles
      let classified = 0;
      for (const song of songs) {
        const styles = stationStyleMap[song.station_name] || [];
        const primaryStyle = styles[0] || null;
        const genre = primaryStyle ? (STYLE_TO_GENRE[primaryStyle] || "OUTRO") : "OUTRO";
        const energy = GENRE_TO_ENERGY[genre] || "MEDIUM";

        const { error: updateError } = await supabase
          .from("scraped_songs")
          .update({ ai_genre: genre, ai_energy: energy })
          .eq("id", song.id);

        if (!updateError) classified++;
      }

      return new Response(JSON.stringify({ classified, total: songs.length, method: "station-based" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "recalculate-styles") {
      // Analyze ai_genre distribution per station and update radio_stations.styles
      const { data: songs, error: fetchErr } = await supabase
        .from("scraped_songs")
        .select("station_name, ai_genre")
        .not("ai_genre", "is", null)
        .not("ai_genre", "eq", "OUTRO");

      if (fetchErr) throw fetchErr;

      // Count genres per station
      const stationGenres: Record<string, Record<string, number>> = {};
      (songs || []).forEach(s => {
        if (!stationGenres[s.station_name]) stationGenres[s.station_name] = {};
        stationGenres[s.station_name][s.ai_genre!] = (stationGenres[s.station_name][s.ai_genre!] || 0) + 1;
      });

      // For each station, pick top 3 genres as styles
      let updated = 0;
      for (const [stationName, genres] of Object.entries(stationGenres)) {
        const topGenres = Object.entries(genres)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([genre]) => genre);

        if (topGenres.length === 0) continue;

        const { error: upErr } = await supabase
          .from("radio_stations")
          .update({ styles: topGenres })
          .eq("name", stationName);

        if (!upErr) {
          updated++;
          console.log(`[STYLES] ${stationName}: ${topGenres.join(", ")}`);
        }
      }

      return new Response(JSON.stringify({ updated, stations: Object.keys(stationGenres).length, method: "id3-based" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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
