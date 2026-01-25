/**
 * Service Mode Detection & API Bridge
 * 
 * This module provides centralized detection and HTTP API calls
 * for Service Mode (browser accessing localhost while Electron runs in background).
 */

// Check if running in native Electron window
export const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron === true;

// Check if running in Service Mode (localhost without native Electron)
// Also detects 127.0.0.1 variant and port 8080 specifically used by Electron service
export const isServiceMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  // Don't check Service Mode if we're in native Electron
  if (isElectron) return false;
  
  const hostname = window.location.hostname;
  const port = window.location.port;
  
  // Standard localhost detection
  const isLocalhost = hostname === '127.0.0.1' || hostname === 'localhost';
  
  // Also detect if we're on port 8080 (Electron service mode default port)
  const isServicePort = port === '8080' || port === '3000' || port === '5173' || port === '8000';
  
  return isLocalhost || (isServicePort && !hostname.includes('lovable'));
};

// Check if we're in Lovable preview environment (not localhost, not electron)
export const isLovablePreview = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (isElectron) return false;
  if (isServiceMode()) return false;
  // If we get here, we're in a web browser but not localhost
  return true;
};

// Cache for backend availability check
let backendAvailableCache: boolean | null = null;
let backendCheckPromise: Promise<boolean> | null = null;
let lastBackendCheck = 0;
const BACKEND_CHECK_INTERVAL = 30000; // 30 seconds

// Auto-reconnect state
let failureCount = 0;
let reconnectIntervalId: ReturnType<typeof setInterval> | null = null;
let reconnectListeners: Set<(connected: boolean) => void> = new Set();
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL_BASE = 3000; // Start with 3 seconds
const RECONNECT_INTERVAL_MAX = 30000; // Max 30 seconds between attempts

/**
 * Subscribe to reconnection events
 */
export function onBackendReconnect(listener: (connected: boolean) => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

/**
 * Notify all listeners of connection status change
 */
function notifyReconnectListeners(connected: boolean): void {
  reconnectListeners.forEach(listener => {
    try {
      listener(connected);
    } catch (e) {
      console.error('[SERVICE-MODE] Error in reconnect listener:', e);
    }
  });
}

/**
 * Start automatic reconnection attempts
 */
function startAutoReconnect(): void {
  // Don't start if already reconnecting or if we're in Lovable preview
  if (reconnectIntervalId || !isServiceMode()) return;
  
  console.log('[SERVICE-MODE] 🔄 Starting auto-reconnect...');
  
  const attemptReconnect = async () => {
    if (failureCount >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[SERVICE-MODE] ⚠️ Max reconnect attempts reached, stopping auto-reconnect');
      stopAutoReconnect();
      return;
    }
    
    failureCount++;
    const delay = Math.min(RECONNECT_INTERVAL_BASE * Math.pow(1.5, failureCount - 1), RECONNECT_INTERVAL_MAX);
    
    console.log(`[SERVICE-MODE] 🔄 Reconnect attempt ${failureCount}/${MAX_RECONNECT_ATTEMPTS}...`);
    
    try {
      const response = await fetch('/api/health', { 
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.electron === true) {
          console.log('[SERVICE-MODE] ✅ Auto-reconnect SUCCESS!');
          backendAvailableCache = true;
          lastBackendCheck = Date.now();
          failureCount = 0;
          stopAutoReconnect();
          notifyReconnectListeners(true);
          return;
        }
      }
    } catch (error) {
      console.log(`[SERVICE-MODE] Reconnect attempt failed, next in ${Math.round(delay / 1000)}s`);
    }
    
    // Schedule next attempt with exponential backoff
    if (reconnectIntervalId) {
      clearInterval(reconnectIntervalId);
    }
    reconnectIntervalId = setInterval(attemptReconnect, delay);
  };
  
  // Start first attempt immediately
  attemptReconnect();
}

/**
 * Stop automatic reconnection
 */
function stopAutoReconnect(): void {
  if (reconnectIntervalId) {
    clearInterval(reconnectIntervalId);
    reconnectIntervalId = null;
  }
}

/**
 * Reset failure count (call when connection is manually restored)
 */
export function resetReconnectState(): void {
  failureCount = 0;
  stopAutoReconnect();
}

/**
 * Check if Electron backend is available (for service mode)
 * Caches the result for 30 seconds to avoid repeated checks
 * Automatically triggers reconnection on failure
 */
export async function checkElectronBackend(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached result if recent (but only if it was true - retry faster if false)
  if (backendAvailableCache === true && (now - lastBackendCheck) < BACKEND_CHECK_INTERVAL) {
    return backendAvailableCache;
  }
  
  // If was false, use shorter cache (5 seconds) to retry faster
  if (backendAvailableCache === false && (now - lastBackendCheck) < 5000) {
    return backendAvailableCache;
  }
  
  // If already checking, wait for that result
  if (backendCheckPromise) {
    return backendCheckPromise;
  }
  
  backendCheckPromise = (async () => {
    try {
      console.log('[SERVICE-MODE] Checking backend availability...');
      const response = await fetch('/api/health', { 
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      if (response.ok) {
        const data = await response.json();
        const available = data.electron === true;
        backendAvailableCache = available;
        lastBackendCheck = now;
        
        if (available) {
          // Connection restored - reset reconnect state
          resetReconnectState();
          notifyReconnectListeners(true);
          console.log(`[SERVICE-MODE] Backend check result: ✅ CONNECTED`);
        } else {
          console.log(`[SERVICE-MODE] Backend check result: ❌ NOT ELECTRON`);
        }
        
        return available;
      }
      console.log(`[SERVICE-MODE] Backend check failed: HTTP ${response.status}`);
      backendAvailableCache = false;
      lastBackendCheck = now;
      
      // Start auto-reconnect on failure
      if (isServiceMode()) {
        startAutoReconnect();
        notifyReconnectListeners(false);
      }
      
      return false;
    } catch (error) {
      console.log(`[SERVICE-MODE] Backend check error:`, error);
      backendAvailableCache = false;
      lastBackendCheck = now;
      
      // Start auto-reconnect on failure
      if (isServiceMode()) {
        startAutoReconnect();
        notifyReconnectListeners(false);
      }
      
      return false;
    } finally {
      backendCheckPromise = null;
    }
  })();
  
  return backendCheckPromise;
}

/**
 * Get whether we can use local file operations
 * Either via native Electron or via Service Mode HTTP API
 */
export function canUseLocalOperations(): boolean {
  return isElectron || isServiceMode();
}

/**
 * Check backend availability synchronously (using cached value)
 * Returns null if not yet checked
 */
export function getBackendAvailable(): boolean | null {
  return backendAvailableCache;
}

/**
 * Reset backend availability cache (useful after connectivity changes)
 */
export function resetBackendCache(): void {
  backendAvailableCache = null;
  lastBackendCheck = 0;
}

// ============= HTTP API WRAPPERS =============

interface MusicLibraryStatsResult {
  success: boolean;
  count: number;
  folders: number;
  error?: string;
}

/**
 * Get music library stats via HTTP API
 */
export async function getMusicLibraryStatsViaAPI(musicFolders: string[]): Promise<MusicLibraryStatsResult> {
  try {
    // Check backend connectivity first
    const backendAvailable = getBackendAvailable();
    if (backendAvailable === false) {
      return { success: false, count: 0, folders: 0, error: 'Backend desconectado' };
    }

    const response = await fetch('/api/music-library-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ musicFolders }),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });
    
    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorBody = await response.json();
        if (errorBody.error) errorDetail = errorBody.error;
      } catch { /* ignore */ }
      return { success: false, count: 0, folders: 0, error: errorDetail };
    }
    
    try {
      return await response.json();
    } catch {
      return { success: false, count: 0, folders: 0, error: 'Resposta inválida' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('Failed to fetch')) {
      return { success: false, count: 0, folders: 0, error: 'Backend não acessível' };
    }
    
    console.error('[SERVICE-API] getMusicLibraryStats error:', error);
    return { success: false, count: 0, folders: 0, error: errorMessage };
  }
}

interface SongMatchResult {
  exists: boolean;
  path?: string;
  filename?: string;
  baseName?: string;
  similarity?: number;
  error?: string;
}

/**
 * Find song match in library via HTTP API
 */
export async function findSongMatchViaAPI(
  artist: string,
  title: string,
  musicFolders: string[],
  threshold: number = 0.75
): Promise<SongMatchResult> {
  try {
    // Check backend connectivity first
    const backendAvailable = getBackendAvailable();
    if (backendAvailable === false) {
      return { exists: false, error: 'Backend desconectado' };
    }

    const response = await fetch('/api/find-song-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist, title, musicFolders, threshold }),
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    
    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorBody = await response.json();
        if (errorBody.error) errorDetail = errorBody.error;
      } catch { /* ignore */ }
      return { exists: false, error: errorDetail };
    }
    
    try {
      return await response.json();
    } catch {
      return { exists: false, error: 'Resposta inválida' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('Failed to fetch')) {
      return { exists: false, error: 'Backend não acessível' };
    }
    
    console.error('[SERVICE-API] findSongMatch error:', error);
    return { exists: false, error: errorMessage };
  }
}

interface DownloadParams {
  artist: string;
  title: string;
  arl: string;
  outputFolder: string;
  outputFolder2?: string;
  quality: string;
}

interface DownloadResult {
  success: boolean;
  error?: string;
  track?: any;
}

/**
 * Download song via HTTP API
 */
export async function downloadViaAPI(params: DownloadParams): Promise<DownloadResult> {
  try {
    // Check backend connectivity before attempting download
    const backendAvailable = getBackendAvailable();
    if (backendAvailable === false) {
      return { 
        success: false, 
        error: 'Backend desconectado. Verifique se o Electron está em execução.' 
      };
    }

    const response = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(120000), // 2 minute timeout for downloads
    });
    
    if (!response.ok) {
      // Try to parse error details
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorDetail = errorData.error;
        }
      } catch {
        // Ignore JSON parse error
      }
      return { success: false, error: errorDetail };
    }
    
    // Safely parse response
    try {
      return await response.json();
    } catch {
      return { success: false, error: 'Resposta inválida do servidor' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('Failed to fetch')) {
      console.error('[SERVICE-API] download: Backend não acessível');
      return { 
        success: false, 
        error: 'Falha na conexão com backend. Verifique se o Electron está em execução.' 
      };
    }
    
    if (errorMessage.includes('timeout') || errorMessage.includes('aborted')) {
      console.error('[SERVICE-API] download: Timeout');
      return { 
        success: false, 
        error: 'Tempo esgotado ao baixar. Tente novamente.' 
      };
    }
    
    console.error('[SERVICE-API] download error:', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Check deemix status via HTTP API
 */
export async function checkDeemixStatusViaAPI(): Promise<{ installed: boolean; command?: string; error?: string }> {
  try {
    // Check backend connectivity first
    const backendAvailable = getBackendAvailable();
    if (backendAvailable === false) {
      return { installed: false, error: 'Backend desconectado' };
    }

    const response = await fetch('/api/deemix/status', {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) {
      return { installed: false, error: `HTTP ${response.status}` };
    }
    
    try {
      return await response.json();
    } catch {
      return { installed: false, error: 'Resposta inválida' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('Failed to fetch')) {
      return { installed: false, error: 'Backend não acessível' };
    }
    
    return { installed: false, error: errorMessage };
  }
}

// ============= GRADE FILE API WRAPPERS =============

interface SaveGradeResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

/**
 * Save grade file via HTTP API (for Service Mode)
 */
export async function saveGradeFileViaAPI(
  folder: string,
  filename: string,
  content: string
): Promise<SaveGradeResult> {
  try {
    // Check backend connectivity before attempting save
    const backendAvailable = getBackendAvailable();
    if (backendAvailable === false) {
      return { 
        success: false, 
        error: 'Backend desconectado. Verifique se o Electron está em execução.' 
      };
    }

    const response = await fetch('/api/save-grade-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, filename, content }),
      signal: AbortSignal.timeout(30000),
    });
    
    if (response.ok) {
      return await response.json();
    }
    
    // Try to get more details from error response
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorDetail = errorBody.error;
      }
    } catch {
      // Ignore JSON parse error
    }
    
    return { success: false, error: errorDetail };
  } catch (error) {
    // Provide more specific error messages
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('Failed to fetch')) {
      console.error('[SERVICE-API] saveGradeFile: Backend não acessível');
      return { 
        success: false, 
        error: 'Falha na conexão com backend. Verifique se o Electron está em execução em localhost:8080.' 
      };
    }
    
    if (errorMessage.includes('timeout') || errorMessage.includes('aborted')) {
      console.error('[SERVICE-API] saveGradeFile: Timeout');
      return { 
        success: false, 
        error: 'Tempo esgotado ao salvar. Tente novamente.' 
      };
    }
    
    console.error('[SERVICE-API] saveGradeFile error:', error);
    return { success: false, error: errorMessage };
  }
}

interface ReadGradeResult {
  success: boolean;
  content?: string;
  filePath?: string;
  error?: string;
}

/**
 * Read grade file via HTTP API (for Service Mode)
 */
export async function readGradeFileViaAPI(
  folder: string,
  filename: string
): Promise<ReadGradeResult> {
  try {
    // Check backend connectivity before attempting read
    const backendAvailable = getBackendAvailable();
    if (backendAvailable === false) {
      return { 
        success: false, 
        error: 'Backend desconectado. Verifique se o Electron está em execução.' 
      };
    }

    const response = await fetch('/api/read-grade-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, filename }),
      signal: AbortSignal.timeout(10000),
    });
    
    if (response.ok) {
      return await response.json();
    }
    
    // Try to get more details from error response
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorDetail = errorBody.error;
      }
    } catch {
      // Ignore JSON parse error
    }
    
    return { success: false, error: errorDetail };
  } catch (error) {
    // Provide more specific error messages
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('Failed to fetch')) {
      console.error('[SERVICE-API] readGradeFile: Backend não acessível');
      return { 
        success: false, 
        error: 'Falha na conexão com backend. Verifique se o Electron está em execução.' 
      };
    }
    
    if (errorMessage.includes('timeout') || errorMessage.includes('aborted')) {
      console.error('[SERVICE-API] readGradeFile: Timeout');
      return { 
        success: false, 
        error: 'Tempo esgotado ao ler arquivo. Tente novamente.' 
      };
    }
    
    console.error('[SERVICE-API] readGradeFile error:', error);
    return { success: false, error: errorMessage };
  }
}
