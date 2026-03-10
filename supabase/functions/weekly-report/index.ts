import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get aggregated stats from radio_historico_stats
    const { data: stats, error: statsError } = await supabase
      .from("radio_historico_stats")
      .select("*")
      .order("play_count", { ascending: false })
      .limit(500);

    if (statsError) throw statsError;

    // Get recent songs with AI classification
    const { data: classified, error: classError } = await supabase
      .from("scraped_songs")
      .select("artist, title, station_name, ai_genre, ai_energy, year, scraped_at")
      .not("ai_genre", "is", null)
      .order("scraped_at", { ascending: false })
      .limit(500);

    if (classError) throw classError;

    // Also get recent history for trend detection (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentHistory, error: histError } = await supabase
      .from("radio_historico")
      .select("artist, title, station_name, captured_at")
      .gte("captured_at", weekAgo)
      .order("captured_at", { ascending: false })
      .limit(1000);

    if (histError) throw histError;

    // === BUILD REPORT ===

    // 1. Top songs by play count (from aggregated stats)
    const topSongs = (stats || []).slice(0, 25).map(s => ({
      artist: s.artist,
      title: s.title,
      playCount: s.play_count,
      stations: s.station_name,
      firstSeen: s.first_seen,
      lastSeen: s.last_seen,
    }));

    // 2. Genre distribution from classified songs
    const genreCounts: Record<string, number> = {};
    const energyCounts: Record<string, number> = {};
    const genreByStation: Record<string, Record<string, number>> = {};

    (classified || []).forEach(s => {
      if (s.ai_genre) {
        genreCounts[s.ai_genre] = (genreCounts[s.ai_genre] || 0) + 1;
        
        if (!genreByStation[s.station_name]) genreByStation[s.station_name] = {};
        genreByStation[s.station_name][s.ai_genre] = (genreByStation[s.station_name][s.ai_genre] || 0) + 1;
      }
      if (s.ai_energy) {
        energyCounts[s.ai_energy] = (energyCounts[s.ai_energy] || 0) + 1;
      }
    });

    // 3. Station activity from recent history
    const stationCounts: Record<string, number> = {};
    const artistCounts: Record<string, number> = {};
    (recentHistory || []).forEach(s => {
      stationCounts[s.station_name] = (stationCounts[s.station_name] || 0) + 1;
      artistCounts[s.artist] = (artistCounts[s.artist] || 0) + 1;
    });

    // 4. Top artists this week
    const topArtists = Object.entries(artistCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([artist, count]) => ({ artist, count }));

    // 5. Station rankings
    const stationRanking = Object.entries(stationCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([station, count]) => ({ station, count }));

    // 6. Genre distribution sorted
    const genreDistribution = Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([genre, count]) => ({ genre, count }));

    // 7. Energy distribution
    const energyDistribution = Object.entries(energyCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([energy, count]) => ({ energy, count }));

    // 8. Genre breakdown per station
    const stationGenres = Object.entries(genreByStation).map(([station, genres]) => ({
      station,
      genres: Object.entries(genres)
        .sort(([, a], [, b]) => b - a)
        .map(([genre, count]) => ({ genre, count })),
    }));

    const report = {
      generatedAt: new Date().toISOString(),
      period: { start: weekAgo, end: new Date().toISOString() },
      summary: {
        totalSongsArchived: stats?.length || 0,
        totalRecentCaptures: recentHistory?.length || 0,
        totalClassified: classified?.length || 0,
        uniqueArtists: Object.keys(artistCounts).length,
        activeStations: Object.keys(stationCounts).length,
      },
      topSongs,
      topArtists,
      stationRanking,
      genreDistribution,
      energyDistribution,
      stationGenres,
    };

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("weekly-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
