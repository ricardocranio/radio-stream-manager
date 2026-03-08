/**
 * Service Watchdog
 * 
 * Monitors background services for "silent deaths" and reports status.
 * Checks every 2 minutes that key timestamps are being updated.
 * If a service appears stalled, logs a warning.
 */

import { useEffect, useRef } from 'react';
import { logSystemError } from '@/store/gradeLogStore';

const WATCHDOG_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const STALE_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes = considered stalled

// Module-level heartbeat registry
const heartbeats: Record<string, number> = {};

/** Services call this to report they're alive */
export function reportServiceHeartbeat(serviceName: string): void {
  heartbeats[serviceName] = Date.now();
}

/** Check if a service has reported recently */
export function isServiceAlive(serviceName: string): boolean {
  const last = heartbeats[serviceName];
  if (!last) return false;
  return (Date.now() - last) < STALE_THRESHOLD_MS;
}

/** Get all service statuses */
export function getServiceStatuses(): Record<string, { alive: boolean; lastHeartbeat: number | null; staleSinceMin: number | null }> {
  const result: Record<string, { alive: boolean; lastHeartbeat: number | null; staleSinceMin: number | null }> = {};
  const expectedServices = ['scraping', 'downloads', 'grade-builder', 'captured-downloads', 'maintenance'];

  for (const name of expectedServices) {
    const last = heartbeats[name] || null;
    const alive = last ? (Date.now() - last) < STALE_THRESHOLD_MS : false;
    const staleSinceMin = last ? Math.round((Date.now() - last) / 60000) : null;
    result[name] = { alive, lastHeartbeat: last, staleSinceMin };
  }
  return result;
}

export function useServiceWatchdog() {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const check = () => {
      const statuses = getServiceStatuses();
      const stalled: string[] = [];

      for (const [name, status] of Object.entries(statuses)) {
        if (status.lastHeartbeat && !status.alive) {
          stalled.push(`${name} (${status.staleSinceMin}min sem atividade)`);
        }
      }

      if (stalled.length > 0) {
        const msg = `Serviços possivelmente travados: ${stalled.join(', ')}`;
        console.warn(`[WATCHDOG] ⚠️ ${msg}`);
        logSystemError('SYSTEM', 'warning', 'Serviço parado detectado', msg);
      }
    };

    intervalRef.current = setInterval(check, WATCHDOG_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { start: () => {} };
}
