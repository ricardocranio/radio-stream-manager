// Dias da semana para monitoramento
export type WeekDay = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';

// Horários específicos de monitoramento para banco de músicas diferenciado
export interface MonitoringSchedule {
  id: string;
  hour: number; // Hora de início
  minute: number; // Minuto de início
  endHour: number; // Hora de fim
  endMinute: number; // Minuto de fim
  enabled: boolean;
  label?: string; // Ex: "Horário nobre", "Música diferenciada"
  customUrl?: string; // URL personalizada para rádios não cadastradas
  weekDays?: WeekDay[]; // Dias da semana ativos (vazio = todos)
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
  // Characters to filter/remove from filenames (user-configurable)
  filterCharacters?: string[];
  // Performance
  powerSavingMode?: boolean;
  // Similarity threshold for music library matching (0.5 to 0.95)
  similarityThreshold?: number;
}

export interface SequenceConfig {
  position: number;
  radioSource: string;
  customFileName?: string; // Custom filename for fixed content (e.g., NOTICIA_DA_HORA_18HORAS)
}

// Scheduled sequence - allows different sequences for different time periods
export interface ScheduledSequence {
  id: string;
  name: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  weekDays: WeekDay[]; // Empty = all days
  sequence: SequenceConfig[];
  enabled: boolean;
  priority: number; // Higher priority overrides lower
}

export interface BlockSchedule {
  time: string;
  songs: CapturedSong[];
  programId: string;
}
