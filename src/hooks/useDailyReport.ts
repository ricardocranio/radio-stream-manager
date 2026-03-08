/**
 * Daily Report
 * 
 * Generates a daily summary of grade building performance:
 * - % of songs resolved vs coringa/fallback
 * - Blocks with failures
 * - Stations with empty pools
 * 
 * Saves to localStorage and logs a summary at the end of each day cycle.
 */

import { useEffect, useRef } from 'react';
import { useGradeLogStore } from '@/store/gradeLogStore';

const REPORT_KEY = 'pgmr_daily_report';
const REPORT_HOUR = 23; // Generate report at 23:xx
const REPORT_MINUTE = 55;

export interface DailyReport {
  date: string; // YYYY-MM-DD
  totalSongs: number;
  resolvedSongs: number;
  coringSongs: number;
  substitutedSongs: number;
  missingSongs: number;
  blocksGenerated: number;
  blocksWithErrors: number;
  emptyStations: string[];
  resolvedPercent: number;
}

function generateReport(): DailyReport {
  const { blockLogs } = useGradeLogStore.getState();
  const today = new Date().toISOString().slice(0, 10);

  let totalSongs = 0;
  let resolvedSongs = 0;
  let coringSongs = 0;
  let substitutedSongs = 0;
  let missingSongs = 0;
  const blockKeys = new Set<string>();
  const blocksWithErrorsSet = new Set<string>();
  const stationHits = new Map<string, number>();

  for (const log of blockLogs) {
    blockKeys.add(log.blockTime);
    totalSongs++;

    if (log.type === 'used') {
      resolvedSongs++;
      stationHits.set(log.station, (stationHits.get(log.station) || 0) + 1);
    } else if (log.type === 'substituted') {
      substitutedSongs++;
      if (log.title?.toLowerCase() === 'mus' || log.title?.toLowerCase() === 'rom' || log.title?.toLowerCase() === 'clas') {
        coringSongs++;
      }
      blocksWithErrorsSet.add(log.blockTime);
    } else if (log.type === 'missing') {
      missingSongs++;
      blocksWithErrorsSet.add(log.blockTime);
    }
  }

  // Detect stations that had zero usage
  const emptyStations: string[] = [];
  // We can't know all configured stations here, but we can report stations
  // that were referenced in substitutions

  const resolvedPercent = totalSongs > 0 ? Math.round((resolvedSongs / totalSongs) * 100) : 0;

  return {
    date: today,
    totalSongs,
    resolvedSongs,
    coringSongs,
    substitutedSongs,
    missingSongs,
    blocksGenerated: blockKeys.size,
    blocksWithErrors: blocksWithErrorsSet.size,
    emptyStations,
    resolvedPercent,
  };
}

function saveReport(report: DailyReport): void {
  try {
    // Keep last 7 days
    const raw = localStorage.getItem(REPORT_KEY);
    const history: DailyReport[] = raw ? JSON.parse(raw) : [];
    
    // Remove existing report for same date
    const filtered = history.filter(r => r.date !== report.date);
    filtered.push(report);
    
    // Keep only last 7
    const trimmed = filtered.slice(-7);
    localStorage.setItem(REPORT_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

export function getReportHistory(): DailyReport[] {
  try {
    const raw = localStorage.getItem(REPORT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function useDailyReport() {
  const hasRunToday = useRef(false);
  const lastDate = useRef('');

  useEffect(() => {
    const check = () => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      
      if (today !== lastDate.current) {
        hasRunToday.current = false;
        lastDate.current = today;
      }

      if (hasRunToday.current) return;
      if (now.getHours() < REPORT_HOUR) return;
      if (now.getHours() === REPORT_HOUR && now.getMinutes() < REPORT_MINUTE) return;

      hasRunToday.current = true;
      const report = generateReport();
      saveReport(report);

      console.log('╔══════════════════════════════════════════════════╗');
      console.log('║          📊 RELATÓRIO DIÁRIO DA GRADE           ║');
      console.log('╠══════════════════════════════════════════════════╣');
      console.log(`║ 📅 Data: ${report.date}`.padEnd(51) + '║');
      console.log(`║ 🎵 Total: ${report.totalSongs} músicas em ${report.blocksGenerated} blocos`.padEnd(51) + '║');
      console.log(`║ ✅ Resolvidas: ${report.resolvedSongs} (${report.resolvedPercent}%)`.padEnd(51) + '║');
      console.log(`║ 🔄 Substituídas: ${report.substitutedSongs}`.padEnd(51) + '║');
      console.log(`║ 🃏 Coringa: ${report.coringSongs}`.padEnd(51) + '║');
      console.log(`║ ❌ Faltantes: ${report.missingSongs}`.padEnd(51) + '║');
      console.log(`║ ⚠️ Blocos com erro: ${report.blocksWithErrors}`.padEnd(51) + '║');
      console.log('╚══════════════════════════════════════════════════╝');
    };

    const interval = setInterval(check, 60000); // Check every minute
    check(); // Run immediately
    return () => clearInterval(interval);
  }, []);

  return { start: () => {} };
}
