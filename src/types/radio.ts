export interface RadioStation {
  id: string;
  name: string;
  urls: string[];
  styles: string[];
  enabled: boolean;
}

export interface ProgramSchedule {
  timeRange: string;
  programName: string;
}

export interface CapturedSong {
  id: string;
  title: string;
  artist: string;
  station: string;
  timestamp: Date;
  status: 'found' | 'missing' | 'curated';
}

export interface SystemConfig {
  musicFolders: string[];
  gradeFolder: string;
  contentFolder: string;
  rankingFile: string;
  updateIntervalMinutes: number;
  artistRepetitionMinutes: number;
  safetyMarginMinutes: number;
  coringaCode: string;
}

export interface SequenceConfig {
  position: number;
  radioSource: string;
}

export interface BlockSchedule {
  time: string;
  songs: CapturedSong[];
  programId: string;
}
