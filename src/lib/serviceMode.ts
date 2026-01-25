/**
 * Service Mode Detection & API Bridge
 * 
 * This module provides centralized detection and HTTP API calls
 * for Service Mode (browser accessing localhost while Electron runs in background).
 */

// Check if running in native Electron window
export const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron === true;

// Check if running in Service Mode (localhost without native Electron)
export const isServiceMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  const isLocalhost = hostname === '127.0.0.1' || hostname === 'localhost';
  return isLocalhost && !isElectron;
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
  
  // Return cached result if recent
  if (backendAvailableCache !== null && (now - lastBackendCheck) < BACKEND_CHECK_INTERVAL) {
    return backendAvailableCache;
  }
  
  // If already checking, wait for that result
  if (backendCheckPromise) {
    return backendCheckPromise;
  }
  
  backendCheckPromise = (async () => {
    try {
      const response = await fetch('/api/health', { 
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      if (response.ok) {
        const data = await response.json();
        backendAvailableCache = data.electron === true;
        lastBackendCheck = now;
        return backendAvailableCache;
      }
      backendAvailableCache = false;
      lastBackendCheck = now;
      return false;
    } catch {
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
