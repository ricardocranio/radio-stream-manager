import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Valid genres for classification
const VALID_GENRES = [
  "SERTANEJO", "PAGODE", "POP", "ROCK", "METAL", "FUNK", "MPB", "FORRO",
  "ELETRONICA", "GOSPEL", "RAP/HIP-HOP", "REGGAETON", "R&B", "COUNTRY",
  "JAZZ", "CLASSICA", "INDIE", "REGGAE", "LATINA", "ROMANTICO", "DANCE", "OUTRO"
];

// Map genres to typical energy levels
const GENRE_TO_ENERGY: Record<string, string> = {
  SERTANEJO: "MEDIUM", PAGODE: "MEDIUM", POP: "HIGH", ELETRONICA: "VERY_HIGH",
  MPB: "LOW", ROCK: "HIGH", FUNK: "VERY_HIGH", GOSPEL: "MEDIUM", FORRO: "HIGH",
  "RAP/HIP-HOP": "HIGH", REGGAETON: "HIGH", "R&B": "MEDIUM", COUNTRY: "MEDIUM",
  JAZZ: "LOW", CLASSICA: "LOW", INDIE: "MEDIUM", METAL: "VERY_HIGH",
  REGGAE: "LOW", LATINA: "HIGH", ROMANTICO: "LOW", DANCE: "VERY_HIGH", OUTRO: "MEDIUM",
};

// Fallback: station-based classification for when AI is unavailable
const STYLE_TO_GENRE: Record<string, string> = {
  SERTANEJO: "SERTANEJO", PAGODE: "PAGODE", AGRONEJO: "SERTANEJO",
  POP: "POP", DANCE: "ELETRONICA", HITS: "POP", "POP/VARIADO": "POP",
  VARIADO: "POP", MPB: "MPB", ROCK: "ROCK", FUNK: "FUNK", GOSPEL: "GOSPEL",
  FORRO: "FORRO", "RAP/HIP-HOP": "RAP/HIP-HOP", REGGAETON: "REGGAETON",
  "R&B": "R&B", COUNTRY: "COUNTRY", JAZZ: "JAZZ", CLASSICA: "CLASSICA",
  INDIE: "INDIE", METAL: "METAL", REGGAE: "REGGAE", LATINA: "LATINA",
};

/**
 * Use Lovable AI to classify a batch of songs by artist+title.
 * Returns a map of "artist|title" → genre.
 */
async function classifyWithAI(
  songs: Array<{ artist: string; title: string }>,
  apiKey: string
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  // Build prompt with all songs
  const songList = songs.map((s, i) => `${i + 1}. ${s.artist} - ${s.title}`).join("\n");

  const systemPrompt = `You are a music genre classifier. Given a list of songs (artist - title), classify each into EXACTLY ONE of these genres:
${VALID_GENRES.join(", ")}

Rules:
- Use the REAL genre of the artist/song, NOT the radio station context
- Lewis Capaldi, Ed Sheeran, Adele = POP
- Tracy Chapman, Alanis Morissette = POP or ROCK
- Iggy Pop, David Bowie, Aerosmith = ROCK
- The Weeknd, Bruno Mars = POP
- Marília Mendonça, Gusttavo Lima = SERTANEJO
- Alexandre Pires, Ferrugem = PAGODE
- Filipe Ret, Emicida = RAP/HIP-HOP
- If unsure, use POP as default

Respond with ONLY a JSON array of objects: [{"index": 1, "genre": "POP"}, ...]
No explanations, no markdown, just the JSON array.`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Classify these songs:\n${songList}` },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[CLASSIFY-AI] API error ${response.status}:`, errText);
      return results;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    }

    const parsed = JSON.parse(jsonStr) as Array<{ index: number; genre: string }>;

    for (const item of parsed) {
      const idx = item.index - 1;
      if (idx >= 0 && idx < songs.length) {
        const genre = VALID_GENRES.includes(item.genre?.toUpperCase())
          ? item.genre.toUpperCase()
          : "OUTRO";
        // Normalize DANCE → ELETRONICA
        const normalizedGenre = genre === "DANCE" ? "ELETRONICA" : genre;
        const key = `${songs[idx].artist.toLowerCase().trim()}|${songs[idx].title.toLowerCase().trim()}`;
        results.set(key, normalizedGenre);
      }
    }

    console.log(`[CLASSIFY-AI] Classified ${results.size}/${songs.length} songs via AI`);
  } catch (e) {
    console.error("[CLASSIFY-AI] Error:", e);
  }

  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { action } = await req.json();

    if (action === "classify-batch") {
      // === AI CACHE: Check if we already classified these artist+title pairs ===
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

      // Pre-fill from already-classified songs with same artist+title (cache hit)
      let cacheHits = 0;
      const uniqueKeys = new Map<string, { artist: string; title: string }>();
      const songKeyMap = new Map<string, string>(); // song key → genre (from cache)

      for (const song of songs) {
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        uniqueKeys.set(key, { artist: song.artist, title: song.title });
      }

      // Batch lookup: find any previously classified songs with same artist+title
      for (const [key] of uniqueKeys) {
        const [artist, title] = key.split("|");
        const { data: existing } = await supabase
          .from("scraped_songs")
          .select("ai_genre, ai_energy")
          .not("ai_genre", "is", null)
          .ilike("artist", artist)
          .ilike("title", title)
          .limit(1);

        if (existing?.length && existing[0].ai_genre) {
          songKeyMap.set(key, existing[0].ai_genre);
        }
      }

      // Apply cache hits
      const uncachedSongs: typeof songs = [];
      for (const song of songs) {
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        const cachedGenre = songKeyMap.get(key);
        if (cachedGenre) {
          const energy = GENRE_TO_ENERGY[cachedGenre] || "MEDIUM";
          const { error: updateError } = await supabase
            .from("scraped_songs")
            .update({ ai_genre: cachedGenre, ai_energy: energy })
            .eq("id", song.id);
          if (!updateError) cacheHits++;
        } else {
          uncachedSongs.push(song);
        }
      }

      let classified = cacheHits;
      let method = cacheHits > 0 ? "cache" : "station-based";

      // === Strategy 1: AI classification for uncached songs ===
      if (LOVABLE_API_KEY && uncachedSongs.length > 0) {
        method = cacheHits > 0 ? "cache+ai" : "ai";
        const BATCH_SIZE = 30;
        for (let i = 0; i < uncachedSongs.length; i += BATCH_SIZE) {
          const batch = uncachedSongs.slice(i, i + BATCH_SIZE);
          const aiResults = await classifyWithAI(
            batch.map(s => ({ artist: s.artist, title: s.title })),
            LOVABLE_API_KEY
          );

          for (const song of batch) {
            const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
            const genre = aiResults.get(key);
            if (genre) {
              const energy = GENRE_TO_ENERGY[genre] || "MEDIUM";
              const { error: updateError } = await supabase
                .from("scraped_songs")
                .update({ ai_genre: genre, ai_energy: energy })
                .eq("id", song.id);
              if (!updateError) classified++;
            }
          }

          if (i + BATCH_SIZE < uncachedSongs.length) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      console.log(`[CLASSIFY] Cache hits: ${cacheHits}, AI classified: ${classified - cacheHits}, uncached: ${uncachedSongs.length}`);

      // === Strategy 2: Station-based fallback for remaining ===
      const { data: stillUnclassified } = await supabase
        .from("scraped_songs")
        .select("id, station_name")
        .is("ai_genre", null)
        .in("id", songs.map(s => s.id));

      if (stillUnclassified && stillUnclassified.length > 0) {
        const { data: stations } = await supabase.from("radio_stations").select("name, styles");
        const stationStyleMap: Record<string, string[]> = {};
        (stations || []).forEach(s => { stationStyleMap[s.name] = s.styles || []; });

        for (const song of stillUnclassified) {
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
        if (method === "ai") method = "ai+station-fallback";
      }

      return new Response(JSON.stringify({ classified, total: songs.length, method, cacheHits }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "recalculate-styles") {
      const { data: songs, error: fetchErr } = await supabase
        .from("scraped_songs")
        .select("station_name, ai_genre")
        .not("ai_genre", "is", null)
        .not("ai_genre", "eq", "OUTRO");
      if (fetchErr) throw fetchErr;

      const stationGenres: Record<string, Record<string, number>> = {};
      (songs || []).forEach(s => {
        if (!stationGenres[s.station_name]) stationGenres[s.station_name] = {};
        stationGenres[s.station_name][s.ai_genre!] = (stationGenres[s.station_name][s.ai_genre!] || 0) + 1;
      });

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
        if (!upErr) { updated++; console.log(`[STYLES] ${stationName}: ${topGenres.join(", ")}`); }
      }

      return new Response(JSON.stringify({ updated, stations: Object.keys(stationGenres).length, method: "id3-based" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "compress-history") {
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
