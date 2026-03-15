/**
 * Sanitization functions for grade filenames and lines.
 * 
 * RULE: The grade .TXT must NEVER contain accents, cedilla, or special characters.
 * The physical file on disk must be renamed FIRST, then the clean name goes into the grade.
 * 
 * Sequence: Validate → Rename on disk → Write clean name to grade
 */

/**
 * Remove accents using Unicode NFD normalization
 */
function removeAccents(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Check if a filename contains accents, cedilla, or special characters
 * that need to be cleaned before going into the grade.
 */
export function filenameNeedsSanitization(filename: string): boolean {
  if (!filename) return false;
  // Check for accented characters (NFD decomposable), &, or other special chars
  const cleaned = removeAccents(filename).replace(/&/g, 'e');
  return cleaned !== filename || /[^a-zA-Z0-9\s\-._()]/g.test(removeAccents(filename));
}

/**
 * Full sanitization for grade line filenames.
 * Removes accents, replaces & with "e", strips special characters.
 * Forces UPPERCASE for radio automation compatibility.
 * 
 * The physical file on disk MUST be renamed to match this output
 * BEFORE writing to the grade .TXT file.
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
  
  // Replace & with "e" (Jorge & Mateus → Jorge e Mateus)
  result = result.replace(/&/g, 'e');
  
  // Remove accents (ação → acao, canção → cancao)
  result = removeAccents(result);
  
  // Remove special characters except: letters, numbers, spaces, dash, dot, underscore, parens
  result = result.replace(/[^a-zA-Z0-9\s\-._()]/g, '');
  
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
 * Return the canonical grade filename for an alias correction.
 * NO disk rename — just returns the sanitized corrected name for the grade .TXT.
 * The alias name is the "truth" configured by the user, so we trust it directly.
 */
export function ensureFileMatchesGradeName(
  _currentFilename: string,
  targetFilename: string,
  _musicFolders: string[],
  filterCharacters?: string[]
): string {
  return sanitizeGradeFilename(targetFilename, filterCharacters);
}

/**
 * Rename a physical file on disk to match the sanitized grade name.
 * MUST be called BEFORE writing the clean name to the grade .TXT.
 * Returns the sanitized filename (whether rename happened or not).
 */
export async function ensureFileRenamedOnDisk(
  originalFilename: string,
  musicFolders: string[],
  filterCharacters?: string[]
): Promise<string> {
  const sanitized = sanitizeGradeFilename(originalFilename, filterCharacters);
  
  // If nothing changed, no rename needed
  if (sanitized === originalFilename.toUpperCase()) {
    return sanitized;
  }
  
  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
  if (!isElectron || !window.electronAPI?.renameMusicFile) {
    console.warn('[SANITIZE] Cannot rename file — not in Electron environment');
    return sanitized;
  }
  
  try {
    const result = await window.electronAPI.renameMusicFile({
      musicFolders,
      currentFilename: originalFilename,
      newFilename: sanitized,
    });
    
    if (result.success) {
      if (result.renamed) {
        console.log(`[SANITIZE] ✅ Renamed on disk: "${originalFilename}" → "${sanitized}"`);
      } else {
        console.log(`[SANITIZE] ℹ️ No rename needed: ${result.reason}`);
      }
    } else {
      console.warn(`[SANITIZE] ⚠️ Could not rename "${originalFilename}": ${result.reason || result.error}`);
    }
  } catch (err) {
    console.error(`[SANITIZE] ❌ Error renaming "${originalFilename}":`, err);
  }
  
  return sanitized;
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
