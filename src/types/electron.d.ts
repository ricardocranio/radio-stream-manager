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
  track?: {
    id: number;
    title: string;
    artist: string;
    album: string;
    duration: number;
    preview: string;
  };
  message?: string;
}

interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAppPath: (name: string) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  openPath: (path: string) => Promise<void>;
  downloadFromDeezer: (params: DeezerDownloadParams) => Promise<DeezerDownloadResult>;
  platform: string;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
