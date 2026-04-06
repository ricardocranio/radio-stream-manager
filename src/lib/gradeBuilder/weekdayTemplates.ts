/**
 * Weekday Template Block Generators
 * 
 * Fixed templates for weekday (seg-sex) blocks that mix
 * fixed content audio files with monitored station songs.
 * 
 * Each function returns a BlockResult with the pre-defined template
 * and resolved monitoring songs from specific stations.
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import type { SongEntry, BlockResult, BlockLogItem, BlockStats, GradeContext } from './types';
import type { WeekDay } from '@/types/radio';
import { FULL_DAY_NAMES_BY_INDEX } from './constants';

// ========== Helpers ==========

/** Get full day name for the target day or current PC day */
function getDayName(targetDay?: WeekDay): string {
  if (targetDay) {
    const map: Record<WeekDay, string> = {
      dom: 'DOMINGO', seg: 'SEGUNDA', ter: 'TERCA',
      qua: 'QUARTA', qui: 'QUINTA', sex: 'SEXTA', sab: 'SÁBADO',
    };
    return map[targetDay] || 'SEGUNDA';
  }
  return FULL_DAY_NAMES_BY_INDEX[new Date().getDay()];
}

/**
 * Pick a real monitored song from a specific station's pool.
 * Checks library, respects anti-repetition, returns quoted filename.
 * Falls back to coringa code if nothing available.
 */
async function pickMonitoredSong(
  stationName: string,
  songsByStation: Record<string, SongEntry[]>,
  ctx: GradeContext,
  timeStr: string,
  isFullDay: boolean,
  usedKeys: Set<string>,
  usedArtists: Set<string>,
  logs: BlockLogItem[],
  coringaCode: string,
): Promise<string> {
  // Try exact match first, then case-insensitive
  let pool = songsByStation[stationName];
  if (!pool || pool.length === 0) {
    const normTarget = stationName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [key, songs] of Object.entries(songsByStation)) {
      const normKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normKey.includes(normTarget) || normTarget.includes(normKey)) {
        pool = songs;
        break;
      }
    }
  }

  if (!pool || pool.length === 0) {
    logs.push({ blockTime: timeStr, type: 'substituted', title: coringaCode, artist: 'CORINGA', station: stationName, reason: `Pool ${stationName} vazio` });
    return coringaCode;
  }

  // Shuffle for variety
  const shuffled = [...pool].sort(() => Math.random() - 0.5);

  for (const candidate of shuffled) {
    const key = `${candidate.title.toLowerCase().trim()}-${candidate.artist.toLowerCase().trim()}`;
    const normArtist = candidate.artist.toLowerCase().trim();
    if (usedKeys.has(key) || usedArtists.has(normArtist)) continue;
    if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) continue;

    const libResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
    if (libResult.exists) {
      const fname = libResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
      usedKeys.add(key);
      usedArtists.add(normArtist);
      ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);
      logs.push({ blockTime: timeStr, type: 'used', title: candidate.title, artist: candidate.artist, station: stationName, reason: `Monitoramento ${stationName}` });
      return `"${fname}"`;
    }
  }

  logs.push({ blockTime: timeStr, type: 'substituted', title: coringaCode, artist: 'CORINGA', station: stationName, reason: `Nenhuma música de ${stationName} na biblioteca` });
  return coringaCode;
}

/** Pick a "rom" (romantic) song from the Românticas folder or genre DB */
async function pickRomanticSong(
  ctx: GradeContext,
  timeStr: string,
  isFullDay: boolean,
  usedKeys: Set<string>,
  usedArtists: Set<string>,
  logs: BlockLogItem[],
): Promise<string> {
  // Try genre-based search
  try {
    const { findSongByGenre } = await import('./specialPrograms');
    const result = await findSongByGenre(
      ['Romântico', 'ROMANTICO', 'Romantic'],
      timeStr, usedKeys, usedArtists, ctx, isFullDay,
    );
    if (result) {
      usedKeys.add(`${result.title.toLowerCase()}-${result.artist.toLowerCase()}`);
      usedArtists.add(result.artist.toLowerCase().trim());
      logs.push({ blockTime: timeStr, type: 'used', title: result.title, artist: result.artist, station: 'ROMÂNTICO', reason: 'Música romântica por gênero' });
      return `"${result.filename}"`;
    }
  } catch { /* fallback */ }

  return 'rom'; // coringa romántico
}

/** Pick a monitoring song cycling through the active sequence's stations */
async function pickMixedMonitoredSong(
  songsByStation: Record<string, SongEntry[]>,
  ctx: GradeContext,
  timeStr: string,
  isFullDay: boolean,
  usedKeys: Set<string>,
  usedArtists: Set<string>,
  logs: BlockLogItem[],
  coringaCode: string,
  stationIndex: { current: number },
): Promise<string> {
  // Use sequence-derived stations from context, or fallback
  const stations = (ctx.sequenceStations && ctx.sequenceStations.length > 0)
    ? ctx.sequenceStations
    : ['BH FM', 'Rádio Globo RJ', 'Band FM', 'Clube FM'];
  
  // Cycle through stations from the active sequence
  for (let attempt = 0; attempt < stations.length; attempt++) {
    const stationName = stations[stationIndex.current % stations.length];
    stationIndex.current++;
    const result = await pickMonitoredSong(stationName, songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    if (result !== coringaCode) return result;
  }
  stationIndex.current++;
  return coringaCode;
}

// ========== Template Generators ==========

/**
 * Sintonia Total blocks (09:00-10:30 weekdays)
 */
export async function generateSintoniaTotalBlock(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = getDayName(targetDay);
  const logs: BlockLogItem[] = [];
  const usedKeys = new Set<string>();
  const usedArtists = new Set<string>();
  const coringaCode = ctx.coringaCode;

  // Map time to template
  let line: string;

  if (hour === 9 && minute === 0) {
    const mon1 = await pickMixedMonitoredSong(songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    const mon2 = await pickMixedMonitoredSong(songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    line = `${timeStr} (ID=SINTONIA TOTAL) vht,"NOTICIA_DA_HORA_09HORAS_${dayName}.mp3","Sintonia Total _ bloco 01.mp3","HOROSCOPO_DO_DIA_EDICAO01_${dayName}.mp3",vht,"Sintonia Total _ bloco 02.mp3",vht,${mon1},vht,${mon2},vht`;
  } else if (hour === 9 && minute === 30) {
    const mon1 = await pickMixedMonitoredSong(songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    const mon2 = await pickMixedMonitoredSong(songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    line = `${timeStr} (ID=SINTONIA TOTAL) vht,"FIQUE_SABENDO_EDICAO01_${dayName}.mp3","Sintonia Total _ bloco 03.mp3","HOROSCOPO_DO_DIA_EDICAO02_${dayName}.mp3",vht,"Sintonia Total _ bloco 04.mp3",vht,${mon1},vht,${mon2},vht`;
  } else if (hour === 10 && minute === 0) {
    const mon1 = await pickMixedMonitoredSong(songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    const mon2 = await pickMixedMonitoredSong(songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    line = `${timeStr} (ID=SINTONIA TOTAL) vht,"NOTICIA_DA_HORA_10HORAS_${dayName}.mp3","Sintonia Total _ bloco 05.mp3","HOROSCOPO_DO_DIA_EDICAO03_${dayName}.mp3",vht,"Sintonia Total _ bloco 06.mp3",vht,${mon1},vht,${mon2},vht`;
  } else {
    // 10:30
    const mon1 = await pickMixedMonitoredSong(songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    const mon2 = await pickMixedMonitoredSong(songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    line = `${timeStr} (ID=SINTONIA TOTAL) vht,"FIQUE_SABENDO_EDICAO02_${dayName}.mp3","Sintonia Total _ bloco 07.mp3","HOROSCOPO_DO_DIA_EDICAO04_${dayName}.mp3",vht,"Sintonia Total _ bloco 08.mp3",vht,${mon1},vht,${mon2},vht`;
  }

  logs.push({ blockTime: timeStr, type: 'fixed', title: 'Sintonia Total', artist: `Bloco ${timeStr}`, station: 'FIXO', reason: 'Template Sintonia Total com monitoramento' });
  return { line: ctx.sanitizeGradeLine(line), logs };
}

/**
 * Painel Flashback blocks (12:00-12:30 weekdays)
 */
export async function generatePainelFlashbackBlock(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = getDayName(targetDay);
  const logs: BlockLogItem[] = [];
  let line: string;

  if (minute === 0) {
    line = `${timeStr} (ID=PAINEL FLASHBACK) vht,"NOTICIA_DA_HORA_12HORAS_${dayName}.mp3","painel flashback _ bloco 01.mp3",vht,"AS_ULTIMAS_DO_ESPORTE_EDICAO01_${dayName}.mp3","painel flashback _ bloco 02.mp3",vht`;
  } else {
    line = `${timeStr} (ID=PAINEL FLASHBACK) vht,"AS_ULTIMAS_DO_ESPORTE_EDICAO02_${dayName}.mp3","painel flashback _ bloco 01.mp3",vht,"FATOS_E_BOATOS_EDICAO01_${dayName}.mp3",vht,"painel flashback _ bloco 02.mp3",vht`;
  }

  logs.push({ blockTime: timeStr, type: 'fixed', title: 'Painel Flashback', artist: `Bloco ${timeStr}`, station: 'FIXO', reason: 'Template Painel Flashback' });
  return { line: ctx.sanitizeGradeLine(line), logs };
}

/**
 * Top 10 / Papo Sério blocks (13:00-13:30 weekdays)
 */
export async function generateTop10PapoSerioBlock(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = getDayName(targetDay);
  const logs: BlockLogItem[] = [];
  const usedKeys = new Set<string>();
  const usedArtists = new Set<string>();
  const coringaCode = ctx.coringaCode;
  let line: string;

  if (minute === 0) {
    line = `${timeStr} (ID=TOP 10) vht,"NOTICIA_DA_HORA_13HORAS_${dayName}.mp3","Top 10 _ bloco 01.mp3",vht,"PAPO_SERIO_${dayName}.mp3","Top 10 _ bloco 02.mp3"`;
  } else {
    // 13:30
    const mon1 = await pickMixedMonitoredSong(songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    const mon2 = await pickMixedMonitoredSong(songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    line = `${timeStr} (ID=TOP 10) vht,"Top 10 _ bloco 03.mp3",vht,"CURIOSIDADES_${dayName}.mp3",${mon1},vht,${mon2},vht`;
  }

  logs.push({ blockTime: timeStr, type: 'fixed', title: 'Top 10 / Papo Sério', artist: `Bloco ${timeStr}`, station: 'FIXO', reason: 'Template Top 10 com conteúdo fixo' });
  return { line: ctx.sanitizeGradeLine(line), logs };
}

/**
 * Intensidade / Notícia em Foco blocks (17:00-17:30 weekdays)
 */
export async function generateIntensidadeBlock(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = getDayName(targetDay);
  const logs: BlockLogItem[] = [];
  let line: string;

  if (minute === 0) {
    line = `${timeStr} (ID=INTENSIDADE) vht,"NOTICIA_DA_HORA_17HORAS_${dayName}.mp3","intensidade _ bloco 01.mp3","noticia em foco _ bloco 01.mp3",vht,"intensidade _ bloco 02.mp3",vht,"noticia em foco _ bloco 02.mp3"`;
  } else {
    line = `${timeStr} (ID=INTENSIDADE) vht,"noticia em foco _ bloco 03.mp3",vht,"intensidade _ bloco 03.mp3",vht,"noticia em foco _ bloco 04.mp3"`;
  }

  logs.push({ blockTime: timeStr, type: 'fixed', title: 'Intensidade / Notícia em Foco', artist: `Bloco ${timeStr}`, station: 'FIXO', reason: 'Template Intensidade' });
  return { line: ctx.sanitizeGradeLine(line), logs };
}

/**
 * Radar De Notícias block (18:00 weekdays)
 * Uses station-specific monitoring songs.
 */
export async function generateRadarNoticiasBlock(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const usedKeys = new Set<string>();
  const usedArtists = new Set<string>();
  const coringaCode = ctx.coringaCode;

  const monBH = await pickMonitoredSong('BH FM', songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
  const monGlobo = await pickMonitoredSong('Rádio Globo RJ', songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
  const monDisney = await pickMonitoredSong('Disney FM', songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
  const monMix = await pickMonitoredSong('Mix FM', songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);

  const line = `${timeStr} (ID=RADAR NOTICIAS) vht,"Radar De Noticias _ bloco 01.mp3",${monBH},vht,"Radar De Noticias _ bloco 02.mp3",${monGlobo},vht,"Radar De Noticias _ bloco 03.mp3",vht,${monDisney},vht,"Radar De Noticias _ bloco 04.mp3",vht,${monMix}`;

  logs.push({ blockTime: timeStr, type: 'fixed', title: 'Radar De Notícias', artist: `Bloco ${timeStr}`, station: 'FIXO', reason: 'Template Radar de Notícias com monitoramento multi-estação' });
  return { line: ctx.sanitizeGradeLine(line), logs };
}

/**
 * TOP 10 MIX + Esporte block (18:30 weekdays)
 */
export async function generateTop10MixEsporteBlock(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = getDayName(targetDay);
  const logs: BlockLogItem[] = [];

  const line = `${timeStr} (ID=TOP10 MIX) vht,"NOTICIA_DA_HORA_18HORAS_${dayName}.mp3","TOP_10_MIX_BLOCO01_${dayName}.mp3",vht,"AS_ULTIMAS_DO_ESPORTE_EDICAO01_${dayName}.mp3",vht,"TOP_10_MIX_BLOCO02_${dayName}.mp3","AS_ULTIMAS_DO_ESPORTE_EDICAO02_${dayName}.mp3"`;

  logs.push({ blockTime: timeStr, type: 'fixed', title: 'TOP 10 MIX + Esporte', artist: `Bloco ${timeStr}`, station: 'FIXO', reason: 'Template TOP10 MIX com esporte' });
  return { line: ctx.sanitizeGradeLine(line), logs };
}

/**
 * Rádio Revista blocks (19:00-19:30 weekdays)
 */
export async function generateRadioRevistaBlock(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = getDayName(targetDay);
  const logs: BlockLogItem[] = [];
  let line: string;

  if (minute === 0) {
    line = `${timeStr} (ID=RADIO REVISTA) vht,"NOTICIA_DA_HORA_16HORAS_${dayName}.mp3","radio revista _ bloco 01.mp3","radio revista _ bloco 02.mp3"`;
  } else {
    line = `${timeStr} (ID=RADIO REVISTA) vht,"radio revista _ bloco 03.mp3","radio revista _ bloco 04.mp3"`;
  }

  logs.push({ blockTime: timeStr, type: 'fixed', title: 'Rádio Revista', artist: `Bloco ${timeStr}`, station: 'FIXO', reason: 'Template Rádio Revista' });
  return { line: ctx.sanitizeGradeLine(line), logs };
}

/**
 * Misturadão V2 blocks (20:00-20:30 weekdays)
 * Updated template with day-aware naming + monitoring songs.
 */
export async function generateMisturadaoV2(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = getDayName(targetDay);
  const logs: BlockLogItem[] = [];
  const usedKeys = new Set<string>();
  const usedArtists = new Set<string>();
  const coringaCode = ctx.coringaCode;
  let line: string;

  if (minute === 0) {
    line = `${timeStr} (ID=MISTURADAO) vht,"NOTICIA_DA_HORA_15HORAS_${dayName}.mp3",vht,"MISTURADAO_BLOCO01_${dayName}.mp3","FIQUE_SABENDO_EDICAO01_${dayName}.mp3",vht,"MISTURADAO_BLOCO02_${dayName}.mp3"`;
  } else {
    // 20:30
    const monDisney1 = await pickMonitoredSong('Disney FM', songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    const monDisney2 = await pickMonitoredSong('Disney FM', songsByStation, ctx, timeStr, isFullDay, usedKeys, usedArtists, logs, coringaCode);
    line = `${timeStr} (ID=MISTURADAO) vht,"MISTURADAO_BLOCO03_${dayName}.mp3","FIQUE_SABENDO_EDICAO02_${dayName}.mp3","MISTURADAO_BLOCO04_${dayName}.mp3",${monDisney1},vht,${monDisney2}`;
  }

  logs.push({ blockTime: timeStr, type: 'fixed', title: 'Misturadão', artist: `Bloco ${timeStr}`, station: 'FIXO', reason: `Template Misturadão ${dayName}` });
  return { line: ctx.sanitizeGradeLine(line), logs };
}

/**
 * Songs of Love blocks (22:00-23:30 weekdays)
 * Template with "songs of love" fixed audio + romantic songs.
 */
export async function generateSongsOfLoveBlock(
  hour: number,
  minute: number,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const usedKeys = new Set<string>();
  const usedArtists = new Set<string>();

  const rom = async () => pickRomanticSong(ctx, timeStr, isFullDay, usedKeys, usedArtists, logs);

  let line: string;

  if (hour === 22 && minute === 0) {
    const r1 = await rom(); const r2 = await rom();
    line = `${timeStr} (ID=SONGS OF LOVE) vht,"songs of love _ bloco 01.mp3",${r1},vht,${r2}`;
  } else if (hour === 22 && minute === 30) {
    const r1 = await rom(); const r2 = await rom();
    line = `${timeStr} (ID=SONGS OF LOVE) vht,"songs of love _ bloco 02.mp3",${r1},vht,${r2}`;
  } else if (hour === 23 && minute === 0) {
    const r1 = await rom();
    line = `${timeStr} (ID=SONGS OF LOVE) vht,"songs of love _ bloco 03.mp3",vht,"songs of love _ bloco 04.mp3",${r1}`;
  } else {
    // 23:30
    const r1 = await rom();
    line = `${timeStr} (ID=SONGS OF LOVE) vht,"songs of love _ bloco 05.mp3",vht,"songs of love _ bloco 06.mp3",${r1}`;
  }

  logs.push({ blockTime: timeStr, type: 'fixed', title: 'Songs of Love', artist: `Bloco ${timeStr}`, station: 'FIXO', reason: 'Template Songs of Love com músicas românticas' });
  return { line: ctx.sanitizeGradeLine(line), logs };
}

// ========== Main Router ==========

/**
 * Check if a weekday template block exists for this time slot.
 * Returns true if the time should be handled by a weekday template.
 */
export function isWeekdayTemplateBlock(hour: number, minute: number): boolean {
  // 09:00-10:30 (Sintonia Total)
  if (hour === 9 && (minute === 0 || minute === 30)) return true;
  if (hour === 10 && (minute === 0 || minute === 30)) return true;
  // 12:00-12:30 (Painel Flashback)
  if (hour === 12 && (minute === 0 || minute === 30)) return true;
  // 13:00-13:30 (Top 10 / Papo Sério)
  if (hour === 13 && (minute === 0 || minute === 30)) return true;
  // 17:00-17:30 (Intensidade)
  if (hour === 17 && (minute === 0 || minute === 30)) return true;
  // 18:00 (Radar Notícias)
  if (hour === 18 && minute === 0) return true;
  // 18:30 (TOP10 MIX + Esporte)
  if (hour === 18 && minute === 30) return true;
  // 19:00-19:30 (Rádio Revista)
  if (hour === 19 && (minute === 0 || minute === 30)) return true;
  // 20:00-20:30 (Misturadão V2)
  if (hour === 20 && (minute === 0 || minute === 30)) return true;
  // 22:00-23:30 (Songs of Love)
  if (hour >= 22 && hour <= 23 && (minute === 0 || minute === 30)) return true;
  return false;
}

/**
 * Generate the weekday template block for the given time.
 * Returns null if no template exists for this time.
 */
export async function generateWeekdayTemplateBlock(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult | null> {
  // Sintonia Total (09:00-10:30)
  if ((hour === 9 || hour === 10) && (minute === 0 || minute === 30)) {
    return generateSintoniaTotalBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
  }
  // Painel Flashback (12:00-12:30)
  if (hour === 12 && (minute === 0 || minute === 30)) {
    return generatePainelFlashbackBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
  }
  // Top 10 / Papo Sério (13:00-13:30)
  if (hour === 13 && (minute === 0 || minute === 30)) {
    return generateTop10PapoSerioBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
  }
  // Intensidade (17:00-17:30)
  if (hour === 17 && (minute === 0 || minute === 30)) {
    return generateIntensidadeBlock(hour, minute, ctx, targetDay);
  }
  // Radar Notícias (18:00)
  if (hour === 18 && minute === 0) {
    return generateRadarNoticiasBlock(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
  }
  // TOP10 MIX + Esporte (18:30)
  if (hour === 18 && minute === 30) {
    return generateTop10MixEsporteBlock(hour, minute, ctx, targetDay);
  }
  // Rádio Revista (19:00-19:30)
  if (hour === 19 && (minute === 0 || minute === 30)) {
    return generateRadioRevistaBlock(hour, minute, ctx, targetDay);
  }
  // Misturadão V2 (20:00-20:30)
  if (hour === 20 && (minute === 0 || minute === 30)) {
    return generateMisturadaoV2(hour, minute, songsByStation, stats, isFullDay, ctx, targetDay);
  }
  // Songs of Love (22:00-23:30)
  if (hour >= 22 && hour <= 23 && (minute === 0 || minute === 30)) {
    return generateSongsOfLoveBlock(hour, minute, stats, isFullDay, ctx, targetDay);
  }
  return null;
}
