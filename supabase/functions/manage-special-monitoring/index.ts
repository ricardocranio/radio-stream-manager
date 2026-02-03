import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, data, id } = await req.json();

    switch (action) {
      case 'list': {
        const { data: schedules, error } = await supabase
          .from('special_monitoring')
          .select('*')
          .order('start_hour', { ascending: true });

        if (error) throw error;
        return new Response(
          JSON.stringify({ success: true, data: schedules }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'add': {
        if (!data) {
          return new Response(
            JSON.stringify({ success: false, error: 'Missing data' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: newSchedule, error } = await supabase
          .from('special_monitoring')
          .insert({
            station_name: data.station_name,
            scrape_url: data.scrape_url,
            start_hour: data.start_hour,
            start_minute: data.start_minute,
            end_hour: data.end_hour,
            end_minute: data.end_minute,
            week_days: data.week_days || ['seg', 'ter', 'qua', 'qui', 'sex'],
            label: data.label || null,
            enabled: data.enabled ?? true,
          })
          .select()
          .single();

        if (error) throw error;
        return new Response(
          JSON.stringify({ success: true, data: newSchedule }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        if (!id || !data) {
          return new Response(
            JSON.stringify({ success: false, error: 'Missing id or data' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const updateData: Record<string, any> = {};
        if (data.station_name !== undefined) updateData.station_name = data.station_name;
        if (data.scrape_url !== undefined) updateData.scrape_url = data.scrape_url;
        if (data.start_hour !== undefined) updateData.start_hour = data.start_hour;
        if (data.start_minute !== undefined) updateData.start_minute = data.start_minute;
        if (data.end_hour !== undefined) updateData.end_hour = data.end_hour;
        if (data.end_minute !== undefined) updateData.end_minute = data.end_minute;
        if (data.week_days !== undefined) updateData.week_days = data.week_days;
        if (data.label !== undefined) updateData.label = data.label;
        if (data.enabled !== undefined) updateData.enabled = data.enabled;

        const { data: updatedSchedule, error } = await supabase
          .from('special_monitoring')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;
        return new Response(
          JSON.stringify({ success: true, data: updatedSchedule }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        if (!id) {
          return new Response(
            JSON.stringify({ success: false, error: 'Missing id' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabase
          .from('special_monitoring')
          .delete()
          .eq('id', id);

        if (error) throw error;
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'clear-scraped-songs': {
        // Clear all scraped songs from the database
        const { error } = await supabase
          .from('scraped_songs')
          .delete()
          .gte('id', '00000000-0000-0000-0000-000000000000'); // Match all UUIDs

        if (error) throw error;
        console.log('[EDGE] Cleared all scraped songs');
        return new Response(
          JSON.stringify({ success: true, message: 'All scraped songs cleared' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'full-system-reset': {
        // COMPLETE SYSTEM RESET - Clears ALL data from Supabase
        // 1. Clear scraped songs
        const { error: songsError } = await supabase
          .from('scraped_songs')
          .delete()
          .gte('id', '00000000-0000-0000-0000-000000000000');
        
        if (songsError) {
          console.error('[EDGE] Error clearing scraped songs:', songsError);
        }

        // 2. Clear special monitoring schedules (optional, based on data.clearSchedules)
        if (data?.clearSchedules) {
          const { error: schedError } = await supabase
            .from('special_monitoring')
            .delete()
            .gte('id', '00000000-0000-0000-0000-000000000000');
          
          if (schedError) {
            console.error('[EDGE] Error clearing special monitoring:', schedError);
          }
        }

        // 3. Reset radio stations to default (disable all) - optional
        if (data?.resetStations) {
          const { error: stationsError } = await supabase
            .from('radio_stations')
            .update({ enabled: false })
            .gte('id', '00000000-0000-0000-0000-000000000000');
          
          if (stationsError) {
            console.error('[EDGE] Error resetting stations:', stationsError);
          }
        }

        console.log('[EDGE] Full system reset completed');
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Full system reset completed',
            cleared: {
              scrapedSongs: !songsError,
              specialMonitoring: data?.clearSchedules ? true : 'skipped',
              radioStations: data?.resetStations ? true : 'skipped',
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: unknown) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
