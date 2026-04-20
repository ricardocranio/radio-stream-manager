/**
 * Daily Grade Pre-Build (Entrega 1)
 *
 * Garante que a grade completa de 24h (todos os 48 blocos) seja montada
 * uma vez por dia, idealmente logo após o reset diário (01:00) ou no boot
 * caso a janela tenha sido perdida.
 *
 * Regras:
 *  - Idempotente por dia (chave `pgmr_daily_prebuild_last_run` no localStorage).
 *  - Catch-up: se ao subir o app o pre-build de hoje ainda não rodou, dispara
 *    em ~45s (depois do daily-reset que roda em ~30s) para não competir.
 *  - Janela alvo: 01:05–01:15 (logo após reset 01:00).
 *  - Reaproveita `gradeBuilder.buildFullDayGrade()` — toda a lógica de
 *    seleção/anti-repetição/JIT continua intacta. Slots dinâmicos serão
 *    sobrescritos pelo refresh real-time (Entrega 2).
 *
 * Execução: somente em Electron (faz I/O em disco).
 */
import { useEffect, useRef } from 'react';
import { reportServiceHeartbeat } from '@/hooks/useServiceWatchdog';
import type { useAutoGradeBuilder } from '@/hooks/useAutoGradeBuilder';

const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;

const LAST_RUN_KEY = 'pgmr_daily_prebuild_last_run';
const TARGET_HOUR = 1;          // 01:xx
const WINDOW_START_MIN = 5;     // a partir de 01:05
const WINDOW_END_MIN = 15;      // até 01:15
const CHECK_INTERVAL_MS = 60_000;
const BOOT_CATCHUP_DELAY_MS = 45_000;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function alreadyRanToday(): boolean {
  try { return localStorage.getItem(LAST_RUN_KEY) === todayKey(); }
  catch { return false; }
}

function markRanToday(): void {
  try { localStorage.setItem(LAST_RUN_KEY, todayKey()); } catch {}
}

type GradeBuilder = ReturnType<typeof useAutoGradeBuilder>;

export function useDailyGradePreBuild(gradeBuilder: GradeBuilder) {
  const runningRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isElectron) return;

    const runPreBuild = async (reason: string) => {
      if (runningRef.current) return;
      if (alreadyRanToday()) return;

      runningRef.current = true;
      console.log(`[PRE-BUILD-24h] 🌅 Iniciando montagem completa da grade (${reason})`);

      try {
        await gradeBuilder.buildFullDayGrade();
        markRanToday();
        console.log('[PRE-BUILD-24h] ✅ Grade 24h montada — slots dinâmicos serão refinados em tempo real');
        reportServiceHeartbeat('daily-prebuild' as any);
      } catch (err) {
        console.error('[PRE-BUILD-24h] ❌ Erro ao montar grade 24h:', err);
      } finally {
        runningRef.current = false;
      }
    };

    // 1) Catch-up no boot (espera o daily-reset 01:00 finalizar primeiro)
    const bootTimer = setTimeout(() => {
      if (!alreadyRanToday()) {
        void runPreBuild('catch-up boot');
      }
    }, BOOT_CATCHUP_DELAY_MS);

    // 2) Janela diária 01:05–01:15
    intervalRef.current = setInterval(() => {
      const now = new Date();
      if (now.getHours() === TARGET_HOUR &&
          now.getMinutes() >= WINDOW_START_MIN &&
          now.getMinutes() <= WINDOW_END_MIN &&
          !alreadyRanToday()) {
        void runPreBuild(`janela diária ${String(TARGET_HOUR).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(bootTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [gradeBuilder]);
}
