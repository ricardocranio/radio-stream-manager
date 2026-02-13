/**
 * Shared types for the Grade Builder system.
 */
import type { WeekDay, SequenceConfig } from '@/types/radio';

export interface SongEntry {
  title: string;
  artist: string;
  station: string;
  style: string;
  filename: string;
  originalFilename?: string;
  existsInLibrary?: boolean;
  scrapedAt?: string; // ISO timestamp for freshness sorting
}

export interface UsedSong {
  title: string;
  artist: string;
  usedAt: Date;
  blockTime: string;
}

export interface CarryOverSong {
  title: string;
  artist: string;
  station: string;
  style: string;
  addedAt: Date;
  targetBlock: string;
}

export interface BlockStats {
  skipped: number;
  substituted: number;
  missing: number;
}

export interface BlockLogItem {
  blockTime: string;
  type: 'used' | 'skipped' | 'substituted' | 'missing' | 'fixed';
  title: string;
  artist: string;
  station: string;
  reason?: string;
  style?: string;
  substituteFor?: string;
}

export interface BlockResult {
  line: string;
  logs: BlockLogItem[];
  songFreshness?: string[]; // ISO timestamps for each song slot (for freshness comparison on rebuild)
}

export interface LibraryCheckResult {
  exists: boolean;
  filename?: string;
}

/**
 * Context object passed to special program generators and song selection functions.
 * Bundles shared dependencies to avoid prop drilling.
 */
export interface GradeContext {
  // Functions
  isRecentlyUsed: (title: string, artist: string, blockTime: string, isFullDay?: boolean) => boolean;
  findSongInLibrary: (artist: string, title: string) => Promise<LibraryCheckResult>;
  batchFindSongsInLibrary: (songs: Array<{ artist: string; title: string }>) => Promise<Map<string, LibraryCheckResult>>;
  markSongAsUsed: (title: string, artist: string, blockTime: string) => void;
  sanitizeFilename: (filename: string) => string;
  sanitizeGradeLine: (line: string) => string;
  getFullDayName: (targetDay?: WeekDay) => string;
  getDayCode: (targetDay?: WeekDay) => string;
  processFixedContentFilename: (fileName: string, hour: number, minute: number, editionIndex: number, targetDay?: WeekDay) => string;
  addMissingSong: (song: any) => void;
  isSongAlreadyMissing: (artist: string, title: string) => boolean;
  addCarryOverSong: (song: Omit<CarryOverSong, 'addedAt'>) => void;
  getCarryOverSongs: (blockTime: string) => CarryOverSong[];
  
  // Data
  coringaCode: string;
  rankingSongs: Array<{
    id: string;
    title: string;
    artist: string;
    plays: number;
    style: string;
    trend: 'up' | 'down' | 'stable';
    lastPlayed: Date;
  }>;
  filterChars?: string[];
  fixedContent: Array<{
    id: string;
    name: string;
    fileName: string;
    type: string;
    dayPattern: string;
    timeSlots: { hour: number; minute: number }[];
    enabled: boolean;
    top50Count?: number;
    position?: 'start' | 'middle' | 'end' | number;
  }>;
  stations: Array<{
    id: string;
    name: string;
    styles?: string[];
  }>;
  musicFolders: string[];
}
