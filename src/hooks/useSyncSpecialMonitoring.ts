import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRadioStore } from '@/store/radioStore';
import { toast } from 'sonner';

// Type for WeekDay (same as in radio.ts)
type WeekDay = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';

// Type for special_monitoring table
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
 * Hook that loads special monitoring schedules from Supabase
 * NOTE: This hook NO LONGER syncs local data TO Supabase
 * All saves/updates/deletes are now done directly in SpecialMonitoringView
 */
export function useSyncSpecialMonitoring() {
  // This hook is now a no-op to prevent conflicts with direct Cloud saves
  // The SpecialMonitoringView handles all CRUD operations directly with Supabase
  return { syncSpecialMonitoring: async () => {} };
}

/**
 * Fetch all special monitoring schedules from Cloud
 */
export async function fetchSpecialMonitoringFromCloud(): Promise<SpecialMonitoringRow[]> {
  try {
    const { data, error } = await supabase
      .from('special_monitoring')
      .select('*')
      .order('start_hour', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching special monitoring:', error);
    return [];
  }
}

/**
 * Add a new special monitoring schedule to Cloud
 */
export async function addSpecialMonitoringToCloud(schedule: {
  stationName: string;
  scrapeUrl: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  weekDays: string[];
  label?: string;
  enabled?: boolean;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('special_monitoring')
      .insert({
        station_name: schedule.stationName,
        scrape_url: schedule.scrapeUrl,
        start_hour: schedule.startHour,
        start_minute: schedule.startMinute,
        end_hour: schedule.endHour,
        end_minute: schedule.endMinute,
        week_days: schedule.weekDays,
        label: schedule.label || null,
        enabled: schedule.enabled ?? true,
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, id: data?.id };
  } catch (error: any) {
    console.error('Error adding special monitoring:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update an existing special monitoring schedule in Cloud
 */
export async function updateSpecialMonitoringInCloud(
  id: string,
  updates: {
    stationName?: string;
    scrapeUrl?: string;
    startHour?: number;
    startMinute?: number;
    endHour?: number;
    endMinute?: number;
    weekDays?: string[];
    label?: string | null;
    enabled?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: Record<string, any> = {};
    if (updates.stationName !== undefined) updateData.station_name = updates.stationName;
    if (updates.scrapeUrl !== undefined) updateData.scrape_url = updates.scrapeUrl;
    if (updates.startHour !== undefined) updateData.start_hour = updates.startHour;
    if (updates.startMinute !== undefined) updateData.start_minute = updates.startMinute;
    if (updates.endHour !== undefined) updateData.end_hour = updates.endHour;
    if (updates.endMinute !== undefined) updateData.end_minute = updates.endMinute;
    if (updates.weekDays !== undefined) updateData.week_days = updates.weekDays;
    if (updates.label !== undefined) updateData.label = updates.label;
    if (updates.enabled !== undefined) updateData.enabled = updates.enabled;

    const { error } = await supabase
      .from('special_monitoring')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('Error updating special monitoring:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete a special monitoring schedule from Cloud
 */
export async function deleteSpecialMonitoringFromCloud(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('special_monitoring')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting special monitoring:', error);
    return { success: false, error: error.message };
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
