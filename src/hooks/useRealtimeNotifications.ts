import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { realtimeManager } from '@/lib/realtimeManager';

interface NotificationOptions {
  enableBrowserNotifications?: boolean;
  enableToastNotifications?: boolean;
  onNewSong?: (song: { title: string; artist: string; station_name: string }) => void;
  onRankingUpdate?: (count: number) => void;
}

// STABLE subscriber ID - prevents channel disconnect on tab navigation
const NOTIFICATIONS_SUBSCRIBER_ID = 'realtime_notifications_global';

export function useRealtimeNotifications(options: NotificationOptions = {}) {
  const { toast } = useToast();
  const { applyRankingBatch } = useRadioStore();
  const lastSongIdRef = useRef<string | null>(null);
  const notificationPermissionRef = useRef<NotificationPermission>('default');
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
  // Using refs for callbacks to keep subscription stable
  const showBrowserNotificationRef = useRef(showBrowserNotification);
  showBrowserNotificationRef.current = showBrowserNotification;
  const showToastNotificationRef = useRef(showToastNotification);
  showToastNotificationRef.current = showToastNotification;
  const onNewSongRef = useRef(onNewSong);
  onNewSongRef.current = onNewSong;
  const onRankingUpdateRef = useRef(onRankingUpdate);
  onRankingUpdateRef.current = onRankingUpdate;

  useEffect(() => {
    const unsubscribe = realtimeManager.subscribe(
      'scraped_songs',
      NOTIFICATIONS_SUBSCRIBER_ID,
      (payload) => {
        const newSong = payload.new as {
          id: string;
          title: string;
          artist: string;
          station_name: string;
          is_now_playing: boolean;
          ai_genre?: string | null;
        };

        // Avoid duplicate notifications
        if (lastSongIdRef.current === newSong.id) return;
        lastSongIdRef.current = newSong.id;

        // Callback
        onNewSongRef.current?.(newSong);

        // Show notifications only for now_playing songs (reduced frequency)
        if (newSong.is_now_playing) {
          showBrowserNotificationRef.current(
            '🎵 Nova música!',
            `${newSong.artist} - ${newSong.title}\n📻 ${newSong.station_name}`
          );
          // Toast only for now_playing, already rate-limited
          showToastNotificationRef.current(
            '🎵 Nova música!',
            `${newSong.artist} - ${newSong.title}`
          );
        }

        // Ranking is now fed exclusively from grade builder (useAutoGradeBuilder)
        // to ensure TOP 25 reflects songs actually played in the grade, not just monitored.
        // See useAutoGradeBuilder lines ~1600 and ~1980 for grade-based ranking updates.
      }
    );

    return unsubscribe;
  }, []); // stable — no deps needed

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
