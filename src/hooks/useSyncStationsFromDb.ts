import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRadioStore } from '@/store/radioStore';
import { RadioStation } from '@/types/radio';

/**
 * Hook that syncs stations from Supabase database to local store on mount.
 * Merges DB stations with local stations, prioritizing DB data.
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

        // Create a map of existing local stations by name (normalized)
        const localStationsByName = new Map<string, RadioStation>();
        stations.forEach(s => {
          localStationsByName.set(s.name.trim().toLowerCase(), s);
        });

        // Merge: DB is the source of truth — only include enabled DB stations
        const mergedStations: RadioStation[] = [];
        const seenNames = new Set<string>();

        for (const dbStation of dbStations) {
          // Skip disabled stations entirely — they should not appear in the local store
          if (dbStation.enabled === false) continue;

          const normalizedName = dbStation.name.trim().toLowerCase();
          
          if (seenNames.has(normalizedName)) continue;
          seenNames.add(normalizedName);

          const localStation = localStationsByName.get(normalizedName);
          
          mergedStations.push({
            id: localStation?.id || dbStation.id,
            name: dbStation.name.trim(),
            urls: localStation?.urls || [],
            scrapeUrl: dbStation.scrape_url,
            styles: dbStation.styles || localStation?.styles || [],
            enabled: true,
            monitoringSchedules: localStation?.monitoringSchedules,
          });
        }

        // Only update if there are changes
        if (mergedStations.length !== stations.length || 
            mergedStations.some((s, i) => s.id !== stations[i]?.id || s.name !== stations[i]?.name)) {
          console.log('[SYNC-FROM-DB] Updating stations from DB:', mergedStations.length);
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
