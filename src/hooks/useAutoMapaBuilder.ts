/**
 * Auto Mapa Builder - JIT Service
 * 
 * Builds mapa slots ~20 minutes before their scheduled time.
 * Respects anti-repetition across both grade and mapa.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { resolveTemplateLine, formatResolvedLine, resetMapasPools } from '@/lib/mapasBuilder/resolver';
import { loadCrossDayBuffer } from '@/lib/crossDayRepetition';
import { reportServiceHeartbeat } from '@/hooks/useServiceWatchdog';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
const MINUTES_BEFORE = 20;
const CHECK_INTERVAL_MS = 60_000; // every minute

// Track which slots have been built (reset daily)
const BUILT_KEY = 'pgmr_mapa_built_slots';

function getBuiltSlots(): Set<string> {
  try {
    const raw = localStorage.getItem(BUILT_KEY);
    if (!raw) return new Set();
    const data = JSON.parse(raw);
    // Reset if from a different day
    const today = new Date().toDateString();
    if (data.day !== today) return new Set();
    return new Set(data.slots || []);
  } catch { return new Set(); }
}

function markSlotBuilt(key: string) {
  const built = getBuiltSlots();
  built.add(key);
  localStorage.setItem(BUILT_KEY, JSON.stringify({
    day: new Date().toDateString(),
    slots: Array.from(built),
  }));
}

// Map JS day-of-week (0=Sun) to template index in the 7-day array [dom,seg,ter,qua,qui,sex,sab]
const DAY_TO_TEMPLATE_INDEX: number[] = [0, 1, 2, 3, 4, 5, 6];

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function useAutoMapaBuilder() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const buildingRef = useRef(false);

  const buildDueSlots = useCallback(async () => {
    if (!isElectron || buildingRef.current) return;
    
    const store = useRadioStore.getState();
    const { mapasConfig, config } = store;
    
    if (!mapasConfig.enabled || !mapasConfig.templates?.length) return;
    
    const now = new Date();
    const dow = now.getDay();
    const dayConfig = DAY_CONFIG[dow];
    const template = mapasConfig.templates[dayConfig.tmplIdx];
    const outputFilename = dayConfig.filename;
    if (!template?.lines?.length) return;
    
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const built = getBuiltSlots();

    // Find slots due in the next MINUTES_BEFORE
    const dueSlots: { lineIdx: number; time: string }[] = [];
    for (let i = 0; i < template.lines.length; i++) {
      const line = template.lines[i];
      const slotMin = timeToMinutes(line.time);
      const diff = slotMin - nowMinutes;
      // Handle midnight wrap: if slot is e.g. 00:55 and now is 23:35, diff = -1360
      // We want to build it if it's 20 min away in either direction
      const normalizedDiff = diff < -720 ? diff + 1440 : diff > 720 ? diff - 1440 : diff;
      
      const slotKey = `${outputFilename}:${line.time}:${now.toDateString()}`;
      if (normalizedDiff > 0 && normalizedDiff <= MINUTES_BEFORE && !built.has(slotKey)) {
        dueSlots.push({ lineIdx: i, time: line.time });
      }
    }

    if (dueSlots.length === 0) return;

    buildingRef.current = true;
    console.log(`[MAPA-JIT] 🕐 Building ${dueSlots.length} due slot(s): ${dueSlots.map(s => s.time).join(', ')}`);

    try {
      // Load cross-day buffer to check grade's used songs
      const gradeUsed = loadCrossDayBuffer();
      const usedArtists = new Set(gradeUsed.map(s => s.artist.toLowerCase()));
      const usedTitles = new Set(gradeUsed.map(s => `${s.artist}|${s.title}`.toLowerCase()));
      
      console.log(`[MAPA-JIT] 📊 Grade anti-repetição: ${usedArtists.size} artistas, ${usedTitles.size} músicas recentes`);

      // Build the full file (all slots), but with fresh pools
      resetMapasPools();
      const cache = new Map<string, string[]>();
      const allLines: string[] = [];
      
      for (const line of template.lines) {
        const resolved = await resolveTemplateLine(line, mapasConfig, config.musicFolders, cache);
        allLines.push(formatResolvedLine(resolved));
      }

      // Save to disk with day-specific filename
      const result = await window.electronAPI!.saveGradeFile({
        folder: mapasConfig.outputFolder,
        filename: outputFilename,
        content: allLines.join('\n'),
      });

      if (result.success) {
        for (const slot of dueSlots) {
          const slotKey = `${outputFilename}:${slot.time}:${now.toDateString()}`;
          markSlotBuilt(slotKey);
        }
        console.log(`[MAPA-JIT] ✅ ${outputFilename} salvo com ${allLines.length} linhas (${['dom','seg','ter','qua','qui','sex','sáb'][dow]})`);
        reportServiceHeartbeat('mapa-jit');
      }
    } catch (err) {
      console.error('[MAPA-JIT] ❌ Erro:', err);
    } finally {
      buildingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isElectron) return;

    // Initial build check after 30s
    const initialTimer = setTimeout(buildDueSlots, 30_000);
    
    // Regular interval
    timerRef.current = setInterval(buildDueSlots, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [buildDueSlots]);

  return { buildDueSlots };
}
