/**
 * Returns the Set of station names (lowercase) that are allowed for automatic downloads.
 * Only stations that appear in the active sequence OR have `prioritizeDownloads` enabled
 * should trigger downloads. This prevents filling the disk with songs from every monitored station.
 */

import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { STATION_ID_TO_DB_NAME } from '@/lib/gradeBuilder/constants';

// Cache memoizado com TTL de 30s — evita recalcular a cada item da fila
let _allowedCache: Set<string> | null = null;
let _allowedCacheAt = 0;
const ALLOWED_CACHE_TTL_MS = 30_000;

export function getAllowedDownloadStations(): Set<string> {
  const now = Date.now();

  if (_allowedCache && now - _allowedCacheAt < ALLOWED_CACHE_TTL_MS) {
    return _allowedCache;
  }

  const state = useRadioStore.getState();
  const { stations, scheduledSequences, sequence } = state;
  const allowed = new Set<string>();

  // 1. Stations with autoDownloadEnabled or prioritizeDownloads flag
  for (const s of stations) {
    if (s.autoDownloadEnabled || s.prioritizeDownloads) {
      allowed.add(s.name.toLowerCase());
    }
  }

  // 2. Stations from the default sequence
  for (const seq of sequence) {
    const dbName = STATION_ID_TO_DB_NAME[seq.radioSource] || STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()];
    if (dbName) {
      allowed.add(dbName.toLowerCase());
    }
    const station = stations.find(s => s.id === seq.radioSource || s.name.toLowerCase() === seq.radioSource.toLowerCase());
    if (station) {
      allowed.add(station.name.toLowerCase());
    }
  }

  // 3. Stations from all enabled scheduled sequences
  for (const sched of scheduledSequences) {
    if (!sched.enabled) continue;
    for (const seq of sched.sequence) {
      const dbName = STATION_ID_TO_DB_NAME[seq.radioSource] || STATION_ID_TO_DB_NAME[seq.radioSource.toLowerCase()];
      if (dbName) {
        allowed.add(dbName.toLowerCase());
      }
      const station = stations.find(s => s.id === seq.radioSource || s.name.toLowerCase() === seq.radioSource.toLowerCase());
      if (station) {
        allowed.add(station.name.toLowerCase());
      }
    }
  }

  _allowedCache = allowed;
  _allowedCacheAt = now;

  return allowed;
}

/**
 * Invalida o cache manualmente (chamar quando stations/sequences mudarem).
 */
export function invalidateAllowedStationsCache(): void {
  _allowedCache = null;
  _allowedCacheAt = 0;
}

/**
 * Check if a given station name is allowed for auto-download.
 */
export function isStationAllowedForDownload(stationName: string | undefined | null): boolean {
  if (!stationName) return false;
  const allowed = getAllowedDownloadStations();
  return allowed.has(stationName.toLowerCase().trim());
}
