/**
 * Background Maintenance Hook
 * 
 * Runs periodic tasks:
 * - AI song classification every 30 minutes
 * - History compression daily at 4:00 AM
 */

import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

const CLASSIFY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAINTENANCE_CHECK_MS = 60 * 1000; // Check every minute

export function useBackgroundMaintenance() {
  const lastClassifyRef = useRef<number>(0);
  const lastCompressRef = useRef<string>(''); // Date string of last compression
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

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

  const start = useCallback(() => {
    // Initial classification after 2 minutes
    setTimeout(() => classifySongs(), 2 * 60 * 1000);

    intervalRef.current = setInterval(() => {
      const now = Date.now();

      // Classify every 30 minutes
      if (now - lastClassifyRef.current >= CLASSIFY_INTERVAL_MS) {
        lastClassifyRef.current = now;
        classifySongs();
      }

      // Compress history once per day at ~4:00 AM
      const currentHour = new Date().getHours();
      const today = new Date().toDateString();
      if (currentHour === 4 && lastCompressRef.current !== today) {
        lastCompressRef.current = today;
        compressHistory();
      }
    }, MAINTENANCE_CHECK_MS);

    console.log('[MAINTENANCE] ✅ Serviço de manutenção iniciado (classificação 30min, compressão 4h)');

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [classifySongs, compressHistory]);

  return { start, classifySongs, compressHistory };
}
