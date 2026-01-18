import { create } from 'zustand';
import { RadioStation, ProgramSchedule, CapturedSong, SystemConfig, SequenceConfig, BlockSchedule } from '@/types/radio';

export interface DeezerConfig {
  arl: string;
  downloadFolder: string;
  quality: 'MP3_128' | 'MP3_320' | 'FLAC';
  enabled: boolean;
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
  missingSongs: CapturedSong[];
  setMissingSongs: (songs: CapturedSong[]) => void;

  // Fixed Content
  fixedContent: FixedContent[];
  setFixedContent: (content: FixedContent[]) => void;
  addFixedContent: (content: FixedContent) => void;
  updateFixedContent: (id: string, updates: Partial<FixedContent>) => void;
  removeFixedContent: (id: string) => void;

  // Block Songs (for drag-and-drop)
  blockSongs: Record<string, BlockSong[]>;
  setBlockSongs: (timeKey: string, songs: BlockSong[]) => void;
}

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
    urls: ['https://onlineradiobox.com/br/clube/playlist/', 'https://radiosaovivo.net/clube-brasilia/'],
    styles: ['SERTANEJO', 'PAGODE', 'POP/VARIADO'],
    enabled: true,
  },
  {
    id: 'disney',
    name: 'Disney FM',
    urls: ['https://onlineradiobox.com/br/disney/playlist/', 'https://radiosaovivo.net/disney/'],
    styles: ['POP/VARIADO', 'TEEN/HITS', 'DANCE'],
    enabled: true,
  },
  {
    id: 'metro',
    name: 'Metropolitana',
    urls: ['https://onlineradiobox.com/br/metropolitana/playlist/', 'https://radiosaovivo.net/metropolitana-fm/'],
    styles: ['POP/VARIADO', 'DANCE', 'HITS'],
    enabled: true,
  },
];

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

const defaultSequence: SequenceConfig[] = [
  { position: 1, radioSource: 'bh' },
  { position: 2, radioSource: 'bh' },
  { position: 3, radioSource: 'bh' },
  { position: 4, radioSource: 'bh' },
  { position: 5, radioSource: 'bh' },
  { position: 6, radioSource: 'band' },
  { position: 7, radioSource: 'band' },
  { position: 8, radioSource: 'band' },
  { position: 9, radioSource: 'band' },
  { position: 10, radioSource: 'random_pop' },
];

const defaultConfig: SystemConfig = {
  musicFolders: ['C:\\Users\\Radio\\Music\\PGM-FM', 'C:\\Playlist\\Músicas'],
  gradeFolder: 'C:\\Playlist\\pgm\\Grades',
  contentFolder: 'G:\\Outros computadores\\Meu computador\\Conteudos KF',
  rankingFile: 'C:\\Playlist\\pgm\\ranking_sucessos.json',
  updateIntervalMinutes: 20,
  artistRepetitionMinutes: 60,
  safetyMarginMinutes: 5,
  coringaCode: 'mus',
};

const defaultDeezerConfig: DeezerConfig = {
  arl: '',
  downloadFolder: 'C:\\Playlist\\Downloads',
  quality: 'MP3_320',
  enabled: false,
};

const defaultFixedContent: FixedContent[] = [
  { id: '1', name: 'Notícia da Hora', fileName: 'NOTICIA_DA_HORA_{HH}HORAS', type: 'news', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 9, minute: 0 }, { hour: 10, minute: 0 }, { hour: 11, minute: 0 }, { hour: 12, minute: 0 }, { hour: 14, minute: 0 }, { hour: 15, minute: 0 }, { hour: 16, minute: 0 }, { hour: 17, minute: 0 }, { hour: 18, minute: 0 }], enabled: true },
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

export const useRadioStore = create<RadioState>((set) => ({
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
}));
