/**
 * Radioagência Nacional Service Hook
 * 
 * Monitors the Radioagência Nacional page every 15 minutes
 * and automatically downloads new audio files to C:\Playlist\Locucoes.
 */

import { useRef, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_FOLDER = 'C:\\Playlist\\Locucoes';
const CLEANUP_MAX_AGE_DAYS = 7;

interface RadioagenciaEntry {
  title: string;
  url: string;
  cleanUrl: string;
  editoria: string;
  isNew: boolean;
}

export function useRadioagenciaService() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunningRef = useRef(false);
  const lastCleanupDateRef = useRef<string | null>(null);

  const getFolder = useCallback((): string => {
    try {
      const saved = localStorage.getItem('radioagenciaConfig');
      if (saved) {
        const config = JSON.parse(saved);
        return config.downloadFolder || DEFAULT_FOLDER;
      }
    } catch (e) {}
    return DEFAULT_FOLDER;
  }, []);

  const isEnabled = useCallback((): boolean => {
    try {
      const saved = localStorage.getItem('radioagenciaConfig');
      if (saved) {
        const config = JSON.parse(saved);
        return config.enabled !== false;
      }
    } catch (e) {}
    return true; // enabled by default
  }, []);

  const checkAndDownload = useCallback(async () => {
    if (!isElectron || !window.electronAPI) return;
    if (isRunningRef.current) return;
    if (!isEnabled()) return;

    isRunningRef.current = true;
    const folder = getFolder();

    try {
      // Daily cleanup
      const todayStr = new Date().toDateString();
      if (lastCleanupDateRef.current !== todayStr && (window.electronAPI as any).radioagenciaCleanup) {
        lastCleanupDateRef.current = todayStr;
        try {
          await (window.electronAPI as any).radioagenciaCleanup({ folder, maxAgeDays: CLEANUP_MAX_AGE_DAYS });
        } catch (e) {
          console.log('[RADIOAGENCIA-SVC] Cleanup error (non-fatal):', e);
        }
      }

      // Check for new entries
      const result = await (window.electronAPI as any).radioagenciaCheck();
      if (!result?.success || !result.entries?.length) {
        console.log('[RADIOAGENCIA-SVC] No entries found or check failed');
        return;
      }

      const newEntries: RadioagenciaEntry[] = result.entries.filter((e: RadioagenciaEntry) => e.isNew);
      if (newEntries.length === 0) {
        console.log('[RADIOAGENCIA-SVC] ✅ Nenhum áudio novo');
        return;
      }

      console.log(`[RADIOAGENCIA-SVC] 📰 ${newEntries.length} novo(s) áudio(s) encontrado(s)`);

      let downloaded = 0;
      let failed = 0;

      for (const entry of newEntries) {
        try {
          const dlResult = await (window.electronAPI as any).radioagenciaDownload({
            url: entry.url,
            cleanUrl: entry.cleanUrl,
            title: entry.title,
            outputFolder: folder,
          });

          if (dlResult?.success) {
            downloaded++;
            if (!dlResult.skipped) {
              console.log(`[RADIOAGENCIA-SVC] ✅ ${entry.title}`);
            }
          } else {
            failed++;
            console.log(`[RADIOAGENCIA-SVC] ❌ ${entry.title}: ${dlResult?.error}`);
          }
        } catch (err) {
          failed++;
          console.log(`[RADIOAGENCIA-SVC] ❌ ${entry.title}: ${err instanceof Error ? err.message : 'Erro'}`);
        }
      }

      if (downloaded > 0) {
        console.log(`[RADIOAGENCIA-SVC] 📰 ${downloaded} áudio(s) baixado(s)${failed > 0 ? `, ${failed} falha(s)` : ''}`);
        
        // System notification
        if (window.electronAPI.showNotification) {
          window.electronAPI.showNotification(
            '📰 Radioagência Nacional',
            `${downloaded} novo(s) áudio(s) baixado(s) em Locuções`
          );
        }
      }
    } catch (error) {
      console.error('[RADIOAGENCIA-SVC] Error:', error);
    } finally {
      isRunningRef.current = false;
    }
  }, [getFolder, isEnabled]);

  const start = useCallback(() => {
    if (!isElectron || !window.electronAPI) {
      console.log('[RADIOAGENCIA-SVC] ⚠️ Electron API indisponível');
      return () => {};
    }

    if (!isEnabled()) {
      console.log('[RADIOAGENCIA-SVC] ⚠️ Desabilitado');
      return () => {};
    }

    console.log(`[RADIOAGENCIA-SVC] ⏰ Monitorando a cada 15 min → ${getFolder()}`);

    // First check after 30s (let other services start first)
    const initialTimeout = setTimeout(() => {
      checkAndDownload();
    }, 30_000);

    // Then every 15 minutes
    intervalRef.current = setInterval(checkAndDownload, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkAndDownload, isEnabled, getFolder]);

  return { start, checkAndDownload };
}
