/**
 * Centralized Realtime Channel Manager
 * Prevents duplicate subscriptions and stack overflow errors
 * Includes auto-recovery with exponential backoff and periodic health checks
 */

import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

type ChannelCallback = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;

interface ChannelSubscriber {
  id: string;
  callback: ChannelCallback;
}

interface ManagedChannel {
  channel: RealtimeChannel | null;
  subscribers: ChannelSubscriber[];
  status: 'idle' | 'connecting' | 'connected' | 'error';
  retryCount: number;
  retryTimeoutId: ReturnType<typeof setTimeout> | null;
  table: string;
}

class RealtimeManager {
  private channels: Map<string, ManagedChannel> = new Map();
  private readonly MAX_RETRIES = 5; // Reduced - rely on health check for recovery
  private readonly BASE_RETRY_DELAY = 5000; // Start at 5s (was 2s)
  private readonly MAX_RETRY_DELAY = 60000; // Cap at 60 seconds (was 30s)
  private healthCheckIntervalId: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL = 120000; // Check every 2 minutes (was 60s)
  private isPageVisible: boolean = true;

  constructor() {
    this.startHealthCheck();
    this.setupVisibilityListener();
  }

  /**
   * Pause reconnection attempts when page is hidden to save CPU
   */
  private setupVisibilityListener() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.isPageVisible = !document.hidden;
        if (this.isPageVisible) {
          // Page became visible - check if we need to reconnect
          this.channels.forEach((managed, channelKey) => {
            if (managed.subscribers.length > 0 && managed.status === 'error') {
              console.log(`[REALTIME-MGR] Page visible, reconnecting ${channelKey}`);
              managed.retryCount = 0;
              this.connectChannel(channelKey, managed.table);
            }
          });
        }
      });
    }
  }

  /**
   * Periodic health check - reconnects any errored or stale channels
   */
  private startHealthCheck() {
    if (this.healthCheckIntervalId) return;

    this.healthCheckIntervalId = setInterval(() => {
      // Skip health check if page is hidden (save CPU)
      if (!this.isPageVisible) return;

      this.channels.forEach((managed, channelKey) => {
        if (managed.subscribers.length === 0) return;

        if (managed.status === 'error') {
          console.log(`[REALTIME-MGR] Health check: reconnecting errored channel ${channelKey}`);
          managed.retryCount = 0;
          this.connectChannel(channelKey, managed.table);
        }
      });
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Subscribe to a table's INSERT events
   */
  subscribe(
    table: string,
    subscriberId: string,
    callback: ChannelCallback
  ): () => void {
    const channelKey = `${table}_changes`;
    
    let managed = this.channels.get(channelKey);
    
    if (!managed) {
      managed = {
        channel: null,
        subscribers: [],
        status: 'idle',
        retryCount: 0,
        retryTimeoutId: null,
        table,
      };
      this.channels.set(channelKey, managed);
    }

    // Check if subscriber already exists
    const existingIndex = managed.subscribers.findIndex(s => s.id === subscriberId);
    if (existingIndex >= 0) {
      // Update callback
      managed.subscribers[existingIndex].callback = callback;
    } else {
      // Add new subscriber
      managed.subscribers.push({ id: subscriberId, callback });
    }

    // Connect if not already connected
    if (managed.status === 'idle' || managed.status === 'error') {
      this.connectChannel(channelKey, table);
    }

    // Return unsubscribe function
    return () => this.unsubscribe(channelKey, subscriberId);
  }

  private connectChannel(channelKey: string, table: string) {
    const managed = this.channels.get(channelKey);
    if (!managed) return;

    // Clean up existing channel
    if (managed.channel) {
      try {
        supabase.removeChannel(managed.channel);
      } catch (e) {
        // Ignore
      }
      managed.channel = null;
    }

    // Clear any pending retry
    if (managed.retryTimeoutId) {
      clearTimeout(managed.retryTimeoutId);
      managed.retryTimeoutId = null;
    }

    managed.status = 'connecting';
    console.log(`[REALTIME-MGR] Connecting to ${channelKey}... (attempt ${managed.retryCount + 1})`);

    const channel = supabase
      .channel(channelKey)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table },
        (payload) => {
          // Dispatch to all subscribers
          const current = this.channels.get(channelKey);
          if (current) {
            current.subscribers.forEach(sub => {
              try {
                sub.callback(payload);
              } catch (e) {
                console.error(`[REALTIME-MGR] Callback error for ${sub.id}:`, e);
              }
            });
          }
        }
      )
      .subscribe((status) => {
        const current = this.channels.get(channelKey);
        if (!current) return;

        if (status === 'SUBSCRIBED') {
          current.status = 'connected';
          current.retryCount = 0;
          console.log(`[REALTIME-MGR] ✓ ${channelKey} connected (${current.subscribers.length} subscribers)`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          current.status = 'error';
          
          if (current.retryCount < this.MAX_RETRIES) {
            current.retryCount++;
            // Exponential backoff with cap
            const delay = Math.min(
              this.BASE_RETRY_DELAY * Math.pow(1.5, current.retryCount - 1),
              this.MAX_RETRY_DELAY
            );
            console.warn(`[REALTIME-MGR] ${channelKey} error, retry ${current.retryCount}/${this.MAX_RETRIES} in ${Math.round(delay)}ms`);
            
            current.retryTimeoutId = setTimeout(() => {
              this.connectChannel(channelKey, table);
            }, delay);
          } else {
            console.error(`[REALTIME-MGR] ${channelKey} max retries reached, will retry on next health check`);
            // Health check will eventually reconnect
          }
        } else if (status === 'CLOSED') {
          // Channel was closed unexpectedly - reconnect with backoff
          // DO NOT reset retryCount here to prevent infinite loops
          if (current.subscribers.length > 0 && current.status !== 'connecting' && !current.retryTimeoutId) {
            // Skip reconnect if page is hidden
            if (!this.isPageVisible) {
              console.log(`[REALTIME-MGR] ${channelKey} closed while hidden, will reconnect when visible`);
              current.status = 'error';
              return;
            }

            if (current.retryCount < this.MAX_RETRIES) {
              current.retryCount++;
              const delay = Math.min(
                this.BASE_RETRY_DELAY * Math.pow(2, current.retryCount - 1),
                this.MAX_RETRY_DELAY
              );
              console.warn(`[REALTIME-MGR] ${channelKey} closed, retry ${current.retryCount}/${this.MAX_RETRIES} in ${Math.round(delay / 1000)}s`);
              
              current.retryTimeoutId = setTimeout(() => {
                current.retryTimeoutId = null;
                this.connectChannel(channelKey, table);
              }, delay);
            } else {
              console.warn(`[REALTIME-MGR] ${channelKey} max retries reached, waiting for health check`);
              current.status = 'error';
            }
          }
        }
      });

    managed.channel = channel;
  }

  private unsubscribe(channelKey: string, subscriberId: string) {
    const managed = this.channels.get(channelKey);
    if (!managed) return;

    // Remove subscriber
    managed.subscribers = managed.subscribers.filter(s => s.id !== subscriberId);
    console.log(`[REALTIME-MGR] Unsubscribed ${subscriberId} from ${channelKey}, ${managed.subscribers.length} remaining`);

    // If no more subscribers, disconnect channel
    if (managed.subscribers.length === 0) {
      if (managed.retryTimeoutId) {
        clearTimeout(managed.retryTimeoutId);
      }
      if (managed.channel) {
        try {
          supabase.removeChannel(managed.channel);
        } catch (e) {
          // Ignore
        }
      }
      this.channels.delete(channelKey);
      console.log(`[REALTIME-MGR] Channel ${channelKey} closed`);
    }
  }

  /**
   * Get channel status
   */
  getStatus(table: string): 'idle' | 'connecting' | 'connected' | 'error' {
    const channelKey = `${table}_changes`;
    return this.channels.get(channelKey)?.status ?? 'idle';
  }

  /**
   * Force reconnect a channel
   */
  reconnect(table: string) {
    const channelKey = `${table}_changes`;
    const managed = this.channels.get(channelKey);
    if (managed && managed.subscribers.length > 0) {
      managed.retryCount = 0;
      this.connectChannel(channelKey, managed.table);
    }
  }

  /**
   * Force reconnect all channels
   */
  reconnectAll() {
    console.log('[REALTIME-MGR] Reconnecting all channels...');
    this.channels.forEach((managed, channelKey) => {
      if (managed.subscribers.length > 0) {
        managed.retryCount = 0;
        this.connectChannel(channelKey, managed.table);
      }
    });
  }

  /**
   * Cleanup all channels
   */
  cleanup() {
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = null;
    }
    this.channels.forEach((managed) => {
      if (managed.retryTimeoutId) {
        clearTimeout(managed.retryTimeoutId);
      }
      if (managed.channel) {
        try {
          supabase.removeChannel(managed.channel);
        } catch (e) {
          // Ignore
        }
      }
    });
    this.channels.clear();
    console.log('[REALTIME-MGR] All channels cleaned up');
  }
}

// Singleton instance
export const realtimeManager = new RealtimeManager();
