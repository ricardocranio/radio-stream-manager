import { useEffect, useRef, useCallback, useId } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore, MissingSong } from '@/store/radioStore';
import { realtimeManager } from '@/lib/realtimeManager';
import { rankingBatcher } from '@/lib/rankingBatcher';
import { checkSongInLibrary } from '@/hooks/useCheckMusicLibrary';
import { cleanAndValidateSong } from '@/lib/cleanSongMetadata';

interface NotificationOptions {
  enableBrowserNotifications?: boolean;
  enableToastNotifications?: boolean;
  onNewSong?: (song: { title: string; artist: string; station_name: string }) => void;
  onRankingUpdate?: (count: number) => void;
}

export function useRealtimeNotifications(options: NotificationOptions = {}) {
  const { toast } = useToast();
  const { applyRankingBatch, config, missingSongs, addMissingSong } = useRadioStore();
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

  // Helper to check if song is already in missing list
  const isSongAlreadyMissing = useCallback((artist: string, title: string) => {
    const normalizedArtist = artist.toLowerCase().trim();
    const normalizedTitle = title.toLowerCase().trim();
    return missingSongs.some(s => 
      s.artist.toLowerCase().trim() === normalizedArtist && 
      s.title.toLowerCase().trim() === normalizedTitle
    );
  }, [missingSongs]);

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
      async (payload) => {
        const rawSong = payload.new as {
          id: string;
          title: string;
          artist: string;
          station_name: string;
          is_now_playing: boolean;
        };

        // Avoid duplicate notifications
        if (lastSongIdRef.current === rawSong.id) return;
        lastSongIdRef.current = rawSong.id;

        // CRITICAL: Clean and validate song data before processing
        const cleanedSong = cleanAndValidateSong(rawSong.artist, rawSong.title);
        
        // Skip invalid entries (addresses, station info, garbage data)
        if (!cleanedSong) {
          console.log(`[REALTIME] ⚠️ Dados inválidos ignorados: "${rawSong.artist} - ${rawSong.title}"`);
          return;
        }
        
        const { artist, title } = cleanedSong;

        // Callback with cleaned data
        onNewSong?.({ title, artist, station_name: rawSong.station_name });

        // Show notifications only for now_playing songs (reduced frequency)
        if (rawSong.is_now_playing) {
          showBrowserNotification(
            '🎵 Nova música!',
            `${artist} - ${title}\n📻 ${rawSong.station_name}`
          );
          // Toast only for now_playing, already rate-limited
          showToastNotification(
            '🎵 Nova música!',
            `${artist} - ${title}`
          );
        }

        // Queue ranking update (batched, not immediate)
        let style = 'POP/VARIADO';
        const stationLower = rawSong.station_name.toLowerCase();
        if (stationLower.includes('bh') || stationLower.includes('sertanejo') || stationLower.includes('clube')) {
          style = 'SERTANEJO';
        } else if (stationLower.includes('band') || stationLower.includes('pagode')) {
          style = 'PAGODE';
        }

        // Use batcher instead of direct update with cleaned data
        rankingBatcher.queueUpdate(title, artist, style);
        onRankingUpdate?.(1);

        // ============= CHECK MUSIC LIBRARY AND ADD TO MISSING IF NEEDED =============
        // This is the critical integration: verify if captured song exists locally
        try {
          const musicFolders = config?.musicFolders || [];
          const threshold = config?.similarityThreshold || 0.75;
          
          if (musicFolders.length > 0) {
            const libraryCheck = await checkSongInLibrary(
              artist,
              title,
              musicFolders,
              threshold
            );
            
            // CRITICAL: Don't add to missing if verification failed (backend offline)
            // This prevents flooding the missing list when backend is unavailable
            if (libraryCheck.verificationFailed) {
              console.log(`[REALTIME] ⚠️ Verificação não disponível para: ${artist} - ${title} (backend offline)`);
              return;
            }
            
            // If not found in library AND not already in missing list, add to missing
            if (!libraryCheck.exists && !isSongAlreadyMissing(artist, title)) {
              const missingSongEntry: MissingSong = {
                id: `missing-rt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                title: title,
                artist: artist,
                station: rawSong.station_name,
                timestamp: new Date(),
                status: 'missing',
                dna: style,
              };
              addMissingSong(missingSongEntry);
              console.log(`[REALTIME] 📥 Nova música faltando detectada: ${artist} - ${title}`);
            }
          }
        } catch (error) {
          console.warn('[REALTIME] Erro ao verificar música no banco:', error);
        }
      }
    );

    return unsubscribe;
  }, [subscriberId, showToastNotification, showBrowserNotification, onNewSong, onRankingUpdate, config, isSongAlreadyMissing, addMissingSong]);

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
