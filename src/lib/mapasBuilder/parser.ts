/**
 * Mapas Template Parser
 * 
 * Reads .txt template files from C:\Playlist\pgm\Mapas
 * and parses them into structured MapaTemplate objects.
 */

import type { MapaTemplate, MapaTemplateLine } from './types';

/**
 * Detect day mapping from filename.
 * MAPA.txt → weekdays (Seg-Sex)
 * S_B.txt / SAB.txt → saturday
 * DOM*.txt → sunday
 */
export function detectDayMapping(filename: string): string {
  const name = filename.toUpperCase().replace(/\.TXT$/i, '');
  
  if (name.startsWith('DOM')) return 'sunday';
  if (name === 'S_B' || name === 'SAB' || name === 'SABADO' || name === 'SÁB') return 'saturday';
  if (name === 'MAPA' || name === 'SEG_SEX') return 'weekdays';
  
  // Specific days
  const dayMap: Record<string, string> = {
    'SEG': 'monday', 'TER': 'tuesday', 'QUA': 'wednesday',
    'QUI': 'thursday', 'SEX': 'friday',
  };
  if (dayMap[name]) return dayMap[name];
  
  return 'weekdays'; // default
}

/**
 * Parse a raw template text into structured lines.
 * Format: "HH:MM code1,code2,code3,..."
 */
export function parseTemplateText(text: string): MapaTemplateLine[] {
  const lines: MapaTemplateLine[] = [];
  
  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Match "HH:MM " followed by comma-separated codes
    const match = trimmed.match(/^(\d{2}:\d{2})\s+(.+)$/);
    if (!match) continue;
    
    const time = match[1];
    const codes = match[2]
      .split(',')
      .map(c => c.trim())
      .filter(Boolean);
    
    if (codes.length > 0) {
      lines.push({ time, codes });
    }
  }
  
  return lines;
}

/**
 * Parse a template file into a MapaTemplate object.
 */
export function parseTemplate(filename: string, content: string): MapaTemplate {
  return {
    filename,
    dayMapping: detectDayMapping(filename),
    lines: parseTemplateText(content),
  };
}

/**
 * Get which template to use for a given day of week.
 * 0=Sunday, 1=Monday, ..., 6=Saturday
 */
export function getTemplateForDay(
  templates: MapaTemplate[],
  dayOfWeek: number
): MapaTemplate | null {
  const dayNames: Record<number, string[]> = {
    0: ['sunday'],
    1: ['monday', 'weekdays'],
    2: ['tuesday', 'weekdays'],
    3: ['wednesday', 'weekdays'],
    4: ['thursday', 'weekdays'],
    5: ['friday', 'weekdays'],
    6: ['saturday'],
  };
  
  const acceptable = dayNames[dayOfWeek] || ['weekdays'];
  
  // Prefer specific day over generic weekdays
  for (const dayName of acceptable) {
    const found = templates.find(t => t.dayMapping === dayName);
    if (found) return found;
  }
  
  return templates[0] || null;
}
