import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { RadioStation, ProgramSchedule, CapturedSong, SystemConfig, SequenceConfig, BlockSchedule, ScheduledSequence } from '@/types/radio';
import { isVinhetaOrJingle } from '@/lib/vinhetaFilter';
import { buildBlockedEngine, type BlockedEngine } from '@/lib/blockedSongsEngine';
import type { MapasConfig, MapaCodeConfig } from '@/lib/mapasBuilder/types';
import { DEFAULT_MAPAS_CONFIG, DEFAULT_CODE_CONFIGS, DEFAULT_TEMPLATES } from '@/lib/mapasBuilder/types';

export interface GenreRouteRule {
  genre: string;      // normalized genre key e.g. "ROCK", "METAL"
  folderName: string;  // subfolder name e.g. "Rock", "Metal"
}

export interface DeezerConfig {
  arl: string;
  downloadFolder: string;
  quality: 'MP3_128' | 'MP3_320' | 'FLAC';
  enabled: boolean;
  autoDownload: boolean;
  autoDownloadIntervalMinutes: number; // Interval between auto-downloads
  genreRoutingEnabled?: boolean;       // Route downloads to genre subfolders
  genreRoutes?: GenreRouteRule[];      // Genre → subfolder mapping
  genreDefaultFolder?: string;         // Default subfolder for unmatched genres (e.g. "Musicas")
}

export interface FixedContent {
  id: string;
  name: string;
  fileName: string;
  type: 'news' | 'horoscope' | 'sports' | 'weather' | 'romance' | 'curiosity' | 'other' | 'top50' | 'vozbrasil' | 'raridades' | 'rockmetal';
  dayPattern: string; // WEEKDAYS, WEEKEND, ALL, or specific days
  timeSlots: { hour: number; minute: number }[];
  enabled: boolean;
  // TOP50 specific config
  top50Count?: number; // How many songs from TOP50 to include
  // Position in block: 'start' | 'middle' | 'end' | number (1-10 for specific position)
  position?: 'start' | 'middle' | 'end' | number;
  // Year-based filtering for decade programs (e.g. Raridades)
  yearMin?: number; // Minimum year (inclusive), e.g. 1990
  yearMax?: number; // Maximum year (inclusive), e.g. 2000
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
  urgency?: 'grade' | 'sequence' | 'normal'; // Priority level for download queue
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

export interface SongAlias {
  id: string;
  fromArtist: string;
  fromTitle: string;
  toArtist: string;
  toTitle: string;
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

  // Song Aliases (corrections)
  songAliases: SongAlias[];
  setSongAliases: (aliases: SongAlias[]) => void;
  addSongAlias: (alias: SongAlias) => void;
  removeSongAlias: (id: string) => void;
  updateSongAlias: (id: string, updates: Partial<SongAlias>) => void;

  // Mapas Config (commercial programming templates)
  mapasConfig: MapasConfig;
  setMapasConfig: (config: Partial<MapasConfig>) => void;
  updateMapaCodeConfig: (code: string, updates: Partial<MapaCodeConfig>) => void;
  addMapaCodeConfig: (config: MapaCodeConfig) => void;
  removeMapaCodeConfig: (code: string) => void;
  resetMapaCodeConfigs: () => void;
  reorderMapaCodeConfigs: (fromIndex: number, toIndex: number) => void;
  updateMapaTemplateLine: (templateIndex: number, lineIndex: number, codes: string[]) => void;
  addMapaTemplateLine: (templateIndex: number, time: string, codes: string[]) => void;
  removeMapaTemplateLine: (templateIndex: number, lineIndex: number) => void;
  resetMapaTemplates: () => void;

  // Grade Preview Songs tracking (artist|title keys of songs in next grade)
  gradePreviewSongKeys: Set<string>;
  setGradePreviewSongKeys: (keys: Set<string>) => void;
  resetProgramming: () => void;
  // Locucao Policy
  policy: LocucaoSchedulePolicy;
  setPolicy: (policy: LocucaoSchedulePolicy) => void;
}

import { loadPolicy, savePolicy, type LocucaoSchedulePolicy, DEFAULT_POLICY } from '@/lib/locucao/locucaoSchedulePolicy';

// V21 Configuration - Updated from FINAL_PGM_V21.py
const defaultStations: RadioStation[] = [
  {
    id: 'bh',
    name: 'BH FM',
    urls: ['https://onlineradiobox.com/br/bh/playlist/', 'https://radiosaovivo.net/bh-fm/'],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-bh-fm-402270',
    styles: ['SERTANEJO', 'PAGODE', 'AGRONEJO'],
    enabled: true,
    downloadFolder: 'hist',
  },
  {
    id: 'band',
    name: 'Band FM',
    urls: ['https://onlineradiobox.com/br/band/playlist/', 'https://radiosaovivo.net/band/'],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/band-fm-413397/',
    styles: ['SERTANEJO', 'PAGODE', 'AGRONEJO'],
    enabled: true,
    downloadFolder: 'hist',
  },
  {
    id: 'clube',
    name: 'Clube FM',
    urls: ['https://www.clubefm.com.br/o-que-tocou', 'https://radiosaovivo.net/clube-brasilia/', 'https://www.radio-ao-vivo.com/radio-clube-fm'],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-clube-fm-brasilia-1055-406812/',
    styles: ['SERTANEJO', 'PAGODE', 'POP/VARIADO'],
    enabled: true,
    downloadFolder: 'hist',
  },
  {
    id: 'globo',
    name: 'Rádio Globo RJ',
    urls: [],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-globo-rj-402262/',
    styles: ['POP', 'SERTANEJO'],
    enabled: true,
    downloadFolder: 'hist',
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
    downloadFolder: 'sertanejo',
  },
  {
    id: 'liberdade',
    name: 'Liberdade FM',
    urls: [],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/radio-liberdade-fm-929-395273/',
    styles: ['SERTANEJO'],
    enabled: true,
    downloadFolder: 'sertanejo',
  },
  {
    id: 'mix',
    name: 'Mix FM',
    urls: [],
    scrapeUrl: 'https://mytuner-radio.com/pt/radio/mix-fm-sao-paulo-408793/',
    styles: ['POP', 'DANCE'],
    enabled: true,
    downloadFolder: 'jovem',
  },
];

// V21 Program IDs - Atualizado com nova grade
const defaultPrograms: ProgramSchedule[] = [
  { timeRange: '0-4', programName: 'Nossa Madrugada' },
  { timeRange: '5-7', programName: 'Sertanejo Nossa' },
  { timeRange: '8-8', programName: 'Happy Hour' },
  { timeRange: '9-11', programName: 'Manhã de Hits' },
  { timeRange: '12-13', programName: 'Hora do Almoço' },
  { timeRange: '14-16', programName: 'Tarde Animada' },
  { timeRange: '17-17', programName: 'Happy Hour' },
  { timeRange: '18-18', programName: 'TOP10' },
  { timeRange: '19-19', programName: 'TOP50' }, // TOP50 às 19:00 e 19:30
  { timeRange: '20-20', programName: 'FIXO' },
  { timeRange: '21-21', programName: 'VOZ_BRASIL' }, // A Voz do Brasil às 21:00
  { timeRange: '22-23', programName: 'Romance' }, // Romance às 22:00-23:30
];

// V21 Sequence - Based on pos_map: 1-3=bh, 4-5=globo, 6-8=band, 9-10=clube
const defaultSequence: SequenceConfig[] = [
  { position: 1, radioSource: 'bh' },
  { position: 2, radioSource: 'bh' },
  { position: 3, radioSource: 'bh' },
  { position: 4, radioSource: 'globo' },
  { position: 5, radioSource: 'globo' },
  { position: 6, radioSource: 'band' },
  { position: 7, radioSource: 'band' },
  { position: 8, radioSource: 'band' },
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
  safetyMarginMinutes: 7, // Maximum 7 minutes before block
  coringaCode: 'mus',
  useGrade24h: true, // Grade 24h enabled by default
  useDefaultFixedSchedules: true, // Show hardcoded programs by default
  // V21 additions
  vozBrasilFolder: 'C:\\Playlist\\A Voz do Brasil',
  vozBrasilTime: '20:35',
  vinhetasFolder: 'C:\\Playlist\\Vinhetas',
  dnaLearningFile: 'C:\\Playlist\\pgm\\Grades\\dna_learning.json',
  inventoryCacheDuration: 3600,
  hardResetInterval: 3600,
  monitorInterval: 300,
  forbiddenWords: [
    // Genéricos/jogos
    '1.FM', 'Love Classics', 'Solitaire', 'Mahjong', 'Dayspedia', 'Games', 'Online',
    // Nomes de rádios
    'METROPOLITANA - SP', 'BAND FM', 'Globo FM', 'Mix FM', 'Jovem Pan', 'Transamérica', 'Nativa FM', 
    'Antena 1', 'Alpha FM', '89 FM', 'Kiss FM', 'Energia 97', 'Rádio Disney', 'Rede Aleluia',
    '105 FM', 'Cidade FM', 'Tupi FM', 'Capital FM', 'Nova Brasil FM', 'Rádio Bandeirantes',
    // Hinos de clubes de futebol
    'Hino do Flamengo', 'Hino do Corinthians', 'Hino do Palmeiras', 'Hino do São Paulo', 
    'Hino do Santos', 'Hino do Vasco', 'Hino do Fluminense', 'Hino do Botafogo',
    'Hino do Grêmio', 'Hino do Internacional', 'Hino do Cruzeiro', 'Hino do Atlético',
    'Hino do Bahia', 'Hino do Vitória', 'Hino do Sport', 'Hino do Náutico',
    'Hino do Fortaleza', 'Hino do Ceará', 'Hino do Coritiba', 'Hino do Athletico',
    'Mengão', 'Timão', 'Verdão', 'Tricolor', 'Peixe', 'Cruzmaltino',
    // Artistas/músicas específicas
    'Eurides Nunes', 'CIRCUS MUSIC', 'THE HIT CREW KIDS', 'PADRE MARCELO ROSSI',
  ],
  funkWords: ['funk', 'mc ', 'sequencia', 'proibidão', 'baile', 'kondzilla', 'gr6'],
  // Default characters to filter from filenames (encoding artifacts, special chars)
  filterCharacters: ['â€™', 'Ã©', 'Ã£', 'Ã§', 'â€"', 'â€œ', 'â€', 'Â', '´', '`', '~', '^', '$', '#', '@'],
  // Power saving mode
  powerSavingMode: false,
  // Similarity threshold for music library matching (0.5 to 0.95)
  similarityThreshold: 0.75,
  // Blocked songs (Artist - Title format) — use "Artista - *" to block all songs from an artist
  blockedSongs: [
    'Jefi - Marquinha De Fita',
    'Olivia - Homem De Papel',
    'Eurides Nunes - FARROUPILHA',
    'CIRCUS MUSIC - *',
    'THE HIT CREW KIDS - *',
    'PADRE MARCELO ROSSI - *',
    'Xuxa - *',
    '搖籃曲 - (鋼琴饗宴)',
    '貴族音樂 - *',
    'Deive Leonardo - Amanhã Não Existe (Ao Vivo)',
    'Adolf Schroeder - Kapitel 3.1 (Der Tod des Richters)',
    'Xandinho Deejay - Set Mixado Baile da Alta',
    'ALCIONE - BRAZIL COM Z E PRA CABRA DA PESTE BRASIL COM S E PRA NACAO DO NORDESTE (AO VIVO)',
    'JEFFINHO - MARQUINHA DE FITINHA',
    'Promessa D - Pedido de Socorro (Ao Vivo)',
    'Naldo Lima - Retrovisor',
    'Kaize - Olha onde eu to',
    'thiago jose - balançou balançou(ao vivo)',
    'SHORT COMMIT - MIDICRONICA',
    'anjos de resgate - *',
    'tayh - *',
    'PROMESSA D - *',
    'DNOBREGA - MEGA SENA (AO VIVO)',
    'Ikaro Mendes - *',
    'Wellington Paixone - *',
    "D'NOBREGA - *",
    'YGOR E KELVEN - O QUE EU FACO AGORA',
    'TAYH - VOCE NAO ME MERECE',
    'MIDICRONICA - SHORT COMMIT',
    'zaz - *',
    'BLACKBIRDS - Meus Herois',
    'Golpe de Estado - Nao e Hora',
    'BALACHIC - ERA UMA VEZ (AO VIVO)',
    'El Terrestre - Debi tirar mas fotos',
    'LONG KHUNG - SOMEONE YOU LOVED (COVER)',
    'Suresh Dehati - Ganja Chillam Zindabad',
    'DJ WL DO V.A - MTG - QUANDO O GRAVE BATE FORTE',
    'ZAPPING 2 - PALAEKSA E PVR',
    'KRISHNA YADAV - *',
  ],
};

const defaultDeezerConfig: DeezerConfig = {
  arl: '', // User must provide their own ARL token via Settings
  downloadFolder: 'C:\\Playlist\\Downloads',
  quality: 'MP3_320',
  enabled: true,
  autoDownload: true, // ENABLED by default - downloads start immediately when songs are missing
  autoDownloadIntervalMinutes: 1, // Legacy - now uses 5s between downloads
  genreRoutingEnabled: true,
  genreRoutes: [
    { genre: 'POP', folderName: 'Pop' },
    { genre: 'ROCK', folderName: 'Rock' },
    { genre: 'METAL', folderName: 'Metal' },
    { genre: 'SERTANEJO', folderName: 'Sertanejo' },
    { genre: 'PAGODE', folderName: 'Pagode' },
    { genre: 'MPB', folderName: 'MPB' },
    { genre: 'RAP/HIP-HOP', folderName: 'Hip Hop' },
    { genre: 'ELETRONICA', folderName: 'Dance' },
  ],
  genreDefaultFolder: 'Musicas',
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
  { id: '11', name: 'Raridades', fileName: 'RARIDADES_BLOCO{ED}', type: 'raridades', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 12, minute: 0 }, { hour: 12, minute: 30 }], enabled: true, yearMin: 1990, yearMax: 2000 },
  { id: '12', name: 'Mamãe Cheguei', fileName: 'MAMAE_CHEGUEI', type: 'other', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 20, minute: 0 }], enabled: true },
  { id: '13', name: 'Curiosidades', fileName: 'CURIOSIDADES', type: 'curiosity', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 17, minute: 30 }], enabled: true },
  // Rock & Metal às 19:00 e 19:30 - 10 músicas das pastas Rock/Metal
  { id: '14', name: 'Rock & Metal Mix', fileName: 'ROCK_METAL', type: 'rockmetal', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 19, minute: 0 }, { hour: 19, minute: 30 }], enabled: true },
  // A Voz do Brasil às 21:00
  { id: '16', name: 'A Voz do Brasil', fileName: 'VOZ_DO_BRASIL', type: 'vozbrasil', dayPattern: 'WEEKDAYS', timeSlots: [{ hour: 21, minute: 0 }], enabled: true },
  // Weekend programs
  { id: '17', name: 'Shake Mix', fileName: 'SHAKE_MIX_BLOCO{ED}_FINAL_DE_SEMANA', type: 'other', dayPattern: 'WEEKEND', timeSlots: [{ hour: 8, minute: 0 }, { hour: 8, minute: 30 }, { hour: 9, minute: 0 }, { hour: 9, minute: 30 }, { hour: 10, minute: 0 }, { hour: 10, minute: 30 }, { hour: 11, minute: 0 }, { hour: 11, minute: 30 }], enabled: true },
  { id: '18', name: 'Mega Mix', fileName: 'MEGA_MIX_BLOCO{ED}_FINAL_DE_SEMANA', type: 'other', dayPattern: 'WEEKEND', timeSlots: [{ hour: 12, minute: 0 }, { hour: 12, minute: 30 }, { hour: 13, minute: 0 }, { hour: 13, minute: 30 }, { hour: 14, minute: 0 }, { hour: 14, minute: 30 }, { hour: 15, minute: 0 }, { hour: 15, minute: 30 }], enabled: true },
  { id: '19', name: 'Sem Parar', fileName: 'SEM_PARAR_BLOCO{ED}_FINAL_DE_SEMANA', type: 'other', dayPattern: 'WEEKEND', timeSlots: [{ hour: 16, minute: 0 }, { hour: 16, minute: 30 }, { hour: 17, minute: 0 }, { hour: 17, minute: 30 }], enabled: true },
  { id: '20', name: 'Mega Funk', fileName: 'MEGA_FUNK_BLOCO{ED}_FINAL_DE_SEMANA', type: 'other', dayPattern: 'WEEKEND', timeSlots: [{ hour: 18, minute: 0 }, { hour: 18, minute: 30 }, { hour: 19, minute: 0 }, { hour: 19, minute: 30 }], enabled: true },
  // Weekend TOP50 FDS
  { id: '21', name: 'TOP50 FDS 20h', fileName: 'POSICAO{N}', type: 'top50', dayPattern: 'WEEKEND', timeSlots: [{ hour: 20, minute: 0 }], enabled: true, top50Count: 10 },
  { id: '22', name: 'TOP50 FDS 20h30', fileName: 'POSICAO{N}', type: 'top50', dayPattern: 'WEEKEND', timeSlots: [{ hour: 20, minute: 30 }], enabled: true, top50Count: 10 },
  // Conexão Mix (weekend nights)
  { id: '23', name: 'Conexão Mix', fileName: 'CONEXAO_MIX_BLOCO{ED}_FINAL_DE_SEMANA', type: 'other', dayPattern: 'WEEKEND', timeSlots: [{ hour: 21, minute: 0 }, { hour: 21, minute: 30 }, { hour: 22, minute: 0 }, { hour: 22, minute: 30 }, { hour: 23, minute: 0 }, { hour: 23, minute: 30 }], enabled: true },
];

const MAPA_FILENAME_BY_DAY: Record<string, string> = {
  dom: 'DOM.txt',
  sunday: 'DOM.txt',
  seg: 'SEG.txt',
  monday: 'SEG.txt',
  ter: 'TER.txt',
  tuesday: 'TER.txt',
  qua: 'QUA.txt',
  wednesday: 'QUA.txt',
  qui: 'QUI.txt',
  thursday: 'QUI.txt',
  sex: 'SEX.txt',
  friday: 'SEX.txt',
  sab: 'SÁB.txt',
  sáb: 'SÁB.txt',
  saturday: 'SÁB.txt',
};

function normalizeMapaTemplateFilename(filename: string | undefined, dayMapping: string | undefined, index: number): string {
  const normalizedDay = (dayMapping || '').trim().toLowerCase();
  if (MAPA_FILENAME_BY_DAY[normalizedDay]) {
    return MAPA_FILENAME_BY_DAY[normalizedDay];
  }

  const normalizedFilename = (filename || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalizedFilename === 'dom.txt') return 'DOM.txt';
  if (normalizedFilename === 'seg.txt') return 'SEG.txt';
  if (normalizedFilename === 'ter.txt') return 'TER.txt';
  if (normalizedFilename === 'qua.txt') return 'QUA.txt';
  if (normalizedFilename === 'qui.txt') return 'QUI.txt';
  if (normalizedFilename === 'sex.txt') return 'SEX.txt';
  if (normalizedFilename === 'sab.txt' || normalizedFilename === 's_b.txt') return 'SÁB.txt';

  return DEFAULT_TEMPLATES[index]?.filename || filename || `MAPA_${index + 1}.txt`;
}

// Cached blocked engine for O(1) lookups inside store actions
let _blockedEngineCache: BlockedEngine | null = null;
let _blockedCacheSignature: string | null = null;

function _getBlockedEngine(state: { config: { blockedSongs?: string[]; forbiddenWords?: string[] }; songAliases?: { fromArtist: string; fromTitle: string; toArtist: string; toTitle: string }[] }): BlockedEngine {
  const signature = JSON.stringify({
    blockedSongs: state.config.blockedSongs ?? [],
    forbiddenWords: state.config.forbiddenWords ?? [],
    songAliases: (state.songAliases ?? []).map((alias) => [alias.fromArtist, alias.fromTitle, alias.toArtist, alias.toTitle]),
  });
  if (!_blockedEngineCache || signature !== _blockedCacheSignature) {
    _blockedEngineCache = buildBlockedEngine(
      state.config.blockedSongs ?? [],
      state.config.forbiddenWords ?? [],
      state.songAliases ?? []
    );
    _blockedCacheSignature = signature;
  }
  return _blockedEngineCache;
}

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
          // Avoid duplicate songs (same title/artist in recent captures)
          const isDuplicate = state.capturedSongs.slice(0, 100).some(
            s => s.title.toLowerCase() === song.title.toLowerCase() && 
                 s.artist.toLowerCase() === song.artist.toLowerCase()
          );
          if (isDuplicate) return state;
          
          // Limit to 200 songs to keep memory reasonable while allowing more captures
          const newSongs = [song, ...state.capturedSongs];
          return { capturedSongs: newSongs.length > 200 ? newSongs.slice(0, 200) : newSongs };
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
        set((state) => {
          // Filter out vinhetas/jingles — they must NEVER go to Deemix
          if (isVinhetaOrJingle(song.artist || '', song.title || '')) {
            console.log(`[STORE] 🚫 Vinheta/jingle filtrada, não adicionada: ${song.artist} - ${song.title}`);
            return state;
          }
          // 🚫 Block check using centralized engine (O(1) lookups)
          const engine = _getBlockedEngine(state);
          if (engine.isBlocked(song.artist || '', song.title || '')) {
            console.log(`[STORE] 🚫 Música bloqueada, não adicionada: ${song.artist} - ${song.title}`);
            return state;
          }
          // Cap at 500 entries, trim oldest
          const updated = [...state.missingSongs, song];
          return { missingSongs: updated.length > 500 ? updated.slice(-500) : updated };
        }),
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

      // Download History - reduced limit for memory optimization
      downloadHistory: [],
      addDownloadHistory: (entry) =>
        set((state) => ({
          downloadHistory: [entry, ...state.downloadHistory].slice(0, 100), // Keep last 100 entries (was 500)
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
            const shouldUpdateStyle = style && style !== 'POP/VARIADO' && 
              (existing.style === 'POP/VARIADO' || existing.style !== style);
            updatedSongs[existingIndex] = {
              ...existing,
              plays: newPlays,
              lastPlayed: new Date(),
              trend: newPlays > 5 ? 'up' : existing.trend,
              ...(shouldUpdateStyle ? { style } : {}),
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
            
            // Limit ranking to 25 songs for memory optimization
            const updatedSongs = [...state.rankingSongs, newSong].slice(0, 25);
            
            // Sort only every 20 new songs for performance
            if (updatedSongs.length % 20 === 0) {
              updatedSongs.sort((a, b) => b.plays - a.plays);
            }
            
            return { rankingSongs: updatedSongs };
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
              // Update style if new value is more specific (from AI) than generic station style
              const shouldUpdateStyle = update.style && update.style !== 'POP/VARIADO' && 
                (existing.style === 'POP/VARIADO' || existing.style !== update.style);
              updatedSongs[existingIndex] = {
                ...existing,
                plays: existing.plays + update.count,
                lastPlayed: new Date(),
                trend: existing.plays + update.count > 5 ? 'up' : existing.trend,
                ...(shouldUpdateStyle ? { style: update.style } : {}),
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
          
          return { rankingSongs: updatedSongs.slice(0, 25) };
        }),
      clearRanking: () => set({ rankingSongs: [] }),

      // Auto Scrape Setting
      autoScrapeEnabled: false,
      setAutoScrapeEnabled: (autoScrapeEnabled) => set({ autoScrapeEnabled }),

      // Song Aliases (corrections)
      songAliases: [
        { id: 'default-1', fromArtist: 'naldo lima', fromTitle: 'retrovisor', toArtist: 'Gusttavo Lima', toTitle: 'Retrovisor' },
        { id: 'default-2', fromArtist: 'Kaize', fromTitle: 'Olha onde eu to', toArtist: 'Ana Castela', toTitle: 'Olha onde eu to' },
        { id: 'default-3', fromArtist: 'Olho Seco', fromTitle: 'Nada (Lisboa) [Ao Vivo]', toArtist: 'Luan Santana', toTitle: 'OLHO MARROM (Ao Vivo em Lisboa)' },
        { id: 'default-4', fromArtist: 'x-terra', fromTitle: 'i will survive', toArtist: 'Léo Santana', toTitle: 'Desliza (Olhinho No Corpinho)' },
        { id: 'default-5', fromArtist: 'PROMESSA D', fromTitle: 'PEDIDO DE SOCORRO', toArtist: 'Gustavo Mioto', toTitle: 'Pedido De Socorro (Ao Vivo)' },
        { id: 'default-6', fromArtist: 'PROMESSA D', fromTitle: 'PEDIDO DE SOCORRO (AO VIVO)', toArtist: 'Gustavo Mioto ', toTitle: ' Pedido De Socorro (Ao Vivo)' },
        { id: 'default-7', fromArtist: 'thiago jose ', fromTitle: 'balançou balançou(ao vivo)', toArtist: 'Thiaguinho', toTitle: 'me balançou(ao vivo)' },
        { id: 'default-8', fromArtist: 'Ikaro Mendes', fromTitle: 'SAUDADE PROIBIDA', toArtist: ' Simone Mendes ', toTitle: 'Saudade Proibida (Ao Vivo)' },
        { id: 'default-9', fromArtist: 'Wellington Paixone ', fromTitle: ' Eu Vou na Sua Casa', toArtist: 'felipe amorim', toTitle: 'Vou na Sua Casa' },
        { id: 'default-10', fromArtist: 'YGOR E KELVEN', fromTitle: 'O QUE EU FACO AGORA', toArtist: 'Dilsinho', toTitle: 'O Que Eu Faço Agora?' },
        { id: 'default-11', fromArtist: 'TAYH', fromTitle: 'voce nao me merece', toArtist: 'Fabinho', toTitle: 'voce nao me merece' },
        { id: 'default-12', fromArtist: 'BLACKBIRDS  ', fromTitle: 'Meus Herois', toArtist: 'Tiee', toTitle: 'Meus Herois' },
        { id: 'default-13', fromArtist: 'BALACHIC  ', fromTitle: 'ERA UMA VEZ (AO VIVO)', toArtist: 'Xand Aviao ', toTitle: 'ERA UMA VEZ (AO VIVO)' },
        { id: 'default-14', fromArtist: 'EDY BRITTO E SAMUEL', fromTitle: 'INEVITAVEL', toArtist: 'Bruno e Marrone', toTitle: 'Inevitável' },
      ],
      setSongAliases: (songAliases) => set({ songAliases }),
      addSongAlias: (alias) => set((state) => ({ songAliases: [...state.songAliases, alias] })),
      removeSongAlias: (id) => set((state) => ({ songAliases: state.songAliases.filter(a => a.id !== id) })),
      updateSongAlias: (id, updates) => set((state) => ({
        songAliases: state.songAliases.map(a => a.id === id ? { ...a, ...updates } : a),
      })),

      // Mapas Config
      mapasConfig: DEFAULT_MAPAS_CONFIG,
      setMapasConfig: (config) => set((state) => ({ mapasConfig: { ...state.mapasConfig, ...config } })),
      updateMapaCodeConfig: (code, updates) => set((state) => ({
        mapasConfig: {
          ...state.mapasConfig,
          codeConfigs: state.mapasConfig.codeConfigs.map(c =>
            c.code === code ? { ...c, ...updates } : c
          ),
        },
      })),
      addMapaCodeConfig: (config) => set((state) => ({
        mapasConfig: {
          ...state.mapasConfig,
          codeConfigs: [...state.mapasConfig.codeConfigs, config],
        },
      })),
      removeMapaCodeConfig: (code) => set((state) => ({
        mapasConfig: {
          ...state.mapasConfig,
          codeConfigs: state.mapasConfig.codeConfigs.filter(c => c.code !== code),
        },
      })),
      resetMapaCodeConfigs: () => set((state) => ({
        mapasConfig: { ...state.mapasConfig, codeConfigs: DEFAULT_CODE_CONFIGS },
      })),
      reorderMapaCodeConfigs: (fromIndex, toIndex) => set((state) => {
        const configs = [...state.mapasConfig.codeConfigs];
        const [moved] = configs.splice(fromIndex, 1);
        configs.splice(toIndex, 0, moved);
        return { mapasConfig: { ...state.mapasConfig, codeConfigs: configs } };
      }),
      updateMapaTemplateLine: (templateIndex, lineIndex, codes) => set((state) => {
        const templates = state.mapasConfig.templates.map((t, ti) => {
          if (ti !== templateIndex) return t;
          return { ...t, lines: t.lines.map((l, li) => li === lineIndex ? { ...l, codes } : l) };
        });
        return { mapasConfig: { ...state.mapasConfig, templates } };
      }),
      addMapaTemplateLine: (templateIndex, time, codes) => set((state) => {
        const templates = state.mapasConfig.templates.map((t, ti) => {
          if (ti !== templateIndex) return t;
          const newLines = [...t.lines, { time, codes }].sort((a, b) => a.time.localeCompare(b.time));
          return { ...t, lines: newLines };
        });
        return { mapasConfig: { ...state.mapasConfig, templates } };
      }),
      removeMapaTemplateLine: (templateIndex, lineIndex) => set((state) => {
        const templates = state.mapasConfig.templates.map((t, ti) => {
          if (ti !== templateIndex) return t;
          return { ...t, lines: t.lines.filter((_, li) => li !== lineIndex) };
        });
        return { mapasConfig: { ...state.mapasConfig, templates } };
      }),
      resetMapaTemplates: () => set((state) => ({
        mapasConfig: { ...state.mapasConfig, templates: DEFAULT_TEMPLATES },
      })),

      // Grade Preview Songs tracking (not persisted)
      gradePreviewSongKeys: new Set<string>(),
      setGradePreviewSongKeys: (keys) => set({ gradePreviewSongKeys: keys }),
      resetProgramming: () =>
        set((state) => {
          const nextPolicy = { ...state.policy, hourOverrides: {} };
          savePolicy(nextPolicy);
          return {
            programs: defaultPrograms,
            sequence: defaultSequence,
            scheduledSequences: [],
            fixedContent: defaultFixedContent,
            config: { ...state.config, useDefaultFixedSchedules: true },
            policy: nextPolicy,
          };
        }),

      policy: loadPolicy(),
      setPolicy: (policy) => {
        savePolicy(policy);
        set({ policy });
      },
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
        // blockSongs excluded — regenerated each grade build (saves ~50KB per persist)
        missingSongs: state.missingSongs.slice(-200), // Persist only last 200
        downloadHistory: state.downloadHistory,
        gradeHistory: state.gradeHistory,
        rankingSongs: state.rankingSongs,
        autoScrapeEnabled: state.autoScrapeEnabled,
        songAliases: state.songAliases,
        mapasConfig: state.mapasConfig,
        policy: state.policy,
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
          // Ensure default aliases are always present
          const defaultAliases = [
            { id: 'default-1', fromArtist: 'naldo lima', fromTitle: 'retrovisor', toArtist: 'Gusttavo Lima', toTitle: 'Retrovisor' },
            { id: 'default-2', fromArtist: 'Kaize', fromTitle: 'Olha onde eu tô', toArtist: 'Ana Castela', toTitle: 'Olha onde eu tô' },
            { id: 'default-3', fromArtist: 'Olho Seco', fromTitle: 'Olho Seco', toArtist: 'Luan Santana', toTitle: 'OLHO MARROM (Ao Vivo em Lisboa)' },
            { id: 'default-4', fromArtist: 'x-terra', fromTitle: 'i will survive', toArtist: 'Léo Santana', toTitle: 'Desliza (Olhinho No Corpinho)' },
            { id: 'default-5', fromArtist: 'PROMESSA D', fromTitle: 'PEDIDO DE SOCORRO', toArtist: 'Gustavo Mioto', toTitle: 'Pedido De Socorro (Ao Vivo)' },
          ];
          const existing = state.songAliases || [];
          const existingIds = new Set(existing.map(a => a.id));
          const missing = defaultAliases.filter(d => !existingIds.has(d.id));
          if (missing.length > 0) {
            state.songAliases = [...existing, ...missing];
          }
          // Auto-migrate genre routes: ensure all default routes are present
          const defaultGenreRoutes: Array<{genre: string; folderName: string}> = [
            { genre: 'POP', folderName: 'Pop' },
            { genre: 'ROCK', folderName: 'Rock' },
            { genre: 'METAL', folderName: 'Metal' },
            { genre: 'SERTANEJO', folderName: 'Sertanejo' },
            { genre: 'PAGODE', folderName: 'Pagode' },
            { genre: 'MPB', folderName: 'MPB' },
            { genre: 'RAP/HIP-HOP', folderName: 'Hip Hop' },
            { genre: 'ELETRONICA', folderName: 'Dance' },
          ];
          if (state.deezerConfig) {
            const existingRoutes = state.deezerConfig.genreRoutes || [];
            const existingGenres = new Set(existingRoutes.map(r => r.genre.toUpperCase()));
            const missingRoutes = defaultGenreRoutes.filter(r => !existingGenres.has(r.genre));
            if (missingRoutes.length > 0) {
              state.deezerConfig.genreRoutes = [...existingRoutes, ...missingRoutes];
              console.log(`[STORE] Auto-migrated ${missingRoutes.length} genre routes: ${missingRoutes.map(r => r.genre).join(', ')}`);
            }
            // Ensure genre routing is enabled
            if (state.deezerConfig.genreRoutingEnabled === undefined) {
              state.deezerConfig.genreRoutingEnabled = true;
            }
          }
          // Fix NOT code: must be vinheta, not monitored
          if (state.mapasConfig?.codeConfigs) {
            state.mapasConfig.codeConfigs = state.mapasConfig.codeConfigs.map(c =>
              c.code === 'NOT' && c.type === 'monitored'
                ? { ...c, type: 'vinheta' as const, label: 'Locuções', vinhetaFolder: 'C:\\Playlist\\Locucoes', stationSource: undefined }
                : c
            );
          }
          if (state.mapasConfig?.templates?.length) {
            state.mapasConfig.templates = state.mapasConfig.templates.map((template, index) => ({
              ...template,
              dayMapping: template.dayMapping || DEFAULT_TEMPLATES[index]?.dayMapping || '',
              filename: normalizeMapaTemplateFilename(template.filename, template.dayMapping, index),
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
export const getActiveSequence = (targetHour?: number, targetMinute?: number): SequenceConfig[] => {
  const state = useRadioStore.getState();
  const now = new Date();
  
  // Use target time if provided, otherwise current time
  const currentHour = targetHour !== undefined ? targetHour : now.getHours();
  const currentMinute = targetMinute !== undefined ? targetMinute : now.getMinutes();
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
