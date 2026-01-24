/**
 * Cleans and validates song metadata before adding to missing list
 * Removes: addresses, HTML entities, time indicators, "live" tags, station info
 */

// Patterns that indicate INVALID data (not a song)
const INVALID_PATTERNS = [
  // Addresses
  /^Rua\s/i,
  /^Av\.\s/i,
  /^Avenida\s/i,
  /^SIG,?\s/i,
  /^SQN\s/i,
  /CEP[:\s]*\d/i,
  /\d{5}[-\s]?\d{3}/,  // Brazilian ZIP code
  /,\s*(DF|SP|RJ|MG|BA|PR|RS|SC|GO|PE|CE|PA|MA|MS|MT|ES|PB|RN|AL|PI|SE|AM|RO|AC|AP|RR|TO),?\s*Brasil?/i,
  /Jardim\s+d[oe]s?\s+\w+/i,
  /Bairro\s+\w+/i,
  /quadra\s+\d+/i,
  /lote\s+\d+/i,
  
  // Station info patterns
  /^Rádio\s+\w+\s+FM/i,
  /^\d+\.\d+\s*FM/i,
  /FM\s*-\s*\w+\s+\d+\.\d+/i,
  /\d+\.\d+\s+live$/i,
  
  // Generic invalid
  /^https?:\/\//i,
  /^www\./i,
  /^\s*$/,
];

// Time indicator patterns to REMOVE from valid songs
const TIME_PATTERNS = [
  /\s*\d+\s*min\s*ago\s*$/i,
  /\s*\d+\s*h\s*ago\s*$/i,
  /\s*\d+\s*hour[s]?\s*ago\s*$/i,
  /\s*\d+\s*minute[s]?\s*ago\s*$/i,
  /\s*há\s*\d+\s*(min|hora|h)\s*$/i,
  /\s*agora\s*$/i,
  /\s*now\s*$/i,
  /\s*live\s*$/i,
  /\s*LIVE\s*$/,
  /\s*ao\s*vivo\s*$/i,
];

// HTML entities to decode
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#x27;': "'",
  '&#x2F;': '/',
};

/**
 * Decode HTML entities in a string
 */
function decodeHTMLEntities(str: string): string {
  let result = str;
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.replace(new RegExp(entity, 'gi'), char);
  }
  return result;
}

/**
 * Check if the string looks like a valid song (artist - title format)
 */
function looksLikeSong(str: string): boolean {
  // Must have a separator (- or by)
  const hasSeparator = /\s+-\s+/.test(str) || /\s+by\s+/i.test(str);
  
  // Should have reasonable length
  const hasReasonableLength = str.length >= 5 && str.length <= 200;
  
  // Should not match invalid patterns
  const matchesInvalid = INVALID_PATTERNS.some(pattern => pattern.test(str));
  
  return hasSeparator && hasReasonableLength && !matchesInvalid;
}

/**
 * Clean time indicators and tags from song string
 */
function removeTimeIndicators(str: string): string {
  let result = str;
  for (const pattern of TIME_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.trim();
}

/**
 * Parse and clean artist/title from a raw string
 * Expected format: "Artist - Title" or "Title - Artist"
 */
export function parseArtistTitle(raw: string): { artist: string; title: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  
  // Decode HTML entities first
  let cleaned = decodeHTMLEntities(raw);
  
  // Remove time indicators
  cleaned = removeTimeIndicators(cleaned);
  
  // Check if it looks like a song
  if (!looksLikeSong(cleaned)) {
    console.log('[CLEAN] Rejected invalid song data:', raw.substring(0, 50));
    return null;
  }
  
  // Split by " - " separator
  const parts = cleaned.split(/\s+-\s+/);
  if (parts.length < 2) {
    // Try "by" separator
    const byParts = cleaned.split(/\s+by\s+/i);
    if (byParts.length >= 2) {
      return {
        title: byParts[0].trim(),
        artist: byParts.slice(1).join(' ').trim()
      };
    }
    return null;
  }
  
  // Standard format: Artist - Title
  const artist = parts[0].trim();
  const title = parts.slice(1).join(' - ').trim();
  
  // Final validation
  if (!artist || !title || artist.length < 2 || title.length < 2) {
    return null;
  }
  
  return { artist, title };
}

/**
 * Clean individual artist name
 */
export function cleanArtistName(artist: string): string {
  if (!artist) return '';
  
  let result = decodeHTMLEntities(artist);
  result = removeTimeIndicators(result);
  
  // Remove common suffixes/prefixes
  result = result.replace(/\s*feat\.?\s*/gi, ' feat ');
  result = result.replace(/\s*ft\.?\s*/gi, ' feat ');
  result = result.replace(/\s*&\s*/g, ' e ');
  
  // Normalize spaces
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Clean individual song title
 */
export function cleanSongTitle(title: string): string {
  if (!title) return '';
  
  let result = decodeHTMLEntities(title);
  result = removeTimeIndicators(result);
  
  // Normalize spaces
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Validate if artist/title pair is a valid song entry
 */
export function isValidSongEntry(artist: string, title: string): boolean {
  if (!artist || !title) return false;
  
  const combined = `${artist} - ${title}`;
  
  // Check against invalid patterns
  if (INVALID_PATTERNS.some(pattern => pattern.test(artist) || pattern.test(title) || pattern.test(combined))) {
    return false;
  }
  
  // Minimum length check
  if (artist.length < 2 || title.length < 2) return false;
  
  // Maximum length check (prevent garbage data)
  if (artist.length > 100 || title.length > 150) return false;
  
  return true;
}

/**
 * Full clean and validate pipeline for song data
 */
export function cleanAndValidateSong(artist: string, title: string): { artist: string; title: string } | null {
  const cleanedArtist = cleanArtistName(artist);
  const cleanedTitle = cleanSongTitle(title);
  
  if (!isValidSongEntry(cleanedArtist, cleanedTitle)) {
    console.log('[CLEAN] Rejected:', { artist, title });
    return null;
  }
  
  return { artist: cleanedArtist, title: cleanedTitle };
}
