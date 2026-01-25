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

/**
 * Check if Electron backend is available (for service mode)
 * Caches the result for 30 seconds to avoid repeated checks
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
        console.log(`[SERVICE-MODE] Backend check result: ${available ? '✅ CONNECTED' : '❌ NOT ELECTRON'}`);
        return available;
      }
      console.log(`[SERVICE-MODE] Backend check failed: HTTP ${response.status}`);
      backendAvailableCache = false;
      lastBackendCheck = now;
      return false;
    } catch (error) {
      console.log(`[SERVICE-MODE] Backend check error:`, error);
      backendAvailableCache = false;
      lastBackendCheck = now;
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
    const response = await fetch('/api/music-library-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ musicFolders }),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });
    
    if (response.ok) {
      return await response.json();
    }
    
    return { success: false, count: 0, folders: 0, error: `HTTP ${response.status}` };
  } catch (error) {
    console.error('[SERVICE-API] getMusicLibraryStats error:', error);
    return { success: false, count: 0, folders: 0, error: String(error) };
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
    const response = await fetch('/api/find-song-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist, title, musicFolders, threshold }),
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    
    if (response.ok) {
      return await response.json();
    }
    
    return { exists: false, error: `HTTP ${response.status}` };
  } catch (error) {
    console.error('[SERVICE-API] findSongMatch error:', error);
    return { exists: false, error: String(error) };
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
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || `HTTP ${response.status}` };
    }
    
    return await response.json();
  } catch (error) {
    console.error('[SERVICE-API] download error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Erro de conexão' };
  }
}

/**
 * Check deemix status via HTTP API
 */
export async function checkDeemixStatusViaAPI(): Promise<{ installed: boolean; command?: string; error?: string }> {
  try {
    const response = await fetch('/api/deemix/status', {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    
    if (response.ok) {
      return await response.json();
    }
    
    return { installed: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { installed: false, error: String(error) };
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
    const response = await fetch('/api/save-grade-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, filename, content }),
      signal: AbortSignal.timeout(30000),
    });
    
    if (response.ok) {
      return await response.json();
    }
    
    return { success: false, error: `HTTP ${response.status}` };
  } catch (error) {
    console.error('[SERVICE-API] saveGradeFile error:', error);
    return { success: false, error: String(error) };
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
    const response = await fetch('/api/read-grade-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, filename }),
      signal: AbortSignal.timeout(10000),
    });
    
    if (response.ok) {
      return await response.json();
    }
    
    return { success: false, error: `HTTP ${response.status}` };
  } catch (error) {
    console.error('[SERVICE-API] readGradeFile error:', error);
    return { success: false, error: String(error) };
  }
}
