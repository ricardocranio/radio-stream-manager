import { useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useRadioStore } from '@/store/radioStore';

interface NotificationOptions {
  enableBrowserNotifications?: boolean;
  enableToastNotifications?: boolean;
  onNewSong?: (song: { title: string; artist: string; station_name: string }) => void;
  onRankingUpdate?: (count: number) => void;
}

export function useRealtimeNotifications(options: NotificationOptions = {}) {
  const { toast } = useToast();
  const { addOrUpdateRankingSong } = useRadioStore();
  const lastSongIdRef = useRef<string | null>(null);
  const notificationPermissionRef = useRef<NotificationPermission>('default');

  const {
    enableBrowserNotifications = true,
    enableToastNotifications = true,
    onNewSong,
    onRankingUpdate,
  } = options;

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
      console.log('Browser notification failed:', e);
    }
  }, [enableBrowserNotifications]);

  // Show toast notification
  const showToastNotification = useCallback((title: string, description: string, variant?: 'default' | 'destructive') => {
    if (!enableToastNotifications) return;
    toast({ title, description, variant });
  }, [enableToastNotifications, toast]);

  // Subscribe to realtime changes
  useEffect(() => {
    console.log('[REALTIME] Setting up Supabase realtime subscription...');

    const channel = supabase
      .channel('scraped_songs_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'scraped_songs',
        },
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

          console.log('[REALTIME] New song captured:', newSong);

          // Callback
          onNewSong?.(newSong);

          // Show notifications
          if (newSong.is_now_playing) {
            showToastNotification(
              '🎵 Nova música capturada!',
              `${newSong.artist} - ${newSong.title} (${newSong.station_name})`
            );

            showBrowserNotification(
              '🎵 Nova música!',
              `${newSong.artist} - ${newSong.title}\n📻 ${newSong.station_name}`
            );
          }

          // Auto-add to ranking
          let style = 'POP/VARIADO';
          const stationLower = newSong.station_name.toLowerCase();
          if (stationLower.includes('bh') || stationLower.includes('sertanejo') || stationLower.includes('clube')) {
            style = 'SERTANEJO';
          } else if (stationLower.includes('band') || stationLower.includes('pagode')) {
            style = 'PAGODE';
          }

          addOrUpdateRankingSong(newSong.title, newSong.artist, style);
          onRankingUpdate?.(1);
        }
      )
      .subscribe((status) => {
        console.log('[REALTIME] Subscription status:', status);
      });

    return () => {
      console.log('[REALTIME] Cleaning up subscription...');
      supabase.removeChannel(channel);
    };
  }, [showToastNotification, showBrowserNotification, addOrUpdateRankingSong, onNewSong, onRankingUpdate]);

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
