/**
 * Optimized Logger
 * 
 * Reduces console spam in production while keeping useful info available.
 * Set localStorage.setItem('pgm-debug', 'true') to enable verbose logging.
 */

const isDebugMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('pgm-debug') === 'true';
};

// Throttle repeated messages (optimized for CPU)
const messageThrottle = new Map<string, number>();
const THROTTLE_INTERVAL = 600000; // 10 minutes between identical messages (~90% log reduction)

const shouldLog = (key: string): boolean => {
  const now = Date.now();
  const lastLog = messageThrottle.get(key);
  
  if (!lastLog || now - lastLog > THROTTLE_INTERVAL) {
    messageThrottle.set(key, now);
    return true;
  }
  return false;
};

// Clean old throttle entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, time] of messageThrottle.entries()) {
    if (now - time > THROTTLE_INTERVAL * 5) {
      messageThrottle.delete(key);
    }
  }
}, THROTTLE_INTERVAL * 5);

export const logger = {
  /**
   * Always logs - for critical errors
   */
  error: (prefix: string, message: string, ...args: unknown[]) => {
    console.error(`${prefix} ${message}`, ...args);
  },

  /**
   * Always logs - for warnings
   */
  warn: (prefix: string, message: string, ...args: unknown[]) => {
    console.warn(`${prefix} ${message}`, ...args);
  },

  /**
   * Only logs in debug mode
   */
  debug: (prefix: string, message: string, ...args: unknown[]) => {
    if (isDebugMode()) {
      console.log(`${prefix} ${message}`, ...args);
    }
  },

  /**
   * Logs important info, but throttled to avoid spam
   */
  info: (prefix: string, message: string, ...args: unknown[]) => {
    const key = `${prefix}:${message}`;
    if (shouldLog(key)) {
      console.log(`${prefix} ${message}`, ...args);
    }
  },

  /**
   * Always logs - for important milestones
   */
  milestone: (prefix: string, message: string, ...args: unknown[]) => {
    console.log(`${prefix} ${message}`, ...args);
  },
};

export default logger;
