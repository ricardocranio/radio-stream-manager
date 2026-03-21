/**
 * Mapas Builder Types
 * 
 * Mapas are commercial/institutional programming templates
 * that run in parallel with the music grade system.
 * Templates live in C:\Playlist\pgm\Mapas
 */

export interface MapaCodeConfig {
  /** Code used in template (e.g., 'mus', 'fun', 'rom') */
  code: string;
  /** Human-readable label */
  label: string;
  /** Type of resolution */
  type: 'literal' | 'vinheta' | 'monitored' | 'genre';
  /** For 'monitored': station name to pull from */
  stationSource?: string;
  /** For 'genre': ID3 genre filter */
  genreFilter?: string[];
  /** For 'vinheta': folder path */
  vinhetaFolder?: string;
}

export interface MapaTemplateLine {
  time: string;       // e.g., "08:27"
  codes: string[];    // e.g., ["SINAL", "HC", "VHTENT", "mus", "vht", "mus"]
}

export interface MapaTemplate {
  filename: string;   // e.g., "MAPA.txt"
  dayMapping: string; // e.g., "weekdays", "saturday", "sunday"
  lines: MapaTemplateLine[];
}

export interface MapaResolvedLine {
  time: string;
  items: string[];    // Resolved filenames or literal codes
}

export interface MapasConfig {
  enabled: boolean;
  mapasFolder: string;           // C:\Playlist\pgm\Mapas
  vhtEntradaFolder: string;      // C:\Playlist\Vht Entrada
  outputFolder: string;          // Where to save generated files
  codeConfigs: MapaCodeConfig[]; // Config for each resolvable code
}

/** Default code configurations */
export const DEFAULT_CODE_CONFIGS: MapaCodeConfig[] = [
  { code: 'SINAL', label: 'Sinal (Hora)', type: 'literal' },
  { code: 'HC', label: 'Hora Certa', type: 'literal' },
  { code: 'RESTART', label: 'Reinício (Vinheta)', type: 'vinheta', vinhetaFolder: 'C:\\Playlist\\Vinhetas' },
  { code: 'NOT', label: 'Notícias (Mix FM)', type: 'monitored', stationSource: 'Mix FM' },
  { code: 'VHTENT', label: 'Vinheta Entrada', type: 'vinheta', vinhetaFolder: 'C:\\Playlist\\Vht Entrada' },
  { code: 'vht', label: 'Vinheta Normal', type: 'vinheta', vinhetaFolder: 'C:\\Playlist\\Vinhetas' },
  { code: 'mus', label: 'Música (Monitoramento)', type: 'monitored', stationSource: 'Disney FM' },
  { code: 'fun', label: 'Funk', type: 'genre', genreFilter: ['FUNK', 'FUNK MELODY', 'FUNK CARIOCA'] },
  { code: 'rom', label: 'MPB / Românticas', type: 'genre', genreFilter: ['MPB', 'ROMANTICA', 'ROMANTICO', 'BALADA', 'BOSSA NOVA'] },
];

export const DEFAULT_MAPAS_CONFIG: MapasConfig = {
  enabled: true,
  mapasFolder: 'C:\\Playlist\\pgm\\Mapas',
  vhtEntradaFolder: 'C:\\Playlist\\Vht Entrada',
  outputFolder: 'C:\\Playlist\\pgm\\Mapas',
  codeConfigs: DEFAULT_CODE_CONFIGS,
};
