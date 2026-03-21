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
  type: 'literal' | 'vinheta' | 'monitored' | 'genre' | 'comercial';
  /** For 'monitored': station name to pull from */
  stationSource?: string;
  /** For 'genre': ID3 genre filter */
  genreFilter?: string[];
  /** For 'genre': decade filter (e.g., '80s', '90s', '2000s') */
  decadeFilter?: string;
  /** For 'vinheta'/'comercial': folder path */
  vinhetaFolder?: string;
  /** For 'comercial': specific fixed file chosen by user */
  fixedFile?: string;
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
  templates: MapaTemplate[];     // Built-in editable templates
}

/** Default code configurations */
export const DEFAULT_CODE_CONFIGS: MapaCodeConfig[] = [
  { code: 'SINAL', label: 'Sinal (Hora)', type: 'literal' },
  { code: 'HC', label: 'Hora Certa', type: 'literal' },
  { code: 'RESTART', label: 'Reinício (Vinheta)', type: 'vinheta', vinhetaFolder: 'C:\\Playlist\\Vinhetas' },
  { code: 'NOT', label: 'Locuções', type: 'vinheta', vinhetaFolder: 'C:\\Playlist\\Locucoes' },
  { code: 'VHTENT', label: 'Vinheta Entrada', type: 'vinheta', vinhetaFolder: 'C:\\Playlist\\Vht Entrada' },
  { code: 'vht', label: 'Vinheta Normal', type: 'vinheta', vinhetaFolder: 'C:\\Playlist\\Vinhetas' },
  { code: 'mus', label: 'Música (Monitoramento)', type: 'monitored', stationSource: 'Disney FM' },
  { code: 'fun', label: 'Funk', type: 'genre', genreFilter: ['FUNK', 'FUNK MELODY', 'FUNK CARIOCA'] },
  { code: 'rom', label: 'MPB / Românticas', type: 'genre', genreFilter: ['MPB', 'ROMANTICA', 'ROMANTICO', 'BOSSA NOVA'] },
  { code: 'com', label: 'Comercial', type: 'comercial', vinhetaFolder: 'C:\\Playlist\\Comerciais' },
];

// Standard block used in most time slots
const STD = ['SINAL','HC','VHTENT','mus','vht','mus'];
const STD_NOT = ['SINAL','HC','NOT','VHTENT','mus','vht','mus'];
const STD_FUN = ['SINAL','HC','VHTENT','fun','vht','fun'];
const STD_ROM = ['SINAL','HC','VHTENT','rom','vht'];

/** Default MAPA template (Seg) */
const makeWeekdayTemplate = (day: string, filename: string): MapaTemplate => ({
  filename,
  dayMapping: day,
  lines: [
    { time: '00:55', codes: ['SINAL','SINAL','HC','VHTENT','mus','vht','mus'] },
    { time: '01:55', codes: STD }, { time: '02:55', codes: STD },
    { time: '03:55', codes: STD }, { time: '04:55', codes: STD },
    { time: '05:55', codes: ['RESTART','SINAL','HC','VHTENT'] },
    { time: '06:55', codes: STD }, { time: '07:27', codes: STD },
    { time: '07:55', codes: STD },
    { time: '08:27', codes: STD_NOT }, { time: '08:55', codes: STD },
    { time: '09:27', codes: STD_NOT }, { time: '09:55', codes: STD },
    { time: '10:27', codes: STD_NOT }, { time: '10:55', codes: STD },
    { time: '11:27', codes: STD_NOT }, { time: '11:55', codes: STD },
    { time: '12:27', codes: STD_NOT }, { time: '12:55', codes: STD },
    { time: '13:27', codes: STD_NOT }, { time: '13:55', codes: STD },
    { time: '14:27', codes: STD_NOT }, { time: '14:55', codes: STD },
    { time: '15:27', codes: STD_NOT }, { time: '15:55', codes: STD },
    { time: '16:27', codes: STD_NOT }, { time: '16:55', codes: STD },
    { time: '17:27', codes: STD_NOT }, { time: '17:55', codes: STD },
    { time: '18:27', codes: STD }, { time: '18:55', codes: STD },
    { time: '19:27', codes: STD }, { time: '19:55', codes: STD },
    { time: '20:59', codes: ['VHTENT'] },
    { time: '22:00', codes: ['SINAL','HC','VHTENT'] },
    { time: '22:27', codes: [...STD_ROM] }, { time: '22:55', codes: [...STD_ROM] },
    { time: '23:27', codes: [...STD_ROM] }, { time: '23:55', codes: [...STD_ROM] },
  ],
});

export const DEFAULT_TEMPLATE_SEG = makeWeekdayTemplate('seg', 'seg.txt');
export const DEFAULT_TEMPLATE_TER = makeWeekdayTemplate('ter', 'ter.txt');
export const DEFAULT_TEMPLATE_QUA = makeWeekdayTemplate('qua', 'qua.txt');
export const DEFAULT_TEMPLATE_QUI = makeWeekdayTemplate('qui', 'qui.txt');
export const DEFAULT_TEMPLATE_SEX = makeWeekdayTemplate('sex', 'sex.txt');

/** Default S_B template (Sábado) */
export const DEFAULT_TEMPLATE_SAB: MapaTemplate = {
  filename: 'sab.txt',
  dayMapping: 'sab',
  lines: [
    { time: '00:55', codes: ['SINAL','SINAL','HC','VHTENT','mus','vht','mus'] },
    { time: '01:55', codes: STD }, { time: '02:55', codes: STD },
    { time: '03:55', codes: STD }, { time: '04:55', codes: STD },
    { time: '05:55', codes: ['RESTART','SINAL','HC','VHTENT'] },
    { time: '06:55', codes: STD }, { time: '07:27', codes: STD },
    { time: '07:55', codes: STD }, { time: '08:27', codes: STD },
    { time: '08:55', codes: STD }, { time: '09:27', codes: STD },
    { time: '09:55', codes: STD }, { time: '10:27', codes: STD },
    { time: '10:55', codes: STD }, { time: '11:27', codes: STD },
    { time: '11:55', codes: STD }, { time: '12:27', codes: STD },
    { time: '12:55', codes: STD }, { time: '13:27', codes: STD },
    { time: '13:55', codes: STD }, { time: '14:27', codes: STD },
    { time: '14:55', codes: STD }, { time: '15:27', codes: STD },
    { time: '15:55', codes: STD }, { time: '16:27', codes: STD },
    { time: '16:55', codes: STD }, { time: '17:27', codes: STD },
    { time: '17:55', codes: STD_FUN }, { time: '18:27', codes: STD_FUN },
    { time: '18:55', codes: STD }, { time: '19:27', codes: STD },
    { time: '19:55', codes: STD }, { time: '20:27', codes: STD },
    { time: '20:59', codes: STD },
    { time: '22:00', codes: STD }, { time: '22:27', codes: STD },
    { time: '22:55', codes: STD }, { time: '23:27', codes: STD },
    { time: '23:55', codes: STD },
  ],
};

/** Default DOM template (Domingo) */
export const DEFAULT_TEMPLATE_DOM: MapaTemplate = {
  filename: 'dom.txt',
  dayMapping: 'dom',
  lines: [
    { time: '00:55', codes: ['SINAL','SINAL','HC','VHTENT','mus','vht','mus'] },
    { time: '01:55', codes: STD }, { time: '02:55', codes: STD },
    { time: '03:55', codes: STD }, { time: '04:55', codes: STD },
    { time: '05:55', codes: ['RESTART','SINAL','HC','VHTENT'] },
    { time: '06:55', codes: STD }, { time: '07:27', codes: STD },
    { time: '07:55', codes: STD }, { time: '08:27', codes: STD },
    { time: '08:55', codes: STD }, { time: '09:27', codes: STD },
    { time: '09:55', codes: STD }, { time: '10:27', codes: STD },
    { time: '10:55', codes: STD }, { time: '11:27', codes: STD },
    { time: '11:55', codes: STD }, { time: '12:27', codes: STD },
    { time: '12:55', codes: STD }, { time: '13:27', codes: STD },
    { time: '13:55', codes: STD }, { time: '14:27', codes: STD },
    { time: '14:55', codes: STD }, { time: '15:27', codes: STD },
    { time: '15:55', codes: STD }, { time: '16:27', codes: STD },
    { time: '16:55', codes: STD }, { time: '17:27', codes: STD },
    { time: '17:55', codes: STD }, { time: '18:27', codes: STD },
    { time: '18:55', codes: STD }, { time: '19:27', codes: STD },
    { time: '19:55', codes: STD }, { time: '20:27', codes: STD },
    { time: '20:59', codes: STD },
    { time: '22:00', codes: STD }, { time: '22:27', codes: STD },
    { time: '22:55', codes: STD }, { time: '23:27', codes: STD },
    { time: '23:55', codes: STD },
  ],
};

export const DEFAULT_TEMPLATES: MapaTemplate[] = [
  DEFAULT_TEMPLATE_DOM,
  DEFAULT_TEMPLATE_SEG,
  DEFAULT_TEMPLATE_TER,
  DEFAULT_TEMPLATE_QUA,
  DEFAULT_TEMPLATE_QUI,
  DEFAULT_TEMPLATE_SEX,
  DEFAULT_TEMPLATE_SAB,
];

export const DEFAULT_MAPAS_CONFIG: MapasConfig = {
  enabled: true,
  mapasFolder: 'C:\\Playlist\\pgm\\Mapas',
  vhtEntradaFolder: 'C:\\Playlist\\Vht Entrada',
  outputFolder: 'C:\\Playlist\\pgm\\Mapas',
  codeConfigs: DEFAULT_CODE_CONFIGS,
  templates: DEFAULT_TEMPLATES,
};
