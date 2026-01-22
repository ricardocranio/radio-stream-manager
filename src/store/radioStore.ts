import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { RadioStation, ProgramSchedule, CapturedSong, SystemConfig, SequenceConfig, BlockSchedule, ScheduledSequence } from '@/types/radio';

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
  type: 'news' | 'horoscope' | 'sports' | 'weather' | 'romance' | 'curiosity' | 'other' | 'top50' | 'vozbrasil';
  dayPattern: string; // WEEKDAYS, WEEKEND, ALL, or specific days
  timeSlots: { hour: number; minute: number }[];
  enabled: boolean;
  // TOP50 specific config
  top50Count?: number; // How many songs from TOP50 to include
  // Position in block: 'start' | 'middle' | 'end' | number (1-10 for specific position)
  position?: 'start' | 'middle' | 'end' | number;
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

// Grade update history entry
export interface GradeHistoryEntry {
  id: string;
  timestamp: Date;
  blockTime: string; // e.g., "18:00"
  songsProcessed: number;
  songsFound: number;
  songsMissing: number;
  programName: string;
}

// Ranking data
export interface RankingSong {
  id: string;
  title: string;
  artist: string;
  plays: number;
  style: string;
  trend: 'up' | 'down' | 'stable';
  lastPlayed: Date;
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
  
  // Scheduled Sequences (time-based sequences)
  scheduledSequences: ScheduledSequence[];
  setScheduledSequences: (sequences: ScheduledSequence[]) => void;
  addScheduledSequence: (sequence: ScheduledSequence) => void;
  updateScheduledSequence: (id: string, updates: Partial<ScheduledSequence>) => void;
  removeScheduledSequence: (id: string) => void;
  
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

  // Grade History
  gradeHistory: GradeHistoryEntry[];
  addGradeHistory: (entry: GradeHistoryEntry) => void;
  clearGradeHistory: () => void;

  // Ranking
  rankingSongs: RankingSong[];
  setRankingSongs: (songs: RankingSong[]) => void;
  addRankingPlay: (songId: string) => void;
  addOrUpdateRankingSong: (title: string, artist: string, style: string) => void;
  applyRankingBatch: (updates: Array<{ title: string; artist: string; style: string; count: number }>) => void;
  clearRanking: () => void;

  // Auto Scrape Setting (persisted)
  autoScrapeEnabled: boolean;
  setAutoScrapeEnabled: (enabled: boolean) => void;
}

// V21 Configuration - Updated from FINAL_PGM_V21.py
const defaultStations: RadioStation[] = [
  {
    id: 'bh',
    name: 'BH FM',
    urls: ['https://onlineradiobox.com/br/bh/playlist/', 'https://radiosaovivo.net/bh-fm/'],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-bh-fm-402270',
    styles: ['SERTANEJO', 'PAGODE', 'AGRONEJO'],
    enabled: true,
  },
  {
    id: 'band',
    name: 'Band FM',
    urls: ['https://onlineradiobox.com/br/band/playlist/', 'https://radiosaovivo.net/band/'],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/band-fm-413397/',
    styles: ['SERTANEJO', 'PAGODE', 'AGRONEJO'],
    enabled: true,
  },
  {
    id: 'clube',
    name: 'Clube FM',
    urls: ['https://www.clubefm.com.br/o-que-tocou', 'https://radiosaovivo.net/clube-brasilia/', 'https://www.radio-ao-vivo.com/radio-clube-fm'],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-clube-fm-brasilia-1055-406812/',
    styles: ['SERTANEJO', 'PAGODE', 'POP/VARIADO'],
    enabled: true,
  },
  {
    id: 'showfm',
    name: 'Show FM 101.1',
    urls: ['https://mytuner-radio.com/pt/radio/show-fm-oliveira-504298/'],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/show-fm-oliveira-504298/',
    styles: ['SERTANEJO', 'POP/VARIADO'],
    enabled: true,
  },
  {
    id: 'globo',
    name: 'Rádio Globo RJ',
    urls: [],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-globo-rj-402262/',
    styles: ['POP', 'SERTANEJO'],
    enabled: true,
  },
  {
    id: 'blink',
    name: 'Blink 102 FM',
    urls: [],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-blink-102-fm-407711/',
    styles: ['POP', 'DANCE'],
    enabled: true,
  },
  {
    id: 'positiva',
    name: 'Positiva FM',
    urls: [],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/positiva-fm-421607/',
    styles: ['POP', 'SERTANEJO'],
    enabled: true,
  },
  {
    id: 'liberdade',
    name: 'Liberdade FM',
    urls: [],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-liberdade-fm-929-395273/',
    styles: ['SERTANEJO'],
    enabled: true,
  },
  {
    id: 'mix',
    name: 'Mix FM',
    urls: [],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/mix-fm-sao-paulo-408793/',
    styles: ['POP', 'DANCE'],
    enabled: true,
  },
];

// V21 Program IDs - Atualizado com nova grade
const defaultPrograms: ProgramSchedule[] = [
  { timeRange: '1-5', programName: 'Nossa Madrugada' },
  { timeRange: '6-8', programName: 'Happy Hour' },
  { timeRange: '9-11', programName: 'Manhã de Hits' },
  { timeRange: '12-13', programName: 'Hora do Almoço' },
  { timeRange: '14-16', programName: 'Tarde Animada' },
  { timeRange: '17-17', programName: 'Happy Hour' },
  { timeRange: '18-18', programName: 'TOP10' },
  { timeRange: '19-19', programName: 'TOP50' }, // TOP50 às 19:00 e 19:30
  { timeRange: '20-20', programName: 'FIXO' },
  { timeRange: '21-21', programName: 'VOZ_BRASIL' }, // A Voz do Brasil às 21:00
  { timeRange: '22-23', programName: 'Romance' }, // Romance às 22:00-00:00
  { timeRange: '0-0', programName: 'Romance' },
];

// V21 Sequence - Based on pos_map: 1-3=bh, 4-6=band, 7-8=clube, 9-10=showfm
const defaultSequence: SequenceConfig[] = [
  { position: 1, radioSource: 'bh' },
  { position: 2, radioSource: 'bh' },
  { position: 3, radioSource: 'bh' },
  { position: 4, radioSource: 'band' },
  { position: 5, radioSource: 'band' },
  { position: 6, radioSource: 'band' },
  { position: 7, radioSource: 'clube' },
  { position: 8, radioSource: 'clube' },
  { position: 9, radioSource: 'showfm' },
  { position: 10, radioSource: 'showfm' },
];

// V21 System Config
const defaultConfig: SystemConfig = {
  musicFolders: ['C:\\Users\\Radio\\Music\\PGM-FM', 'C:\\Playlist\\Músicas'],
  gradeFolder: 'C:\\Playlist\\pgm\\Grades',
  contentFolder: 'G:\\Outros computadores\\Meu computador\\Conteudos KF',
  rankingFile: 'C:\\Playlist\\pgm\\Grades\\ranking_sucessos.json',
  updateIntervalMinutes: 20,
  artistRepetitionMinutes: 60,
  safetyMarginMinutes: 7, // Maximum 7 minutes before block
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
  // Power saving mode
  powerSavingMode: false,
};

const defaultDeezerConfig: DeezerConfig = {
  arl: '', // User must provide their own ARL token via Settings
  downloadFolder: 'C:\\Playlist\\Downloads',
  quality: 'MP3_320',
  enabled: true,
  autoDownload: false,
  autoDownloadIntervalMinutes: 1, // Default 1 minute between downloads (can be 0.5 to 30)
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
  // Romance movido para 22:00-00:00
  { id: '10', name: 'Romance', fileName: 'ROMANCE_BLOCO{ED}', type: 'romance', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 22, minute: 0 }, { hour: 22, minute: 30 }, { hour: 23, minute: 0 }, { hour: 23, minute: 30 }, { hour: 0, minute: 0 }], enabled: true },
  { id: '11', name: 'Raridades', fileName: 'RARIDADES_BLOCO{ED}', type: 'other', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 12, minute: 0 }, { hour: 12, minute: 30 }], enabled: true },
  { id: '12', name: 'Mamãe Cheguei', fileName: 'MAMAE_CHEGUEI', type: 'other', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 20, minute: 0 }], enabled: true },
  { id: '13', name: 'Curiosidades', fileName: 'CURIOSIDADES', type: 'curiosity', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 17, minute: 30 }], enabled: true },
  // TOP50 às 19:00 - 10 músicas
  { id: '14', name: 'TOP50 Bloco 19h', fileName: 'POSICAO{N}', type: 'top50', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 19, minute: 0 }], enabled: true, top50Count: 10 },
  // TOP50 às 19:30 - 10 músicas
  { id: '15', name: 'TOP50 Bloco 19h30', fileName: 'POSICAO{N}', type: 'top50', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 19, minute: 30 }], enabled: true, top50Count: 10 },
  // A Voz do Brasil às 21:00
  { id: '16', name: 'A Voz do Brasil', fileName: 'VOZ_DO_BRASIL', type: 'vozbrasil', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 21, minute: 0 }], enabled: true },
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
        set((state) => {
          // Avoid duplicate songs (same title/artist in last 50)
          const isDuplicate = state.capturedSongs.slice(0, 50).some(
            s => s.title === song.title && s.artist === song.artist
          );
          if (isDuplicate) return state;
          
          // Prepend and limit - reuse array if possible
          const newSongs = [song, ...state.capturedSongs];
          return { capturedSongs: newSongs.length > 100 ? newSongs.slice(0, 100) : newSongs };
        }),
      clearCapturedSongs: () => set({ capturedSongs: [] }),

      config: defaultConfig,
      setConfig: (config) =>
        set((state) => ({ config: { ...state.config, ...config } })),

      deezerConfig: defaultDeezerConfig,
      setDeezerConfig: (config) =>
        set((state) => ({ deezerConfig: { ...state.deezerConfig, ...config } })),

      sequence: defaultSequence,
      setSequence: (sequence) => set({ sequence }),

      // Scheduled Sequences
      scheduledSequences: [],
      setScheduledSequences: (scheduledSequences) => set({ scheduledSequences }),
      addScheduledSequence: (sequence) =>
        set((state) => ({ scheduledSequences: [...state.scheduledSequences, sequence] })),
      updateScheduledSequence: (id, updates) =>
        set((state) => ({
          scheduledSequences: state.scheduledSequences.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        })),
      removeScheduledSequence: (id) =>
        set((state) => ({
          scheduledSequences: state.scheduledSequences.filter((s) => s.id !== id),
        })),

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

      // Grade History
      gradeHistory: [],
      addGradeHistory: (entry) =>
        set((state) => ({
          gradeHistory: [entry, ...state.gradeHistory].slice(0, 100), // Keep last 100 entries
        })),
      clearGradeHistory: () => set({ gradeHistory: [] }),

      // Ranking
      rankingSongs: [],
      setRankingSongs: (rankingSongs) => set({ rankingSongs }),
      addRankingPlay: (songId) =>
        set((state) => ({
          rankingSongs: state.rankingSongs.map((s) =>
            s.id === songId ? { ...s, plays: s.plays + 1, lastPlayed: new Date() } : s
          ),
        })),
      // Optimized: processes batch updates from rankingBatcher
      addOrUpdateRankingSong: (title, artist, style) =>
        set((state) => {
          const normalizedTitle = title.toLowerCase().trim();
          const normalizedArtist = artist.toLowerCase().trim();
          
          // Find existing song
          let existingIndex = -1;
          for (let i = 0; i < state.rankingSongs.length; i++) {
            const s = state.rankingSongs[i];
            if (s.title.toLowerCase() === normalizedTitle && 
                s.artist.toLowerCase() === normalizedArtist) {
              existingIndex = i;
              break;
            }
          }
          
          if (existingIndex >= 0) {
            const existing = state.rankingSongs[existingIndex];
            const newPlays = existing.plays + 1;
            const updatedSongs = [...state.rankingSongs];
            updatedSongs[existingIndex] = {
              ...existing,
              plays: newPlays,
              lastPlayed: new Date(),
              trend: newPlays > 5 ? 'up' : existing.trend,
            };
            
            // Sort only every 50 updates (increased from 20)
            if (newPlays % 50 === 0) {
              updatedSongs.sort((a, b) => b.plays - a.plays);
            }
            
            return { rankingSongs: updatedSongs };
          } else {
            const newSong: RankingSong = {
              id: `r-${Date.now()}`,
              title: title.trim(),
              artist: artist.trim(),
              plays: 1,
              style: style || 'POP/VARIADO',
              trend: 'stable',
              lastPlayed: new Date(),
            };
            
            const updatedSongs = [...state.rankingSongs, newSong];
            
            // Sort only every 10 new songs (increased from 5)
            if (updatedSongs.length % 10 === 0) {
              updatedSongs.sort((a, b) => b.plays - a.plays);
            }
            
            return { rankingSongs: updatedSongs.slice(0, 100) };
          }
        }),
      // Batch update: applies multiple ranking updates at once (from batcher)
      applyRankingBatch: (updates: Array<{ title: string; artist: string; style: string; count: number }>) =>
        set((state) => {
          let updatedSongs = [...state.rankingSongs];
          
          for (const update of updates) {
            const normalizedTitle = update.title.toLowerCase().trim();
            const normalizedArtist = update.artist.toLowerCase().trim();
            
            let existingIndex = -1;
            for (let i = 0; i < updatedSongs.length; i++) {
              const s = updatedSongs[i];
              if (s.title.toLowerCase() === normalizedTitle && 
                  s.artist.toLowerCase() === normalizedArtist) {
                existingIndex = i;
                break;
              }
            }
            
            if (existingIndex >= 0) {
              const existing = updatedSongs[existingIndex];
              updatedSongs[existingIndex] = {
                ...existing,
                plays: existing.plays + update.count,
                lastPlayed: new Date(),
                trend: existing.plays + update.count > 5 ? 'up' : existing.trend,
              };
            } else {
              updatedSongs.push({
                id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                title: update.title,
                artist: update.artist,
                plays: update.count,
                style: update.style,
                trend: 'stable',
                lastPlayed: new Date(),
              });
            }
          }
          
          // Sort once after all updates
          updatedSongs.sort((a, b) => b.plays - a.plays);
          
          return { rankingSongs: updatedSongs.slice(0, 100) };
        }),
      clearRanking: () => set({ rankingSongs: [] }),

      // Auto Scrape Setting
      autoScrapeEnabled: false,
      setAutoScrapeEnabled: (autoScrapeEnabled) => set({ autoScrapeEnabled }),
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
        scheduledSequences: state.scheduledSequences,
        fixedContent: state.fixedContent,
        blockSongs: state.blockSongs,
        missingSongs: state.missingSongs,
        downloadHistory: state.downloadHistory,
        gradeHistory: state.gradeHistory,
        rankingSongs: state.rankingSongs,
        autoScrapeEnabled: state.autoScrapeEnabled,
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
          // Convert rankingSongs lastPlayed to Date objects
          if (state.rankingSongs) {
            state.rankingSongs = state.rankingSongs.map((song) => ({
              ...song,
              lastPlayed: new Date(song.lastPlayed),
            }));
          }
          // Convert gradeHistory timestamps
          if (state.gradeHistory) {
            state.gradeHistory = state.gradeHistory.map((entry) => ({
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

// Helper function to get active sequence based on current time and scheduled sequences
export const getActiveSequence = (): SequenceConfig[] => {
  const state = useRadioStore.getState();
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTimeMinutes = currentHour * 60 + currentMinute;
  
  const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
  const currentDay = dayMap[now.getDay()];
  
  // Find active scheduled sequence
  const activeScheduled = state.scheduledSequences
    .filter((s) => s.enabled)
    .filter((s) => s.weekDays.length === 0 || s.weekDays.includes(currentDay))
    .filter((s) => {
      const startMinutes = s.startHour * 60 + s.startMinute;
      const endMinutes = s.endHour * 60 + s.endMinute;
      
      // Handle overnight ranges
      if (endMinutes <= startMinutes) {
        return currentTimeMinutes >= startMinutes || currentTimeMinutes < endMinutes;
      }
      return currentTimeMinutes >= startMinutes && currentTimeMinutes < endMinutes;
    })
    .sort((a, b) => b.priority - a.priority);
  
  if (activeScheduled.length > 0) {
    return activeScheduled[0].sequence;
  }
  
  return state.sequence;
};
