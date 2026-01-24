import { useState, useEffect, useCallback, useRef } from 'react';

export interface HealthStatus {
  supabase: 'ok' | 'degraded' | 'offline';
  realtime: 'ok' | 'degraded' | 'offline';
  electron: 'ok' | 'unavailable';
  network: 'online' | 'offline';
  lastCheck: Date | null;
  issues: string[];
}

const CHECK_INTERVAL = 120000; // 2 minutes (increased from 1 minute to reduce overhead)

export function useHealthCheck() {
  const [status, setStatus] = useState<HealthStatus>({
    supabase: 'ok',
    realtime: 'ok',
    electron: typeof window !== 'undefined' && window.electronAPI ? 'ok' : 'unavailable',
    network: typeof navigator !== 'undefined' ? (navigator.onLine ? 'online' : 'offline') : 'online',
    lastCheck: null,
    issues: [],
  });
  
  const checkingRef = useRef(false);
  const mountedRef = useRef(true);

  const checkSupabase = useCallback(async (): Promise<'ok' | 'degraded' | 'offline'> => {
    try {
      // Dynamic import to avoid circular dependencies
      const { supabase } = await import('@/integrations/supabase/client');
      
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
    try {
      // Use the centralized manager status - NO test channels
      const { realtimeManager } = await import('@/lib/realtimeManager');
      const status = realtimeManager.getStatus('scraped_songs');
      
      if (status === 'connected') {
        return 'ok';
      } else if (status === 'error') {
        return 'offline';
      } else if (status === 'connecting') {
        return 'degraded';
      }
      
      // Default to degraded if no specific status (channel not subscribed yet)
      return 'degraded';
    } catch (error) {
      console.error('[HEALTH] Realtime check failed:', error);
      return 'degraded';
    }
  }, []);

  const runHealthCheck = useCallback(async () => {
    // Prevent concurrent checks
    if (checkingRef.current || !mountedRef.current) return;
    checkingRef.current = true;
    
    try {
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
      
      // Check Realtime (simplified - no test channels)
      const realtimeStatus = await checkRealtime();
      if (realtimeStatus === 'offline') {
        issues.push('Conexão em tempo real indisponível');
      } else if (realtimeStatus === 'degraded') {
        issues.push('Conexão em tempo real degradada');
      }
      
      // Check Electron
      const electronStatus = typeof window !== 'undefined' && window.electronAPI ? 'ok' : 'unavailable';
      
      if (mountedRef.current) {
        setStatus({
          supabase: supabaseStatus,
          realtime: realtimeStatus,
          electron: electronStatus,
          network: networkStatus,
          lastCheck: new Date(),
          issues,
        });
      }
      
      // Log health status (less verbose)
      if (issues.length > 0) {
        console.warn('[HEALTH] Issues detected:', issues);
      }
    } finally {
      checkingRef.current = false;
    }
  }, [checkSupabase, checkRealtime]);

  // Initial check and cleanup
  useEffect(() => {
    mountedRef.current = true;
    
    // Delay initial check to avoid startup overhead
    const initialTimeout = setTimeout(runHealthCheck, 5000);
    
    return () => {
      mountedRef.current = false;
      clearTimeout(initialTimeout);
    };
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
      if (mountedRef.current) {
        setStatus(prev => ({ ...prev, network: 'online' }));
        // Delay health check to let connections stabilize
        setTimeout(runHealthCheck, 2000);
      }
    };
    
    const handleOffline = () => {
      console.log('[HEALTH] Network offline');
      if (mountedRef.current) {
        setStatus(prev => ({ 
          ...prev, 
          network: 'offline',
          issues: [...prev.issues.filter(i => i !== 'Sem conexão com a internet'), 'Sem conexão com a internet']
        }));
      }
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
