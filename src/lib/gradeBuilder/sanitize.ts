/**
 * Sanitization functions for grade filenames and lines.
 * 
 * PRESERVES the REAL filename from disk as much as possible.
 * Only applies: accent removal, UPPERCASE, filter characters, and .MP3 normalization.
 * Does NOT remove/replace characters that may exist in the actual file on disk,
 * since files are already sanitized by the download service (sanitizeForDisk).
 */

/**
 * Light sanitization for grade line filenames.
 * Only removes accents, applies UPPERCASE, and removes user-configured filter characters.
 * Does NOT strip special chars or replace & — those are already handled by the download service.
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
  
  // Remove accents via NFD normalization
  result = result
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  
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
