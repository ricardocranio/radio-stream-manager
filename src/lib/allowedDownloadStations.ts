/**
 * Returns the Set of station names (lowercase) that are allowed for automatic downloads.
 * Only stations that appear in the active sequence OR have `prioritizeDownloads` enabled
 * should trigger downloads. This prevents filling the disk with songs from every monitored station.
 */

import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { STATION_ID_TO_DB_NAME } from '@/lib/gradeBuilder/constants';

export function getAllowedDownloadStations(): Set<string> {
  const state = useRadioStore.getState();
  const { stations, scheduledSequences, sequence } = state;
  const allowed = new Set<string>();

  // 1. Stations with autoDownloadEnabled or prioritizeDownloads flag (must be enabled)
  for (const s of stations) {
    if (s.enabled && (s.autoDownloadEnabled || s.prioritizeDownloads)) {
      allowed.add(s.name.toLowerCase());
    }
  }

  // 2. Stations from the default sequence (only if enabled in the station list)
  const enabledNames = new Set(stations.filter(s => s.enabled).map(s => s.name.toLowerCase()));
  
  for (const seq of sequence) {
    const dbName = STATION_ID_TO_DB_NAME[seq.radioSource] || STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()];
    if (dbName && enabledNames.has(dbName.toLowerCase())) {
      allowed.add(dbName.toLowerCase());
    }
    const station = stations.find(s => s.id === seq.radioSource || s.name.toLowerCase() === seq.radioSource.toLowerCase());
    if (station && station.enabled) {
      allowed.add(station.name.toLowerCase());
    }
  }

  // 3. Stations from all enabled scheduled sequences (only if enabled in the station list)
  for (const sched of scheduledSequences) {
    if (!sched.enabled) continue;
    for (const seq of sched.sequence) {
      const dbName = STATION_ID_TO_DB_NAME[seq.radioSource] || STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()];
      if (dbName && enabledNames.has(dbName.toLowerCase())) {
        allowed.add(dbName.toLowerCase());
      }
      const station = stations.find(s => s.id === seq.radioSource || s.name.toLowerCase() === seq.radioSource.toLowerCase());
      if (station && station.enabled) {
        allowed.add(station.name.toLowerCase());
      }
    }
  }

  return allowed;
}

/**
 * Check if a given station name is allowed for auto-download.
 */
export function isStationAllowedForDownload(stationName: string | undefined | null): boolean {
  if (!stationName) return false;
  const allowed = getAllowedDownloadStations();
  return allowed.has(stationName.toLowerCase().trim());
}
