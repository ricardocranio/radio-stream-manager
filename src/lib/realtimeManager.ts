/**
 * Centralized Realtime Channel Manager
 * Prevents duplicate subscriptions and stack overflow errors
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
}

class RealtimeManager {
  private channels: Map<string, ManagedChannel> = new Map();
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000;

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
    console.log(`[REALTIME-MGR] Connecting to ${channelKey}...`);

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

        console.log(`[REALTIME-MGR] ${channelKey} status: ${status}`);

        if (status === 'SUBSCRIBED') {
          current.status = 'connected';
          current.retryCount = 0;
          console.log(`[REALTIME-MGR] ✓ ${channelKey} connected`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          current.status = 'error';
          
          if (current.retryCount < this.MAX_RETRIES) {
            current.retryCount++;
            const delay = this.RETRY_DELAY * current.retryCount;
            console.warn(`[REALTIME-MGR] ${channelKey} error, retry ${current.retryCount}/${this.MAX_RETRIES} in ${delay}ms`);
            
            current.retryTimeoutId = setTimeout(() => {
              this.connectChannel(channelKey, table);
            }, delay);
          } else {
            console.error(`[REALTIME-MGR] ${channelKey} max retries reached`);
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
      this.connectChannel(channelKey, table);
    }
  }

  /**
   * Cleanup all channels
   */
  cleanup() {
    this.channels.forEach((managed, key) => {
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
