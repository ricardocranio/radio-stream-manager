/**
 * VHT (Vinheta) Dynamic Resolver
 * 
 * Replaces literal 'vht' codes in grade lines with random audio files
 * from a configured vinhetas folder. Cycles through all files without
 * repetition until all have been used, then resets the cycle.
 */

import { sanitizeGradeFilename } from './sanitize';
import { getIsElectronEnv } from './constants';

/** Tracks used vinhetas across a single grade generation cycle */
let usedVinhetas: Set<string> = new Set();
let availableVinhetas: string[] = [];
let vinhetasLoaded = false;

/**
 * Reset the VHT resolver state (call at start of each grade generation)
 */
export function resetVhtResolver() {
  usedVinhetas.clear();
  availableVinhetas = [];
  vinhetasLoaded = false;
}

/**
 * Load vinheta files from the configured folder
 */
async function loadVinhetas(vinhetasFolder: string): Promise<string[]> {
  if (!getIsElectronEnv() || !window.electronAPI?.listFolderFiles) return [];

  try {
    const result = await window.electronAPI.listFolderFiles({
      folder: vinhetasFolder,
      extension: '.mp3',
    });

    if (result.success && result.files.length > 0) {
      console.log(`[VHT] 📂 ${result.files.length} vinhetas encontradas em ${vinhetasFolder}`);
      return result.files.map(f => f.name);
    }
  } catch (err) {
    console.warn(`[VHT] ⚠️ Erro ao listar vinhetas em ${vinhetasFolder}:`, err);
  }
  return [];
}

/**
 * Pick a random vinheta filename, avoiding repetition until all are used.
 * When all vinhetas have been used, resets the cycle.
 */
function pickRandomVinheta(allFiles: string[], filterCharacters?: string[]): string {
  if (allFiles.length === 0) return 'vht';

  // If all have been used, reset the cycle
  if (usedVinhetas.size >= allFiles.length) {
    console.log(`[VHT] 🔄 Ciclo completo (${allFiles.length} vinhetas), reiniciando rotação`);
    usedVinhetas.clear();
  }

  // Filter to only unused files
  const unused = allFiles.filter(f => !usedVinhetas.has(f.toUpperCase()));
  if (unused.length === 0) {
    usedVinhetas.clear();
    return pickRandomVinheta(allFiles, filterCharacters);
  }

  // Random pick from unused
  const picked = unused[Math.floor(Math.random() * unused.length)];
  usedVinhetas.add(picked.toUpperCase());

  // Sanitize the filename for the grade
  const sanitized = sanitizeGradeFilename(picked, filterCharacters);
  return `"${sanitized}"`;
}

/**
 * Resolve all 'vht' occurrences in a grade line with random vinheta files.
 * Must be called AFTER the line is fully constructed.
 * 
 * @param line - The grade line with literal 'vht' placeholders
 * @param vinhetasFolder - Path to the vinhetas folder
 * @param filterCharacters - Characters to filter from filenames
 * @returns The line with 'vht' replaced by random vinheta filenames
 */
export async function resolveVhtInLine(
  line: string,
  vinhetasFolder: string,
  filterCharacters?: string[]
): Promise<string> {
  if (!vinhetasFolder || !line.includes('vht')) return line;

  // Load vinhetas once per generation cycle
  if (!vinhetasLoaded) {
    availableVinhetas = await loadVinhetas(vinhetasFolder);
    vinhetasLoaded = true;
  }

  if (availableVinhetas.length === 0) {
    console.warn('[VHT] ⚠️ Nenhuma vinheta encontrada, mantendo código literal "vht"');
    return line;
  }

  // Replace each standalone 'vht' (not inside quotes) with a random vinheta
  // Pattern: match 'vht' that is preceded by comma and followed by comma or end
  const result = line.replace(/(?<=,)vht(?=,|$)/g, () => {
    return pickRandomVinheta(availableVinhetas, filterCharacters);
  });

  // Also handle 'vht' at the start of content (after the ID block)
  return result.replace(/(?<=\) )vht(?=,)/g, () => {
    return pickRandomVinheta(availableVinhetas, filterCharacters);
  });
}
