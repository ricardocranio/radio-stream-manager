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
 * Rename a physical file on disk to match a specific target grade name.
 * Used when aliases/corrections define the canonical filename that MUST be written to the grade.
 * 
 * SAFETY: Before renaming, reads ID3 tags to verify the target artist/title matches
 * the actual file content. If ID3 doesn't confirm, skip rename to protect library integrity.
 */
export async function ensureFileMatchesGradeName(
  currentFilename: string,
  targetFilename: string,
  musicFolders: string[],
  filterCharacters?: string[]
): Promise<string> {
  const sanitizedTarget = sanitizeGradeFilename(targetFilename, filterCharacters);
  const sanitizedCurrent = sanitizeGradeFilename(currentFilename || '', filterCharacters);

  if (!currentFilename) {
    return sanitizedTarget;
  }

  // Names already match — no rename needed
  if (sanitizedCurrent === sanitizedTarget) {
    return sanitizedTarget;
  }

  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
  if (!isElectron || !window.electronAPI?.renameMusicFile) {
    // Not in Electron — just return the canonical name for the grade
    return sanitizedTarget;
  }

  // === ID3 VALIDATION: Read actual tags before renaming ===
  // Extract target artist/title from the canonical filename pattern "Artist - Title.mp3"
  const targetBase = targetFilename.replace(/\.mp3$/i, '');
  const dashIdx = targetBase.indexOf(' - ');
  if (dashIdx > 0 && window.electronAPI?.readId3Genre) {
    const targetArtist = targetBase.substring(0, dashIdx).trim().toLowerCase();
    const targetTitle = targetBase.substring(dashIdx + 3).trim().toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\[.*?\]\s*/g, '').trim(); // strip suffixes for comparison

    try {
      const id3Result = await window.electronAPI.readId3Genre({
        filePath: currentFilename,
        musicFolders,
      });

      if (id3Result.success && (id3Result.artist || id3Result.title)) {
        const id3Artist = (id3Result.artist || '').toLowerCase().trim();
        const id3Title = (id3Result.title || '').toLowerCase().trim()
          .replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\[.*?\]\s*/g, '').trim();

        // Check if ID3 tags confirm the target identity (fuzzy: at least title or artist must match)
        const artistMatch = id3Artist.includes(targetArtist) || targetArtist.includes(id3Artist);
        const titleMatch = id3Title.includes(targetTitle) || targetTitle.includes(id3Title);

        if (!artistMatch && !titleMatch) {
          // ID3 tags don't confirm — this file is NOT the song the alias says it is
          // Don't rename, use the CURRENT filename in the grade to preserve library integrity
          console.warn(`[SANITIZE] ⛔ ID3 não confirma alias: arquivo="${currentFilename}" ID3="${id3Result.artist} - ${id3Result.title}" alvo="${targetBase}". Mantendo nome original.`);
          return sanitizedCurrent;
        }

        console.log(`[SANITIZE] ✅ ID3 confirma: "${id3Result.artist} - ${id3Result.title}" ≈ "${targetBase}"`);
      }
    } catch (err) {
      console.warn(`[SANITIZE] ⚠️ Não foi possível ler ID3 de "${currentFilename}":`, err);
      // Can't read ID3 — proceed with rename (alias takes precedence as configured by user)
    }
  }

  try {
    const result = await window.electronAPI.renameMusicFile({
      musicFolders,
      currentFilename,
      newFilename: sanitizedTarget,
    });

    if (result.success) {
      if (result.renamed) {
        console.log(`[SANITIZE] ✅ Canonical rename on disk: "${currentFilename}" → "${sanitizedTarget}"`);
      } else {
        console.log(`[SANITIZE] ℹ️ Canonical rename not needed: ${result.reason}`);
      }
    } else {
      console.warn(`[SANITIZE] ⚠️ Could not force canonical name "${sanitizedTarget}": ${result.reason || result.error}`);
    }
  } catch (err) {
    console.error(`[SANITIZE] ❌ Error forcing canonical name "${sanitizedTarget}":`, err);
  }

  return sanitizedTarget;
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
