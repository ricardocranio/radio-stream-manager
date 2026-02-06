/**
 * Constants for the Grade Builder system.
 */
import type { WeekDay } from '@/types/radio';

export const ARTIST_REPETITION_MINUTES = 60;
export const DEFAULT_MINUTES_BEFORE_BLOCK = 10;

/** Explicit mapping from local station IDs to database station names */
export const STATION_ID_TO_DB_NAME: Record<string, string> = {
  'bh': 'BH FM',
  'band': 'Band FM',
  'clube': 'Clube FM',
  'globo': 'Rádio Globo RJ',
  'blink': 'Blink 102 FM',
  'positiva': 'Positiva FM',
  'liberdade': 'Liberdade FM',
  'mix': 'Mix FM',
};

/** Day code mapping for file naming (abbreviated) */
export const DAY_CODE_MAP: Record<WeekDay, string> = {
  'dom': 'DOM',
  'seg': 'SEG',
  'ter': 'TER',
  'qua': 'QUA',
  'qui': 'QUI',
  'sex': 'SEX',
  'sab': 'SAB',
};

/** Full day name mapping for fixed content filenames */
export const FULL_DAY_NAME_MAP: Record<WeekDay, string> = {
  'dom': 'DOMINGO',
  'seg': 'SEGUNDA',
  'ter': 'TERCA',
  'qua': 'QUARTA',
  'qui': 'QUINTA',
  'sex': 'SEXTA',
  'sab': 'SABADO',
};

/** Day names indexed by Date.getDay() */
export const DAY_CODES_BY_INDEX = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
export const FULL_DAY_NAMES_BY_INDEX = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];
export const WEEKDAY_KEYS: WeekDay[] = ['seg', 'ter', 'qua', 'qui', 'sex'];

export const isElectronEnv = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
