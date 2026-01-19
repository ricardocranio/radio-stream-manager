import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRadioStore } from '@/store/radioStore';
import { toast } from 'sonner';

// Type for WeekDay (same as in radio.ts)
type WeekDay = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';

// Type for special_monitoring table (not yet in generated types)
interface SpecialMonitoringRow {
  id: string;
  station_name: string;
  scrape_url: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  week_days: string[];
  label: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Hook that syncs local special monitoring schedules to Supabase
 */
export function useSyncSpecialMonitoring() {
  const stations = useRadioStore((state) => state.stations);

  const syncSpecialMonitoring = useCallback(async () => {
    try {
      // Get all stations with monitoring schedules
      const stationsWithSchedules = stations.filter(
        s => s.monitoringSchedules && s.monitoringSchedules.length > 0
      );

      // Get current schedules from Supabase (using any to bypass type check for new table)
      const { data: supabaseSchedules, error: fetchError } = await (supabase as any)
        .from('special_monitoring')
        .select('*') as { data: SpecialMonitoringRow[] | null; error: any };

      if (fetchError) {
        console.error('Error fetching special monitoring:', fetchError);
        return;
      }

      const existingIds = new Set((supabaseSchedules || []).map(s => s.id));

      // Collect all local schedules
      const allLocalSchedules: Array<{
        stationName: string;
        scrapeUrl: string;
        schedule: {
          id: string;
          hour: number;
          minute: number;
          endHour: number;
          endMinute: number;
          enabled: boolean;
          label?: string;
          customUrl?: string;
          weekDays?: WeekDay[];
        };
      }> = [];

      for (const station of stationsWithSchedules) {
        for (const schedule of station.monitoringSchedules || []) {
          allLocalSchedules.push({
            stationName: station.name,
            scrapeUrl: schedule.customUrl || station.scrapeUrl || '',
            schedule,
          });
        }
      }

      // Upsert each schedule
      for (const item of allLocalSchedules) {
        const scheduleData = {
          id: item.schedule.id,
          station_name: item.stationName,
          scrape_url: item.scrapeUrl,
          start_hour: item.schedule.hour,
          start_minute: item.schedule.minute,
          end_hour: item.schedule.endHour,
          end_minute: item.schedule.endMinute,
          week_days: item.schedule.weekDays || ['seg', 'ter', 'qua', 'qui', 'sex'],
          label: item.schedule.label || null,
          enabled: item.schedule.enabled,
        };

        const { error } = await (supabase as any)
          .from('special_monitoring')
          .upsert(scheduleData, { onConflict: 'id' });

        if (error) {
          console.error('Error upserting special monitoring:', error);
        }
      }

      // Remove schedules that no longer exist locally
      const localIds = new Set(allLocalSchedules.map(s => s.schedule.id));
      for (const existingId of existingIds) {
        if (!localIds.has(existingId)) {
          await (supabase as any)
            .from('special_monitoring')
            .delete()
            .eq('id', existingId);
        }
      }

      console.log('✅ Special monitoring synced to Supabase');
    } catch (error) {
      console.error('Error syncing special monitoring:', error);
    }
  }, [stations]);

  // Sync on mount and when stations change
  useEffect(() => {
    syncSpecialMonitoring();
  }, [syncSpecialMonitoring]);

  return { syncSpecialMonitoring };
}

/**
 * Manual sync function for special monitoring
 */
export async function syncSpecialMonitoringToSupabase(
  schedules: Array<{
    id: string;
    stationName: string;
    scrapeUrl: string;
    hour: number;
    minute: number;
    endHour: number;
    endMinute: number;
    weekDays: WeekDay[];
    label?: string;
    enabled: boolean;
  }>
) {
  try {
    // Clear existing and insert new
    await (supabase as any)
      .from('special_monitoring')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    for (const schedule of schedules) {
      const { error } = await (supabase as any)
        .from('special_monitoring')
        .insert({
          id: schedule.id,
          station_name: schedule.stationName,
          scrape_url: schedule.scrapeUrl,
          start_hour: schedule.hour,
          start_minute: schedule.minute,
          end_hour: schedule.endHour,
          end_minute: schedule.endMinute,
          week_days: schedule.weekDays,
          label: schedule.label || null,
          enabled: schedule.enabled,
        });

      if (error) {
        console.error('Error inserting special monitoring:', error);
      }
    }

    toast.success('Monitoramento especial sincronizado!');
    return true;
  } catch (error) {
    console.error('Error syncing special monitoring:', error);
    toast.error('Erro ao sincronizar monitoramento especial');
    return false;
  }
}

/**
 * Check if current time is within a monitoring schedule
 */
export function isWithinSchedule(
  schedule: { 
    startHour: number; 
    startMinute: number; 
    endHour: number; 
    endMinute: number;
    weekDays?: string[];
  },
  date: Date = new Date()
): boolean {
  const currentHour = date.getHours();
  const currentMinute = date.getMinutes();
  const currentDay = date.getDay(); // 0 = Sunday

  // Map day of week
  const dayMap: Record<number, string> = {
    0: 'dom',
    1: 'seg',
    2: 'ter',
    3: 'qua',
    4: 'qui',
    5: 'sex',
    6: 'sab',
  };

  // Check if current day is in weekDays
  if (schedule.weekDays && schedule.weekDays.length > 0) {
    if (!schedule.weekDays.includes(dayMap[currentDay])) {
      return false;
    }
  }

  // Convert to minutes for easier comparison
  const currentMins = currentHour * 60 + currentMinute;
  const startMins = schedule.startHour * 60 + schedule.startMinute;
  const endMins = schedule.endHour * 60 + schedule.endMinute;

  return currentMins >= startMins && currentMins <= endMins;
}