// Horários específicos de monitoramento para banco de músicas diferenciado
export interface MonitoringSchedule {
  id: string;
  hour: number;
  minute: number;
  enabled: boolean;
  label?: string; // Ex: "Horário nobre", "Música diferenciada"
}

export interface RadioStation {
  id: string;
  name: string;
  urls: string[];
  scrapeUrl?: string; // URL for real-time scraping (mytuner-radio, etc.)
  styles: string[];
  enabled: boolean;
  monitoringSchedules?: MonitoringSchedule[]; // Horários específicos para monitoramento
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
  source?: string; // URL from where the song was captured
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
  // V21 additions
  vozBrasilFolder?: string;
  vozBrasilTime?: string;
  dnaLearningFile?: string;
  inventoryCacheDuration?: number;
  hardResetInterval?: number;
  monitorInterval?: number;
  forbiddenWords?: string[];
  funkWords?: string[];
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
