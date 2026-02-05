/**
 * Sanitizes a filename for use in playlist/grade .txt files
 * - Removes accents (ç→c, á→a, etc.)
 * - Replaces & with "e"
 * - Removes parentheses but keeps content (ao vivo)→ao vivo
 * - Removes other special characters
 * - Normalizes spaces
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

/**
 * Remove accents from a string
 */
function removeAccents(str: string): string {
  return str.split('').map(char => accentMap[char] || char).join('');
}

/**
 * Sanitize a filename for playlist generation
 * @param filename - Original filename (e.g., "Propaganda - Jorge & Mateus.mp3")
 * @returns Sanitized filename (e.g., "Propaganda - Jorge e Mateus.mp3")
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return '';
  
  let result = filename;
  
  // Replace & with "e"
  result = result.replace(/&/g, 'e');
  
  // Replace "feat." and "ft." variations with " feat "
  result = result.replace(/\s*feat\.?\s*/gi, ' feat ');
  result = result.replace(/\s*ft\.?\s*/gi, ' feat ');
  
  // REMOVE parentheses AND their content completely: (Ao Vivo), (Acústico), etc.
  // These suffixes cause issues with radio automation systems
  result = result.replace(/\s*\([^)]*\)\s*/g, ' ');
  
  // REMOVE brackets AND their content completely: [Live], [Remix], etc.
  result = result.replace(/\s*\[[^\]]*\]\s*/g, ' ');
  
  // Remove accents BEFORE removing special characters
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
  
  // REMOVE parentheses AND their content completely
  result = result.replace(/\s*\([^)]*\)\s*/g, ' ');
  
  // REMOVE brackets AND their content completely
  result = result.replace(/\s*\[[^\]]*\]\s*/g, ' ');
  
  // Remove accents
  result = removeAccents(result);
  
  // Remove special characters
  result = result.replace(/[^a-zA-Z0-9\s\-]/g, '');
  
  // Normalize spaces
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Sanitize fixed content filename template
 * Ensures proper format: NOTICIA_DA_HORA_{HH}HORAS_{DIA}.mp3
 * @param template - Template with placeholders like {HH}, {DIA}
 * @param hour - Block hour
 * @param dayName - Full day name (SEGUNDA, TERCA, etc.)
 * @returns Processed filename
 */
export function processFixedContentTemplate(
  template: string,
  hour: number,
  dayName: string
): string {
  if (!template) return '';
  
  let result = template;
  
  // Replace {HH} with 2-digit hour
  result = result.replace(/\{HH\}/gi, hour.toString().padStart(2, '0'));
  
  // Replace {DIA} with full day name
  result = result.replace(/\{DIA\}/gi, dayName);
  
  // Replace {ED} or {1}, {2}, etc. for edition numbers (handled separately)
  result = result.replace(/\{ED\}/gi, '01');
  
  // Remove accents
  result = removeAccents(result);
  
  // Remove special characters except: letters, numbers, underscores, dot
  result = result.replace(/[^a-zA-Z0-9_.-]/g, '');
  
  // Ensure .mp3 extension
  if (!result.toLowerCase().endsWith('.mp3')) {
    result = result + '.mp3';
  }
  
  return result.toUpperCase();
}
