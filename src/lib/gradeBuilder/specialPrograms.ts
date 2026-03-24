/**
 * Special Program Generators & Thematic Song Finders
 * 
 * Architecture: Library-First with O(1) Index Lookups
 * - LibraryIndex: Pre-built Maps (byGenre, byDecade, byGenreDecade, byArtistTitle)
 * - Strategy: Local Library (ID3) → DB (enrichment/cross-ref) → Fallback
 * - Genre synonyms: exact map, no includes() — avoids false positives
 * - DB enrichment: non-blocking background updates for discovered years
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import type { SongEntry, BlockResult, BlockLogItem, BlockStats, GradeContext } from './types';
import type { WeekDay } from '@/types/radio';
import { applyTemporalDecay } from '@/lib/rankingDecay';
import { supabase } from '@/integrations/supabase/client';

// ---------------------------------------------------------------------------
// TYPES
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
  byArtistTitle: Map<string, SongMeta>;
  allSongs: SongMeta[];
  builtAt: number;
}

// ---------------------------------------------------------------------------
// CACHE + INDEX
// ---------------------------------------------------------------------------

let _metadataCacheResult: SongMeta[] | null = null;
let _metadataCacheTime = 0;
let _libraryIndex: LibraryIndex | null = null;
const METADATA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// GENRE SYNONYMS — exact match map, no includes()
// ---------------------------------------------------------------------------

const GENRE_SYNONYMS: Record<string, string> = {
  'HARD ROCK': 'ROCK',
  'CLASSIC ROCK': 'ROCK',
  'SOFT ROCK': 'ROCK',
  'ALTERNATIVE ROCK': 'ROCK',
  'POP ROCK': 'ROCK',
  'INDIE ROCK': 'ROCK',
  'PROG ROCK': 'ROCK',
  'PROGRESSIVE ROCK': 'ROCK',
  'BLUES ROCK': 'ROCK',
  'FOLK ROCK': 'ROCK',
  'GARAGE ROCK': 'ROCK',
  'SOUTHERN ROCK': 'ROCK',
  'PSYCHEDELIC ROCK': 'ROCK',
  'STONER ROCK': 'ROCK',
  'GRUNGE': 'ROCK',
  'PUNK': 'ROCK',
  'PUNK ROCK': 'ROCK',
  'POST-PUNK': 'ROCK',
  'NEW WAVE': 'ROCK',
  'BRITPOP': 'ROCK',
  'EMO': 'ROCK',
  'POP PUNK': 'ROCK',
  'SKA': 'ROCK',
  'ALTERNATIVE': 'ROCK',
  'POP DANCE': 'POP',
  'DANCE POP': 'POP',
  'TEEN POP': 'POP',
  'SYNTH POP': 'POP',
  'ELECTROPOP': 'POP',
  'INDIE POP': 'POP',
  'ART POP': 'POP',
  'DREAM POP': 'POP',
  'K-POP': 'POP',
  'J-POP': 'POP',
  'HEAVY METAL': 'METAL',
  'DEATH METAL': 'METAL',
  'THRASH METAL': 'METAL',
  'POWER METAL': 'METAL',
  'BLACK METAL': 'METAL',
  'DOOM METAL': 'METAL',
  'SYMPHONIC METAL': 'METAL',
  'NU METAL': 'METAL',
  'NU-METAL': 'METAL',
  'METALCORE': 'METAL',
  'PROGRESSIVE METAL': 'METAL',
  'GOTHIC METAL': 'METAL',
  'FOLK METAL': 'METAL',
  'SPEED METAL': 'METAL',
  'GROOVE METAL': 'METAL',
  'INDUSTRIAL METAL': 'METAL',
  'MELODIC DEATH METAL': 'METAL',
  'DEATHCORE': 'METAL',
  'DJENT': 'METAL',
  'HARDCORE': 'METAL',
  'SERTANEJO UNIVERSITÁRIO': 'SERTANEJO',
  'SERTANEJO UNIVERSITARIO': 'SERTANEJO',
  'SERTANEJO RAIZ': 'SERTANEJO',
  'SERTANEJO ROMÂNTICO': 'SERTANEJO',
  'SERTANEJO POP': 'SERTANEJO',
  'MÚSICA SERTANEJA': 'SERTANEJO',
  'MUSICA SERTANEJA': 'SERTANEJO',
  'COUNTRY BRASILEIRO': 'SERTANEJO',
  'PAGODE ROMÂNTICO': 'PAGODE',
  'SAMBA PAGODE': 'PAGODE',
  'SAMBA': 'PAGODE',
  'SAMBA ROCK': 'PAGODE',
  'SAMBA DE RODA': 'PAGODE',
  'PARTIDO ALTO': 'PAGODE',
  'RAP': 'HIP HOP',
  'TRAP': 'HIP HOP',
  'HIP-HOP': 'HIP HOP',
  'RAP/HIP-HOP': 'HIP HOP',
  'RAP BRASILEIRO': 'HIP HOP',
  'BOOM BAP': 'HIP HOP',
  'FUNK CARIOCA': 'FUNK',
  'FUNK MELODY': 'FUNK',
  'FUNK OSTENTAÇÃO': 'FUNK',
  'FUNK OSTENTACAO': 'FUNK',
  'FUNK BRASILEIRO': 'FUNK',
  'BAILE FUNK': 'FUNK',
  'FUNK POP': 'FUNK',
  'BREGA FUNK': 'FUNK',
  'ELETRÔNICA': 'ELETRONICA',
  'ELECTRONIC': 'ELETRONICA',
  'TECHNO': 'ELETRONICA',
  'HOUSE': 'ELETRONICA',
  'DEEP HOUSE': 'ELETRONICA',
  'TRANCE': 'ELETRONICA',
  'EDM': 'ELETRONICA',
  'DANCE': 'ELETRONICA',
  'DUBSTEP': 'ELETRONICA',
  'DRUM AND BASS': 'ELETRONICA',
  'DRUM & BASS': 'ELETRONICA',
  'DNB': 'ELETRONICA',
  'AMBIENT': 'ELETRONICA',
  'SYNTHWAVE': 'ELETRONICA',
  'DISCO': 'ELETRONICA',
  'PROGRESSIVE HOUSE': 'ELETRONICA',
  'TROPICAL HOUSE': 'ELETRONICA',
  'FORRÓ UNIVERSITÁRIO': 'FORRÓ',
  'FORRÓ ELETRÔNICO': 'FORRÓ',
  'FORRO ELETRONICO': 'FORRÓ',
  'FORRO': 'FORRÓ',
  'ARROCHA': 'FORRÓ',
  'PISEIRO': 'FORRÓ',
  'PISADINHA': 'FORRÓ',
  'BREGA': 'FORRÓ',
  'TECNOBREGA': 'FORRÓ',
  'LAMBADA': 'FORRÓ',
  'AXÉ': 'AXE',
  'AXÉ MUSIC': 'AXE',
  'AXEMUSIC': 'AXE',
  'R&B': 'RNB',
  'RHYTHM AND BLUES': 'RNB',
  'SOUL': 'RNB',
  'NEO SOUL': 'RNB',
  'NEO-SOUL': 'RNB',
  'CONTEMPORARY R&B': 'RNB',
  'MOTOWN': 'RNB',
  'ROMÂNTICO': 'ROMANTICO',
  'ROMANTICA': 'ROMANTICO',
  'BALADA': 'ROMANTICO',
  'GOSPEL': 'GOSPEL',
  'MÚSICAS GOSPEL': 'GOSPEL',
  'MÚSICA CRISTÃ': 'GOSPEL',
  'MUSICA GOSPEL': 'GOSPEL',
  'CCM': 'GOSPEL',
  'CHRISTIAN': 'GOSPEL',
  'WORSHIP': 'GOSPEL',
  'PRAISE': 'GOSPEL',
  'MPB': 'MPB',
  'MÚSICA POPULAR BRASILEIRA': 'MPB',
  'MUSICA POPULAR BRASILEIRA': 'MPB',
  'BOSSA NOVA': 'MPB',
  'TROPICALIA': 'MPB',
  'TROPICÁLIA': 'MPB',
  'MANGUEBEAT': 'MPB',
  'REGGAE': 'REGGAE',
  'ROOTS REGGAE': 'REGGAE',
  'DUB': 'REGGAE',
  'DANCEHALL': 'REGGAE',
  'REGGAETON': 'REGGAETON',
  'REGGAETÓN': 'REGGAETON',
  'LATIN': 'LATIN',
  'LATINA': 'LATIN',
  'LATIN POP': 'LATIN',
  'LATIN URBAN': 'LATIN',
  'BACHATA': 'LATIN',
  'SALSA': 'LATIN',
  'CUMBIA': 'LATIN',
  'MERENGUE': 'LATIN',
  'COUNTRY': 'COUNTRY',
  'COUNTRY POP': 'COUNTRY',
  'AMERICANA': 'COUNTRY',
  'BLUEGRASS': 'COUNTRY',
  'JAZZ': 'JAZZ',
  'SMOOTH JAZZ': 'JAZZ',
  'JAZZ FUSION': 'JAZZ',
  'ACID JAZZ': 'JAZZ',
  'CLASSICAL': 'CLASSICA',
  'CLÁSSICA': 'CLASSICA',
  'CLASSICA': 'CLASSICA',
  'ERUDITA': 'CLASSICA',
  'OPERA': 'CLASSICA',
  'ÓPERA': 'CLASSICA',
  'INDIE': 'INDIE',
  'INDIE FOLK': 'INDIE',
  'INDIE ELECTRONIC': 'INDIE',
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
// NORMALIZATION
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

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// METADATA CACHE
// ---------------------------------------------------------------------------

async function getCachedLibraryMetadata(): Promise<SongMeta[]> {
  const now = Date.now();
  if (_metadataCacheResult && now - _metadataCacheTime < METADATA_CACHE_TTL) {
    return _metadataCacheResult;
  }

  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;
  if (!isElectron || !(window as any).electronAPI?.scanLibraryMetadata) return [];

  try {
    const { useRadioStore } = await import('@/store/radioStore');
    const { config } = useRadioStore.getState();
    const allFolders = config.musicFolders?.filter(Boolean) || [];
    if (allFolders.length === 0) return [];

    console.log('[META-CACHE] 📂 Escaneando biblioteca para cache de metadados...');
    const scanResult = await (window as any).electronAPI.scanLibraryMetadata({ musicFolders: allFolders });

    if (scanResult?.success && scanResult.songs?.length) {
      _metadataCacheResult = scanResult.songs;
      _metadataCacheTime = now;
      _libraryIndex = null; // Invalidate index
      console.log(`[META-CACHE] ✅ Cache criado: ${scanResult.songs.length} músicas`);
      return _metadataCacheResult!;
    }
  } catch (e) {
    console.warn('[META-CACHE] Erro ao escanear:', e);
  }
  return [];
}

export function invalidateLibraryCache(): void {
  _metadataCacheResult = null;
  _metadataCacheTime = 0;
  _libraryIndex = null;
}

// ---------------------------------------------------------------------------
// LIBRARY INDEX — built once per cache cycle, O(1) lookups
// ---------------------------------------------------------------------------

async function getLibraryIndex(): Promise<LibraryIndex> {
  if (_libraryIndex) return _libraryIndex;

  const raw = await getCachedLibraryMetadata();

  const byGenre       = new Map<string, SongMeta[]>();
  const byDecade      = new Map<string, SongMeta[]>();
  const byGenreDecade = new Map<string, SongMeta[]>();
  const byArtistTitle = new Map<string, SongMeta>();

  for (const song of raw) {
    if (!song.artist || song.artist === 'Desconhecido') continue;

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

  _libraryIndex = { byGenre, byDecade, byGenreDecade, byArtistTitle, allSongs: raw, builtAt: Date.now() };

  console.log(
    `[LibraryIndex] ✅ ${raw.length} músicas indexadas | ` +
    `${byGenre.size} gêneros | ${byDecade.size} décadas | ` +
    `${byArtistTitle.size} artist::title lookups`
  );

  return _libraryIndex;
}

// ---------------------------------------------------------------------------
// GENRE VARIANT RESOLUTION — normalized + reverse synonyms
// ---------------------------------------------------------------------------

function resolveGenreVariants(genres: string[]): string[] {
  const normalized = new Set<string>();
  for (const g of genres) {
    const n = normalizeId3Genre(g);
    if (!n) continue;
    normalized.add(n);
    // Add all synonyms that map to this canonical genre
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
// ANTI-REPETITION VALIDATION
// ---------------------------------------------------------------------------

function isValidCandidate(
  song: SongMeta,
  usedInBlock: Set<string>,
  usedArtistsInBlock: Set<string>,
  ctx: GradeContext,
  timeStr: string,
  isFullDay: boolean = false,
): boolean {
  const key        = atKey(song.artist, song.title);
  const artistNorm = song.artist.toLowerCase().trim();
  if (usedInBlock.has(key)) return false;
  if (usedArtistsInBlock.has(artistNorm)) return false;
  if (ctx.isRecentlyUsed(song.title, song.artist, timeStr, isFullDay)) return false;
  return true;
}

function markAsUsed(
  song: SongMeta,
  usedInBlock: Set<string>,
  usedArtistsInBlock: Set<string>,
  ctx: GradeContext,
  timeStr: string,
): void {
  usedInBlock.add(atKey(song.artist, song.title));
  usedArtistsInBlock.add(song.artist.toLowerCase().trim());
  ctx.markSongAsUsed(song.title, song.artist, timeStr);
}

// ---------------------------------------------------------------------------
// CROSS-REFERENCE: DB candidates → library matches via index (no IPC)
// ---------------------------------------------------------------------------

function matchDbCandidatesInLibrary(
  dbCandidates: { artist: string; title: string }[],
  index: LibraryIndex,
): SongMeta[] {
  const results: SongMeta[] = [];
  const addedKeys = new Set<string>();

  for (const c of dbCandidates) {
    const artistNorm = c.artist.toLowerCase().trim();
    const titleNorm  = c.title.toLowerCase().trim();
    const key = `${artistNorm}::${titleNorm}`;

    if (addedKeys.has(key)) continue;

    // O(1) exact lookup
    const exact = index.byArtistTitle.get(key);
    if (exact) {
      results.push(exact);
      addedKeys.add(key);
      continue;
    }

    // Fuzzy fallback: contains match (only if exact fails)
    for (const [mapKey, song] of index.byArtistTitle) {
      if (addedKeys.has(mapKey)) continue;
      const [kA, kT] = mapKey.split('::');
      if (
        (kA.includes(artistNorm) || artistNorm.includes(kA)) &&
        (kT.includes(titleNorm)  || titleNorm.includes(kT))
      ) {
        results.push(song);
        addedKeys.add(mapKey);
        break;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// DB ENRICHMENT — background, non-blocking
// ---------------------------------------------------------------------------

async function enrichDbWithLocalYears(songs: SongMeta[]): Promise<void> {
  const songsWithYear = songs.filter(s => s.year && parseInt(s.year, 10) > 0).slice(0, 100);
  let updated = 0;

  for (const song of songsWithYear) {
    try {
      const { data } = await supabase
        .from('scraped_songs')
        .select('id')
        .ilike('artist', song.artist.trim())
        .ilike('title', song.title.trim())
        .is('year', null)
        .limit(5);

      if (data?.length) {
        for (const row of data) {
          await supabase.from('scraped_songs').update({ year: String(song.year) }).eq('id', row.id);
          updated++;
        }
      }
    } catch {
      // best-effort
    }
  }

  if (updated > 0) {
    console.log(`[DB-ENRICH] 📅 ${updated} músicas no DB atualizadas com year do ID3`);
  }
}

// ---------------------------------------------------------------------------
// findSongByGenre
// Strategy 1: Library local (ID3 indexed) ← PRIMARY
// Strategy 2: DB enrichment → cross-ref with library
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

  // === Strategy 1: Library local — indexed O(1) ===
  const localCandidates: SongMeta[] = [];
  for (const variant of variants) {
    localCandidates.push(...(index.byGenre.get(variant) ?? []));
  }

  const deduped = shuffle([
    ...new Map(localCandidates.map(s => [atKey(s.artist, s.title), s])).values(),
  ]);

  for (const song of deduped) {
    if (!isValidCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr, isFullDay)) continue;
    markAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
    return { filename: song.filename, artist: song.artist, title: song.title, genre: song.genre };
  }

  // === Strategy 2: DB → cross-ref with library ===
  try {
    const { data: dbData } = await supabase
      .from('scraped_songs')
      .select('artist, title, station_name, ai_genre')
      .in('ai_genre', dbGenreVariants(genres))
      .order('scraped_at', { ascending: false })
      .limit(300);

    if (dbData?.length) {
      const fromDb = matchDbCandidatesInLibrary(dbData, index);
      for (const song of shuffle(fromDb)) {
        if (!isValidCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr, isFullDay)) continue;
        markAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
        return { filename: song.filename, artist: song.artist, title: song.title, genre: song.genre };
      }
    }
  } catch (e) {
    console.warn(`[findSongByGenre] DB query failed:`, e);
  }

  console.warn(`[findSongByGenre] Sem match para gêneros: [${genres.join(', ')}]`);
  return null;
}

// ---------------------------------------------------------------------------
// findSongByYear
// Strategy 1: Library local — ID3 year indexed by decade ← PRIMARY
// Strategy 2: DB with year filter → cross-ref with library
// Bonus: enriches DB with locally discovered years (non-blocking)
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

  // === Strategy 1: Library local — ID3 year indexed ===
  const localCandidates: SongMeta[] = [];
  for (const decade of relevantDecades) {
    const songs = index.byDecade.get(decade) ?? [];
    localCandidates.push(...songs.filter(s => {
      const yr = parseInt(s.year, 10);
      return !isNaN(yr) && yr >= yearMin && yr <= yearMax;
    }));
  }

  const deduped = shuffle([
    ...new Map(localCandidates.map(s => [atKey(s.artist, s.title), s])).values(),
  ]);

  for (const song of deduped) {
    if (!isValidCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr, isFullDay)) continue;
    markAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
    // Enrich DB in background
    enrichDbWithLocalYears(localCandidates).catch(() => {});
    return { filename: song.filename, artist: song.artist, title: song.title, yearRange: `${yearMin}-${yearMax}` };
  }

  // === Strategy 2: DB → cross-ref with library ===
  try {
    const { data: dbData } = await supabase
      .from('scraped_songs')
      .select('artist, title, station_name, year')
      .not('year', 'is', null)
      .gte('year', String(yearMin))
      .lte('year', String(yearMax))
      .order('scraped_at', { ascending: false })
      .limit(300);

    if (dbData?.length) {
      const fromDb = matchDbCandidatesInLibrary(dbData, index);
      for (const song of shuffle(fromDb)) {
        if (!isValidCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr, isFullDay)) continue;
        markAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
        return { filename: song.filename, artist: song.artist, title: song.title, yearRange: `${yearMin}-${yearMax}` };
      }
    }
  } catch (e) {
    console.warn(`[findSongByYear] DB query failed:`, e);
  }

  // Enrich even without match — improves future lookups
  if (localCandidates.length > 0) {
    enrichDbWithLocalYears(localCandidates).catch(() => {});
  }

  console.warn(`[findSongByYear] Sem match na biblioteca para ${yearMin}-${yearMax}`);
  return null;
}

// ---------------------------------------------------------------------------
// findSongByGenreAndYear
// Strategy 1: Library local — byGenreDecade index (O(1)) ← PRIMARY
// Strategy 2: DB with both filters → cross-ref with library
// Strategy 3: Fallback genre-only (explicit warning)
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

  // === Strategy 1: Library local — byGenreDecade O(1) ===
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
    if (!isValidCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr, isFullDay)) continue;
    markAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
    return {
      filename:  song.filename,
      artist:    song.artist,
      title:     song.title,
      genre:     song.genre,
      yearRange: `${yearMin}-${yearMax}`,
    };
  }

  // === Strategy 2: DB → cross-ref with library ===
  try {
    const { data: dbData } = await supabase
      .from('scraped_songs')
      .select('artist, title, station_name, ai_genre, year')
      .in('ai_genre', dbGenreVariants(genres))
      .not('year', 'is', null)
      .gte('year', String(yearMin))
      .lte('year', String(yearMax))
      .order('scraped_at', { ascending: false })
      .limit(300);

    if (dbData?.length) {
      const fromDb = matchDbCandidatesInLibrary(dbData, index);
      for (const song of shuffle(fromDb)) {
        if (!isValidCandidate(song, usedInBlock, usedArtistsInBlock, ctx, timeStr, isFullDay)) continue;
        markAsUsed(song, usedInBlock, usedArtistsInBlock, ctx, timeStr);
        return {
          filename:  song.filename,
          artist:    song.artist,
          title:     song.title,
          genre:     song.genre,
          yearRange: `${yearMin}-${yearMax}`,
        };
      }
    }
  } catch (e) {
    console.warn(`[findSongByGenreAndYear] DB query failed:`, e);
  }

  // === Strategy 3: Fallback — genre only (explicit warning) ===
  console.warn(
    `[findSongByGenreAndYear] FALLBACK — Sem match para [${genres.join(', ')}] em ${yearMin}-${yearMax}. ` +
    `Buscando só por gênero. Verifique: (1) ID3 year preenchido, (2) DB possui year.`
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

// =========================================================================
// EXISTING GENERATORS — preserved with minor improvements
// =========================================================================

/**
 * Generate the Voz do Brasil block (21:00 weekdays).
 */
export function generateVozDoBrasil(timeStr: string): BlockResult {
  return {
    line: '21:00 (FIXO ID=VOZ DO BRASIL) vht,vozbrasil',
    logs: [{
      blockTime: timeStr,
      type: 'fixed',
      title: 'A Voz do Brasil',
      artist: 'Governo Federal',
      station: 'EBC',
      reason: 'Conteúdo fixo obrigatório - sem montagem do sistema',
    }],
  };
}

/**
 * Generate Misturadão block (20:00 or 20:30 weekdays).
 */
export async function generateMisturadao(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = ctx.getFullDayName(targetDay);
  const sortedRanking = applyTemporalDecay([...ctx.rankingSongs]);
  const logs: BlockLogItem[] = [];
  const usedPositions = new Set<number>();

  const getRankingFilename = async (preferredPosition: number): Promise<string> => {
    const positionsToTry: number[] = [preferredPosition];
    for (let offset = 1; offset <= sortedRanking.length; offset++) {
      if (preferredPosition + offset <= sortedRanking.length) positionsToTry.push(preferredPosition + offset);
      if (preferredPosition - offset > 0) positionsToTry.push(preferredPosition - offset);
    }

    for (const pos of positionsToTry) {
      if (pos < 1 || pos > sortedRanking.length || usedPositions.has(pos)) continue;
      
      const song = sortedRanking[pos - 1];
      if (ctx.isRecentlyUsed(song.title, song.artist, timeStr)) continue;

      const libraryResult = await ctx.findSongInLibrary(song.artist, song.title);
      if (libraryResult.exists) {
        usedPositions.add(pos);
        ctx.markSongAsUsed(song.title, song.artist, timeStr);
        const realFilename = libraryResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
        
        logs.push({
          blockTime: timeStr,
          type: 'used',
          title: song.title,
          artist: song.artist,
          station: 'RANKING',
          reason: `Ranking posição ${pos}${pos !== preferredPosition ? ` (fallback da posição ${preferredPosition})` : ''}`,
        });
        
        return realFilename;
      }
    }

    console.warn(`[MISTURADAO] ⚠️ Nenhuma música do ranking disponível para posição ${preferredPosition}, usando coringa`);
    logs.push({
      blockTime: timeStr,
      type: 'substituted',
      title: ctx.coringaCode,
      artist: 'CORINGA',
      station: 'RANKING',
      reason: `Ranking vazio ou sem música na biblioteca para posição ${preferredPosition}`,
    });
    return ctx.coringaCode;
  };

  if (minute === 0) {
    const misturadao01 = `MISTURADAO_BLOCO01_${dayName}.mp3`;
    const misturadao02 = `MISTURADAO_BLOCO02_${dayName}.mp3`;
    const posicao05 = await getRankingFilename(5);
    const posicao04 = await getRankingFilename(4);
    
    logs.push({
      blockTime: timeStr,
      type: 'fixed',
      title: 'MISTURADÃO Bloco 20:00',
      artist: `${misturadao01}, ${misturadao02}`,
      station: 'FIXO',
      reason: `Formato especial com ranking (posições usadas: ${[...usedPositions].join(', ') || 'nenhuma'})`,
    });
    
    return {
      line: ctx.sanitizeGradeLine(`${timeStr} (ID=MISTURADAO) "${misturadao01}",vht,"${posicao05}",vht,"${misturadao02}",vht,"${posicao04}"`),
      logs,
    };
  } else {
    const misturadao03 = `MISTURADAO_BLOCO03_${dayName}.mp3`;
    const misturadao04 = `MISTURADAO_BLOCO04_${dayName}.mp3`;
    const posicao02 = await getRankingFilename(2);
    const posicao01 = await getRankingFilename(1);
    
    logs.push({
      blockTime: timeStr,
      type: 'fixed',
      title: 'MISTURADÃO Bloco 20:30',
      artist: `${misturadao03}, ${misturadao04}`,
      station: 'FIXO',
      reason: `Formato especial com ranking (posições usadas: ${[...usedPositions].join(', ') || 'nenhuma'})`,
    });
    
    return {
      line: ctx.sanitizeGradeLine(`${timeStr} (ID=MISTURADAO) "${misturadao03}",vht,"${posicao02}",vht,"${misturadao04}",vht,"${posicao01}"`),
      logs,
    };
  }
}

/**
 * Generate TOP50 block (19:00/19:30 weekdays).
 */
export async function generateTop50Block(
  hour: number,
  minute: number,
  top50Count: number,
  ctx: GradeContext
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const SONGS_PER_BLOCK = 10;
  
  const sorted = applyTemporalDecay([...ctx.rankingSongs]);
  
  const isFirstBlock = minute === 0;
  const startIndex = isFirstBlock ? 19 : 9;
  const endIndex = isFirstBlock ? 10 : 0;

  const top50Songs: string[] = [];
  const usedPositions: number[] = [];

  for (let i = startIndex; i >= endIndex && top50Songs.length < SONGS_PER_BLOCK; i--) {
    if (i >= sorted.length) continue;
    
    const song = sorted[i];
    if (ctx.isRecentlyUsed(song.title, song.artist, timeStr)) continue;

    const libraryResult = await ctx.findSongInLibrary(song.artist, song.title);
    if (libraryResult.exists) {
      const realFilename = libraryResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
      top50Songs.push(realFilename);
      ctx.markSongAsUsed(song.title, song.artist, timeStr);
      usedPositions.push(i + 1);
      
      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: song.title,
        artist: song.artist,
        station: 'RANKING',
        reason: `TOP50 posição ${i + 1}`,
      });
    } else {
      top50Songs.push(ctx.coringaCode);
      logs.push({
        blockTime: timeStr,
        type: 'substituted',
        title: ctx.coringaCode,
        artist: song.artist,
        station: 'RANKING',
        reason: `TOP50 posição ${i + 1} - não encontrada na biblioteca`,
      });
    }
  }

  while (top50Songs.length < SONGS_PER_BLOCK) {
    top50Songs.push(ctx.coringaCode);
    logs.push({
      blockTime: timeStr,
      type: 'substituted',
      title: ctx.coringaCode,
      artist: 'CORINGA',
      station: 'RANKING',
      reason: 'Ranking insuficiente para preencher bloco TOP50',
    });
  }

  const posRange = isFirstBlock ? '20→11' : '10→01';
  logs.push({
    blockTime: timeStr,
    type: 'fixed',
    title: `TOP50 - Posições ${posRange}`,
    artist: 'Ranking',
    station: 'TOP50',
    reason: `Bloco TOP50 com músicas reais do ranking (posições ${usedPositions.join(', ') || 'nenhuma'})`,
  });

  return {
    line: ctx.sanitizeGradeLine(`${timeStr} (ID=TOP50) ${top50Songs.map(s => s === ctx.coringaCode ? s : `"${s}"`).join(',vhtn,')}`),
    logs,
  };
}

/**
 * Generate Madrugada block (00:00-04:30) - Mix from ALL stations.
 */
export async function generateMadrugada(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  programName: string
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const TARGET_SONGS = 10;

  const allPool: SongEntry[] = [];
  for (const stationSongs of Object.values(songsByStation)) {
    allPool.push(...stationSongs);
  }
  const shuffled = [...allPool].sort(() => Math.random() - 0.5);

  const candidatesToCheck = shuffled.slice(0, 30);
  const batchResults = await ctx.batchFindSongsInLibrary(
    candidatesToCheck.map(s => ({ artist: s.artist, title: s.title }))
  );

  const mixSongs: string[] = [];
  const mixUsedArtists = new Set<string>();
  const mixUsedKeys = new Set<string>();

  for (const candidate of shuffled) {
    if (mixSongs.length >= TARGET_SONGS) break;
    
    const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
    const normalizedArtist = candidate.artist.toLowerCase().trim();
    
    if (mixUsedKeys.has(key) || mixUsedArtists.has(normalizedArtist)) continue;
    if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) continue;
    
    const batchKey = `${candidate.artist.toLowerCase().trim()}|${candidate.title.toLowerCase().trim()}`;
    const libraryResult = batchResults.get(batchKey) || await ctx.findSongInLibrary(candidate.artist, candidate.title);
    
    if (libraryResult.exists) {
      const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
      mixSongs.push(`"${correctFilename}"`);
      mixUsedKeys.add(key);
      mixUsedArtists.add(normalizedArtist);
      ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);
      
      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: candidate.title,
        artist: candidate.artist,
        station: candidate.station,
        style: candidate.style,
        reason: 'Miscelânea madrugada (todas as rádios)',
      });
    }
  }

  while (mixSongs.length < TARGET_SONGS) {
    mixSongs.push(ctx.coringaCode);
    stats.missing++;
    logs.push({
      blockTime: timeStr,
      type: 'substituted',
      title: ctx.coringaCode,
      artist: 'CORINGA',
      station: 'FALLBACK',
      reason: 'Pool da madrugada esgotado',
    });
  }

  return {
    line: ctx.sanitizeGradeLine(`${timeStr} (ID=${programName}) ${mixSongs.join(',vht,')}`),
    logs,
  };
}

/**
 * Generate Rock & Metal block — now uses LibraryIndex + DB cross-ref.
 */
export async function generateRockMetal(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const TARGET_SONGS = 10;
  const usedInBlock = new Set<string>();
  const usedArtistsInBlock = new Set<string>();

  const selectedSongs: string[] = [];

  for (let i = 0; i < TARGET_SONGS; i++) {
    const result = await findSongByGenre(['ROCK', 'METAL'], timeStr, usedInBlock, usedArtistsInBlock, ctx, false);
    if (result) {
      selectedSongs.push(`"${result.filename}"`);
      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: result.title,
        artist: result.artist,
        station: result.genre.toUpperCase(),
        reason: `Rock/Metal por gênero (${result.genre})`,
      });
    } else {
      selectedSongs.push(ctx.coringaCode);
      logs.push({
        blockTime: timeStr,
        type: 'substituted',
        title: ctx.coringaCode,
        artist: 'CORINGA',
        station: 'FALLBACK',
        reason: 'Pool Rock/Metal esgotado',
      });
    }
  }

  logs.push({
    blockTime: timeStr,
    type: 'fixed',
    title: 'Rock & Metal Mix',
    artist: `${selectedSongs.filter(s => s !== ctx.coringaCode).length} músicas`,
    station: 'ROCK/METAL',
    reason: `10 músicas filtradas por gênero ROCK/METAL via LibraryIndex + DB`,
  });

  return {
    line: ctx.sanitizeGradeLine(
      `${timeStr} (ID=ROCK METAL) ${selectedSongs.join(',vhtn,')}`
    ),
    logs,
  };
}

/**
 * Generate TOP10 Década block.
 */
export async function generateTop10Decada(
  hour: number,
  minute: number,
  yearMin: number,
  yearMax: number,
  ctx: GradeContext,
  targetDay?: WeekDay
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const TARGET_SONGS = 10;
  const usedInBlock = new Set<string>();
  const usedArtistsInBlock = new Set<string>();

  const decadeSongs: string[] = [];

  for (let i = 0; i < TARGET_SONGS; i++) {
    const result = await findSongByYear(yearMin, yearMax, timeStr, usedInBlock, usedArtistsInBlock, ctx, false);
    if (result) {
      decadeSongs.push(`"${result.filename}"`);
      usedInBlock.add(atKey(result.artist, result.title));
      usedArtistsInBlock.add(result.artist.toLowerCase().trim());
      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: result.title,
        artist: result.artist,
        station: 'DÉCADA',
        reason: `TOP10 Década ${yearMin}-${yearMax}`,
      });
    } else {
      decadeSongs.push(ctx.coringaCode);
      logs.push({
        blockTime: timeStr,
        type: 'substituted',
        title: ctx.coringaCode,
        artist: 'CORINGA',
        station: 'FALLBACK',
        reason: `Pool década ${yearMin}-${yearMax} esgotado`,
      });
    }
  }

  logs.push({
    blockTime: timeStr,
    type: 'fixed',
    title: `TOP10 Década ${yearMin}-${yearMax}`,
    artist: `${decadeSongs.filter(s => s !== ctx.coringaCode).length} músicas`,
    station: 'DÉCADA',
    reason: `10 músicas de ${yearMin} a ${yearMax} via LibraryIndex + DB`,
  });

  return {
    line: ctx.sanitizeGradeLine(
      `${timeStr} (ID=TOP10) ${decadeSongs.join(',vhtn,')}`
    ),
    logs,
  };
}

/**
 * Generate TOP10 block (18:30 weekdays).
 */
export async function generateTop10Block(
  hour: number,
  minute: number,
  ctx: GradeContext,
  targetDay?: WeekDay
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = ctx.getFullDayName(targetDay);
  const logs: BlockLogItem[] = [];

  const esporte01 = `AS_ULTIMAS_DO_ESPORTE_EDICAO01_${dayName}.mp3`;
  const esporte02 = `AS_ULTIMAS_DO_ESPORTE_EDICAO02_${dayName}.mp3`;
  const top10_01 = `TOP_10_MIX_BLOCO01_${dayName}.MP3`;
  const top10_02 = `TOP_10_MIX_BLOCO02_${dayName}.MP3`;

  const sortedRanking = applyTemporalDecay([...ctx.rankingSongs]);
  const usedPositions = new Set<number>();

  const getRankingSong = async (preferredPos: number): Promise<string> => {
    for (let offset = 0; offset < sortedRanking.length; offset++) {
      const pos = preferredPos + offset;
      if (pos < 1 || pos > sortedRanking.length || usedPositions.has(pos)) continue;
      
      const song = sortedRanking[pos - 1];
      if (ctx.isRecentlyUsed(song.title, song.artist, timeStr)) continue;

      const libraryResult = await ctx.findSongInLibrary(song.artist, song.title);
      if (libraryResult.exists) {
        usedPositions.add(pos);
        ctx.markSongAsUsed(song.title, song.artist, timeStr);
        const realFilename = libraryResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
        
        logs.push({
          blockTime: timeStr,
          type: 'used',
          title: song.title,
          artist: song.artist,
          station: 'RANKING',
          reason: `TOP10 posição ${pos}`,
        });
        
        return `"${realFilename}"`;
      }
    }
    
    logs.push({
      blockTime: timeStr,
      type: 'substituted',
      title: ctx.coringaCode,
      artist: 'CORINGA',
      station: 'RANKING',
      reason: `TOP10 sem música do ranking disponível para posição ${preferredPos}`,
    });
    return ctx.coringaCode;
  };

  const musica01 = await getRankingSong(1);
  const musica02 = await getRankingSong(2);

  logs.push({
    blockTime: timeStr,
    type: 'fixed',
    title: 'TOP 10 MIX',
    artist: `${esporte01}, ${top10_01}, ${esporte02}, ${top10_02}`,
    station: 'FIXO',
    reason: `Programa especial TOP10 com esporte, mix e ranking (posições ${[...usedPositions].join(', ') || 'nenhuma'})`,
  });

  return {
    line: ctx.sanitizeGradeLine(
      `${timeStr} (ID=TOP10) "${esporte01}",vhtn,"${top10_01}",vht,${musica01},vhtn,"${esporte02}",vhtn,"${top10_02}",vhtn,${musica02}`
    ),
    logs,
  };
}

/**
 * Generate Sertanejo Nossa block (05:00-07:30).
 */
export async function generateSertanejoNossa(
  hour: number,
  minute: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const logs: BlockLogItem[] = [];
  const SERTANEJO_STATIONS = ['Liberdade FM', 'Positiva FM'];
  const TARGET_SONGS = 10;
  const CORINGA = 'clas';

  const stationPools: Record<string, SongEntry[]> = {};
  for (const stName of SERTANEJO_STATIONS) {
    const directPool = songsByStation[stName] || [];
    if (directPool.length > 0) {
      stationPools[stName] = [...directPool].sort(() => Math.random() - 0.5);
    } else {
      for (const [poolName, poolSongs] of Object.entries(songsByStation)) {
        const norm1 = poolName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const norm2 = stName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (norm1.includes(norm2) || norm2.includes(norm1)) {
          stationPools[stName] = [...poolSongs].sort(() => Math.random() - 0.5);
          break;
        }
      }
    }
    if (!stationPools[stName]) stationPools[stName] = [];
  }

  const allCandidates: Array<{ artist: string; title: string }> = [];
  for (const pool of Object.values(stationPools)) {
    for (const song of pool) {
      allCandidates.push({ artist: song.artist, title: song.title });
    }
  }
  const batchResults = await ctx.batchFindSongsInLibrary(allCandidates);

  const sertanejoSongs: string[] = [];
  const sertUsedArtists = new Set<string>();
  const sertUsedKeys = new Set<string>();
  const stationIndices: Record<string, number> = {};
  SERTANEJO_STATIONS.forEach(s => stationIndices[s] = 0);

  for (let i = 0; i < TARGET_SONGS; i++) {
    const currentStation = SERTANEJO_STATIONS[i % SERTANEJO_STATIONS.length];
    const pool = stationPools[currentStation] || [];
    let found = false;

    while (stationIndices[currentStation] < pool.length && !found) {
      const candidate = pool[stationIndices[currentStation]];
      stationIndices[currentStation]++;

      const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
      const normalizedArtist = candidate.artist.toLowerCase().trim();

      if (sertUsedKeys.has(key) || sertUsedArtists.has(normalizedArtist)) continue;
      if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) continue;

      const batchKey = `${candidate.artist.toLowerCase().trim()}|${candidate.title.toLowerCase().trim()}`;
      const libraryResult = batchResults.get(batchKey) || await ctx.findSongInLibrary(candidate.artist, candidate.title);

      if (libraryResult.exists) {
        const correctFilename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
        sertanejoSongs.push(`"${correctFilename}"`);
        sertUsedKeys.add(key);
        sertUsedArtists.add(normalizedArtist);
        ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);

        logs.push({
          blockTime: timeStr,
          type: 'used',
          title: candidate.title,
          artist: candidate.artist,
          station: currentStation,
          style: candidate.style,
          reason: `Sertanejo Nossa (${currentStation})`,
        });
        found = true;
      }
    }

    if (!found) {
      sertanejoSongs.push(CORINGA);
      stats.missing++;
      logs.push({
        blockTime: timeStr,
        type: 'substituted',
        title: CORINGA,
        artist: 'CORINGA',
        station: currentStation,
        reason: `Pool ${currentStation} esgotado`,
      });
    }
  }

  return {
    line: ctx.sanitizeGradeLine(`${timeStr} (ID=Sertanejo Nossa) ${sertanejoSongs.join(',vht,')}`),
    logs,
  };
}

/**
 * Generate Raridades block — now uses findSongByYear with LibraryIndex.
 */
export async function generateRaridades(
  hour: number,
  minute: number,
  yearMin: number,
  yearMax: number,
  _fixedFileName: string,
  _editionIndex: number,
  songsByStation: Record<string, SongEntry[]>,
  stats: BlockStats,
  isFullDay: boolean,
  ctx: GradeContext,
  targetDay?: WeekDay
): Promise<BlockResult> {
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const dayName = ctx.getFullDayName(targetDay);
  const logs: BlockLogItem[] = [];
  const DECADE_SONGS_NEEDED = 2;
  const usedInBlock = new Set<string>();
  const usedArtistsInBlock = new Set<string>();

  // Select decade songs using the upgraded finder
  const decadeSongs: string[] = [];
  for (let i = 0; i < DECADE_SONGS_NEEDED; i++) {
    const result = await findSongByYear(yearMin, yearMax, timeStr, usedInBlock, usedArtistsInBlock, ctx, isFullDay);
    if (result) {
      decadeSongs.push(`"${result.filename}"`);
      usedInBlock.add(atKey(result.artist, result.title));
      usedArtistsInBlock.add(result.artist.toLowerCase().trim());
      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: result.title,
        artist: result.artist,
        station: 'DÉCADA',
        reason: `Raridades (ano ${yearMin}-${yearMax})`,
      });
    } else {
      decadeSongs.push(ctx.coringaCode);
      stats.missing++;
      logs.push({
        blockTime: timeStr,
        type: 'substituted',
        title: ctx.coringaCode,
        artist: 'CORINGA',
        station: 'FALLBACK',
        reason: `Pool de raridades ${yearMin}-${yearMax} esgotado`,
      });
    }
  }

  // Build template line
  let line: string;

  if (minute === 0) {
    const noticia = `NOTICIA_DA_HORA_12HORAS_${dayName}.MP3`;
    const rarBloco01 = `RARIDADES_BLOCO01_${dayName}.mp3`;
    const esporte01 = `AS_ULTIMAS_DO_ESPORTE_EDICAO01_${dayName}.MP3`;
    const fatos01 = `FATOS_E_BOATOS_EDICAO01_${dayName}.MP3`;
    const rarBloco02 = `RARIDADES_BLOCO02_${dayName}.mp3`;

    line = `${timeStr} (ID=Raridades) "${noticia}",vht,"${rarBloco01}","${esporte01}",vht,"${fatos01}","${rarBloco02}",vht,${decadeSongs[0]},vht,${decadeSongs[1]}`;

    logs.push({
      blockTime: timeStr,
      type: 'fixed',
      title: 'Raridades Bloco 12:00',
      artist: `${noticia}, ${rarBloco01}, ${rarBloco02}`,
      station: 'FIXO',
      reason: `Template Raridades 12:00 com ${decadeSongs.filter(s => s !== ctx.coringaCode).length} músicas da década ${yearMin}-${yearMax}`,
    });
  } else {
    const noticia = `NOTICIA_DA_HORA_10HORAS_${dayName}.MP3`;
    const rarBloco03 = `RARIDADES_BLOCO03_${dayName}.mp3`;
    const patrulha = `PATRULHA_DO_CONSUMIDOR_${dayName}.mp3`;
    const esporte02 = `AS_ULTIMAS_DO_ESPORTE_EDICAO02_${dayName}.MP3`;
    const fatos04 = `FATOS_E_BOATOS_EDICAO04_${dayName}.MP3`;
    const rarBloco04 = `RARIDADES_BLOCO04_${dayName}.mp3`;

    line = `${timeStr} (ID=Raridades) "${noticia}",vht,"${rarBloco03}","${patrulha}",vht,"${esporte02}",vht,"${fatos04}","${rarBloco04}",vht,${decadeSongs[0]},vht,${decadeSongs[1]}`;

    logs.push({
      blockTime: timeStr,
      type: 'fixed',
      title: 'Raridades Bloco 12:30',
      artist: `${noticia}, ${rarBloco03}, ${rarBloco04}`,
      station: 'FIXO',
      reason: `Template Raridades 12:30 com ${decadeSongs.filter(s => s !== ctx.coringaCode).length} músicas da década ${yearMin}-${yearMax}`,
    });
  }

  return {
    line: ctx.sanitizeGradeLine(line),
    logs,
  };
}
