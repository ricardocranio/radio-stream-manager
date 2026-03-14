/**
 * Vinheta / Jingle Filter
 * 
 * Detects non-music items (vinhetas, intercoms, jingles, station IDs)
 * that should NEVER be sent to Deemix for download.
 * Deemix is exclusively for radio-monitored songs.
 */

// Keywords that indicate a file is a vinheta/jingle, not a real song
const JINGLE_KEYWORDS = [
  'vinheta', 'vht', 'vhtn',
  'intercom', 'nossa intercom',
  'capturado', 'capturada',
  'jingle', 'spot', 'comercial',
  'identificação', 'identificacao',
  'chamada', 'prefixo',
  'cortina', 'abertura',
  'encerramento', 'passagem',
  'hora certa', 'horacerta',
  'institucional',
];

// Patterns in filenames that are clearly not songs
const NON_SONG_PATTERNS = [
  /^vht\d*/i,
  /^vhtn\d*/i,
  /^vinheta/i,
  /^intercom/i,
  /^spot[_\s]/i,
  /^jingle/i,
];

/**
 * Check if an artist/title/filename represents a vinheta, jingle, or
 * any non-music item that should NOT go to Deemix download.
 */
export function isVinhetaOrJingle(
  artist: string,
  title: string,
  filename?: string,
): boolean {
  const artistL = (artist || '').toLowerCase().trim();
  const titleL = (title || '').toLowerCase().trim();
  const filenameL = (filename || '').toLowerCase().trim();

  // Empty artist or title — not a real song
  if (!artistL || !titleL) return true;

  // Check keywords in artist or title
  for (const kw of JINGLE_KEYWORDS) {
    if (artistL === kw || titleL === kw) return true;
    if (artistL.includes(kw) && artistL.length < kw.length + 8) return true;
    if (titleL.includes(kw) && titleL.length < kw.length + 8) return true;
  }

  // Check non-song filename patterns
  const nameToCheck = filenameL || `${artistL} - ${titleL}`;
  for (const pattern of NON_SONG_PATTERNS) {
    if (pattern.test(nameToCheck)) return true;
  }

  // "NOSSA INTERCOM - CAPTURADO" pattern (exact or close)
  if (artistL.includes('intercom') || titleL.includes('capturado')) {
    return true;
  }

  return false;
}
