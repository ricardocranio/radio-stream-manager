/**
 * Ranking Batcher - Accumulates ranking updates and processes them in batches
 * Reduces memory and CPU usage by batching updates instead of processing each song individually
 */

interface PendingUpdate {
  title: string;
  artist: string;
  style: string;
  count: number;
}

class RankingBatcher {
  private pendingUpdates: Map<string, PendingUpdate> = new Map();
  private lastFlush: number = Date.now();
  private flushIntervalId: NodeJS.Timeout | null = null;
  
  // Flush interval in ms (6 hours = 21600000ms, but we'll use 30 min for practical testing)
  private readonly FLUSH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_PENDING = 500; // Max pending updates before force flush
  
  private flushCallback: ((updates: PendingUpdate[]) => void) | null = null;

  /**
   * Initialize the batcher with a callback to apply accumulated updates
   */
  private visibilityHandler: (() => void) | null = null;

  init(onFlush: (updates: PendingUpdate[]) => void) {
    this.flushCallback = onFlush;
    
    // Set up periodic flush
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
    }
    
    this.flushIntervalId = setInterval(() => {
      this.flush();
    }, this.FLUSH_INTERVAL_MS);
    
    // Remove previous listener if exists (prevent leak on re-init)
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    
    // Also flush on visibility change (when user returns to tab)
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (!document.hidden && this.pendingUpdates.size > 0) {
          const timeSinceLastFlush = Date.now() - this.lastFlush;
          if (timeSinceLastFlush > 60000) {
            this.flush();
          }
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /**
   * Queue a ranking update (batched, not immediate)
   */
  queueUpdate(title: string, artist: string, style: string) {
    const key = `${title.toLowerCase().trim()}|${artist.toLowerCase().trim()}`;
    
    const existing = this.pendingUpdates.get(key);
    if (existing) {
      existing.count++;
    } else {
      this.pendingUpdates.set(key, {
        title: title.trim(),
        artist: artist.trim(),
        style: style || 'POP/VARIADO',
        count: 1,
      });
    }
    
    // Force flush if too many pending updates
    if (this.pendingUpdates.size >= this.MAX_PENDING) {
      this.flush();
    }
  }

  /**
   * Flush all pending updates to the store
   */
  flush() {
    if (this.pendingUpdates.size === 0) return;
    
    const updates = Array.from(this.pendingUpdates.values());
    this.pendingUpdates.clear();
    this.lastFlush = Date.now();
    
    // Log only summary
    if (updates.length > 0) {
      console.log(`[RANKING-BATCH] Aplicando ${updates.length} atualizações acumuladas`);
    }
    
    if (this.flushCallback) {
      this.flushCallback(updates);
    }
  }

  /**
   * Get pending count for debugging
   */
  getPendingCount(): number {
    return this.pendingUpdates.size;
  }

  /**
   * Force immediate flush (for testing or manual trigger)
   */
  forceFlush() {
    this.flush();
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.flush(); // Final flush
    this.flushCallback = null;
  }
}

// Singleton instance
export const rankingBatcher = new RankingBatcher();
