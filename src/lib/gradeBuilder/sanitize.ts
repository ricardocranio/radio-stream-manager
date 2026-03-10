/**
 * Sanitization functions for grade filenames and lines.
 * 
 * CRITICAL: When a filename comes from the library match (real file on disk),
 * we must preserve it EXACTLY as-is (only uppercase). Replacing & with "e"
 * or removing characters would cause the Playlist Digital to not find the file.
 * 
 * Only apply minimal normalization: UPPERCASE + user filter characters.
 */

/**
 * Light sanitization for grade line filenames.
 * PRESERVES the real filename from disk — only applies:
 * 1. User-configured filter character removal (encoding artifacts)
 * 2. Space normalization
 * 3. Force UPPERCASE for radio automation compatibility
 * 
 * Does NOT replace & or remove accents/special chars, because
 * the filename must match what exists on disk exactly.
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
