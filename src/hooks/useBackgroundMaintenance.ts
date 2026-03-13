/**
 * Background Maintenance Hook
 * 
 * Runs periodic tasks:
 * - AI song classification every 30 minutes
 * - Auto-purge blocked files from disk every 12 hours (Electron only)
 * - Auto-deduplicate music library every 24 hours (Electron only)
 * - History compression daily at 4:00 AM
 * 
 * NOTE: ARL validation is handled by useGlobalDownloadService (every 15 min)
 */

import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRadioStore } from '@/store/radioStore';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
const CLASSIFY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const PURGE_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const DEDUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TEMP_PROCESS_INTERVAL_MS = 2 * 60 * 1000; // Every 2 minutes
const MAINTENANCE_CHECK_MS = 60 * 1000; // Check every minute

export function useBackgroundMaintenance() {
  const lastClassifyRef = useRef<number>(0);
  const lastPurgeRef = useRef<number>(0);
  const lastDedupRef = useRef<number>(0);
  const lastTempProcessRef = useRef<number>(0);
  const lastCompressRef = useRef<string>(''); // Date string of last compression
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const classifySongs = useCallback(async () => {
    try {
      console.log('[MAINTENANCE] 🎯 Classificando músicas com IA...');
      const { data, error } = await supabase.functions.invoke('classify-song', {
        body: { action: 'classify-batch' },
      });

      if (error) {
        console.error('[MAINTENANCE] Erro na classificação:', error);
        return;
      }

      if (data?.classified > 0) {
        console.log(`[MAINTENANCE] ✅ ${data.classified}/${data.total} músicas classificadas`);
      } else {
        console.log('[MAINTENANCE] Nenhuma música pendente de classificação');
      }
    } catch (error) {
      console.error('[MAINTENANCE] Erro na classificação:', error);
    }
  }, []);

  const purgeBlockedFiles = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.purgeBlockedFiles) return;

    try {
      const { config, deezerConfig } = useRadioStore.getState();
      const allFolders = [
        ...config.musicFolders,
        deezerConfig.downloadFolder,
      ].filter(Boolean);

      if (allFolders.length === 0) return;

      const blockedSongs = config.blockedSongs || [];
      const forbiddenWords = config.forbiddenWords || [];

      if (blockedSongs.length === 0 && forbiddenWords.length === 0) return;

      console.log('[MAINTENANCE] 🗑️ Verificando arquivos bloqueados no disco...');
      const result = await window.electronAPI.purgeBlockedFiles({
        musicFolders: allFolders,
        blockedSongs,
        forbiddenWords,
      });

      if (result.deletedCount > 0) {
        console.log(`[MAINTENANCE] 🗑️ ${result.deletedCount} arquivo(s) bloqueado(s) removido(s) do disco`);
      } else {
        console.log('[MAINTENANCE] ✅ Nenhum arquivo bloqueado encontrado no disco');
      }
    } catch (error) {
      console.error('[MAINTENANCE] Erro no purge automático:', error);
    }
  }, []);

  const autoDeduplicateLibrary = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.scanDuplicates || !window.electronAPI?.deleteDuplicates) return;

    try {
      const { config, deezerConfig } = useRadioStore.getState();
      const allFolders = [
        ...config.musicFolders,
        deezerConfig.downloadFolder,
      ].filter(Boolean);

      if (allFolders.length === 0) return;

      console.log('[MAINTENANCE] 🔍 Escaneando duplicatas na biblioteca...');
      const scanResult = await window.electronAPI.scanDuplicates({ musicFolders: allFolders });

      if (!scanResult?.duplicates || scanResult.duplicates.length === 0) {
        console.log('[MAINTENANCE] ✅ Nenhuma duplicata encontrada na biblioteca');
        return;
      }

      console.log(`[MAINTENANCE] 🗑️ ${scanResult.duplicates.length} grupo(s) de duplicatas encontrado(s), removendo cópias de menor qualidade...`);
      
      const filesToDelete = scanResult.duplicates.flatMap((group: any) => 
        group.remove.map((f: any) => f.path)
      );

      const deleteResult = await window.electronAPI.deleteDuplicates({ filePaths: filesToDelete });
      console.log(`[MAINTENANCE] ✅ ${deleteResult.deleted} arquivo(s) duplicado(s) removido(s) automaticamente`);
    } catch (error) {
      console.error('[MAINTENANCE] Erro na deduplicação automática:', error);
    }
  }, []);

  const compressHistory = useCallback(async () => {
    try {
      console.log('[MAINTENANCE] 🗜️ Comprimindo histórico...');
      const { data, error } = await supabase.functions.invoke('classify-song', {
        body: { action: 'compress-history' },
      });

      if (error) {
        console.error('[MAINTENANCE] Erro na compressão:', error);
        return;
      }

      console.log(`[MAINTENANCE] ✅ Histórico comprimido:`, data?.result);
    } catch (error) {
      console.error('[MAINTENANCE] Erro na compressão:', error);
    }
  }, []);

  const processTempFiles = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.processTempFiles) return;
    try {
      const { config } = useRadioStore.getState();
      const folders = config.musicFolders || [];
      if (folders.length === 0) return;

      const result = await window.electronAPI.processTempFiles({ musicFolders: folders });
      if (result.moved > 0) {
        console.log(`[MAINTENANCE] 📂 _temp ID3: ${result.moved} arquivo(s) processado(s) e movido(s)`);
      }
    } catch (error) {
      // Silent — runs frequently
    }
  }, []);

  const start = useCallback(() => {
    // Initial classification after 2 minutes
    setTimeout(() => classifySongs(), 2 * 60 * 1000);

    // Initial purge after 3 minutes
    if (isElectron) {
      setTimeout(() => purgeBlockedFiles(), 3 * 60 * 1000);
    }

    // Initial dedup after 10 minutes
    if (isElectron) {
      setTimeout(() => autoDeduplicateLibrary(), 10 * 60 * 1000);
    }

    // Initial temp processing after 1 minute
    if (isElectron) {
      setTimeout(() => processTempFiles(), 60 * 1000);
    }

    intervalRef.current = setInterval(() => {
      const now = Date.now();

      // Process _temp files every 2 minutes (Electron only)
      if (isElectron && now - lastTempProcessRef.current >= TEMP_PROCESS_INTERVAL_MS) {
        lastTempProcessRef.current = now;
        processTempFiles();
      }

      // Classify every 30 minutes
      if (now - lastClassifyRef.current >= CLASSIFY_INTERVAL_MS) {
        lastClassifyRef.current = now;
        classifySongs();
      }

      // Purge blocked files every 12 hours (Electron only)
      if (isElectron && now - lastPurgeRef.current >= PURGE_INTERVAL_MS) {
        lastPurgeRef.current = now;
        purgeBlockedFiles();
      }

      // Auto-deduplicate every 24 hours (Electron only)
      if (isElectron && now - lastDedupRef.current >= DEDUP_INTERVAL_MS) {
        lastDedupRef.current = now;
        autoDeduplicateLibrary();
      }

      // Compress history once per day at ~4:00 AM
      const currentHour = new Date().getHours();
      const today = new Date().toDateString();
      if (currentHour === 4 && lastCompressRef.current !== today) {
        lastCompressRef.current = today;
        compressHistory();
      }
    }, MAINTENANCE_CHECK_MS);

    console.log('[MAINTENANCE] ✅ Serviço de manutenção iniciado (temp 2min, classificação 30min, purge 12h, dedup 24h, compressão 4h)');

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [classifySongs, compressHistory, purgeBlockedFiles, autoDeduplicateLibrary, processTempFiles]);

  return { start, classifySongs, compressHistory, purgeBlockedFiles, autoDeduplicateLibrary, processTempFiles };
}
