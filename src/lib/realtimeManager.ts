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
  retryTimeoutId: NodeJS.Timeout | null;
  table: string;
}

class RealtimeManager {
  private channels: Map<string, ManagedChannel> = new Map();
  private readonly MAX_RETRIES = 10; // Increased from 3
  private readonly BASE_RETRY_DELAY = 2000;
  private readonly MAX_RETRY_DELAY = 30000; // Cap at 30 seconds
  private healthCheckIntervalId: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL = 60000; // Check every 60 seconds

  constructor() {
    this.startHealthCheck();
  }

  /**
   * Periodic health check - reconnects any errored or stale channels
   */
  private startHealthCheck() {
    if (this.healthCheckIntervalId) return;

    this.healthCheckIntervalId = setInterval(() => {
      this.channels.forEach((managed, channelKey) => {
        if (managed.subscribers.length === 0) return;

        if (managed.status === 'error') {
          console.log(`[REALTIME-MGR] Health check: reconnecting errored channel ${channelKey}`);
          managed.retryCount = 0; // Reset retries on health check
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
          // Channel was closed unexpectedly - reconnect if we still have subscribers
          if (current.subscribers.length > 0 && current.status !== 'connecting') {
            console.warn(`[REALTIME-MGR] ${channelKey} closed unexpectedly, reconnecting...`);
            current.retryCount = 0;
            setTimeout(() => {
              this.connectChannel(channelKey, table);
            }, this.BASE_RETRY_DELAY);
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
