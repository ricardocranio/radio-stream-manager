import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface HealthStatus {
  supabase: 'ok' | 'degraded' | 'offline';
  realtime: 'ok' | 'degraded' | 'offline';
  electron: 'ok' | 'unavailable';
  network: 'online' | 'offline';
  lastCheck: Date | null;
  issues: string[];
}

const CHECK_INTERVAL = 60000; // 1 minute

export function useHealthCheck() {
  const [status, setStatus] = useState<HealthStatus>({
    supabase: 'ok',
    realtime: 'ok',
    electron: typeof window !== 'undefined' && window.electronAPI ? 'ok' : 'unavailable',
    network: typeof navigator !== 'undefined' ? (navigator.onLine ? 'online' : 'offline') : 'online',
    lastCheck: null,
    issues: [],
  });
  
  const realtimeCheckRef = useRef<boolean>(false);

  const checkSupabase = useCallback(async (): Promise<'ok' | 'degraded' | 'offline'> => {
    try {
      const startTime = Date.now();
      const { error } = await supabase
        .from('radio_stations')
        .select('id')
        .limit(1)
        .single();
      
      const latency = Date.now() - startTime;
      
      // Consider degraded if latency > 3 seconds
      if (latency > 3000) {
        console.warn('[HEALTH] Supabase latency high:', latency, 'ms');
        return 'degraded';
      }
      
      // PGRST116 is "no rows returned" - that's ok
      if (error && error.code !== 'PGRST116') {
        console.error('[HEALTH] Supabase error:', error);
        return 'degraded';
      }
      
      return 'ok';
    } catch (error) {
      console.error('[HEALTH] Supabase offline:', error);
      return 'offline';
    }
  }, []);

  const checkRealtime = useCallback(async (): Promise<'ok' | 'degraded' | 'offline'> => {
    return new Promise((resolve) => {
      const testChannel = supabase.channel('health_check_' + Date.now());
      const timeout = setTimeout(() => {
        supabase.removeChannel(testChannel);
        resolve('degraded');
      }, 5000);

      testChannel
        .subscribe((status) => {
          clearTimeout(timeout);
          supabase.removeChannel(testChannel);
          
          if (status === 'SUBSCRIBED') {
            realtimeCheckRef.current = true;
            resolve('ok');
          } else if (status === 'CHANNEL_ERROR') {
            resolve('offline');
          } else {
            resolve('degraded');
          }
        });
    });
  }, []);

  const runHealthCheck = useCallback(async () => {
    const issues: string[] = [];
    
    // Check network
    const networkStatus = navigator.onLine ? 'online' : 'offline';
    if (networkStatus === 'offline') {
      issues.push('Sem conexão com a internet');
    }
    
    // Check Supabase
    const supabaseStatus = await checkSupabase();
    if (supabaseStatus === 'offline') {
      issues.push('Banco de dados indisponível');
    } else if (supabaseStatus === 'degraded') {
      issues.push('Banco de dados com alta latência');
    }
    
    // Check Realtime
    const realtimeStatus = await checkRealtime();
    if (realtimeStatus === 'offline') {
      issues.push('Conexão em tempo real indisponível');
    } else if (realtimeStatus === 'degraded') {
      issues.push('Conexão em tempo real degradada');
    }
    
    // Check Electron
    const electronStatus = typeof window !== 'undefined' && window.electronAPI ? 'ok' : 'unavailable';
    
    setStatus({
      supabase: supabaseStatus,
      realtime: realtimeStatus,
      electron: electronStatus,
      network: networkStatus,
      lastCheck: new Date(),
      issues,
    });
    
    // Log health status
    if (issues.length > 0) {
      console.warn('[HEALTH] Issues detected:', issues);
    } else {
      console.log('[HEALTH] All systems operational');
    }
  }, [checkSupabase, checkRealtime]);

  // Initial check
  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  // Periodic checks
  useEffect(() => {
    const interval = setInterval(runHealthCheck, CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [runHealthCheck]);

  // Listen for network changes
  useEffect(() => {
    const handleOnline = () => {
      console.log('[HEALTH] Network online');
      setStatus(prev => ({ ...prev, network: 'online' }));
      runHealthCheck();
    };
    
    const handleOffline = () => {
      console.log('[HEALTH] Network offline');
      setStatus(prev => ({ 
        ...prev, 
        network: 'offline',
        issues: [...prev.issues.filter(i => i !== 'Sem conexão com a internet'), 'Sem conexão com a internet']
      }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [runHealthCheck]);

  return {
    status,
    runHealthCheck,
    isHealthy: status.issues.length === 0 && status.network === 'online',
  };
}
