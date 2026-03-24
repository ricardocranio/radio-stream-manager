// specialPrograms.ts
// ARQUITETURA CORRIGIDA:
//   Monitoramento (scraped_songs) → selectSongForSlot P1-P6 (NÃO muda — correto)
//   genre_/year_/genreyear_       → BIBLIOTECA LOCAL (ID3) é a fonte primária
//   scraped_songs                 → apenas enriquece metadados de músicas que JÁ existem localmente

import { supabase } from '@/integrations/supabase/client';
import type { GradeContext, BlockResult, BlockLogItem, BlockStats, SongEntry } from './types';
import type { WeekDay } from '@/types/radio';
import { sanitizeFilename } from '@/lib/sanitizeFilename';
import { sanitizeGradeLine } from './sanitize';

// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------

interface SongMeta {
  filename: string;
  artist: string;
  title: string;
  genre: string;
  year: string;
  bpm?: string;
}

interface LibraryIndex {
  byGenre: Map<string, SongMeta[]>;
  byDecade: Map<string, SongMeta[]>;
  byGenreDecade: Map<string, SongMeta[]>;
  byArtistTitle: Map<string, SongMeta>; // "artist::title" → SongMeta — lookup O(1)
  allSongs: SongMeta[];
  builtAt: number;
}

// ---------------------------------------------------------------------------
// CACHE DE METADADOS + ÍNDICE LOCAL
// ---------------------------------------------------------------------------

let _metadataCacheResult: SongMeta[] | null = null;
let _metadataCacheTime = 0;
let _libraryIndex: LibraryIndex | null = null;
const METADATA_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// ---------------------------------------------------------------------------
// MAPA DE SINÔNIMOS DE GÊNERO
// Comparação exata — sem includes() para evitar falsos positivos
// ---------------------------------------------------------------------------

const GENRE_SYNONYMS: Record<string, string> = {
  'HARD ROCK': 'ROCK',
  'CLASSIC ROCK': 'ROCK',
  'SOFT ROCK': 'ROCK',
  'ALTERNATIVE ROCK': 'ROCK',
  'POP ROCK': 'ROCK',
  'INDIE ROCK': 'ROCK',
  'PROG ROCK': 'ROCK',
  'POP DANCE': 'POP',
  'DANCE POP': 'POP',
  'TEEN POP': 'POP',
  'SYNTH POP': 'POP',
  'HEAVY METAL': 'METAL',
  'DEATH METAL': 'METAL',
  'THRASH METAL': 'METAL',
  'POWER METAL': 'METAL',
  'BLACK METAL': 'METAL',
  'SERTANEJO UNIVERSITÁRIO': 'SERTANEJO',
  'SERTANEJO RAIZ': 'SERTANEJO',
  'SERTANEJO ROMÂNTICO': 'SERTANEJO',
  'MÚSICA SERTANEJA': 'SERTANEJO',
  'PAGODE ROMÂNTICO': 'PAGODE',
  'SAMBA PAGODE': 'PAGODE',
  'SAMBA': 'PAGODE',
  'RAP': 'HIP HOP',
  'TRAP': 'HIP HOP',
  'HIP-HOP': 'HIP HOP',
  'FUNK CARIOCA': 'FUNK',
  'FUNK MELODY': 'FUNK',
  'FUNK OSTENTAÇÃO': 'FUNK',
  'ELETRÔNICA': 'ELETRONICA',
  'ELECTRONIC': 'ELETRONICA',
  'TECHNO': 'ELETRONICA',
  'HOUSE': 'ELETRONICA',
  'TRANCE': 'ELETRONICA',
  'EDM': 'ELETRONICA',
  'DANCE': 'ELETRONICA',
  'FORRÓ UNIVERSITÁRIO': 'FORRÓ',
  'FORRÓ ELETRÔNICO': 'FORRÓ',
  'FORRO': 'FORRÓ',
  'AXÉ': 'AXE',
  'AXÉ MUSIC': 'AXE',
  'AXEMUSIC': 'AXE',
  'R&B': 'RNB',
  'RHYTHM AND BLUES': 'RNB',
  'SOUL': 'RNB',
  'ROMÂNTICO': 'ROMANTICO',
  'ROMANTICA': 'ROMANTICO',
  'BALADA': 'ROMANTICO',
  'GOSPEL': 'GOSPEL',
  'MÚSICAS GOSPEL': 'GOSPEL',
  'MÚSICA CRISTÃ': 'GOSPEL',
  'CCM': 'GOSPEL',
  'MPB': 'MPB',
  'MÚSICA POPULAR BRASILEIRA': 'MPB',
  'REGGAE': 'REGGAE',
  'REGGAETON': 'REGGAE',
  'LATIN': 'LATIN',
  'LATINA': 'LATIN',
};

const DECADE_RANGES: Record<string, [number, number]> = {
  '60s':   [1960, 1969],
  '70s':   [1970, 1979],
  '80s':   [1980, 1989],
  '90s':   [1990, 1999],
  '2000s': [2000, 2009],
  '2010s': [2010, 2019],
  '2020s': [2020, 2030],
};

// ---------------------------------------------------------------------------
// NORMALIZAÇÃO
// ---------------------------------------------------------------------------

export function normalizeId3Genre(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return GENRE_SYNONYMS[upper] ?? upper;
}

function yearToDecadeKey(year: number): string | null {
  for (const [key, [min, max]] of Object.entries(DECADE_RANGES)) {
    if (year >= min && year <= max) return key;
  }
  return null;
}

function atKey(artist: string, title: string): string {
  return `${artist.toLowerCase().trim()}::${title.toLowerCase().trim()}`;
}

function songKey(artist: string, title: string): string {
  return `${title.toLowerCase()}-${artist.toLowerCase()}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// CACHE DE METADADOS DA BIBLIOTECA LOCAL (múltiplas pastas via IPC)
// ---------------------------------------------------------------------------

async function getCachedLibraryMetadata(): Promise<SongMeta[]> {
  const now = Date.now();
  if (_metadataCacheResult && now - _metadataCacheTime < METADATA_CACHE_TTL) {
    return _metadataCacheResult;
  }

  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;
  if (!isElectron) return [];

  const { useRadioStore } = await import('@/store/radioStore');
  const musicFolders: string[] = useRadioStore.getState().config.musicFolders ?? [];

  let songs: SongMeta[] = [];
  try {
    const scanResult = await (window as any).electronAPI.scanLibraryMetadata({ musicFolders });
    songs = scanResult?.songs ?? [];
  } catch (e) {
    console.warn('[specialPrograms] scanLibraryMetadata falhou:', e);
    return _metadataCacheResult ?? [];
  }

  _metadataCacheResult = songs;
  _metadataCacheTime = now;
  _libraryIndex = null; // Invalida índice quando cache renova

  console.log(`[specialPrograms] 📚 Biblioteca escaneada: ${songs.length} músicas | pastas: ${musicFolders.join(', ')}`);
  return _metadataCacheResult;
}

export function invalidateLibraryCache(): void {
  _metadataCacheResult = null;
  _metadataCacheTime = 0;
  _libraryIndex = null;
}

// ---------------------------------------------------------------------------
// ÍNDICE LOCAL
// Construído uma vez por ciclo de cache — lookup O(1) por gênero, década e combo
// ---------------------------------------------------------------------------

async function getLibraryIndex(): Promise<LibraryIndex> {
  if (_libraryIndex) return _libraryIndex;

  const raw = await getCachedLibraryMetadata();

  const byGenre       = new Map<string, SongMeta[]>();
  const byDecade      = new Map<string, SongMeta[]>();
  const byGenreDecade = new Map<string, SongMeta[]>();
  const byArtistTitle = new Map<string, SongMeta>();

  for (const song of raw) {
    byArtistTitle.set(atKey(song.artist, song.title), song);

    const genre   = normalizeId3Genre(song.genre);
    const yearNum = parseInt(song.year, 10);
    const decade  = !isNaN(yearNum) ? yearToDecadeKey(yearNum) : null;

    if (genre) {
      if (!byGenre.has(genre)) byGenre.set(genre, []);
      byGenre.get(genre)!.push(song);
    }

    if (decade) {
      if (!byDecade.has(decade)) byDecade.set(decade, []);
      byDecade.get(decade)!.push(song);
    }

    if (genre && decade) {
      const key = `${genre}_${decade}`;
      if (!byGenreDecade.has(key)) byGenreDecade.set(key, []);
      byGenreDecade.get(key)!.push(song);
    }
  }

  _libraryIndex = {
    byGenre,
    byDecade,
    byGenreDecade,
    byArtistTitle,
    allSongs: raw,
    builtAt: Date.now(),
  };

  console.log(
    `[LibraryIndex] ${raw.length} músicas | ${byGenre.size} gêneros | ${byDecade.size} décadas | ${byGenreDecade.size} combos`
  );

  return _libraryIndex;
}

// ---------------------------------------------------------------------------
// SNAPSHOT DE DISPONIBILIDADE (usado pelo SequenceView para mostrar o que tem)
// ---------------------------------------------------------------------------

export async function getLibraryAvailabilitySnapshot(): Promise<{
  genres: Array<{ name: string; count: number }>;
  decades: Array<{ name: string; count: number }>;
  genreDecades: Array<{ genre: string; decade: string; count: number }>;
  total: number;
}> {
  const index = await getLibraryIndex();

  const genres = Array.from(index.byGenre.entries())
    .map(([name, songs]) => ({ name, count: songs.length }))
    .sort((a, b) => b.count - a.count);

  const decadeOrder = ['60s', '70s', '80s', '90s', '2000s', '2010s', '2020s'];
  const decades = Array.from(index.byDecade.entries())
    .map(([name, songs]) => ({ name, count: songs.length }))
    .sort((a, b) => decadeOrder.indexOf(a.name) - decadeOrder.indexOf(b.name));

  const genreDecades = Array.from(index.byGenreDecade.entries())
    .map(([key, songs]) => {
      const lastUnderscore = key.lastIndexOf('_');
      return {
        genre: key.substring(0, lastUnderscore),
        decade: key.substring(lastUnderscore + 1),
        count: songs.length,
      };
    })
    .sort((a, b) => b.count - a.count);

  return { genres, decades, genreDecades, total: index.allSongs.length };
}

// ---------------------------------------------------------------------------
// RESOLUÇÃO DE VARIANTES DE GÊNERO
// ---------------------------------------------------------------------------

function resolveGenreVariants(genres: string[]): string[] {
  const normalized = new Set<string>();
  for (const g of genres) {
    const n = normalizeId3Genre(g);
    if (!n) continue;
    normalized.add(n);
    for (const [synonym, canonical] of Object.entries(GENRE_SYNONYMS)) {
      if (canonical === n) normalized.add(synonym);
    }
  }
  return Array.from(normalized);
}

function dbGenreVariants(genres: string[]): string[] {
  const variants = new Set<string>();
  for (const g of [...genres, ...resolveGenreVariants(genres)]) {
    variants.add(g.toUpperCase());
    variants.add(g.toLowerCase());
    variants.add(g.charAt(0).toUpperCase() + g.slice(1).toLowerCase());
  }
  return Array.from(variants);
}

// ---------------------------------------------------------------------------
// VALIDAÇÃO ANTI-REPETIÇÃO
// ---------------------------------------------------------------------------

function isValidLibraryCandidate(
  song: SongMeta,
  usedInBlock: Set<string>,
  usedArtistsInBlock: Set<string>,
  ctx: GradeContext,
  timeStr: string,
): boolean {
  const key        = songKey(song.artist, song.title);
  const artistNorm = song.artist.toLowerCase().trim();
  if (usedInBlock.has(key)) return false;
  if (usedArtistsInBlock.has(artistNorm)) return false;
  if (ctx.isRecentlyUsed(song.title, song.artist, timeStr)) return false;
  return true;
}

function markLibrarySongAsUsed(
  song: SongMeta,
  usedInBlock: Set<string>,
  usedArtistsInBlock: Set<string>,
  ctx: GradeContext,
  timeStr: string,
): void {
  usedInBlock.add(songKey(song.artist, song.title));
  usedArtistsInBlock.add(song.artist.toLowerCase().trim());
  ctx.markSongAsUsed(song.title, song.artist, timeStr);
}

// ---------------------------------------------------------------------------
// CROSS-REFERENCE: candidatos do DB → apenas músicas que existem na biblioteca
// ---------------------------------------------------------------------------

function matchDbCandidatesInLibrary(
  dbCandidates: { artist: string; title: string }[],
  index: LibraryIndex,
): SongMeta[] {
  const results: SongMeta[] = [];

  for (const c of dbCandidates) {
    const artistNorm = c.artist.toLowerCase().trim();
    const titleNorm  = c.title.toLowerCase().trim();

    // Tentativa 1: lookup exato O(1)
    const exact = index.byArtistTitle.get(`${artistNorm}::${titleNorm}`);
    if (exact) { results.push(exact); continue; }

    // Tentativa 2: fuzzy por contains (só se exato falhar)
    for (const [key, song] of index.byArtistTitle) {
      const [kA, kT] = key.split('::');
      if (
        (kA.includes(artistNorm) || artistNorm.includes(kA)) &&
        (kT.includes(titleNorm)  || titleNorm.includes(kT))
      ) {
        results.push(song);
        break;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// ENRIQUECIMENTO DO DB COM ANOS DA BIBLIOTECA (non-blocking, background)
// ---------------------------------------------------------------------------

async function enrichDbWithLocalYears(songs: SongMeta[]): Promise<void> {
  for (const song of songs.slice(0, 50)) {
    if (!song.year) continue;
    try {
      const { data } = await supabase
        .from('scraped_songs')
        .select('id')
        .ilike('artist', song.artist)
        .ilike('title', song.title)
        .is('year', null)
        .single();
      if (data?.id) {
        await supabase
          .from('scraped_songs')
          .update({ year: String(song.year) })
          .eq('id', data.id);
      }
    } catch {
      // best-effort, silencioso
    }
  }
}

// ---------------------------------------------------------------------------
// findSongByGenre
//
// Strategy 1: Biblioteca local — ID3 genre tags indexadas ← FONTE PRIMÁRIA
// Strategy 2: DB como enriquecimento de metadados (NUNCA retorna músicas que não existam localmente)
// ---------------------------------------------------------------------------

export async function findSongByGenre(
  genres: string[],
  timeStr: string,
  usedInBlock: Set<string>,
  usedArtistsInBlock: Set<string>,
  ctx: GradeContext,
  isFullDay: boolean = false,
): Promise<{ filename: string; artist: string; title: string; genre: string } | null> {

  const index    = await getLibraryIndex();
  const variants = resolveGenreVariants(genres);

  // === Strategy 1: Biblioteca local — ID3 genre tags ===
  const localCandidates: SongMeta[] = [];
  for (const variant of variants) {
    localCandidates.push(...(index.byGenre.get(variant) ?? []));
  }

  const deduped = shuffle(
    Array.from(new Map(localCandidates.map(s => [atKey(s.artist, s.title), s])).values())
  );

  for (const song of deduped) {
    if (!isValidLibraryCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr)) continue;

    const libResult = await ctx.findSongInLibrary(song.artist, song.title);
    if (!libResult.exists) continue;

    const realFilename = libResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
    markLibrarySongAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
    return { filename: realFilename, artist: song.artist, title: song.title, genre: song.genre };
  }

  // === Strategy 2: DB como enriquecimento ===
  const { data: dbData } = await supabase
    .from('scraped_songs')
    .select('artist, title, ai_genre')
    .in('ai_genre', dbGenreVariants(genres))
    .order('scraped_at', { ascending: false })
    .limit(300);

  if (dbData?.length) {
    const fromDb = matchDbCandidatesInLibrary(dbData, index);
    for (const song of shuffle(fromDb)) {
      if (!isValidLibraryCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr)) continue;

      const libResult = await ctx.findSongInLibrary(song.artist, song.title);
      if (!libResult.exists) continue;

      const realFilename = libResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
      markLibrarySongAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
      return { filename: realFilename, artist: song.artist, title: song.title, genre: song.genre };
    }
  }

  console.warn(`[findSongByGenre] Sem match na biblioteca para: [${genres.join(', ')}]`);
  return null;
}

// ---------------------------------------------------------------------------
// findSongByYear
//
// Strategy 1: Biblioteca local — ID3 year tags indexadas ← FONTE PRIMÁRIA
// Strategy 2: DB com year preenchido — apenas músicas que existem localmente
// ---------------------------------------------------------------------------

export async function findSongByYear(
  yearMin: number,
  yearMax: number,
  timeStr: string,
  usedInBlock: Set<string>,
  usedArtistsInBlock: Set<string>,
  ctx: GradeContext,
  isFullDay: boolean = false,
): Promise<{ filename: string; artist: string; title: string; yearRange: string } | null> {

  const index = await getLibraryIndex();

  const relevantDecades = Object.entries(DECADE_RANGES)
    .filter(([, [min, max]]) => max >= yearMin && min <= yearMax)
    .map(([key]) => key);

  // === Strategy 1: Biblioteca local — ID3 year tags ===
  const localCandidates: SongMeta[] = [];
  for (const decade of relevantDecades) {
    const songs = index.byDecade.get(decade) ?? [];
    localCandidates.push(...songs.filter(s => {
      const yr = parseInt(s.year, 10);
      return !isNaN(yr) && yr >= yearMin && yr <= yearMax;
    }));
  }

  const deduped = shuffle(
    Array.from(new Map(localCandidates.map(s => [atKey(s.artist, s.title), s])).values())
  );

  for (const song of deduped) {
    if (!isValidLibraryCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr)) continue;

    const libResult = await ctx.findSongInLibrary(song.artist, song.title);
    if (!libResult.exists) continue;

    const realFilename = libResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
    markLibrarySongAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
    enrichDbWithLocalYears(localCandidates).catch(() => {});
    return { filename: realFilename, artist: song.artist, title: song.title, yearRange: `${yearMin}-${yearMax}` };
  }

  // === Strategy 2: DB com year ===
  const { data: dbData } = await supabase
    .from('scraped_songs')
    .select('artist, title, year')
    .not('year', 'is', null)
    .gte('year', String(yearMin))
    .lte('year', String(yearMax))
    .order('scraped_at', { ascending: false })
    .limit(300);

  if (dbData?.length) {
    const fromDb = matchDbCandidatesInLibrary(dbData, index);
    for (const song of shuffle(fromDb)) {
      if (!isValidLibraryCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr)) continue;

      const libResult = await ctx.findSongInLibrary(song.artist, song.title);
      if (!libResult.exists) continue;

      const realFilename = libResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
      markLibrarySongAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
      return { filename: realFilename, artist: song.artist, title: song.title, yearRange: `${yearMin}-${yearMax}` };
    }
  }

  if (localCandidates.length > 0) {
    enrichDbWithLocalYears(localCandidates).catch(() => {});
  }

  console.warn(`[findSongByYear] Sem match na biblioteca para ${yearMin}-${yearMax}`);
  return null;
}

// ---------------------------------------------------------------------------
// findSongByGenreAndYear
//
// Strategy 1: Biblioteca local — índice byGenreDecade O(1) ← FONTE PRIMÁRIA
// Strategy 2: DB com ambos os filtros — apenas músicas que existem localmente
// Strategy 3: Fallback só gênero — AVISO EXPLÍCITO no log
// ---------------------------------------------------------------------------

export async function findSongByGenreAndYear(
  genres: string[],
  yearMin: number,
  yearMax: number,
  timeStr: string,
  usedInBlock: Set<string>,
  usedArtistsInBlock: Set<string>,
  ctx: GradeContext,
  isFullDay: boolean = false,
): Promise<{ filename: string; artist: string; title: string; genre: string; yearRange: string } | null> {

  const index    = await getLibraryIndex();
  const variants = resolveGenreVariants(genres);

  const relevantDecades = Object.entries(DECADE_RANGES)
    .filter(([, [min, max]]) => max >= yearMin && min <= yearMax)
    .map(([key]) => key);

  // === Strategy 1: Biblioteca local — índice byGenreDecade ===
  const localCandidates: SongMeta[] = [];
  for (const variant of variants) {
    for (const decade of relevantDecades) {
      const key   = `${variant}_${decade}`;
      const songs = index.byGenreDecade.get(key) ?? [];
      localCandidates.push(...songs.filter(s => {
        const yr = parseInt(s.year, 10);
        return !isNaN(yr) && yr >= yearMin && yr <= yearMax;
      }));
    }
  }

  const deduped = shuffle([
    ...new Map(localCandidates.map(s => [atKey(s.artist, s.title), s])).values(),
  ]);

  for (const song of deduped) {
    if (!isValidLibraryCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr)) continue;

    const libResult = await ctx.findSongInLibrary(song.artist, song.title);
    if (!libResult.exists) continue;

    const realFilename = libResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
    markLibrarySongAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
    return {
      filename:  realFilename,
      artist:    song.artist,
      title:     song.title,
      genre:     song.genre,
      yearRange: `${yearMin}-${yearMax}`,
    };
  }

  // === Strategy 2: DB com ambos os filtros ===
  const { data: dbData } = await supabase
    .from('scraped_songs')
    .select('artist, title, ai_genre, year')
    .in('ai_genre', dbGenreVariants(genres))
    .not('year', 'is', null)
    .gte('year', String(yearMin))
    .lte('year', String(yearMax))
    .order('scraped_at', { ascending: false })
    .limit(300);

  if (dbData?.length) {
    const fromDb = matchDbCandidatesInLibrary(dbData, index);
    for (const song of shuffle(fromDb)) {
      if (!isValidLibraryCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr)) continue;

      const libResult = await ctx.findSongInLibrary(song.artist, song.title);
      if (!libResult.exists) continue;

      const realFilename = libResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
      markLibrarySongAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
      return {
        filename:  realFilename,
        artist:    song.artist,
        title:     song.title,
        genre:     song.genre,
        yearRange: `${yearMin}-${yearMax}`,
      };
    }
  }

  // === Strategy 3: Fallback — ignora ano ===
  console.warn(
    `[findSongByGenreAndYear] FALLBACK ACIONADO — Sem match para [${genres.join(', ')}] em ${yearMin}-${yearMax}. ` +
    `Buscando por gênero sem restrição de ano. ` +
    `Verifique: (1) ID3 year preenchido nas músicas da biblioteca, ` +
    `(2) DB possui year para esse intervalo.`
  );

  const genreOnly = await findSongByGenre(genres, timeStr, usedInBlock, usedArtistsInBlock, ctx, isFullDay);
  if (genreOnly) {
    return { ...genreOnly, yearRange: `${yearMin}-${yearMax} (fallback — ano ignorado)` };
  }

  console.error(
    `[findSongByGenreAndYear] FALHA TOTAL — Nenhuma música para [${genres.join(', ')}] em ${yearMin}-${yearMax}.`
  );
  return null;
}

// ---------------------------------------------------------------------------
// generateVozDoBrasil — 21:00 Seg-Sex (60 min)
// ---------------------------------------------------------------------------

export function generateVozDoBrasil(timeStr: string): BlockResult {
  return {
    line: `${timeStr} (ID=VOZ DO BRASIL) "VOZ_DO_BRASIL.MP3"`,
    logs: [{
      blockTime: timeStr,
      type: 'fixed',
      title: 'Voz do Brasil',
      artist: 'VOZ_DO_BRASIL.MP3',
      station: 'FIXO',
      reason: 'A Voz do Brasil (obrigatório por lei, 60 min)',
    }],
  };
}

// ---------------------------------------------------------------------------
// generateRaridades — 12:00/12:30 Seg-Sex
// ---------------------------------------------------------------------------

export async function generateRaridades(
  hour: number,
  minute: number,
  yearMin: number,
  yearMax: number,
  fixedFileName: string,
  editionIndex: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const usedInBlock: Set<string> = new Set();
  const usedArtistsInBlock: Set<string> = new Set();
  const songs: string[] = [];

  const processedFileName = ctx.processFixedContentFilename(fixedFileName, hour, minute, editionIndex, targetDay);
  const finalFileName = processedFileName.toLowerCase().endsWith('.mp3')
    ? processedFileName
    : `${processedFileName}.mp3`;
  songs.push(`"${finalFileName}"`);
  logs.push({
    blockTime: timeStr, type: 'fixed',
    title: 'Raridades', artist: finalFileName,
    station: 'FIXO', reason: 'Programa Raridades',
  });

  for (let i = 0; i < 2; i++) {
    const result = await findSongByYear(yearMin, yearMax, timeStr, usedInBlock, usedArtistsInBlock, ctx, isFullDay);
    if (result) {
      songs.push(`"${result.filename}"`);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: result.filename, artist: '',
        station: `RARIDADES ${yearMin}-${yearMax}`,
        reason: `Música ${yearMin}-${yearMax} (biblioteca local)`,
      });
    } else {
      songs.push(ctx.coringaCode);
      stats.missing++;
    }
  }

  return {
    line: sanitizeGradeLine(`${timeStr} (ID=RARIDADES) ${songs.join(',vht,')}`, ctx.filterChars),
    logs,
  };
}

// ---------------------------------------------------------------------------
// generateTop10Decada — 18:00 Seg-Sex
// ---------------------------------------------------------------------------

export async function generateTop10Decada(
  hour: number,
  minute: number,
  yearMin: number,
  yearMax: number,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const songs: string[] = [];
  const usedInBlock: Set<string> = new Set();
  const usedArtistsInBlock: Set<string> = new Set();

  for (let i = 0; i < 10; i++) {
    const result = await findSongByYear(yearMin, yearMax, timeStr, usedInBlock, usedArtistsInBlock, ctx, false);
    if (result) {
      songs.push(`"${result.filename}"`);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: result.filename, artist: '',
        station: `TOP10 ${yearMin}-${yearMax}`,
        reason: `TOP10 Década ${yearMin}-${yearMax} (biblioteca local)`,
      });
    } else {
      songs.push(ctx.coringaCode);
    }
  }

  return {
    line: sanitizeGradeLine(`${timeStr} (ID=TOP10) ${songs.join(',VHTN,')}`, ctx.filterChars),
    logs,
  };
}

// ---------------------------------------------------------------------------
// generateTop10Block — 18:30 Seg-Sex
// ---------------------------------------------------------------------------

export async function generateTop10Block(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const songs: string[] = [];

  const sorted = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays).slice(0, 25);

  for (const rankSong of sorted.slice(0, 8)) {
    const libResult = await ctx.findSongInLibrary(rankSong.artist, rankSong.title);
    if (libResult.exists) {
      const fname = libResult.filename || sanitizeFilename(`${rankSong.artist} - ${rankSong.title}.mp3`);
      songs.push(`"${fname}"`);
      ctx.markSongAsUsed(rankSong.title, rankSong.artist, timeStr);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: rankSong.title, artist: rankSong.artist,
        station: 'TOP25', reason: 'TOP10 Block ranking',
      });
    }
  }

  while (songs.length < 8) {
    songs.push(ctx.coringaCode);
  }

  return {
    line: sanitizeGradeLine(`${timeStr} (ID=TOP10) ${songs.join(',vht,')}`, ctx.filterChars),
    logs,
  };
}

// ---------------------------------------------------------------------------
// generateTop50Block — TOP50 em horário fixo
// ---------------------------------------------------------------------------

export async function generateTop50Block(
  hour: number,
  minute: number,
  count: number,
  ctx: GradeContext,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const songs: string[] = [];

  const sorted = [...ctx.rankingSongs].sort((a, b) => b.plays - a.plays).slice(0, 50);

  for (let i = 0; i < count && i < sorted.length; i++) {
    const song = sorted[i];
    const libResult = await ctx.findSongInLibrary(song.artist, song.title);
    if (libResult.exists) {
      const fname = libResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
      songs.push(`"${fname}"`);
      ctx.markSongAsUsed(song.title, song.artist, timeStr);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: song.title, artist: song.artist,
        station: 'TOP50', reason: `TOP50 posição ${i + 1}`,
      });
    } else {
      songs.push(ctx.coringaCode);
    }
  }

  while (songs.length < count) songs.push(ctx.coringaCode);

  return {
    line: sanitizeGradeLine(`${timeStr} (ID=TOP50) ${songs.join(',vht,')}`, ctx.filterChars),
    logs,
  };
}

// ---------------------------------------------------------------------------
// generateRockMetal — 19:00/19:30 Seg-Sex
// ---------------------------------------------------------------------------

export async function generateRockMetal(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const songs: string[] = [];
  const usedInBlock: Set<string> = new Set();
  const usedArtistsInBlock: Set<string> = new Set();

  for (let i = 0; i < 10; i++) {
    const result = await findSongByGenre(
      ['ROCK', 'METAL'], timeStr, usedInBlock, usedArtistsInBlock, ctx, false
    );
    if (result) {
      songs.push(`"${result.filename}"`);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: result.title, artist: result.artist,
        station: 'ROCK/METAL', reason: 'Rock Metal (biblioteca local)',
      });
    } else {
      songs.push(ctx.coringaCode);
    }
  }

  return {
    line: sanitizeGradeLine(`${timeStr} (ID=TOP50) ${songs.join(',VHTN,')}`, ctx.filterChars),
    logs,
  };
}

// ---------------------------------------------------------------------------
// generateMisturadao — 20:00/20:30 Seg-Sex
// ---------------------------------------------------------------------------

export async function generateMisturadao(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const songs: string[] = [];
  const usedInBlock: Set<string> = new Set();
  const usedArtistsInBlock: Set<string> = new Set();

  const genrePool = ['SERTANEJO', 'PAGODE', 'POP', 'FUNK', 'MPB'];
  for (let i = 0; i < 10; i++) {
    const genre = genrePool[i % genrePool.length];
    const result = await findSongByGenre([genre], timeStr, usedInBlock, usedArtistsInBlock, ctx, false);
    if (result) {
      songs.push(`"${result.filename}"`);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: result.title, artist: result.artist,
        station: `MISTURADAO-${genre}`, reason: `Misturadão ${genre} (biblioteca local)`,
      });
    } else {
      songs.push(ctx.coringaCode);
    }
  }

  return {
    line: sanitizeGradeLine(`${timeStr} (ID=MISTURADAO) ${songs.join(',vht,')}`, ctx.filterChars),
    logs,
  };
}

// ---------------------------------------------------------------------------
// generateMadrugada — 00:00-04:30 Seg-Sex
// ---------------------------------------------------------------------------

export async function generateMadrugada(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  programName: string,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const songs: string[] = [];
  const usedInBlock: Set<string> = new Set();
  const usedArtistsInBlock: Set<string> = new Set();

  const genrePool = ['ROMANTICO', 'MPB', 'POP', 'SERTANEJO'];
  for (let i = 0; i < 10; i++) {
    const genre = genrePool[i % genrePool.length];
    const result = await findSongByGenre([genre], timeStr, usedInBlock, usedArtistsInBlock, ctx, isFullDay);
    if (result) {
      songs.push(`"${result.filename}"`);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: result.title, artist: result.artist,
        station: `MADRUGADA-${genre}`, reason: `Madrugada ${genre} (biblioteca local)`,
      });
    } else {
      songs.push(ctx.coringaCode);
      stats.missing++;
    }
  }

  return {
    line: sanitizeGradeLine(`${timeStr} (ID=${programName}) ${songs.join(',vht,')}`, ctx.filterChars),
    logs,
  };
}

// ---------------------------------------------------------------------------
// generateSertanejoNossa — 05:00-07:30 Seg-Sex
// ---------------------------------------------------------------------------

export async function generateSertanejoNossa(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const songs: string[] = [];
  const usedInBlock: Set<string> = new Set();
  const usedArtistsInBlock: Set<string> = new Set();

  for (let i = 0; i < 10; i++) {
    const result = await findSongByGenre(
      ['SERTANEJO', 'PAGODE'], timeStr, usedInBlock, usedArtistsInBlock, ctx, isFullDay
    );
    if (result) {
      songs.push(`"${result.filename}"`);
      logs.push({
        blockTime: timeStr, type: 'used',
        title: result.title, artist: result.artist,
        station: 'SERTANEJO-NOSSA', reason: 'Sertanejo Nossa (biblioteca local)',
      });
    } else {
      songs.push(ctx.coringaCode);
      stats.missing++;
    }
  }

  return {
    line: sanitizeGradeLine(`${timeStr} (ID=Sertanejo Nossa) ${songs.join(',vht,')}`, ctx.filterChars),
    logs,
  };
}
