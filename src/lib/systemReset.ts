/**
 * System Reset — Reusable Logic
 *
 * Extracted from DashboardView so the same "Zerar Sistema" flow can be invoked
 * both manually (button) and automatically (daily 01:00 scheduler).
 *
 * Preserves: config, deezerConfig, songAliases, stations, fixedContent,
 *            sequence, scheduledSequences, programs, mapasConfig, autoScrapeEnabled.
 */
import { supabase } from '@/integrations/supabase/client';
import { useRadioStore } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useSimilarityLogStore } from '@/store/similarityLogStore';
import { invalidateMusicLibraryCache } from '@/hooks/useMusicLibraryStats';

export interface SystemResetOptions {
  /** Wipe Supabase tables (scraped_songs, radio_historico, etc). */
  clearSupabase: boolean;
  /** Also delete special_monitoring rows. */
  clearSchedules: boolean;
  /** Disable all radio_stations rows. */
  resetStations: boolean;
}

export interface SystemResetResult {
  ok: boolean;
  clearedKeys: number;
  supabase: 'skipped' | 'ok' | 'error';
  error?: string;
}

const DEFAULT_OPTIONS: SystemResetOptions = {
  clearSupabase: true,
  clearSchedules: false,
  resetStations: false,
};

/**
 * Execute a full system reset preserving user configurations.
 * Safe to call from a scheduler — never throws, returns result object.
 */
export async function executeFullSystemReset(
  options: Partial<SystemResetOptions> = {},
): Promise<SystemResetResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const result: SystemResetResult = {
    ok: false,
    clearedKeys: 0,
    supabase: 'skipped',
  };

  try {
    // 1. Clear local Zustand stores
    const store = useRadioStore.getState();
    store.clearCapturedSongs();
    store.clearMissingSongs();
    store.clearDownloadHistory();
    store.clearGradeHistory();
    store.clearRanking();
    useAutoDownloadStore.getState().resetQueue();
    useSimilarityLogStore.getState().resetStats();
    store.setBatchDownloadProgress({
      isRunning: false,
      total: 0,
      completed: 0,
      failed: 0,
      current: '',
    });
    console.log('[AUTO-RESET] ✅ Local stores cleared');

    // 2. Clear Supabase via Edge Function
    if (opts.clearSupabase) {
      try {
        const { data, error } = await supabase.functions.invoke('manage-special-monitoring', {
          body: {
            action: 'full-system-reset',
            data: {
              clearSchedules: opts.clearSchedules,
              resetStations: opts.resetStations,
            },
          },
        });
        if (error) {
          console.warn('[AUTO-RESET] ⚠️ Supabase reset error:', error.message);
          result.supabase = 'error';
        } else {
          console.log('[AUTO-RESET] ✅ Supabase cleared:', data);
          result.supabase = 'ok';
        }
      } catch (e) {
        console.warn('[AUTO-RESET] ⚠️ Supabase exception:', e);
        result.supabase = 'error';
      }
    }

    // 3. Preserve user configs, then clear transient localStorage keys
    const preservedConfig = { ...store.config };
    const preservedDeezerConfig = { ...store.deezerConfig };
    const preservedAliases = [...store.songAliases];
    const preservedStations = [...store.stations];
    const preservedFixedContent = [...store.fixedContent];
    const preservedSequence = [...store.sequence];
    const preservedScheduledSeq = [...store.scheduledSequences];
    const preservedPrograms = [...store.programs];
    const preservedMapasConfig = store.mapasConfig ? { ...store.mapasConfig } : undefined;
    const preservedAutoScrape = store.autoScrapeEnabled;

    const keysToPreserve = ['vozBrasilConfig', 'theme', 'supabase.auth.token', 'pgm-radio-storage'];
    const allKeys = Object.keys(localStorage);

    allKeys.forEach((key) => {
      if (key.startsWith('supabase') || keysToPreserve.some((k) => key === k || key.includes(k))) {
        return;
      }
      if (
        key.includes('grade') ||
        key.includes('similarity') ||
        key.includes('stats') ||
        key.includes('ranking') ||
        key.includes('download') ||
        key.includes('missing') ||
        key.includes('captured') ||
        key === 'auto-download-storage' ||
        key === 'realtime-stats-storage' ||
        key === 'similarity-log-storage' ||
        key === 'pgmr_last_id3_scan' ||
        key === 'pgmr_lib_cache' ||
        key === 'pgmr_offline_songs'
      ) {
        localStorage.removeItem(key);
        result.clearedKeys++;
      }
    });
    console.log(`[AUTO-RESET] 🧹 ${result.clearedKeys} localStorage keys cleared (configs preserved)`);

    // 4. Restore preserved configs
    useRadioStore.setState({
      config: preservedConfig,
      deezerConfig: preservedDeezerConfig,
      songAliases: preservedAliases,
      stations: preservedStations,
      fixedContent: preservedFixedContent,
      sequence: preservedSequence,
      scheduledSequences: preservedScheduledSeq,
      programs: preservedPrograms,
      mapasConfig: preservedMapasConfig || store.mapasConfig,
      autoScrapeEnabled: preservedAutoScrape,
    });

    // 5. Clear realtime stats store
    try {
      const { useRealtimeStatsStore } = await import('@/store/realtimeStatsStore');
      useRealtimeStatsStore.getState().reset();
    } catch {
      /* ignore */
    }

    // 6. Invalidate music library cache
    invalidateMusicLibraryCache();

    result.ok = true;
    return result;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    console.error('[AUTO-RESET] ❌ Failed:', result.error);
    return result;
  }
}
