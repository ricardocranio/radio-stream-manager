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
  
  // Replace "feat." and "ft." variations
  result = result.replace(/\s*feat\.?\s*/gi, ' feat ');
  result = result.replace(/\s*ft\.?\s*/gi, ' feat ');
  
  // Remove parentheses but keep content: (Ao Vivo) → Ao Vivo
  result = result.replace(/\(([^)]+)\)/g, '$1');
  
  // Remove brackets but keep content: [Ao Vivo] → Ao Vivo
  result = result.replace(/\[([^\]]+)\]/g, '$1');
  
  // Remove accents
  result = removeAccents(result);
  
  // Remove remaining special characters except: letters, numbers, spaces, dash, dot
  // Specifically remove: ´ ` ~ ' " , ; : ! ? @ # $ % ^ * + = | \ / < >
  result = result.replace(/[^a-zA-Z0-9\s\-.]/g, '');
  
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
