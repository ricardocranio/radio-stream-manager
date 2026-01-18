import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { RadioStation, ProgramSchedule, CapturedSong, SystemConfig, SequenceConfig, BlockSchedule } from '@/types/radio';

export interface DeezerConfig {
  arl: string;
  downloadFolder: string;
  quality: 'MP3_128' | 'MP3_320' | 'FLAC';
  enabled: boolean;
  autoDownload: boolean;
  autoDownloadIntervalMinutes: number; // Interval between auto-downloads
}

export interface FixedContent {
  id: string;
  name: string;
  fileName: string;
  type: 'news' | 'horoscope' | 'sports' | 'weather' | 'romance' | 'curiosity' | 'other';
  dayPattern: string; // WEEKDAYS, WEEKEND, ALL, or specific days
  timeSlots: { hour: number; minute: number }[];
  enabled: boolean;
}

export interface BlockSong {
  id: string;
  title: string;
  artist: string;
  file: string;
  source: string;
  isFixed: boolean;
}

export interface MissingSong {
  id: string;
  title: string;
  artist: string;
  station: string;
  timestamp: Date;
  status: 'missing' | 'downloading' | 'downloaded' | 'error';
  dna?: string;
}

export interface DownloadHistoryEntry {
  id: string;
  songId: string;
  title: string;
  artist: string;
  timestamp: Date;
  status: 'success' | 'error';
  errorMessage?: string;
  duration?: number; // download time in ms
}

interface RadioState {
  // Radio Stations
  stations: RadioStation[];
  setStations: (stations: RadioStation[]) => void;
  updateStation: (id: string, updates: Partial<RadioStation>) => void;
  
  // Program Schedule
  programs: ProgramSchedule[];
  setPrograms: (programs: ProgramSchedule[]) => void;
  
  // Captured Songs (Real-time)
  capturedSongs: CapturedSong[];
  addCapturedSong: (song: CapturedSong) => void;
  clearCapturedSongs: () => void;
  
  // System Config
  config: SystemConfig;
  setConfig: (config: Partial<SystemConfig>) => void;
  
  // Deezer Config
  deezerConfig: DeezerConfig;
  setDeezerConfig: (config: Partial<DeezerConfig>) => void;
  
  // Sequence Config
  sequence: SequenceConfig[];
  setSequence: (sequence: SequenceConfig[]) => void;
  
  // Block Schedule
  blocks: BlockSchedule[];
  setBlocks: (blocks: BlockSchedule[]) => void;
  
  // System Status
  isRunning: boolean;
  setIsRunning: (running: boolean) => void;
  lastUpdate: Date | null;
  setLastUpdate: (date: Date) => void;
  
  // Missing Songs
  missingSongs: MissingSong[];
  setMissingSongs: (songs: MissingSong[]) => void;
  addMissingSong: (song: MissingSong) => void;
  updateMissingSong: (id: string, updates: Partial<MissingSong>) => void;
  removeMissingSong: (id: string) => void;
  clearMissingSongs: () => void;

  // Fixed Content
  fixedContent: FixedContent[];
  setFixedContent: (content: FixedContent[]) => void;
  addFixedContent: (content: FixedContent) => void;
  updateFixedContent: (id: string, updates: Partial<FixedContent>) => void;
  removeFixedContent: (id: string) => void;

  // Block Songs (for drag-and-drop)
  blockSongs: Record<string, BlockSong[]>;
  setBlockSongs: (timeKey: string, songs: BlockSong[]) => void;

  // Batch Download State
  batchDownloadProgress: {
    isRunning: boolean;
    total: number;
    completed: number;
    failed: number;
    current: string;
  };
  setBatchDownloadProgress: (progress: Partial<RadioState['batchDownloadProgress']>) => void;

  // Download History
  downloadHistory: DownloadHistoryEntry[];
  addDownloadHistory: (entry: DownloadHistoryEntry) => void;
  clearDownloadHistory: () => void;
}

// V21 Configuration - Updated from FINAL_PGM_V21.py
const defaultStations: RadioStation[] = [
  {
    id: 'bh',
    name: 'BH FM',
    urls: ['https://onlineradiobox.com/br/bh/playlist/', 'https://radiosaovivo.net/bh-fm/'],
    styles: ['SERTANEJO', 'PAGODE', 'AGRONEJO'],
    enabled: true,
  },
  {
    id: 'band',
    name: 'Band FM',
    urls: ['https://onlineradiobox.com/br/band/playlist/', 'https://radiosaovivo.net/band/'],
    styles: ['SERTANEJO', 'PAGODE', 'AGRONEJO'],
    enabled: true,
  },
  {
    id: 'clube',
    name: 'Clube FM',
    urls: ['https://www.clubefm.com.br/o-que-tocou', 'https://radiosaovivo.net/clube-brasilia/', 'https://www.radio-ao-vivo.com/radio-clube-fm'],
    styles: ['SERTANEJO', 'PAGODE', 'POP/VARIADO'],
    enabled: true,
  },
];

// V21 Program IDs
const defaultPrograms: ProgramSchedule[] = [
  { timeRange: '1-5', programName: 'Nossa Madrugada' },
  { timeRange: '6-8', programName: 'Happy Hour' },
  { timeRange: '9-11', programName: 'Manhã de Hits' },
  { timeRange: '12-13', programName: 'Hora do Almoço' },
  { timeRange: '14-16', programName: 'Tarde Animada' },
  { timeRange: '17-17', programName: 'Happy Hour' },
  { timeRange: '18-18', programName: 'TOP10' },
  { timeRange: '19-19', programName: 'FIXO' },
  { timeRange: '20-20', programName: 'FIXO' },
  { timeRange: '21-23', programName: 'Noite NOSSA' },
  { timeRange: '0-0', programName: 'Noite NOSSA' },
];

// V21 Sequence - Based on pos_map: 1-4=bh, 5-7=band, 8-10=clube
const defaultSequence: SequenceConfig[] = [
  { position: 1, radioSource: 'bh' },
  { position: 2, radioSource: 'bh' },
  { position: 3, radioSource: 'bh' },
  { position: 4, radioSource: 'bh' },
  { position: 5, radioSource: 'band' },
  { position: 6, radioSource: 'band' },
  { position: 7, radioSource: 'band' },
  { position: 8, radioSource: 'clube' },
  { position: 9, radioSource: 'clube' },
  { position: 10, radioSource: 'clube' },
];

// V21 System Config
const defaultConfig: SystemConfig = {
  musicFolders: ['C:\\Users\\Radio\\Music\\PGM-FM', 'C:\\Playlist\\Músicas'],
  gradeFolder: 'C:\\Playlist\\pgm\\Grades',
  contentFolder: 'G:\\Outros computadores\\Meu computador\\Conteudos KF',
  rankingFile: 'C:\\Playlist\\pgm\\Grades\\ranking_sucessos.json',
  updateIntervalMinutes: 20,
  artistRepetitionMinutes: 60,
  safetyMarginMinutes: 5,
  coringaCode: 'mus',
  // V21 additions
  vozBrasilFolder: 'C:\\Playlist\\A Voz do Brasil',
  vozBrasilTime: '20:35',
  dnaLearningFile: 'C:\\Playlist\\pgm\\Grades\\dna_learning.json',
  inventoryCacheDuration: 3600,
  hardResetInterval: 3600,
  monitorInterval: 300,
  forbiddenWords: ['1.FM', 'Love Classics', 'Solitaire', 'Mahjong', 'Dayspedia', 'Games', 'Online', 'METROPOLITANA - SP', 'BAND FM'],
  funkWords: ['funk', 'mc ', 'sequencia', 'proibidão', 'baile', 'kondzilla', 'gr6'],
};

const defaultDeezerConfig: DeezerConfig = {
  arl: '04b2d26d75ab4326fd20b66bffd71ca2393a2f2d7893b44453ea5b6f560038ee327caf42b5458fc5776838427d655108d36af2a999c5a661c4c00bb3ca72dfc1c5929881ccdfec2a464bca3a2502e7c006342baed4deac609ad946ef67972f5d',
  downloadFolder: 'C:\\Playlist\\Downloads',
  quality: 'MP3_320',
  enabled: true,
  autoDownload: false,
  autoDownloadIntervalMinutes: 20, // Default 20 minutes between downloads
};

const defaultFixedContent: FixedContent[] = [
  { id: '1', name: 'Notícia da Hora', fileName: 'NOTICIA_DA_HORA_{HH}HORAS', type: 'news', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 9, minute: 0 }, { hour: 10, minute: 0 }, { hour: 11, minute: 0 }, { hour: 12, minute: 0 }, { hour: 14, minute: 0 }, { hour: 15, minute: 0 }, { hour: 16, minute: 0 }, { hour: 17, minute: 0 }], enabled: true },
  { id: '2', name: 'Horóscopo do Dia', fileName: 'HOROSCOPO_DO_DIA_EDICAO{ED}', type: 'horoscope', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 8, minute: 30 }, { hour: 9, minute: 30 }, { hour: 10, minute: 30 }, { hour: 11, minute: 30 }], enabled: true },
  { id: '3', name: 'As Últimas do Esporte', fileName: 'AS_ULTIMAS_DO_ESPORTE_EDICAO{ED}', type: 'sports', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 12, minute: 0 }, { hour: 12, minute: 30 }], enabled: true },
  { id: '4', name: 'Clima Brasil Sudeste', fileName: 'CLIMA_BRASIL_SUDESTE', type: 'weather', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 12, minute: 30 }], enabled: true },
  { id: '5', name: 'Fique Sabendo', fileName: 'FIQUE_SABENDO_EDICAO{ED}', type: 'news', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 13, minute: 0 }, { hour: 13, minute: 30 }, { hour: 14, minute: 0 }, { hour: 14, minute: 30 }, { hour: 15, minute: 0 }], enabled: true },
  { id: '6', name: 'Fatos e Boatos', fileName: 'FATOS_E_BOATOS_EDICAO01', type: 'curiosity', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 16, minute: 30 }], enabled: true },
  { id: '7', name: 'Top 10 Mix', fileName: 'TOP_10_MIX_BLOCO{ED}', type: 'other', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 18, minute: 0 }, { hour: 18, minute: 30 }], enabled: true },
  { id: '8', name: 'Papo Sério', fileName: 'PAPO_SERIO', type: 'other', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 20, minute: 0 }], enabled: true },
  { id: '9', name: 'Momento de Reflexão', fileName: 'MOMENTO_DE_REFLEXAO', type: 'other', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 20, minute: 30 }], enabled: true },
  { id: '10', name: 'Romance', fileName: 'ROMANCE_BLOCO{ED}', type: 'romance', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 20, minute: 0 }, { hour: 20, minute: 30 }, { hour: 21, minute: 0 }, { hour: 22, minute: 30 }], enabled: true },
  { id: '11', name: 'Raridades', fileName: 'RARIDADES_BLOCO{ED}', type: 'other', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 12, minute: 0 }, { hour: 12, minute: 30 }], enabled: true },
  { id: '12', name: 'Mamãe Cheguei', fileName: 'MAMAE_CHEGUEI', type: 'other', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 21, minute: 0 }], enabled: true },
  { id: '13', name: 'Curiosidades', fileName: 'CURIOSIDADES', type: 'curiosity', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 22, minute: 30 }], enabled: true },
];

export const useRadioStore = create<RadioState>()(
  persist(
    (set) => ({
      stations: defaultStations,
      setStations: (stations) => set({ stations }),
      updateStation: (id, updates) =>
        set((state) => ({
          stations: state.stations.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        })),

      programs: defaultPrograms,
      setPrograms: (programs) => set({ programs }),

      capturedSongs: [],
      addCapturedSong: (song) =>
        set((state) => ({
          capturedSongs: [song, ...state.capturedSongs].slice(0, 100),
        })),
      clearCapturedSongs: () => set({ capturedSongs: [] }),

      config: defaultConfig,
      setConfig: (config) =>
        set((state) => ({ config: { ...state.config, ...config } })),

      deezerConfig: defaultDeezerConfig,
      setDeezerConfig: (config) =>
        set((state) => ({ deezerConfig: { ...state.deezerConfig, ...config } })),

      sequence: defaultSequence,
      setSequence: (sequence) => set({ sequence }),

      blocks: [],
      setBlocks: (blocks) => set({ blocks }),

      isRunning: false,
      setIsRunning: (isRunning) => set({ isRunning }),
      lastUpdate: null,
      setLastUpdate: (lastUpdate) => set({ lastUpdate }),

      missingSongs: [],
      setMissingSongs: (missingSongs) => set({ missingSongs }),
      addMissingSong: (song) =>
        set((state) => ({ missingSongs: [...state.missingSongs, song] })),
      updateMissingSong: (id, updates) =>
        set((state) => ({
          missingSongs: state.missingSongs.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        })),
      removeMissingSong: (id) =>
        set((state) => ({
          missingSongs: state.missingSongs.filter((s) => s.id !== id),
        })),
      clearMissingSongs: () => set({ missingSongs: [] }),

      fixedContent: defaultFixedContent,
      setFixedContent: (fixedContent) => set({ fixedContent }),
      addFixedContent: (content) =>
        set((state) => ({ fixedContent: [...state.fixedContent, content] })),
      updateFixedContent: (id, updates) =>
        set((state) => ({
          fixedContent: state.fixedContent.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        })),
      removeFixedContent: (id) =>
        set((state) => ({
          fixedContent: state.fixedContent.filter((c) => c.id !== id),
        })),

      blockSongs: {},
      setBlockSongs: (timeKey, songs) =>
        set((state) => ({
          blockSongs: { ...state.blockSongs, [timeKey]: songs },
        })),

      batchDownloadProgress: {
        isRunning: false,
        total: 0,
        completed: 0,
        failed: 0,
        current: '',
      },
      setBatchDownloadProgress: (progress) =>
        set((state) => ({
          batchDownloadProgress: { ...state.batchDownloadProgress, ...progress },
        })),

      // Download History
      downloadHistory: [],
      addDownloadHistory: (entry) =>
        set((state) => ({
          downloadHistory: [entry, ...state.downloadHistory].slice(0, 500), // Keep last 500 entries
        })),
      clearDownloadHistory: () => set({ downloadHistory: [] }),
    }),
    {
      name: 'pgm-radio-storage', // localStorage key
      storage: createJSONStorage(() => localStorage),
      // Only persist these fields (not transient state like isRunning, batchDownloadProgress)
      partialize: (state) => ({
        stations: state.stations,
        programs: state.programs,
        config: state.config,
        deezerConfig: state.deezerConfig,
        sequence: state.sequence,
        fixedContent: state.fixedContent,
        blockSongs: state.blockSongs,
        missingSongs: state.missingSongs,
        downloadHistory: state.downloadHistory,
      }),
      // Handle Date objects that get serialized as strings
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Convert timestamp strings back to Date objects
          if (state.missingSongs) {
            state.missingSongs = state.missingSongs.map((song) => ({
              ...song,
              timestamp: new Date(song.timestamp),
            }));
          }
          if (state.downloadHistory) {
            state.downloadHistory = state.downloadHistory.map((entry) => ({
              ...entry,
              timestamp: new Date(entry.timestamp),
            }));
          }
        }
      },
      version: 1, // For future migrations
    }
  )
);

// Helper function to get download stats
export const getDownloadStats = () => {
  const state = useRadioStore.getState();
  const total = state.downloadHistory.length;
  const success = state.downloadHistory.filter((e) => e.status === 'success').length;
  const failed = state.downloadHistory.filter((e) => e.status === 'error').length;
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
  return { total, success, failed, successRate };
};
