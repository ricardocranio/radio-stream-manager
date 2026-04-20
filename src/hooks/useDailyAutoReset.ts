/**
 * Daily Auto Reset — Scheduled at 01:00 every day.
 *
 * Runs the same "Zerar Sistema" flow as the manual button, but automatically.
 * Idempotent: tracks last-run date in localStorage so it never fires twice in a single day,
 * and runs on app boot if 01:00 was missed.
 */
import { useEffect, useRef } from 'react';
import { executeFullSystemReset } from '@/lib/systemReset';
import { useToast } from '@/hooks/use-toast';
import { reportServiceHeartbeat } from '@/hooks/useServiceWatchdog';

const LAST_RUN_KEY = 'pgmr_daily_auto_reset_last_run';
const TARGET_HOUR = 1;
const TARGET_MINUTE = 0;
const CHECK_INTERVAL_MS = 60_000; // 1 minute
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getLastRunDate(): string | null {
  try {
    return localStorage.getItem(LAST_RUN_KEY);
  } catch {
    return null;
  }
}

function markRanToday() {
  try {
    localStorage.setItem(LAST_RUN_KEY, todayKey());
  } catch {
    /* ignore */
  }
}

export function useDailyAutoReset() {
  const { toast } = useToast();
  const runningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const tryRun = async (reason: 'scheduled' | 'boot-catchup') => {
      if (cancelled || runningRef.current) return;

      const now = new Date();
      const today = todayKey();
      const lastRun = getLastRunDate();

      // Already ran today
      if (lastRun === today) return;

      // For scheduled trigger: only between 01:00 and 01:59
      // For boot-catchup: only if it's PAST 01:00 today AND we missed it
      if (reason === 'scheduled') {
        if (now.getHours() !== TARGET_HOUR) return;
      } else {
        // boot-catchup: must be past 01:00 today
        if (now.getHours() < TARGET_HOUR) return;
      }

      runningRef.current = true;
      console.log(`[AUTO-RESET] 🕐 Disparando reset diário (${reason}) às ${now.toLocaleTimeString()}`);

      try {
        // Use safest defaults for automated runs:
        // - clearSupabase: true (we want fresh capture pool)
        // - clearSchedules: false (keep user-configured monitoring)
        // - resetStations: false (keep stations enabled)
        const result = await executeFullSystemReset({
          clearSupabase: true,
          clearSchedules: false,
          resetStations: false,
        });

        markRanToday();
        reportServiceHeartbeat('daily-auto-reset');

        if (result.ok) {
          console.log(`[AUTO-RESET] ✅ Reset diário concluído (${result.clearedKeys} chaves, supabase: ${result.supabase})`);
          toast({
            title: '🔄 Reset Diário Automático',
            description: `Sistema resetado às 01:00 (${result.clearedKeys} chaves limpas). Configurações preservadas.`,
          });
        } else {
          console.warn('[AUTO-RESET] ⚠️ Reset com falhas:', result.error);
        }
      } catch (e) {
        console.error('[AUTO-RESET] ❌ Erro:', e);
      } finally {
        runningRef.current = false;
      }
    };

    // Boot catch-up: if app starts after 01:00 and we haven't run today
    const bootTimer = setTimeout(() => tryRun('boot-catchup'), 30_000);

    // Regular minute-by-minute check for the 01:00 window
    const interval = setInterval(() => tryRun('scheduled'), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(bootTimer);
      clearInterval(interval);
    };
  }, [toast]);

  return { isElectron };
}
