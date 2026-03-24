/**
 * Global download mutex — ensures only ONE download happens at a time
 * across all services (auto-download, captured songs, etc.).
 *
 * Grade-priority songs can "cut in line" but still wait for the
 * current download to finish before starting.
 */

let locked = false;
let waitQueue: Array<{ resolve: () => void; priority: number }> = [];
let lockTimeoutRef: ReturnType<typeof setTimeout> | null = null;

const LOCK_SAFETY_TIMEOUT_MS = 90_000; // 90s max — força release se travar

export async function acquireDownloadLock(priority = 0): Promise<void> {
  if (!locked) {
    locked = true;
    // Inicia watchdog de segurança
    lockTimeoutRef = setTimeout(() => {
      console.warn('[MUTEX] ⚠️ Lock não foi liberado em 90s — forçando release de segurança');
      releaseDownloadLock();
    }, LOCK_SAFETY_TIMEOUT_MS);
    return;
  }

  return new Promise<void>((resolve) => {
    waitQueue.push({ resolve, priority });
    // Keep sorted by priority (highest first)
    waitQueue.sort((a, b) => b.priority - a.priority);
  });
}

export function releaseDownloadLock(): void {
  // Cancela o watchdog ao liberar normalmente
  if (lockTimeoutRef) {
    clearTimeout(lockTimeoutRef);
    lockTimeoutRef = null;
  }

  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    // Reinicia watchdog para o próximo adquirente
    lockTimeoutRef = setTimeout(() => {
      console.warn('[MUTEX] ⚠️ Lock (queued) não liberado em 90s — forçando release');
      releaseDownloadLock();
    }, LOCK_SAFETY_TIMEOUT_MS);
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

export function getLockAge(): number | null {
  if (!locked || !lockTimeoutRef) return null;
  return LOCK_SAFETY_TIMEOUT_MS;
}
