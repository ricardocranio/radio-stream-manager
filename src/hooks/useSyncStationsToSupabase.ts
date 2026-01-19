import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRadioStore } from '@/store/radioStore';
import { toast } from 'sonner';

/**
 * Hook that syncs local store stations to Supabase radio_stations table
 * whenever there are changes to the local stations
 */
export function useSyncStationsToSupabase() {
  const stations = useRadioStore((state) => state.stations);

  const syncStations = useCallback(async () => {
    try {
      // Get current stations from Supabase
      const { data: supabaseStations, error: fetchError } = await supabase
        .from('radio_stations')
        .select('id, name, scrape_url, styles, enabled');

      if (fetchError) {
        console.error('Error fetching Supabase stations:', fetchError);
        return;
      }

      const supabaseStationNames = new Set(supabaseStations?.map(s => s.name) || []);
      const localStationNames = new Set(stations.map(s => s.name));

      // Disable stations that are not in local store
      for (const supabaseStation of supabaseStations || []) {
        const localStation = stations.find(s => s.name === supabaseStation.name);
        
        if (!localStation) {
          // Station exists in Supabase but not in local store - disable it
          if (supabaseStation.enabled) {
            await supabase
              .from('radio_stations')
              .update({ enabled: false })
              .eq('id', supabaseStation.id);
          }
        } else {
          // Station exists in both - update it if needed
          const needsUpdate = 
            supabaseStation.enabled !== localStation.enabled ||
            supabaseStation.scrape_url !== localStation.scrapeUrl ||
            JSON.stringify(supabaseStation.styles) !== JSON.stringify(localStation.styles);

          if (needsUpdate) {
            await supabase
              .from('radio_stations')
              .update({
                scrape_url: localStation.scrapeUrl,
                styles: localStation.styles,
                enabled: localStation.enabled,
              })
              .eq('id', supabaseStation.id);
          }
        }
      }

      // Insert new stations that exist locally but not in Supabase
      for (const localStation of stations) {
        if (!supabaseStationNames.has(localStation.name)) {
          await supabase
            .from('radio_stations')
            .insert({
              name: localStation.name,
              scrape_url: localStation.scrapeUrl,
              styles: localStation.styles,
              enabled: localStation.enabled,
            });
        }
      }

      console.log('✅ Stations synced to Supabase');
    } catch (error) {
      console.error('Error syncing stations:', error);
    }
  }, [stations]);

  // Sync on mount and when stations change
  useEffect(() => {
    syncStations();
  }, [syncStations]);

  return { syncStations };
}

/**
 * Manual sync function that can be called from components
 */
export async function syncStationsToSupabase(stations: { name: string; scrapeUrl: string; styles: string[]; enabled: boolean }[]) {
  try {
    // Disable all stations first
    await supabase
      .from('radio_stations')
      .update({ enabled: false })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all

    // Update or insert each local station
    for (const station of stations) {
      const { data: existing } = await supabase
        .from('radio_stations')
        .select('id')
        .eq('name', station.name)
        .single();

      if (existing) {
        await supabase
          .from('radio_stations')
          .update({
            scrape_url: station.scrapeUrl,
            styles: station.styles,
            enabled: station.enabled,
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('radio_stations')
          .insert({
            name: station.name,
            scrape_url: station.scrapeUrl,
            styles: station.styles,
            enabled: station.enabled,
          });
      }
    }

    toast.success('Emissoras sincronizadas com sucesso!');
    return true;
  } catch (error) {
    console.error('Error syncing stations:', error);
    toast.error('Erro ao sincronizar emissoras');
    return false;
  }
}
