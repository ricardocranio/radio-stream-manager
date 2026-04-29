import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRadioStore } from '@/store/radioStore';
import { RadioStation } from '@/types/radio';

/**
 * Hook that syncs stations from Supabase database to local store on mount.
 * LOCAL stations take priority (user customizations are preserved).
 * DB only provides: new stations not yet in local, and scrapeUrl/streamUrl updates.
 */
export function useSyncStationsFromDb() {
  const { stations, setStations } = useRadioStore();

  useEffect(() => {
    const syncFromDb = async () => {
      try {
        const { data: dbStations, error } = await supabase
          .from('radio_stations')
          .select('*')
          .order('name');

        if (error) {
          console.error('[SYNC-FROM-DB] Error fetching stations:', error);
          return;
        }

        if (!dbStations || dbStations.length === 0) {
          console.log('[SYNC-FROM-DB] No stations in database');
          return;
        }

        // Use current state to merge
        const currentStations = useRadioStore.getState().stations;

        // 1. Map local stations to potentially updated URLs from DB
        const mergedStations: RadioStation[] = currentStations.map(localStation => {
          const normalizedName = localStation.name.trim().toLowerCase();
          const dbStation = dbStations.find(db => db.name.trim().toLowerCase() === normalizedName);
          
          if (dbStation) {
            return {
              ...localStation,
              scrapeUrl: dbStation.scrape_url || localStation.scrapeUrl,
              streamUrl: dbStation.stream_url || localStation.streamUrl,
            };
          }
          return localStation;
        });

        const localNames = new Set(currentStations.map(s => s.name.trim().toLowerCase()));
        let hasNewFromDb = false;

        // 2. Add DB-only stations that don't exist locally
        for (const dbStation of dbStations) {
          const normalizedName = dbStation.name.trim().toLowerCase();
          if (!localNames.has(normalizedName)) {
            hasNewFromDb = true;
            localNames.add(normalizedName);
            mergedStations.push({
              id: dbStation.id,
              name: dbStation.name.trim(),
              urls: [],
              scrapeUrl: dbStation.scrape_url,
              streamUrl: dbStation.stream_url || undefined,
              styles: dbStation.styles || [],
              enabled: dbStation.enabled ?? true,
            });
          }
        }

        if (hasNewFromDb) {
          console.log('[SYNC-FROM-DB] New stations found in DB, merging...');
          setStations(mergedStations);
        }
      } catch (err) {
        console.error('[SYNC-FROM-DB] Unexpected error:', err);
      }
    };

    // Sync on mount
    syncFromDb();

    // Also sync when tab becomes visible
    const handleVisibility = () => {
      if (!document.hidden) {
        syncFromDb();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []); // Only run on mount
}
