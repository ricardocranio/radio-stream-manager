/**
 * Content Folder Cleanup Service
 * 
 * Two cleanup tasks:
 * 1. PkInfo cleanup: 15 minutes before each fixed content program
 * 2. Old day files cleanup: Deletes files from past weekdays daily
 *    (e.g. on Thursday, deletes Monday/Tuesday/Wednesday files)
 */

import { useRef, useCallback } from 'react';
import { useRadioStore, FixedContent } from '@/store/radioStore';
import { reportServiceHeartbeat } from '@/hooks/useServiceWatchdog';
import { clearGradeStorage } from '@/lib/gradeBuilder/gradePersistence';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
const CHECK_INTERVAL_MS = 60_000; // check every minute
const MINUTES_BEFORE = 15; // clean 15 min before program

// Default folder — user can override via localStorage
const DEFAULT_CONTENT_FOLDER = 'G:\\Outros computadores\\Meu computador\\Conteudos KF';

// Track which cleanups have run today (avoid repeating)
const CLEANED_KEY = 'pgmr_content_cleaned_slots';
const OLD_DAY_CLEANED_KEY = 'pgmr_old_day_cleaned';

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

function hasOldDayCleanedToday(): boolean {
  try {
    const raw = localStorage.getItem(OLD_DAY_CLEANED_KEY);
    return raw === new Date().toDateString();
  } catch { return false; }
}

function markOldDayCleaned() {
  localStorage.setItem(OLD_DAY_CLEANED_KEY, new Date().toDateString());
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

  /** Delete files from past weekdays (e.g. on Thursday delete Mon/Tue/Wed files) */
  const cleanOldDayFiles = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.cleanupOldDayFiles) return;
    if (hasOldDayCleanedToday()) return;

    const folder = getFolder();
    console.log(`[CONTENT-CLEANUP] 🗓️ Verificando arquivos de dias passados em: ${folder}`);

    try {
      const result = await window.electronAPI.cleanupOldDayFiles({ folder });

      if (result.success) {
        markOldDayCleaned();

        if (result.deletedCount > 0) {
          console.log(`[CONTENT-CLEANUP] ✅ ${result.deletedCount} arquivo(s) de dias passados removidos: ${result.deletedFiles.join(', ')}`);
          console.log(`[CONTENT-CLEANUP] 📅 Dias mantidos: ${result.keptDays.join(', ')}`);

          if (window.electronAPI?.showNotification) {
            window.electronAPI.showNotification(
              '🗓️ Limpeza de Dias Passados',
              `${result.deletedCount} arquivo(s) removidos de Conteudos KF. Mantidos: ${result.keptDays.join(', ')}`
            );
          }
        } else {
          console.log(`[CONTENT-CLEANUP] ✅ Nenhum arquivo de dia passado encontrado. Dias mantidos: ${result.keptDays.join(', ')}`);
        }
        reportServiceHeartbeat('content-cleanup');
      }
    } catch (err) {
      console.error('[CONTENT-CLEANUP] ❌ Erro na limpeza de dias passados:', err);
    }
  }, [getFolder]);

  const checkAndClean = useCallback(async () => {
    if (!isElectron || cleaningRef.current) return;

    // === 1. Clean old day files (once per day) ===
    await cleanOldDayFiles();

    // === 2. PkInfo cleanup before fixed programs ===
    const { fixedContent } = useRadioStore.getState();
    if (!fixedContent?.length) return;

    const now = new Date();
    const dow = now.getDay();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const cleaned = getCleanedSlots();
    const folder = getFolder();

    const dueSlots: { name: string; time: string }[] = [];

    for (const fc of fixedContent) {
      if (!fc.enabled) continue;
      if (!matchesDay(fc.dayPattern, dow)) continue;

      for (const slot of fc.timeSlots) {
        const slotMinutes = slot.hour * 60 + slot.minute;
        const diff = slotMinutes - nowMinutes;
        const normalizedDiff = diff < -720 ? diff + 1440 : diff > 720 ? diff - 1440 : diff;

        const slotKey = `${fc.id}:${slot.hour}:${slot.minute}:${now.toDateString()}`;
        
        if (normalizedDiff > 0 && normalizedDiff <= MINUTES_BEFORE && !cleaned.has(slotKey)) {
          dueSlots.push({ 
            name: fc.name, 
            time: `${slot.hour.toString().padStart(2, '0')}:${slot.minute.toString().padStart(2, '0')}` 
          });
          markSlotCleaned(slotKey);
        }
      }
    }

    if (dueSlots.length === 0) return;

    cleaningRef.current = true;
    
    const programNames = [...new Set(dueSlots.map(s => s.name))].join(', ');
    const times = dueSlots.map(s => s.time).join(', ');
    console.log(`[CONTENT-CLEANUP] 🗑️ Removendo PkInfo de "${folder}" — programa(s): ${programNames} às ${times}`);

    try {
      const result = await cleanFolder(folder);
      
      if (result.success) {
        if (result.deletedCount > 0) {
          console.log(`[CONTENT-CLEANUP] ✅ PkInfo removido antes de: ${programNames}`);
          
          if (window.electronAPI?.showNotification) {
            window.electronAPI.showNotification(
              '🗑️ PkInfo Limpo',
              `PkInfo removido de Conteudos KF — ${programNames} em ${MINUTES_BEFORE} min`
            );
          }
        } else {
          console.log(`[CONTENT-CLEANUP] ✅ PkInfo já ausente antes de: ${programNames}`);
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
  }, [cleanFolder, cleanOldDayFiles, getFolder]);

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

  return { start, checkAndClean, cleanOldDayFiles };
}
