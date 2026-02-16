import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RadioStation {
  id: string;
  name: string;
  scrape_url: string;
  stream_url: string | null;
  styles: string[];
  enabled: boolean;
  monitoring_start_hour: number | null;
  monitoring_start_minute: number;
  monitoring_end_hour: number | null;
  monitoring_end_minute: number;
  monitoring_week_days: string[];
}

interface SpecialMonitoring {
  id: string;
  station_name: string;
  scrape_url: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  week_days: string[];
  label: string | null;
  enabled: boolean;
}

function isWithinSchedule(schedule: SpecialMonitoring, now: Date): boolean {
  const currentHour = now.getUTCHours() - 3;
  const adjustedHour = currentHour < 0 ? currentHour + 24 : currentHour;
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay();
  const dayMap: Record<number, string> = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab' };
  if (schedule.week_days?.length > 0 && !schedule.week_days.includes(dayMap[currentDay])) return false;
  const currentMins = adjustedHour * 60 + currentMinute;
  return currentMins >= schedule.start_hour * 60 + schedule.start_minute && currentMins <= schedule.end_hour * 60 + schedule.end_minute;
}

function isStationActiveNow(station: RadioStation, now: Date): boolean {
  if (station.monitoring_start_hour === null || station.monitoring_end_hour === null) return true;
  const currentHour = now.getUTCHours() - 3;
  const adjustedHour = currentHour < 0 ? currentHour + 24 : currentHour;
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay();
  const dayMap: Record<number, string> = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab' };
  if (station.monitoring_week_days?.length > 0 && !station.monitoring_week_days.includes(dayMap[currentDay])) return false;
  const currentMins = adjustedHour * 60 + currentMinute;
  return currentMins >= station.monitoring_start_hour * 60 + station.monitoring_start_minute && currentMins <= station.monitoring_end_hour * 60 + station.monitoring_end_minute;
}

const BATCH_SIZE = 4;

async function scrapeStation(
  stationName: string,
  scrapeUrl: string,
  streamUrl: string | null,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<{ nowPlaying?: { title: string; artist: string }; success: boolean; error?: string }> {
  try {
    const body: Record<string, string> = { stationName, stationUrl: scrapeUrl };
    if (streamUrl) body.streamUrl = streamUrl;

    const response = await fetch(`${supabaseUrl}/functions/v1/scrape-radio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return {
      success: data.success,
      nowPlaying: data.nowPlaying,
      error: data.error,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown' };
  }
}

async function processStation(
  station: RadioStation,
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  now: Date,
): Promise<{ station: string; success: boolean; songs: number; error?: string; skipped?: boolean }> {
  if (!isStationActiveNow(station, now)) {
    return { station: station.name, success: true, songs: 0, skipped: true };
  }

  console.log(`[${station.name}] Scraping... (stream_url: ${station.stream_url ? 'yes' : 'no'})`);
  const result = await scrapeStation(station.name, station.scrape_url, station.stream_url, supabaseUrl, supabaseKey);

  if (!result.success || !result.nowPlaying) {
    console.warn(`[${station.name}] ✗ ${result.error || 'No song data'}`);
    return { station: station.name, success: false, songs: 0, error: result.error };
  }

  // Check for duplicates
  const { data: existing } = await supabase
    .from('scraped_songs')
    .select('id')
    .eq('station_id', station.id)
    .eq('title', result.nowPlaying.title)
    .eq('artist', result.nowPlaying.artist)
    .gte('scraped_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`[${station.name}] Already exists, skipping`);
    return { station: station.name, success: true, songs: 0 };
  }

  const { error: insertError } = await supabase.from('scraped_songs').insert({
    station_id: station.id,
    station_name: station.name,
    title: result.nowPlaying.title,
    artist: result.nowPlaying.artist,
    is_now_playing: true,
    source: station.stream_url || station.scrape_url,
  });

  if (insertError) {
    console.error(`[${station.name}] Insert error: ${insertError.message}`);
    return { station: station.name, success: false, songs: 0, error: insertError.message };
  }

  console.log(`[${station.name}] ✓ ${result.nowPlaying.artist} - ${result.nowPlaying.title}`);
  return { station: station.name, success: true, songs: 1 };
}

async function processSpecialMonitoring(
  schedule: SpecialMonitoring,
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<{ station: string; success: boolean; songs: number; error?: string }> {
  console.log(`[ESPECIAL ${schedule.station_name}] Scraping...`);
  const result = await scrapeStation(schedule.station_name, schedule.scrape_url, null, supabaseUrl, supabaseKey);

  if (!result.success || !result.nowPlaying) {
    return { station: `[ESPECIAL] ${schedule.station_name}`, success: false, songs: 0, error: result.error };
  }

  const { data: existing } = await supabase
    .from('scraped_songs')
    .select('id')
    .eq('station_name', schedule.station_name)
    .eq('title', result.nowPlaying.title)
    .eq('artist', result.nowPlaying.artist)
    .gte('scraped_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .limit(1);

  if (existing && existing.length > 0) {
    return { station: `[ESPECIAL] ${schedule.station_name}`, success: true, songs: 0 };
  }

  const { error: insertError } = await supabase.from('scraped_songs').insert({
    station_name: schedule.station_name,
    title: result.nowPlaying.title,
    artist: result.nowPlaying.artist,
    is_now_playing: true,
    source: schedule.scrape_url,
  });

  if (!insertError) {
    console.log(`[ESPECIAL ${schedule.station_name}] ✓ ${result.nowPlaying.artist} - ${result.nowPlaying.title}`);
  }

  return { station: `[ESPECIAL] ${schedule.station_name}`, success: true, songs: insertError ? 0 : 1 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('=== AUTO-SCRAPE STATIONS STARTED (ICY Metadata) ===');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: stations, error: stationsError } = await supabase
      .from('radio_stations')
      .select('*')
      .eq('enabled', true);

    if (stationsError) {
      return new Response(JSON.stringify({ success: false, error: stationsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Found ${stations?.length || 0} enabled stations`);
    const results: { station: string; success: boolean; songs: number; error?: string; skipped?: boolean }[] = [];
    const now = new Date();
    const stationList = (stations || []) as RadioStation[];

    for (let i = 0; i < stationList.length; i += BATCH_SIZE) {
      const batch = stationList.slice(i, i + BATCH_SIZE);
      console.log(`\n--- Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.map(s => s.name).join(', ')}) ---`);
      const batchResults = await Promise.all(
        batch.map(station => processStation(station, supabase, supabaseUrl, supabaseServiceKey, now))
      );
      results.push(...batchResults);
      if (i + BATCH_SIZE < stationList.length) await new Promise(r => setTimeout(r, 200));
    }

    // === SPECIAL MONITORING ===
    console.log('\n=== Processing Special Monitoring ===');
    const { data: specialMonitoring } = await supabase.from('special_monitoring').select('*').eq('enabled', true);

    if (specialMonitoring?.length) {
      const activeSchedules = (specialMonitoring as SpecialMonitoring[]).filter(s => isWithinSchedule(s, now));
      if (activeSchedules.length > 0) {
        console.log(`${activeSchedules.length} active special monitoring schedules`);
        for (let i = 0; i < activeSchedules.length; i += BATCH_SIZE) {
          const batch = activeSchedules.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(schedule => processSpecialMonitoring(schedule, supabase, supabaseUrl, supabaseServiceKey))
          );
          results.push(...batchResults);
        }
      }
    }

    const successCount = results.filter(r => r.success && !r.skipped).length;
    const failedCount = results.filter(r => !r.success).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const totalSongs = results.reduce((sum, r) => sum + r.songs, 0);
    const elapsed = Date.now() - startTime;

    console.log(`\n=== COMPLETED in ${elapsed}ms ===`);
    console.log(`Success: ${successCount}, Failed: ${failedCount}, Skipped: ${skippedCount}, Songs: ${totalSongs}`);

    return new Response(
      JSON.stringify({ success: true, results, summary: { success: successCount, failed: failedCount, skipped: skippedCount, totalSongs, elapsed } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Fatal error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
