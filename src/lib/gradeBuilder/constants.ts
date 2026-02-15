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
  'sab': 'SÁB',
};

/** Full day name mapping for fixed content filenames */
export const FULL_DAY_NAME_MAP: Record<WeekDay, string> = {
  'dom': 'DOMINGO',
  'seg': 'SEGUNDA',
  'ter': 'TERCA',
  'qua': 'QUARTA',
  'qui': 'QUINTA',
  'sex': 'SEXTA',
  'sab': 'SÁBADO',
};

/** Day names indexed by Date.getDay() */
export const DAY_CODES_BY_INDEX = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
export const FULL_DAY_NAMES_BY_INDEX = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
export const WEEKDAY_KEYS: WeekDay[] = ['seg', 'ter', 'qua', 'qui', 'sex'];

export const isElectronEnv = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

/** Short abbreviation map for station names (used in UI badges) */
export const STATION_ABBREVIATIONS: Record<string, string> = {
  'BH FM': 'BH',
  'Band FM': 'BD',
  'Clube FM': 'CL',
  'Rádio Globo RJ': 'GL',
  'Blink 102 FM': 'BK',
  'Positiva FM': 'PS',
  'Liberdade FM': 'LB',
  'Mix FM': 'MX',
  'Metropolitana FM': 'MT',
  'Energia 97': 'EN',
  'Positividade FM': 'PV',
  '105 FM': '105',
  // Extras comuns
  'Jovem Pan': 'JP',
  'Jovem Pan Florianópolis': 'JPF',
  'Nativa FM': 'NT',
  'Transamérica': 'TR',
  'Antena 1': 'A1',
  'Disney FM': 'DS',
  'Rádio Disney': 'DS',
  'Alpha FM': 'AL',
  'Kiss FM': 'KS',
  'Nova Brasil FM': 'NB',
  'Tupi FM': 'TP',
  'Cidade FM': 'CD',
  'Sara Brasil FM': 'SB',
  'CBN': 'CBN',
  'JB FM': 'JB',
  'Roquette Pinto': 'RP',
  'FM O Dia': 'OD',
  'Super Rádio Tupi': 'ST',
  'Rádio Nacional': 'RN',
  'Cultura FM': 'CT',
  'Gazeta FM': 'GZ',
  'Itatiaia': 'IT',
  'Rádio Globo SP': 'GS',
  'Paradiso FM': 'PD',
  'Massa FM': 'MS',
  'Mais FM': 'MF',
  'Rede Aleluia': 'RA',
};

/** Get short abbreviation for a station name */
export function getStationAbbreviation(stationName: string): string {
  return STATION_ABBREVIATIONS[stationName] || stationName.substring(0, 2).toUpperCase();
}
