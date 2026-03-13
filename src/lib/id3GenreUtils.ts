/**
 * Shared ID3 Genre Utilities
 * 
 * Centralized genre normalization and energy mapping used by
 * both auto-download and captured-download services.
 */

// Comprehensive genre text → normalized genre mapping
const ID3_GENRE_MAP: Record<string, string> = {
  // Pop
  pop: 'POP', 'synth-pop': 'POP', 'indie pop': 'POP', 'dance pop': 'POP',
  'pop rock': 'POP', 'electropop': 'POP', 'teen pop': 'POP', 'power pop': 'POP',
  'j-pop': 'POP', 'k-pop': 'POP', 'art pop': 'POP', 'dream pop': 'POP',
  'chamber pop': 'POP', 'sunshine pop': 'POP', 'bubblegum pop': 'POP',

  // Rock
  rock: 'ROCK', 'rock and roll': 'ROCK', 'classic rock': 'ROCK',
  'alternative rock': 'ROCK', 'alternative': 'ROCK', 'indie rock': 'ROCK',
  'punk rock': 'ROCK', punk: 'ROCK', 'post-punk': 'ROCK', grunge: 'ROCK',
  'hard rock': 'ROCK', 'soft rock': 'ROCK', 'progressive rock': 'ROCK',
  'psychedelic rock': 'ROCK', 'garage rock': 'ROCK', 'southern rock': 'ROCK',
  'stoner rock': 'ROCK', 'folk rock': 'ROCK', 'blues rock': 'ROCK',
  'new wave': 'ROCK', 'brit pop': 'ROCK', britpop: 'ROCK',
  'post-rock': 'ROCK', emo: 'ROCK', 'pop punk': 'ROCK', ska: 'ROCK',

  // Metal
  metal: 'METAL', 'heavy metal': 'METAL', 'death metal': 'METAL',
  'black metal': 'METAL', 'thrash metal': 'METAL', 'power metal': 'METAL',
  'doom metal': 'METAL', 'symphonic metal': 'METAL', 'nu metal': 'METAL',
  'nu-metal': 'METAL', metalcore: 'METAL', 'progressive metal': 'METAL',
  'gothic metal': 'METAL', 'folk metal': 'METAL', 'speed metal': 'METAL',
  'groove metal': 'METAL', 'industrial metal': 'METAL', 'melodic death metal': 'METAL',
  deathcore: 'METAL', djent: 'METAL', hardcore: 'METAL',

  // Sertanejo
  sertanejo: 'SERTANEJO', 'sertanejo universitário': 'SERTANEJO',
  'sertanejo universitario': 'SERTANEJO', 'sertanejo raiz': 'SERTANEJO',
  'sertanejo pop': 'SERTANEJO', 'country brasileiro': 'SERTANEJO',
  'música sertaneja': 'SERTANEJO', 'musica sertaneja': 'SERTANEJO',

  // Pagode / Samba
  pagode: 'PAGODE', samba: 'PAGODE', 'samba rock': 'PAGODE',
  'samba de roda': 'PAGODE', 'partido alto': 'PAGODE',

  // MPB
  mpb: 'MPB', 'música popular brasileira': 'MPB', 'musica popular brasileira': 'MPB',
  'bossa nova': 'MPB', 'tropicalia': 'MPB', 'tropicália': 'MPB',
  blues: 'MPB', 'brazilian': 'MPB',

  // Hip-hop / Rap
  'hip-hop': 'RAP/HIP-HOP', 'hip hop': 'RAP/HIP-HOP', rap: 'RAP/HIP-HOP',
  'trap': 'RAP/HIP-HOP', 'boom bap': 'RAP/HIP-HOP', 'rap brasileiro': 'RAP/HIP-HOP',
  'gangsta rap': 'RAP/HIP-HOP', 'conscious hip hop': 'RAP/HIP-HOP',

  // Electronic / Dance
  electronic: 'ELETRONICA', dance: 'ELETRONICA', edm: 'ELETRONICA',
  house: 'ELETRONICA', 'deep house': 'ELETRONICA', techno: 'ELETRONICA',
  trance: 'ELETRONICA', dubstep: 'ELETRONICA', 'drum and bass': 'ELETRONICA',
  'drum & bass': 'ELETRONICA', dnb: 'ELETRONICA', ambient: 'ELETRONICA',
  'lo-fi': 'ELETRONICA', lofi: 'ELETRONICA', chillout: 'ELETRONICA',
  'future bass': 'ELETRONICA', synthwave: 'ELETRONICA', disco: 'ELETRONICA',
  'nu-disco': 'ELETRONICA', 'progressive house': 'ELETRONICA',
  'electro house': 'ELETRONICA', 'tropical house': 'ELETRONICA',

  // Funk
  funk: 'FUNK', 'funk carioca': 'FUNK', 'funk brasileiro': 'FUNK',
  'funk melody': 'FUNK', 'funk ostentação': 'FUNK', 'funk ostentacao': 'FUNK',
  'baile funk': 'FUNK', 'funk pop': 'FUNK',

  // Gospel
  gospel: 'GOSPEL', 'christian': 'GOSPEL', 'worship': 'GOSPEL',
  'música gospel': 'GOSPEL', 'musica gospel': 'GOSPEL', ccm: 'GOSPEL',
  'christian rock': 'GOSPEL', 'praise': 'GOSPEL',

  // Forró
  forró: 'FORRO', forro: 'FORRO', 'forró eletrônico': 'FORRO',
  'forro eletronico': 'FORRO', axé: 'FORRO', axe: 'FORRO',
  'arrocha': 'FORRO', 'piseiro': 'FORRO', 'pisadinha': 'FORRO',

  // Reggaeton / Latin
  reggaeton: 'REGGAETON', 'reggaetón': 'REGGAETON', 'latin pop': 'REGGAETON',
  latin: 'LATINA', latina: 'LATINA', 'latin urban': 'REGGAETON',
  bachata: 'REGGAETON', salsa: 'LATINA', cumbia: 'LATINA',
  merengue: 'LATINA',

  // R&B / Soul
  'r&b': 'R&B', rnb: 'R&B', soul: 'R&B', 'neo soul': 'R&B',
  'neo-soul': 'R&B', 'contemporary r&b': 'R&B', motown: 'R&B',

  // Country
  country: 'COUNTRY', 'country pop': 'COUNTRY', americana: 'COUNTRY',
  bluegrass: 'COUNTRY',

  // Jazz
  jazz: 'JAZZ', 'smooth jazz': 'JAZZ', 'jazz fusion': 'JAZZ',
  'acid jazz': 'JAZZ', 'cool jazz': 'JAZZ', 'free jazz': 'JAZZ',

  // Classical
  classical: 'CLASSICA', 'clássica': 'CLASSICA', classica: 'CLASSICA',
  'erudita': 'CLASSICA', opera: 'CLASSICA', 'ópera': 'CLASSICA',
  orchestral: 'CLASSICA', 'chamber music': 'CLASSICA',

  // Indie
  indie: 'INDIE', 'indie folk': 'INDIE', 'indie electronic': 'INDIE',

  // Reggae
  reggae: 'REGGAE', 'roots reggae': 'REGGAE', dub: 'REGGAE',
  dancehall: 'REGGAE',

  // Other Brazilian
  'brega': 'FORRO', 'tecnobrega': 'FORRO', 'brega funk': 'FUNK',
  'lambada': 'FORRO', 'manguebeat': 'MPB', 'maracatu': 'MPB',
};

// ID3v1 numeric genre code → normalized genre
const ID3V1_GENRE_MAP: Record<number, string> = {
  0: 'MPB',           // Blues
  1: 'ROCK',          // Classic Rock
  2: 'POP',           // Country → POP for our context
  3: 'ELETRONICA',    // Dance
  4: 'ELETRONICA',    // Disco
  5: 'FUNK',          // Funk
  6: 'RAP/HIP-HOP',  // Grunge → close to rock but mapped
  7: 'R&B',           // Hip-Hop
  8: 'JAZZ',          // Jazz
  9: 'METAL',         // Metal
  10: 'POP',          // New Age → POP
  11: 'POP',          // Oldies
  12: 'OUTRO',        // Other
  13: 'POP',          // Pop
  14: 'R&B',          // R&B
  15: 'RAP/HIP-HOP', // Rap
  16: 'REGGAE',       // Reggae
  17: 'ROCK',         // Rock
  18: 'ELETRONICA',   // Techno
  19: 'POP',          // Industrial → POP
  20: 'ROCK',         // Alternative
  21: 'ROCK',         // Ska
  32: 'CLASSICA',     // Classical
  33: 'ROCK',         // Instrumental
  37: 'R&B',          // Soul
  38: 'ROCK',         // Punk
  40: 'ROCK',         // Alternative Rock
  42: 'R&B',          // Bass
  43: 'R&B',          // Soul
  48: 'ELETRONICA',   // Fast-Fusion
  52: 'ELETRONICA',   // Electronic
  57: 'ELETRONICA',   // Dream
  59: 'REGGAE',       // Chanson
  62: 'POP',          // Pop/Funk
  74: 'ROCK',         // Acid Rock
  75: 'ROCK',         // Psychedelic
  77: 'ROCK',         // Musical
  80: 'COUNTRY',      // Folk
  85: 'RAP/HIP-HOP', // Bebop → repurposed
  86: 'LATINA',       // Latin
  89: 'MPB',          // Bluegrass → MPB
  98: 'ELETRONICA',   // Club
  99: 'ELETRONICA',   // Tango
  100: 'PAGODE',      // Samba
  101: 'MPB',         // Folklore
  103: 'POP',         // Polka
  104: 'ELETRONICA',  // Retro
  105: 'ROCK',        // Theatre
  107: 'ROCK',        // Rock & Roll
  108: 'ROCK',        // Hard Rock
  115: 'ELETRONICA',  // House
  116: 'ELETRONICA',  // Game
  117: 'ELETRONICA',  // Sound Clip
  123: 'ROCK',        // A Cappella
  124: 'ELETRONICA',  // Euro-House
  125: 'ELETRONICA',  // Dance Hall
  126: 'ROCK',        // Goa
  127: 'ELETRONICA',  // Drum & Bass
  128: 'ELETRONICA',  // Club-House
  129: 'METAL',       // Hardcore
  130: 'METAL',       // Terror
  131: 'INDIE',       // Indie
  132: 'MPB',         // BritPop → context-based
  133: 'ROCK',        // Negerpunk
  134: 'ROCK',        // Polsk Punk
  135: 'METAL',       // Beat / Metal
  136: 'METAL',       // Christian Gangsta
  137: 'METAL',       // Heavy Metal
  138: 'METAL',       // Black Metal
  139: 'ROCK',        // Crossover
  140: 'ELETRONICA',  // Contemporary C
  141: 'ROCK',        // Christian Rock
  142: 'METAL',       // Merengue (repurposed)
  143: 'PAGODE',      // Salsa
  144: 'METAL',       // Thrash Metal
  145: 'POP',         // Anime
  146: 'ELETRONICA',  // Jpop
  147: 'ELETRONICA',  // Synthpop
};

/**
 * Normalize raw ID3 genre text to standardized genre code.
 * Handles both numeric ID3v1 codes and text genre names.
 * Also handles combined genres like "Rock; Metal" or "Pop/Rock".
 */
export function normalizeId3Genre(raw: string): string {
  if (!raw || raw.trim().length === 0) return 'OUTRO';

  let lower = raw.toLowerCase().replace(/[()]/g, '').trim();

  // Handle numeric ID3v1 genre codes
  const num = parseInt(lower);
  if (!isNaN(num) && lower === String(num)) {
    return ID3V1_GENRE_MAP[num] || 'OUTRO';
  }

  // Direct match
  if (ID3_GENRE_MAP[lower]) return ID3_GENRE_MAP[lower];

  // Handle combined genres: "Rock; Metal" → try each part
  const separators = /[;\\/|,&]/;
  if (separators.test(lower)) {
    const parts = lower.split(separators).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (ID3_GENRE_MAP[part]) return ID3_GENRE_MAP[part];
    }
  }

  // Partial match: check if any key is contained in the genre string
  for (const [key, value] of Object.entries(ID3_GENRE_MAP)) {
    if (lower.includes(key) && key.length >= 3) {
      return value;
    }
  }

  return 'OUTRO';
}

/**
 * Map normalized genre to energy level for smart scoring.
 */
export function genreToEnergy(genre: string): string {
  const map: Record<string, string> = {
    SERTANEJO: 'MEDIUM', PAGODE: 'MEDIUM', POP: 'HIGH', ELETRONICA: 'VERY_HIGH',
    MPB: 'LOW', ROCK: 'HIGH', FUNK: 'VERY_HIGH', GOSPEL: 'MEDIUM', FORRO: 'HIGH',
    'RAP/HIP-HOP': 'HIGH', REGGAETON: 'HIGH', 'R&B': 'MEDIUM', COUNTRY: 'MEDIUM',
    JAZZ: 'LOW', CLASSICA: 'LOW', INDIE: 'MEDIUM', METAL: 'VERY_HIGH',
    REGGAE: 'LOW', LATINA: 'HIGH', OUTRO: 'MEDIUM',
  };
  return map[genre] || 'MEDIUM';
}

/**
 * Perform genre-based file routing after download.
 * Moves the file to the appropriate subfolder based on ID3 genre.
 * Returns the subfolder name used, or null if routing was skipped.
 */
export async function routeFileByGenre(
  verifiedFile: string,
  sourceFolder: string,
  musicFolders: string[],
  logPrefix: string = '[DL]',
): Promise<string | null> {
  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
  if (!isElectron || !(window.electronAPI as any)?.moveFileToGenreFolder) return null;

  const { useRadioStore } = await import('@/store/radioStore');
  const { deezerConfig } = useRadioStore.getState();
  const routes = deezerConfig.genreRoutes || [];
  const defaultFolder = deezerConfig.genreDefaultFolder || 'Musicas';

  // Read ID3 genre
  let songGenre: string | null = null;
  try {
    if (window.electronAPI?.readId3Genre) {
      const id3Result = await window.electronAPI.readId3Genre({
        filePath: verifiedFile,
        musicFolders: [sourceFolder, ...musicFolders],
      });
      if (id3Result?.success && id3Result.genre) {
        songGenre = normalizeId3Genre(id3Result.genre);
      }
    }
  } catch { /* use null */ }

  const matchedRoute = songGenre
    ? routes.find(r => r.genre.toUpperCase() === songGenre!.toUpperCase())
    : null;
  const targetSubfolder = matchedRoute ? matchedRoute.folderName : defaultFolder;

  try {
    const moveResult = await (window.electronAPI as any).moveFileToGenreFolder({
      sourceFolder,
      fileName: verifiedFile,
      targetSubfolder,
    });
    if (moveResult?.success) {
      console.log(`${logPrefix} 📂 Roteado: ${verifiedFile} → ${targetSubfolder}/ (gênero: ${songGenre || 'padrão'})`);
      return targetSubfolder;
    }
  } catch (e) {
    console.warn(`${logPrefix} Genre routing failed (non-critical):`, e);
  }
  return null;
}
