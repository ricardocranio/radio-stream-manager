/**
 * Centralized error handling utilities for PGM-FM
 */

export interface ErrorContext {
  component: string;
  action: string;
  details?: Record<string, unknown>;
}

export interface AppError {
  message: string;
  code: string;
  context: ErrorContext;
  timestamp: Date;
  recoverable: boolean;
}

// Error codes for categorization
export const ErrorCodes = {
  // Network errors
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  API_ERROR: 'API_ERROR',
  
  // Supabase errors
  SUPABASE_CONNECTION: 'SUPABASE_CONNECTION',
  SUPABASE_QUERY: 'SUPABASE_QUERY',
  REALTIME_CHANNEL: 'REALTIME_CHANNEL',
  
  // Electron errors
  ELECTRON_IPC: 'ELECTRON_IPC',
  FILE_SYSTEM: 'FILE_SYSTEM',
  DEEMIX_ERROR: 'DEEMIX_ERROR',
  
  // Business logic errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  
  // Unknown
  UNKNOWN: 'UNKNOWN',
} as const;

type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// Store errors for debugging
const errorLog: AppError[] = [];
const MAX_ERROR_LOG = 100;

/**
 * Create a structured error
 */
export function createError(
  message: string,
  code: ErrorCode,
  context: ErrorContext,
  recoverable = true
): AppError {
  const error: AppError = {
    message,
    code,
    context,
    timestamp: new Date(),
    recoverable,
  };
  
  // Store in error log
  errorLog.unshift(error);
  if (errorLog.length > MAX_ERROR_LOG) {
    errorLog.pop();
  }
  
  // Log to console with context
  console.error(`[${code}] ${context.component}:${context.action}`, message, context.details);
  
  return error;
}

/**
 * Get recent errors for debugging
 */
export function getRecentErrors(count = 10): AppError[] {
  return errorLog.slice(0, count);
}

/**
 * Clear error log
 */
export function clearErrorLog(): void {
  errorLog.length = 0;
}

/**
 * Parse various error types into a consistent format
 */
export function parseError(error: unknown, context: ErrorContext): AppError {
  if (error instanceof Error) {
    // Check for specific error types
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout') || message.includes('aborted')) {
      return createError(error.message, ErrorCodes.NETWORK_TIMEOUT, context);
    }
    
    if (message.includes('network') || message.includes('fetch')) {
      return createError(error.message, ErrorCodes.NETWORK_OFFLINE, context);
    }
    
    if (message.includes('channel_error') || message.includes('realtime')) {
      return createError(error.message, ErrorCodes.REALTIME_CHANNEL, context);
    }
    
    if (message.includes('supabase') || message.includes('postgres')) {
      return createError(error.message, ErrorCodes.SUPABASE_QUERY, context);
    }
    
    return createError(error.message, ErrorCodes.UNKNOWN, context);
  }
  
  if (typeof error === 'string') {
    return createError(error, ErrorCodes.UNKNOWN, context);
  }
  
  return createError('An unknown error occurred', ErrorCodes.UNKNOWN, context);
}

/**
 * Retry wrapper with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
    context: ErrorContext;
    onRetry?: (attempt: number, error: AppError) => void;
  }
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    context,
    onRetry,
  } = options;
  
  let lastError: AppError | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = parseError(error, context);
      
      if (attempt < maxRetries) {
        const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);
        
        console.log(`[RETRY] ${context.component}:${context.action} - Attempt ${attempt}/${maxRetries}, retrying in ${delay}ms`);
        
        onRetry?.(attempt, lastError);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Debounced function wrapper
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Throttled function wrapper
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  
  return (...args: Parameters<T>) => {
    const now = Date.now();
    
    if (now - lastCall >= limit) {
      lastCall = now;
      fn(...args);
    }
  };
}

/**
 * Check if browser is online
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
