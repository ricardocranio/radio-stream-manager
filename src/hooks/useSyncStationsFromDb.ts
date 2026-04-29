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

        // 1. Identify local stations that STILL exist in the DB (preserve them)
        // 2. Local stations NOT in DB but present locally: if syncFromDb is running, 
        //    it means we might have a conflict between "user deleted it" and "DB has it".
        // CRITICAL: We only keep local stations that are also in the DB to allow deletion 
        // to propagate if the user deleted it from the DB elsewhere, BUT here we want
        // the LOCAL deletion to be the source of truth for the local UI.
        
        // Let's refine: We only add DB stations that are NEW.
        // We do NOT remove local stations here because the user might have just deleted them
        // and they haven't synced to DB yet (or they are local-only).
        
        const mergedStations: RadioStation[] = stations.map(localStation => {
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

        const localNames = new Set(stations.map(s => s.name.trim().toLowerCase()));
        let hasNewFromDb = false;

        // Add DB-only stations that don't exist locally (genuinely new from other clients/cloud)
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
