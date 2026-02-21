interface DeezerDownloadParams {
  artist: string;
  title: string;
  arl: string;
  outputFolder: string;
  quality: 'MP3_128' | 'MP3_320' | 'FLAC';
  stationName?: string; // If provided, saves to station subfolder
}

interface DeezerDownloadResult {
  success: boolean;
  error?: string;
  needsInstall?: boolean;
  skipped?: boolean; // True if file already existed
  existingPath?: string; // Path where file already exists
  existingStation?: string; // Station folder where file exists
  stationFolder?: string; // Station folder where file was saved
  track?: {
    id: number;
    title: string;
    artist: string;
    album: string;
    duration: number;
  };
  output?: string;
  outputFolder?: string;
  message?: string;
  verifiedFile?: string; // Name of the verified downloaded file
}

// Station folder management
interface EnsureStationFoldersParams {
  baseFolder: string;
  stations: string[];
}

interface EnsureStationFoldersResult {
  success: boolean;
  created: string[];
  total: number;
  error?: string;
}

interface CheckFileInSubfoldersParams {
  baseFolder: string;
  artist: string;
  title: string;
}

interface CheckFileInSubfoldersResult {
  exists: boolean;
  path?: string;
  station?: string;
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

interface RenameMusicFileParams {
  musicFolders: string[];
  currentFilename: string;
  newFilename: string;
}

interface RenameMusicFileResult {
  success: boolean;
  renamed: boolean;
  oldPath?: string;
  newPath?: string;
  reason?: string;
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

interface BpmScanParams {
  folders: string[];
}

interface BpmScanResult {
  success: boolean;
  total: number;
  withBpm: number;
  withoutBpm: number;
  samples: { filename: string; bpm: number }[];
  bpmDistribution: { range: string; count: number }[];
  error?: string;
}

interface BpmCacheEntry {
  bpm: number;
  scannedAt: string;
}

interface BpmCacheData {
  [filename: string]: BpmCacheEntry;
}

interface BpmCacheSaveParams {
  folder: string;
  data: BpmCacheData;
}

interface BpmCacheLoadParams {
  folder: string;
}

interface BpmCacheResult {
  success: boolean;
  data?: BpmCacheData;
  error?: string;
}

interface StationConfig {
  id: string;
  name: string;
  urls: string[];
  styles: string[];
  enabled: boolean;
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
  scrapeVozDownloadUrl: () => Promise<{ success: boolean; url: string | null; error?: string }>;
  onVozDownloadProgress: (callback: (progress: VozDownloadProgress) => void) => void;
  
  // Grade file operations
  saveGradeFile: (params: GradeFileParams) => Promise<GradeFileResult>;
  readGradeFile: (params: Omit<GradeFileParams, 'content'>) => Promise<GradeFileResult>;
  listFolderFiles: (params: FolderListParams) => Promise<FolderListResult>;
  renameMusicFile: (params: RenameMusicFileParams) => Promise<RenameMusicFileResult>;
  scanBpmTags: (params: BpmScanParams) => Promise<BpmScanResult>;
  saveBpmCache: (params: BpmCacheSaveParams) => Promise<{ success: boolean; error?: string }>;
  loadBpmCache: (params: BpmCacheLoadParams) => Promise<BpmCacheResult>;
  
  // Station folder management
  ensureStationFolders: (params: EnsureStationFoldersParams) => Promise<EnsureStationFoldersResult>;
  checkFileInSubfolders: (params: CheckFileInSubfoldersParams) => Promise<CheckFileInSubfoldersResult>;
  
  // Window management
  showWindow: () => Promise<{ success: boolean }>;
  
  // Auto-update
  checkForUpdates: () => Promise<void>;
  onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => void;
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => void;
  onDownloadProgress: (callback: (progress: { percent: number }) => void) => void;
  
  // Python/Deemix status notifications
  onPythonStatus: (callback: (status: { available: boolean; message: string; downloadUrl: string }) => void) => void;
  onDeemixStatus: (callback: (status: { installed: boolean; command: string | null }) => void) => void;
  getDeemixCommand: () => Promise<string | null>;
  
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
