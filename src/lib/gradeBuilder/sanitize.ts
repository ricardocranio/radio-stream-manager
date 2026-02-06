/**
 * Sanitization functions for grade filenames and lines.
 * 
 * PRESERVES parentheses and brackets (e.g., "(Ao Vivo)", "[Remix]") because
 * these are part of the actual filename on disk returned by library matching.
 * Only removes accents, &→e, special chars, forces UPPERCASE, ensures .MP3.
 */

/**
 * Light sanitization for grade line filenames.
 * Also removes any user-configured filter characters.
 */
export function sanitizeGradeFilename(filename: string, filterCharacters?: string[]): string {
  if (!filename) return '';
  
  let result = filename;
  
  // Remove user-configured filter characters first (encoding artifacts, etc.)
  if (filterCharacters && filterCharacters.length > 0) {
    for (const char of filterCharacters) {
      if (char) {
        const escaped = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'g'), '');
      }
    }
  }
  
  // Replace & with "e"
  result = result.replace(/&/g, 'e');
  
  // Remove accents via NFD normalization
  result = result
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  
  // Remove special characters EXCEPT: letters, numbers, spaces, dash, dot, underscore, parens, brackets
  result = result.replace(/[^a-zA-Z0-9\s\-._()[\]]/g, '');
  
  // Normalize multiple spaces to single space
  result = result.replace(/\s+/g, ' ').trim();
  
  // Clean up space before extension
  result = result.replace(/\s+\./g, '.');
  
  // Remove any double extensions
  result = result.replace(/\.mp3\.mp3/gi, '.mp3');
  
  // Force UPPERCASE for radio automation
  result = result.toUpperCase();
  
  return result;
}

/**
 * Sanitize all quoted filenames in a grade line for radio automation compatibility.
 */
export function sanitizeGradeLine(line: string, filterCharacters?: string[]): string {
  return line.replace(/"([^"]+)"/g, (_match, filename: string) => {
    return `"${sanitizeGradeFilename(filename, filterCharacters)}"`;
  });
}

/**
 * Create a bound sanitizeGradeLine function with pre-configured filter characters.
 */
export function createLineSanitizer(filterCharacters?: string[]) {
  return (line: string) => sanitizeGradeLine(line, filterCharacters);
}
