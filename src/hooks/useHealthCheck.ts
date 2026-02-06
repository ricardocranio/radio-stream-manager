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

// Increased intervals and thresholds for stability and CPU optimization
const CHECK_INTERVAL = 600000; // 10 minutes (was 5 minutes - further reduce noise)
const LATENCY_THRESHOLD = 15000; // 15 seconds (was 8 seconds - avoid false positives from heavy scraping)
const REALTIME_TIMEOUT = 8000; // 8 seconds (was 5 seconds)

// Track consecutive failures before showing degraded status
const FAILURE_THRESHOLD = 3; // Require 3 consecutive failures (was 2)

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
  const consecutiveFailuresRef = useRef<{ supabase: number; realtime: number }>({
    supabase: 0,
    realtime: 0,
  });

  const checkSupabase = useCallback(async (): Promise<'ok' | 'degraded' | 'offline'> => {
    try {
      const startTime = Date.now();
      
      // Use Promise.race with a timeout to prevent the health check from hanging
      const queryPromise = supabase
        .from('radio_stations')
        .select('id')
        .limit(1)
        .maybeSingle();
      
      const timeoutPromise = new Promise<{ error: { code: string; message: string } }>((resolve) => {
        setTimeout(() => resolve({ error: { code: 'TIMEOUT', message: 'Health check timeout' } }), LATENCY_THRESHOLD);
      });
      
      const result = await Promise.race([queryPromise, timeoutPromise]);
      const latency = Date.now() - startTime;
      
      // Handle timeout
      if ('error' in result && result.error?.code === 'TIMEOUT') {
        consecutiveFailuresRef.current.supabase++;
        if (consecutiveFailuresRef.current.supabase >= FAILURE_THRESHOLD) {
          console.warn('[HEALTH] Supabase timeout after', consecutiveFailuresRef.current.supabase, 'failures');
          return 'degraded';
        }
        return 'ok';
      }
      
      const { error } = result as { error: any };
      
      // PGRST116 is "no rows returned" - that's ok
      if (error && error.code !== 'PGRST116') {
        consecutiveFailuresRef.current.supabase++;
        if (consecutiveFailuresRef.current.supabase >= FAILURE_THRESHOLD) {
          console.warn('[HEALTH] Supabase error after', consecutiveFailuresRef.current.supabase, 'failures:', error);
          return 'degraded';
        }
        return 'ok'; // Don't report degraded on first failure
      }
      
      // Consider degraded only if latency > threshold AND multiple occurrences
      if (latency > LATENCY_THRESHOLD) {
        consecutiveFailuresRef.current.supabase++;
        if (consecutiveFailuresRef.current.supabase >= FAILURE_THRESHOLD) {
          console.warn('[HEALTH] Supabase latency high after', consecutiveFailuresRef.current.supabase, 'checks:', latency, 'ms');
          return 'degraded';
        }
        return 'ok'; // Don't report degraded on first high latency
      }
      
      // Reset failure counter on success
      consecutiveFailuresRef.current.supabase = 0;
      return 'ok';
    } catch (error) {
      consecutiveFailuresRef.current.supabase++;
      if (consecutiveFailuresRef.current.supabase >= FAILURE_THRESHOLD) {
        console.error('[HEALTH] Supabase offline after', consecutiveFailuresRef.current.supabase, 'failures');
        return 'offline';
      }
      return 'ok'; // Don't report offline on first failure
    }
  }, []);

  const checkRealtime = useCallback(async (): Promise<'ok' | 'degraded' | 'offline'> => {
    // Use the centralized manager status instead of creating new channels
    const { realtimeManager } = await import('@/lib/realtimeManager');
    const status = realtimeManager.getStatus('scraped_songs');
    
    if (status === 'connected') {
      realtimeCheckRef.current = true;
      consecutiveFailuresRef.current.realtime = 0;
      return 'ok';
    } else if (status === 'error') {
      consecutiveFailuresRef.current.realtime++;
      if (consecutiveFailuresRef.current.realtime >= FAILURE_THRESHOLD) {
        return 'offline';
      }
      return 'ok';
    } else if (status === 'connecting' || status === 'idle') {
      // Connecting and idle are normal states, not degraded
      return 'ok';
    }
    
    // Fallback: quick ping test (only if no manager status)
    return new Promise((resolve) => {
      const testChannel = supabase.channel('health_check_' + Date.now());
      const timeout = setTimeout(() => {
        try { supabase.removeChannel(testChannel); } catch (e) {}
        consecutiveFailuresRef.current.realtime++;
        if (consecutiveFailuresRef.current.realtime >= FAILURE_THRESHOLD) {
          resolve('degraded');
        } else {
          resolve('ok');
        }
      }, REALTIME_TIMEOUT);

      testChannel
        .subscribe((status) => {
          clearTimeout(timeout);
          try { supabase.removeChannel(testChannel); } catch (e) {}
          
          if (status === 'SUBSCRIBED') {
            realtimeCheckRef.current = true;
            consecutiveFailuresRef.current.realtime = 0;
            resolve('ok');
          } else if (status === 'CHANNEL_ERROR') {
            consecutiveFailuresRef.current.realtime++;
            if (consecutiveFailuresRef.current.realtime >= FAILURE_THRESHOLD) {
              resolve('offline');
            } else {
              resolve('ok');
            }
          } else {
            // TIMED_OUT, CLOSED - consider ok unless repeated
            resolve('ok');
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
    
    // Log health status (only if issues, reduce console spam)
    if (issues.length > 0) {
      console.warn('[HEALTH] Issues detected:', issues);
    }
  }, [checkSupabase, checkRealtime]);

  // Initial check (delayed to let app stabilize)
  useEffect(() => {
    const initialDelay = setTimeout(() => {
      runHealthCheck();
    }, 10000); // Wait 10 seconds after mount
    
    return () => clearTimeout(initialDelay);
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
      // Reset failure counters when coming back online
      consecutiveFailuresRef.current = { supabase: 0, realtime: 0 };
      setStatus(prev => ({ ...prev, network: 'online' }));
      // Delay check to let connections stabilize
      setTimeout(runHealthCheck, 3000);
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
