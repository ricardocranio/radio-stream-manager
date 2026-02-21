/**
 * Global download mutex — ensures only ONE download happens at a time
 * across all services (auto-download, captured songs, etc.).
 * 
 * Grade-priority songs can "cut in line" but still wait for the
 * current download to finish before starting.
 */

let locked = false;
let waitQueue: Array<{ resolve: () => void; priority: number }> = [];

export async function acquireDownloadLock(priority = 0): Promise<void> {
  if (!locked) {
    locked = true;
    return;
  }

  return new Promise<void>((resolve) => {
    waitQueue.push({ resolve, priority });
    // Keep sorted by priority (highest first)
    waitQueue.sort((a, b) => b.priority - a.priority);
  });
}

export function releaseDownloadLock(): void {
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next.resolve();
  } else {
    locked = false;
  }
}

export function isDownloadLocked(): boolean {
  return locked;
}

export function getWaitingCount(): number {
  return waitQueue.length;
}
