interface DeezerDownloadParams {
  artist: string;
  title: string;
  arl: string;
  outputFolder: string;
  quality: 'MP3_128' | 'MP3_320' | 'FLAC';
}

interface DeezerDownloadResult {
  success: boolean;
  error?: string;
  needsInstall?: boolean;
  track?: {
    id: number;
    title: string;
    artist: string;
    album: string;
    duration: number;
  };
  output?: string;
  message?: string;
}

interface BatchCompleteStats {
  completed: number;
  failed: number;
  total: number;
  outputFolder?: string;
}

interface ScrapedSong {
  id: string;
  title: string;
  artist: string;
  station: string;
  timestamp: Date;
  status: 'found' | 'missing';
}

interface ScrapeResult {
  songs: ScrapedSong[];
  errors: { station: string; error: string }[];
  timestamp: string;
}

interface CheckSongParams {
  artist: string;
  title: string;
  musicFolders: string[];
  threshold?: number; // Similarity threshold (0.5 to 0.95), defaults to 0.75
}

interface CheckSongResult {
  exists: boolean;
  path?: string;
  filename?: string;
  baseName?: string;
  similarity?: number;
}

interface MusicLibraryStatsParams {
  musicFolders: string[];
}

interface MusicLibraryStatsResult {
  success: boolean;
  count: number;
  folders: number;
}

interface VozDownloadParams {
  url: string;
  outputFolder: string;
  filename: string;
}

interface VozDownloadResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  error?: string;
}

interface VozCleanupParams {
  folder: string;
  maxAgeDays: number;
}

interface VozCleanupResult {
  success: boolean;
  deletedCount?: number;
  error?: string;
}

interface VozDownloadProgress {
  progress: number;
  downloaded: number;
  total: number;
}

interface GradeFileParams {
  folder: string;
  filename: string;
  content?: string;
}

interface GradeFileResult {
  success: boolean;
  filePath?: string;
  content?: string;
  error?: string;
}

interface FolderListParams {
  folder: string;
  extension?: string;
}

interface FolderFileInfo {
  name: string;
  size: number;
  modified: string;
}

interface FolderListResult {
  success: boolean;
  files: FolderFileInfo[];
  error?: string;
}

interface StationConfig {
  id: string;
  name: string;
  urls: string[];
  styles: string[];
  enabled: boolean;
}

interface ServiceModeStatus {
  running: boolean;
  port: number;
  url: string;
}

interface ElectronAPI {
  // App info
  getAppVersion: () => Promise<string>;
  getAppPath: (name: string) => Promise<string>;
  
  // Shell operations
  openExternal: (url: string) => Promise<void>;
  openPath: (path: string) => Promise<void>;
  openFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
  ensureFolder: (path: string) => Promise<{ success: boolean; created?: boolean; error?: string }>;
  selectFolder: () => Promise<string | null>;
  
  // Deezer/deemix integration
  downloadFromDeezer: (params: DeezerDownloadParams) => Promise<DeezerDownloadResult>;
  checkDeemix: () => Promise<boolean>;
  checkPython: () => Promise<{ available: boolean; command: string | null }>;
  installDeemix: () => Promise<{
    success: boolean;
    error?: string;
    output?: string;
    message?: string;
    needsPython?: boolean;
    needsRestart?: boolean;
  }>;
  testDeemix: () => Promise<{
    success: boolean;
    version?: string;
    command?: string;
    message?: string;
    error?: string;
  }>;
  testDeemixSearch: (params: { artist: string; title: string }) => Promise<{
    success: boolean;
    track?: {
      id: number;
      title: string;
      artist: string;
      album: string;
      preview: string;
      link: string;
    };
    message?: string;
    error?: string;
  }>;
  onDeemixInstallProgress: (callback: (progress: { status: string; message: string }) => void) => void;
  
  // Notifications
  showNotification: (title: string, body: string) => Promise<void>;
  notifyBatchComplete: (stats: BatchCompleteStats) => Promise<void>;
  
  // Radio scraping
  scrapeStations: (stations: StationConfig[]) => Promise<ScrapeResult>;
  scrapeStation: (station: StationConfig) => Promise<{ success: boolean; songs: ScrapedSong[]; error?: string }>;
  
  // Music library check - verify if song exists in local folders
  checkSongExists: (params: CheckSongParams) => Promise<CheckSongResult>;
  findSongMatch: (params: CheckSongParams) => Promise<CheckSongResult>;
  getMusicLibraryStats: (params: MusicLibraryStatsParams) => Promise<MusicLibraryStatsResult>;
  
  // Voz do Brasil download
  downloadVozBrasil: (params: VozDownloadParams) => Promise<VozDownloadResult>;
  cleanupVozBrasil: (params: VozCleanupParams) => Promise<VozCleanupResult>;
  onVozDownloadProgress: (callback: (progress: VozDownloadProgress) => void) => void;
  
  // Grade file operations
  saveGradeFile: (params: GradeFileParams) => Promise<GradeFileResult>;
  readGradeFile: (params: Omit<GradeFileParams, 'content'>) => Promise<GradeFileResult>;
  listFolderFiles: (params: FolderListParams) => Promise<FolderListResult>;
  
  // Auto-update
  checkForUpdates: () => Promise<void>;
  onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => void;
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => void;
  onDownloadProgress: (callback: (progress: { percent: number }) => void) => void;
  
  // Python/Deemix status notifications
  onPythonStatus: (callback: (status: { available: boolean; message: string; downloadUrl: string }) => void) => void;
  onDeemixStatus: (callback: (status: { installed: boolean; command: string | null }) => void) => void;
  getDeemixCommand: () => Promise<string | null>;
  
  // Service Mode (Tray + Localhost)
  setServiceMode: (mode: 'window' | 'service') => Promise<void>;
  getServiceMode: () => Promise<'window' | 'service'>;
  openInBrowser: () => Promise<void>;
  getLocalhostUrl: () => Promise<string>;
  onServerStatus: (callback: (status: ServiceModeStatus) => void) => void;
  onServiceModeChanged: (callback: (mode: 'window' | 'service') => void) => void;
  
  // Platform detection
  platform: string;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
