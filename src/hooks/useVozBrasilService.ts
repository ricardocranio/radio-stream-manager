/**
 * Voz do Brasil Service Hook
 * 
 * Manages automatic download and cleanup of "A Voz do Brasil" audio files.
 * Extracted from GlobalServicesContext for modularity.
 */

import { useRef, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
const MIN_FILE_SIZE_BYTES = 40 * 1024 * 1024; // 40MB minimum to avoid saving error pages

export function useVozBrasilService() {
  const schedulerRef = useRef<NodeJS.Timeout | null>(null);
  const lastDownloadDateRef = useRef<string | null>(null);
  const lastCleanupDateRef = useRef<string | null>(null);

  const cleanupOldFiles = useCallback(async (folder: string): Promise<void> => {
    if (!isElectron || !window.electronAPI?.cleanupVozBrasil) return;
    
    try {
      console.log('[VOZ-SVC] 🗑️ Limpando arquivos antigos...');
      const result = await window.electronAPI.cleanupVozBrasil({
        folder,
        maxAgeDays: 1,
      });
      
      if (result.success && result.deletedCount && result.deletedCount > 0) {
        console.log(`[VOZ-SVC] 🗑️ Removidos ${result.deletedCount} arquivo(s) antigo(s)`);
      }
    } catch (error) {
      console.log('[VOZ-SVC] ⚠️ Erro na limpeza (continuando):', error);
    }
  }, []);
  
  const download = useCallback(async (): Promise<boolean> => {
    if (!isElectron || !window.electronAPI?.downloadVozBrasil) {
      console.log('[VOZ-SVC] ⚠️ Electron API não disponível');
      return false;
    }

    let config = {
      enabled: true,
      downloadFolder: 'C:\\Playlist\\A Voz do Brasil',
    };
    
    try {
      const savedConfig = localStorage.getItem('vozBrasilConfig');
      if (savedConfig) config = { ...config, ...JSON.parse(savedConfig) };
    } catch (e) {
      console.log('[VOZ-SVC] Usando config padrão');
    }

    if (!config.enabled) {
      console.log('[VOZ-SVC] ⚠️ Desabilitada');
      return false;
    }

    await cleanupOldFiles(config.downloadFolder);

    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    
    const uniqueUrls = [
      `https://radiogov.ebc.com.br/programas/a-voz-do-brasil-download/${day}-${month}-${year}/@@download/file`,
      `https://radiogov.ebc.com.br/programas/a-voz-do-brasil-download/${day}-${month}-2025/@@download/file`,
      `https://radiogov.ebc.com.br/programas/a-voz-do-brasil-download/${day}-${month}-${year}-1/@@download/file`,
    ];
    
    const filename = `VozDoBrasil_${day}-${month}-${year}.mp3`;

    console.log('[VOZ-SVC] 📻 Iniciando download...');

    for (let i = 0; i < uniqueUrls.length; i++) {
      const url = uniqueUrls[i];
      console.log(`[VOZ-SVC] Tentativa ${i + 1}/${uniqueUrls.length}`);
      
      try {
        const result = await window.electronAPI.downloadVozBrasil({
          url,
          outputFolder: config.downloadFolder,
          filename,
        });
        
        if (result.success) {
          if (result.fileSize && result.fileSize < MIN_FILE_SIZE_BYTES) {
            console.log(`[VOZ-SVC] URL ${i + 1} arquivo muito pequeno (${(result.fileSize / 1024 / 1024).toFixed(1)}MB < 40MB), pulando...`);
            continue;
          }
          console.log(`[VOZ-SVC] ✅ Download concluído: ${filename} (${result.fileSize ? (result.fileSize / 1024 / 1024).toFixed(1) + 'MB' : '?'})`);
          return true;
        } else {
          console.log(`[VOZ-SVC] URL ${i + 1} falhou: ${result.error}`);
        }
      } catch (err) {
        console.log(`[VOZ-SVC] URL ${i + 1} erro: ${err instanceof Error ? err.message : 'Desconhecido'}`);
      }
    }

    console.log('[VOZ-SVC] ❌ Todas as URLs falharam');
    return false;
  }, [cleanupOldFiles]);

  /** Start the Voz do Brasil scheduler. Returns cleanup function. */
  const start = useCallback(() => {
    if (!isElectron || !window.electronAPI?.downloadVozBrasil) {
      console.log('[VOZ-SVC] ⚠️ Electron API indisponível');
      return () => {};
    }

    let config = {
      enabled: true,
      scheduleTime: '20:35',
      cleanupTime: '23:59',
      downloadFolder: 'C:\\Playlist\\A Voz do Brasil',
    };
    
    try {
      const savedConfig = localStorage.getItem('vozBrasilConfig');
      if (savedConfig) config = { ...config, ...JSON.parse(savedConfig) };
    } catch (e) { /* use default */ }

    if (!config.enabled) {
      console.log('[VOZ-SVC] Agendamento desabilitado');
      return () => {};
    }

    const isWeekday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;
    
    const checkAndExecute = async () => {
      const now = new Date();
      const todayStr = now.toDateString();
      
      let currentConfig = { enabled: true, scheduleTime: '20:35', cleanupTime: '23:59', downloadFolder: 'C:\\Playlist\\A Voz do Brasil' };
      try {
        const saved = localStorage.getItem('vozBrasilConfig');
        if (saved) currentConfig = { ...currentConfig, ...JSON.parse(saved) };
      } catch (e) { /* use default */ }
      
      if (!currentConfig.enabled) return;

      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const currentTotalMinutes = currentHour * 60 + currentMinute;

      // === CLEANUP (runs regardless of isRunning) ===
      if (lastCleanupDateRef.current !== todayStr && window.electronAPI?.cleanupVozBrasil) {
        const cleanupParts = (currentConfig.cleanupTime || '23:59').split(':');
        const cleanupHour = parseInt(cleanupParts[0], 10);
        const cleanupMinute = parseInt(cleanupParts[1], 10);
        const cleanupTotalMinutes = cleanupHour * 60 + cleanupMinute;
        
        // Use a 30-minute window, handling midnight wrap (e.g., 23:59 → 00:29)
        let isInCleanupWindow = false;
        const windowEnd = cleanupTotalMinutes + 30;
        
        if (windowEnd > 1440) {
          // Window wraps past midnight
          isInCleanupWindow = currentTotalMinutes >= cleanupTotalMinutes || currentTotalMinutes <= (windowEnd - 1440);
        } else {
          isInCleanupWindow = currentTotalMinutes >= cleanupTotalMinutes && currentTotalMinutes <= windowEnd;
        }
        
        if (isInCleanupWindow) {
          console.log('[VOZ-SVC] 🗑️ Horário de limpeza atingido');
          lastCleanupDateRef.current = todayStr;
          
          try {
            const result = await window.electronAPI.cleanupVozBrasil({
              folder: currentConfig.downloadFolder,
              maxAgeDays: 0,
            });
            
            if (result.success) {
              console.log(`[VOZ-SVC] 🗑️ Limpeza: ${result.deletedCount || 0} arquivo(s) removidos`);
            } else {
              console.warn('[VOZ-SVC] ⚠️ Limpeza falhou:', result.error);
              lastCleanupDateRef.current = null;
            }
          } catch (error) {
            console.error('[VOZ-SVC] ❌ Erro limpeza:', error);
            lastCleanupDateRef.current = null;
          }
        }
      }

      // === DOWNLOAD (weekdays only, requires isRunning) ===
      const { isRunning } = useRadioStore.getState();
      if (!isRunning || !isWeekday(now) || lastDownloadDateRef.current === todayStr) return;
      
      const timeParts = (currentConfig.scheduleTime || '20:35').split(':');
      const scheduleTotalMinutes = (parseInt(timeParts[0], 10) || 20) * 60 + (parseInt(timeParts[1], 10) || 35);
      
      if (currentTotalMinutes >= scheduleTotalMinutes && currentTotalMinutes <= scheduleTotalMinutes + 30) {
        console.log('[VOZ-SVC] ⏰ Janela de download!');
        lastDownloadDateRef.current = todayStr;
        
        const success = await download();
        if (!success) {
          lastDownloadDateRef.current = null;
          console.log('[VOZ-SVC] ⚠️ Falhou, retentando no próximo minuto');
        }
      }
    };

    // Log schedule info
    const timeParts = (config.scheduleTime || '20:35').split(':');
    const cleanupParts = (config.cleanupTime || '23:59').split(':');
    console.log(`[VOZ-SVC] ⏰ Download: ${timeParts[0]}:${timeParts[1]} (Seg-Sex) | Limpeza: ${cleanupParts[0]}:${cleanupParts[1]}`);

    checkAndExecute();
    schedulerRef.current = setInterval(checkAndExecute, 60000);

    return () => {
      if (schedulerRef.current) clearInterval(schedulerRef.current);
    };
  }, [download]);

  return { download, start };
}
