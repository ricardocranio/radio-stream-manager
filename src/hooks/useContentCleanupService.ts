/**
 * Content Folder Cleanup Service
 * 
 * Automatically cleans the "Conteudos KF" folder 15 minutes before
 * each fixed content program starts (same logic as Voz do Brasil / Notícias).
 * 
 * This ensures fresh content is always ready for the next program block.
 */

import { useRef, useCallback } from 'react';
import { useRadioStore, FixedContent } from '@/store/radioStore';
import { reportServiceHeartbeat } from '@/hooks/useServiceWatchdog';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
const CHECK_INTERVAL_MS = 60_000; // check every minute
const MINUTES_BEFORE = 15; // clean 15 min before program

// Default folder — user can override via localStorage
const DEFAULT_CONTENT_FOLDER = 'G:\\Outros computadores\\Meu computador\\Conteudos KF';

// Track which cleanups have run today (avoid repeating)
const CLEANED_KEY = 'pgmr_content_cleaned_slots';

function getCleanedSlots(): Set<string> {
  try {
    const raw = localStorage.getItem(CLEANED_KEY);
    if (!raw) return new Set();
    const data = JSON.parse(raw);
    if (data.day !== new Date().toDateString()) return new Set();
    return new Set(data.slots || []);
  } catch { return new Set(); }
}

function markSlotCleaned(key: string) {
  const cleaned = getCleanedSlots();
  cleaned.add(key);
  localStorage.setItem(CLEANED_KEY, JSON.stringify({
    day: new Date().toDateString(),
    slots: Array.from(cleaned),
  }));
}

/** Check if a dayPattern matches the current day */
function matchesDay(dayPattern: string, dow: number): boolean {
  const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  switch (dayPattern) {
    case 'ALL': return true;
    case 'WEEKDAYS': return dow >= 1 && dow <= 5;
    case 'WEEKEND': return dow === 0 || dow === 6;
    default: return dayPattern === dayNames[dow];
  }
}

export function useContentCleanupService() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleaningRef = useRef(false);

  const getFolder = useCallback((): string => {
    try {
      const saved = localStorage.getItem('contentCleanupConfig');
      if (saved) {
        const config = JSON.parse(saved);
        return config.folder || DEFAULT_CONTENT_FOLDER;
      }
    } catch {}
    return DEFAULT_CONTENT_FOLDER;
  }, []);

  const cleanFolder = useCallback(async (folder: string): Promise<{ success: boolean; deletedCount: number }> => {
    if (!isElectron || !window.electronAPI?.cleanupContentFolder) {
      return { success: false, deletedCount: 0 };
    }

    try {
      const result = await window.electronAPI.cleanupContentFolder({ folder });
      return { success: result.success, deletedCount: result.deletedCount || 0 };
    } catch (err) {
      console.error('[CONTENT-CLEANUP] ❌ Erro na limpeza:', err);
      return { success: false, deletedCount: 0 };
    }
  }, []);

  const checkAndClean = useCallback(async () => {
    if (!isElectron || cleaningRef.current) return;

    const { fixedContent } = useRadioStore.getState();
    if (!fixedContent?.length) return;

    const now = new Date();
    const dow = now.getDay();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const cleaned = getCleanedSlots();
    const folder = getFolder();

    // Find fixed programs that start in the next MINUTES_BEFORE
    const dueSlots: { name: string; time: string }[] = [];

    for (const fc of fixedContent) {
      if (!fc.enabled) continue;
      if (!matchesDay(fc.dayPattern, dow)) continue;

      for (const slot of fc.timeSlots) {
        const slotMinutes = slot.hour * 60 + slot.minute;
        const diff = slotMinutes - nowMinutes;
        // Handle midnight wrap
        const normalizedDiff = diff < -720 ? diff + 1440 : diff > 720 ? diff - 1440 : diff;

        const slotKey = `${fc.id}:${slot.hour}:${slot.minute}:${now.toDateString()}`;
        
        if (normalizedDiff > 0 && normalizedDiff <= MINUTES_BEFORE && !cleaned.has(slotKey)) {
          dueSlots.push({ 
            name: fc.name, 
            time: `${slot.hour.toString().padStart(2, '0')}:${slot.minute.toString().padStart(2, '0')}` 
          });
          // Mark all due slots for this check
          markSlotCleaned(slotKey);
        }
      }
    }

    if (dueSlots.length === 0) return;

    cleaningRef.current = true;
    
    // Only clean once (first due slot triggers the cleanup for all)
    const programNames = [...new Set(dueSlots.map(s => s.name))].join(', ');
    const times = dueSlots.map(s => s.time).join(', ');
    console.log(`[CONTENT-CLEANUP] 🗑️ Limpando "${folder}" — programa(s): ${programNames} às ${times}`);

    try {
      const result = await cleanFolder(folder);
      
      if (result.success) {
        if (result.deletedCount > 0) {
          console.log(`[CONTENT-CLEANUP] ✅ ${result.deletedCount} arquivo(s) removido(s) antes de: ${programNames}`);
          
          if (window.electronAPI?.showNotification) {
            window.electronAPI.showNotification(
              '🗑️ Conteúdos KF Limpos',
              `${result.deletedCount} arquivo(s) removido(s) — ${programNames} em ${MINUTES_BEFORE} min`
            );
          }
        } else {
          console.log(`[CONTENT-CLEANUP] ✅ Pasta já vazia antes de: ${programNames}`);
        }
        reportServiceHeartbeat('content-cleanup');
      } else {
        console.warn(`[CONTENT-CLEANUP] ⚠️ Limpeza falhou antes de: ${programNames}`);
      }
    } catch (err) {
      console.error('[CONTENT-CLEANUP] ❌ Erro:', err);
    } finally {
      cleaningRef.current = false;
    }
  }, [cleanFolder, getFolder]);

  const start = useCallback(() => {
    if (!isElectron) return () => {};

    console.log(`[CONTENT-CLEANUP] ⏰ Monitorando programas fixos — limpeza ${MINUTES_BEFORE} min antes → ${getFolder()}`);

    // Initial check after 45s
    const initialTimer = setTimeout(checkAndClean, 45_000);

    // Regular check every minute
    intervalRef.current = setInterval(checkAndClean, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkAndClean, getFolder]);

  return { start, checkAndClean };
}
