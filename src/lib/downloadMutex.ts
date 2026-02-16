/**
 * Global Download Mutex
 * 
 * Ensures only ONE download runs at a time across all services
 * (auto-download, captured songs, manual downloads).
 * This prevents corrupted/partial files from concurrent Deezer requests.
 */

let locked = false;
let waitQueue: Array<() => void> = [];

/**
 * Acquire the download lock. Resolves when the lock is available.
 * Only one caller can hold the lock at a time.
 */
export function acquireDownloadLock(): Promise<void> {
  if (!locked) {
    locked = true;
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    waitQueue.push(resolve);
  });
}

/**
 * Release the download lock, allowing the next queued caller to proceed.
 */
export function releaseDownloadLock(): void {
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    // Keep locked = true, pass the lock to next in line
    next();
  } else {
    locked = false;
  }
}

/**
 * Check if the download lock is currently held.
 */
export function isDownloadLocked(): boolean {
  return locked;
}
