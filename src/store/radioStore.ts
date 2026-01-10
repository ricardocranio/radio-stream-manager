import { create } from 'zustand';
import { RadioStation, ProgramSchedule, CapturedSong, SystemConfig, SequenceConfig, BlockSchedule } from '@/types/radio';

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
}));
