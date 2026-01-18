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
  
  // Deezer/deemix integration
  downloadFromDeezer: (params: DeezerDownloadParams) => Promise<DeezerDownloadResult>;
  checkDeemix: () => Promise<boolean>;
  
  // Notifications
  showNotification: (title: string, body: string) => Promise<void>;
  notifyBatchComplete: (stats: BatchCompleteStats) => Promise<void>;
  
  // Radio scraping
  scrapeStations: (stations: StationConfig[]) => Promise<ScrapeResult>;
  scrapeStation: (station: StationConfig) => Promise<{ success: boolean; songs: ScrapedSong[]; error?: string }>;
  
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
