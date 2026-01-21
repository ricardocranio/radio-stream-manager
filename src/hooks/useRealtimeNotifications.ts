import { useEffect, useRef, useCallback, useId } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore } from '@/store/radioStore';
import { realtimeManager } from '@/lib/realtimeManager';
import { rankingBatcher } from '@/lib/rankingBatcher';

interface NotificationOptions {
  enableBrowserNotifications?: boolean;
  enableToastNotifications?: boolean;
  onNewSong?: (song: { title: string; artist: string; station_name: string }) => void;
  onRankingUpdate?: (count: number) => void;
}

export function useRealtimeNotifications(options: NotificationOptions = {}) {
  const { toast } = useToast();
  const { applyRankingBatch } = useRadioStore();
  const lastSongIdRef = useRef<string | null>(null);
  const notificationPermissionRef = useRef<NotificationPermission>('default');
  const subscriberId = useId();
  const batcherInitializedRef = useRef(false);

  const {
    enableBrowserNotifications = true,
    enableToastNotifications = true,
    onNewSong,
    onRankingUpdate,
  } = options;

  // Initialize ranking batcher once
  useEffect(() => {
    if (batcherInitializedRef.current) return;
    batcherInitializedRef.current = true;
    
    rankingBatcher.init((updates) => {
      if (updates.length > 0) {
        applyRankingBatch(updates);
      }
    });

    return () => {
      // Flush on unmount
      rankingBatcher.forceFlush();
    };
  }, [applyRankingBatch]);

  // Request browser notification permission
  useEffect(() => {
    if (enableBrowserNotifications && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
          notificationPermissionRef.current = permission;
        });
      } else {
        notificationPermissionRef.current = Notification.permission;
      }
    }
  }, [enableBrowserNotifications]);

  // Show browser notification
  const showBrowserNotification = useCallback((title: string, body: string, icon?: string) => {
    if (!enableBrowserNotifications) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      new Notification(title, {
        body,
        icon: icon || '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'radio-monitor',
        silent: false,
      });
    } catch (e) {
      // Silent fail for notifications
    }
  }, [enableBrowserNotifications]);

  // Show toast notification - heavily debounced to prevent spam
  const lastToastRef = useRef<number>(0);
  const showToastNotification = useCallback((title: string, description: string, variant?: 'default' | 'destructive') => {
    if (!enableToastNotifications) return;
    
    // Rate limit toasts to max 1 per 30 seconds
    const now = Date.now();
    if (now - lastToastRef.current < 30000) return;
    lastToastRef.current = now;
    
    toast({ title, description, variant });
  }, [enableToastNotifications, toast]);

  // Subscribe to realtime changes via centralized manager
  useEffect(() => {
    const unsubscribe = realtimeManager.subscribe(
      'scraped_songs',
      `notifications_${subscriberId}`,
      (payload) => {
        const newSong = payload.new as {
          id: string;
          title: string;
          artist: string;
          station_name: string;
          is_now_playing: boolean;
        };

        // Avoid duplicate notifications
        if (lastSongIdRef.current === newSong.id) return;
        lastSongIdRef.current = newSong.id;

        // Callback
        onNewSong?.(newSong);

        // Show notifications only for now_playing songs (reduced frequency)
        if (newSong.is_now_playing) {
          showBrowserNotification(
            '🎵 Nova música!',
            `${newSong.artist} - ${newSong.title}\n📻 ${newSong.station_name}`
          );
          // Toast only for now_playing, already rate-limited
          showToastNotification(
            '🎵 Nova música!',
            `${newSong.artist} - ${newSong.title}`
          );
        }

        // Queue ranking update (batched, not immediate)
        let style = 'POP/VARIADO';
        const stationLower = newSong.station_name.toLowerCase();
        if (stationLower.includes('bh') || stationLower.includes('sertanejo') || stationLower.includes('clube')) {
          style = 'SERTANEJO';
        } else if (stationLower.includes('band') || stationLower.includes('pagode')) {
          style = 'PAGODE';
        }

        // Use batcher instead of direct update
        rankingBatcher.queueUpdate(newSong.title, newSong.artist, style);
        onRankingUpdate?.(1);
      }
    );

    return unsubscribe;
  }, [subscriberId, showToastNotification, showBrowserNotification, onNewSong, onRankingUpdate]);

  // Request notification permission manually
  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      showToastNotification(
        'Notificações não suportadas',
        'Seu navegador não suporta notificações push.',
        'destructive'
      );
      return false;
    }

    const permission = await Notification.requestPermission();
    notificationPermissionRef.current = permission;

    if (permission === 'granted') {
      showToastNotification(
        '🔔 Notificações ativadas!',
        'Você receberá alertas quando novas músicas forem capturadas.'
      );
      return true;
    } else {
      showToastNotification(
        'Notificações bloqueadas',
        'Permita notificações nas configurações do navegador.',
        'destructive'
      );
      return false;
    }
  }, [showToastNotification]);

  return {
    requestPermission,
    showBrowserNotification,
    showToastNotification,
    hasPermission: notificationPermissionRef.current === 'granted',
  };
}
