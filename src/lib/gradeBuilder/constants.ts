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

/** Manual overrides for station abbreviations (used in UI badges) */
const STATION_ABBREVIATION_OVERRIDES: Record<string, string> = {
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
  'Rádio Disney': 'DS',
  'Disney FM': 'DS',
  'Super Rádio Tupi': 'ST',
  'FM O Dia': 'OD',
  'Rede Aleluia': 'RA',
};

/** Auto-generate a short abbreviation from a station name */
function generateAbbreviation(name: string): string {
  // Remove common suffixes/prefixes
  const cleaned = name
    .replace(/\b(FM|AM|Rádio|Radio)\b/gi, '')
    .trim();

  // Split into significant words
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) return name.substring(0, 2).toUpperCase();

  // Single word: take first 2-3 chars
  if (words.length === 1) {
    const w = words[0];
    // If it's a number (e.g. "105"), keep it
    if (/^\d+$/.test(w)) return w;
    return w.substring(0, 2).toUpperCase();
  }

  // Multiple words: take first letter of each (up to 3)
  return words
    .slice(0, 3)
    .map(w => w[0])
    .join('')
    .toUpperCase();
}

/** Get short abbreviation for a station name (auto-generated with manual overrides) */
export function getStationAbbreviation(stationName: string): string {
  return STATION_ABBREVIATION_OVERRIDES[stationName] || generateAbbreviation(stationName);
}
