/**
 * Sanitizes a filename for use in playlist/grade .txt files
 * - Removes accents (ç→c, á→a, etc.)
 * - Replaces & with "e"
 * - Removes parentheses but keeps content (ao vivo)→ao vivo
 * - Removes other special characters
 * - Normalizes spaces
 * - Supports dynamic placeholders: {HH} for hour, {DIA} for weekday
 */

// Map of accented characters to their non-accented equivalents
const accentMap: Record<string, string> = {
  'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a',
  'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
  'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
  'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
  'ç': 'c',
  'ñ': 'n',
  'Á': 'A', 'À': 'A', 'Ã': 'A', 'Â': 'A', 'Ä': 'A',
  'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
  'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
  'Ó': 'O', 'Ò': 'O', 'Õ': 'O', 'Ô': 'O', 'Ö': 'O',
  'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
  'Ç': 'C',
  'Ñ': 'N',
};

// Weekday names for {DIA} placeholder
const weekdayNames = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

/**
 * Remove accents from a string
 */
function removeAccents(str: string): string {
  return str.split('').map(char => accentMap[char] || char).join('');
}

/**
 * Replace dynamic placeholders in filename
 * @param filename - Original filename with placeholders
 * @param hour - Hour for {HH} placeholder (optional, uses current hour if not provided)
 * @returns Filename with placeholders replaced
 */
export function replacePlaceholders(filename: string, hour?: number): string {
  if (!filename) return '';
  
  let result = filename;
  
  // Get current date/time
  const now = new Date();
  const currentHour = hour !== undefined ? hour : now.getHours();
  const currentDay = now.getDay();
  
  // Replace {HH} with hour (2 digits)
  result = result.replace(/\{HH\}/gi, currentHour.toString().padStart(2, '0'));
  
  // Replace {DIA} with weekday name
  result = result.replace(/\{DIA\}/gi, weekdayNames[currentDay]);
  
  return result;
}

/**
 * Sanitize a filename for playlist generation
 * @param filename - Original filename (e.g., "Propaganda - Jorge & Mateus.mp3")
 * @param hour - Optional hour for {HH} placeholder
 * @returns Sanitized filename (e.g., "Propaganda - Jorge e Mateus.mp3")
 */
export function sanitizeFilename(filename: string, hour?: number): string {
  if (!filename) return '';
  
  let result = filename;
  
  // First, replace dynamic placeholders
  result = replacePlaceholders(result, hour);
  
  // Replace & with "e"
  result = result.replace(/&/g, 'e');
  
  // Replace "feat." and "ft." variations
  result = result.replace(/\s*feat\.?\s*/gi, ' feat ');
  result = result.replace(/\s*ft\.?\s*/gi, ' feat ');
  
  // Remove parentheses but keep content: (Ao Vivo) → Ao Vivo
  result = result.replace(/\(([^)]+)\)/g, '$1');
  
  // Remove brackets but keep content: [Ao Vivo] → Ao Vivo
  result = result.replace(/\[([^\]]+)\]/g, '$1');
  
  // Remove accents
  result = removeAccents(result);
  
  // Remove remaining special characters except: letters, numbers, spaces, dash, dot, underscore
  // Specifically remove: ´ ` ~ ' " , ; : ! ? @ # $ % ^ * + = | \ / < >
  result = result.replace(/[^a-zA-Z0-9\s\-._]/g, '');
  
  // Ensure proper "Artist - Title" format (single dash with spaces)
  result = result.replace(/\s*-\s*/g, ' - ');
  
  // Normalize multiple spaces to single space
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Sanitize a filename for fixed content with dynamic placeholders
 * This preserves placeholders until generation time
 * @param filename - Original filename with placeholders
 * @param hour - Hour for the block
 * @returns Sanitized filename with placeholders replaced
 */
export function sanitizeFixedContentFilename(filename: string, hour: number): string {
  // Replace placeholders first, then sanitize
  return sanitizeFilename(filename, hour);
}

/**
 * Sanitize artist name for display/comparison
 * @param artist - Original artist name
 * @returns Sanitized artist name
 */
export function sanitizeArtistName(artist: string): string {
  if (!artist) return '';
  
  let result = artist;
  
  // Replace & with "e"
  result = result.replace(/&/g, 'e');
  
  // Remove accents
  result = removeAccents(result);
  
  // Remove special characters
  result = result.replace(/[^a-zA-Z0-9\s\-]/g, '');
  
  // Normalize spaces
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Sanitize song title for display/comparison
 * @param title - Original title
 * @returns Sanitized title
 */
export function sanitizeSongTitle(title: string): string {
  if (!title) return '';
  
  let result = title;
  
  // Remove parentheses content markers but keep text
  result = result.replace(/\(([^)]+)\)/g, '$1');
  
  // Remove accents
  result = removeAccents(result);
  
  // Remove special characters
  result = result.replace(/[^a-zA-Z0-9\s\-]/g, '');
  
  // Normalize spaces
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Normalize song info for comparison and deduplication
 * @param artist - Artist name
 * @param title - Song title
 * @returns Normalized key for comparison
 */
export function normalizeSongKey(artist: string, title: string): string {
  const normalizedArtist = sanitizeArtistName(artist).toLowerCase();
  const normalizedTitle = sanitizeSongTitle(title).toLowerCase();
  return `${normalizedArtist}-${normalizedTitle}`;
}
