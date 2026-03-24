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

const GENERIC_STYLES = ['POP/VARIADO', 'VARIADO', 'POP', ''];

class RankingBatcher {
  private pendingUpdates: Map<string, PendingUpdate> = new Map();
  private lastFlush: number = Date.now();
  private flushIntervalId: ReturnType<typeof setTimeout> | null = null;
  private visibilityHandler: (() => void) | null = null;
  
  private readonly FLUSH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_PENDING = 500;
  private readonly MIN_VISIBILITY_WAIT = 60 * 1000; // 1 minute
  
  private flushCallback: ((updates: PendingUpdate[]) => void) | null = null;

  /**
   * Initialize the batcher with a callback to apply accumulated updates
   */
  init(onFlush: (updates: PendingUpdate[]) => void) {
    if (this.flushCallback) return; // prevent accidental re-init
    this.flushCallback = onFlush;
    
    // Set up periodic flush
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
    }
    
    this.flushIntervalId = setInterval(() => {
      this.flush();
    }, this.FLUSH_INTERVAL_MS);
    
    // Flush on visibility change (when user returns to tab)
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (document.visibilityState !== 'visible') return;
        if (this.pendingUpdates.size > 0) {
          const timeSinceLastFlush = Date.now() - this.lastFlush;
          if (timeSinceLastFlush > this.MIN_VISIBILITY_WAIT) {
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
    // Guard against empty inputs
    if (!title || !artist) return;
    
    const key = `${title.toLowerCase().trim()}::${artist.toLowerCase().trim()}`;
    
    const existing = this.pendingUpdates.get(key);
    if (existing) {
      existing.count++;
      // Upgrade style if incoming is more specific than generic
      if (style && !GENERIC_STYLES.includes(style.toUpperCase().trim()) &&
          GENERIC_STYLES.includes(existing.style.toUpperCase().trim())) {
        existing.style = style;
      }
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
    
    if (updates.length > 0) {
      console.log(`[RANKING-BATCH] Aplicando ${updates.length} atualizações acumuladas`);
    }
    
    if (this.flushCallback) {
      try {
        this.flushCallback(updates);
      } catch (err) {
        console.error('[RANKING-BATCH] Erro no flush:', err);
      }
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
    // Remove visibility listener properly
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
