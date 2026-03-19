/**
 * Special Program Generators
 * 
 * Each function generates a complete block for a specific radio program:
 * - Voz do Brasil (21:00 weekdays)
 * - Misturadão (20:00 and 20:30 weekdays)
 * - Madrugada (00:00-04:30)
 * - Sertanejo Nossa (05:00-07:30)
 * - TOP50 (19:00-19:30)
 */

import { sanitizeFilename } from '@/lib/sanitizeFilename';
import type { SongEntry, BlockResult, BlockLogItem, BlockStats, GradeContext } from './types';
import type { WeekDay } from '@/types/radio';
import { applyTemporalDecay } from '@/lib/rankingDecay';

/**
 * Generate the Voz do Brasil block (21:00 weekdays).
 * Hardcoded format - never goes through sanitization.
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
 * Uses real ranking songs with library verification.
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

  /**
   * Get the real filename from ranking at preferred position.
   * Falls back to any available ranking song, then coringa.
   */
  const getRankingFilename = async (preferredPosition: number): Promise<string> => {
    // Try preferred position first, then nearby positions
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

    // All ranking songs exhausted or missing from library → coringa
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
    
    // posicao01 é a ÚLTIMA música do bloco (grand finale)
    return {
      line: ctx.sanitizeGradeLine(`${timeStr} (ID=MISTURADAO) "${misturadao03}",vht,"${posicao02}",vht,"${misturadao04}",vht,"${posicao01}"`),
      logs,
    };
  }
}

/**
 * Generate TOP50 block (19:00/19:30 weekdays).
 * Uses 20 positions from the ranking in reverse order:
 *  - 19:00 → positions 20 down to 11 (least to mid)
 *  - 19:30 → positions 10 down to 01 (mid to top)
 * Each song is verified in the local music library.
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
  
  // Sort ranking by plays descending → index 0 = position 1 (most played)
  const sorted = applyTemporalDecay([...ctx.rankingSongs]);
  
  // 19:00 block: positions 20→11 (indices 19→10)
  // 19:30 block: positions 10→01 (indices 9→0)
  const isFirstBlock = minute === 0;
  const startIndex = isFirstBlock ? 19 : 9;  // position 20 or 10
  const endIndex = isFirstBlock ? 10 : 0;    // position 11 or 01

  const top50Songs: string[] = [];
  const usedPositions: number[] = [];

  // Walk from startIndex down to endIndex (reverse order)
  for (let i = startIndex; i >= endIndex && top50Songs.length < SONGS_PER_BLOCK; i--) {
    if (i >= sorted.length) continue;
    
    const song = sorted[i];
    if (ctx.isRecentlyUsed(song.title, song.artist, timeStr)) continue;

    const libraryResult = await ctx.findSongInLibrary(song.artist, song.title);
    if (libraryResult.exists) {
      const realFilename = libraryResult.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
      top50Songs.push(realFilename);
      ctx.markSongAsUsed(song.title, song.artist, timeStr);
      usedPositions.push(i + 1); // human-readable position (1-based)
      
      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: song.title,
        artist: song.artist,
        station: 'RANKING',
        reason: `TOP50 posição ${i + 1}`,
      });
    } else {
      // Song not in library → use coringa and log
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

  // Fill remaining slots with coringa if ranking has fewer than needed
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

  // Build flattened pool and shuffle
  const allPool: SongEntry[] = [];
  for (const stationSongs of Object.values(songsByStation)) {
    allPool.push(...stationSongs);
  }
  const shuffled = [...allPool].sort(() => Math.random() - 0.5);

  // Pre-check library existence in batch for candidates
  const candidatesToCheck = shuffled.slice(0, 30); // Check more than needed for filtering
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
    
    // Use batch result if available, otherwise check individually
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

  // Fill remaining with coringa
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
 * Generate Sertanejo Nossa block (05:00-07:30).
 * Alternates Liberdade FM and Positiva FM. Coringa: clas.
 */
/**
 * Generate Rock & Metal block (19:00/19:30 weekdays).
 * Pulls 10 songs from the database filtered by ai_genre = ROCK or METAL,
 * then verifies they exist in the local library before adding to the grade.
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

  // Fetch Rock and Metal songs from the database by ai_genre
  let dbGenreSongs: Array<{ artist: string; title: string; station_name: string; ai_genre: string }> = [];
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data, error } = await supabase
      .from('scraped_songs')
      .select('artist, title, station_name, ai_genre')
      .in('ai_genre', ['ROCK', 'METAL', 'Rock', 'Metal'])
      .order('scraped_at', { ascending: false })
      .limit(500);

    if (!error && data) {
      dbGenreSongs = data as typeof dbGenreSongs;
    }
  } catch (e) {
    console.warn('[ROCK-METAL] Falha ao buscar músicas por gênero:', e);
  }

  // Deduplicate by artist+title
  const seen = new Set<string>();
  const candidates: Array<{ artist: string; title: string; station: string; genre: string }> = [];
  for (const s of dbGenreSongs) {
    const key = `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ artist: s.artist, title: s.title, station: s.station_name, genre: s.ai_genre });
  }

  // Shuffle for variety
  candidates.sort(() => Math.random() - 0.5);

  // Select songs, checking library and anti-repetition
  const selectedSongs: string[] = [];
  const usedArtists = new Set<string>();

  for (const candidate of candidates) {
    if (selectedSongs.length >= TARGET_SONGS) break;

    const normalizedArtist = candidate.artist.toLowerCase().trim();
    if (usedArtists.has(normalizedArtist)) continue;
    if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr)) continue;

    const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
    if (libraryResult.exists) {
      const filename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
      selectedSongs.push(`"${filename}"`);
      usedArtists.add(normalizedArtist);
      ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);

      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: candidate.title,
        artist: candidate.artist,
        station: candidate.genre.toUpperCase(),
        reason: `Rock/Metal por gênero (ai_genre=${candidate.genre})`,
      });
    }
  }

  // Fill remaining with coringa
  while (selectedSongs.length < TARGET_SONGS) {
    selectedSongs.push(ctx.coringaCode);
    logs.push({
      blockTime: timeStr,
      type: 'substituted',
      title: ctx.coringaCode,
      artist: 'CORINGA',
      station: 'FALLBACK',
      reason: 'Pool Rock/Metal por gênero esgotado',
    });
  }

  logs.push({
    blockTime: timeStr,
    type: 'fixed',
    title: 'Rock & Metal Mix',
    artist: `${selectedSongs.length} músicas (pool: ${candidates.length} candidatos por gênero)`,
    station: 'ROCK/METAL',
    reason: `10 músicas filtradas por ai_genre ROCK/METAL intercaladas com vhtn`,
  });

  return {
    line: ctx.sanitizeGradeLine(
      `${timeStr} (ID=ROCK METAL) ${selectedSongs.join(',vhtn,')}`
    ),
    logs,
  };
}

/**
 * Generic genre-based song finder for sequence positions.
 * Pulls a single song from the database filtered by ai_genre.
 * Used by sequence positions with source "genre_SERTANEJO", "genre_PAGODE", etc.
 */
export async function findSongByGenre(
  genres: string[],
  timeStr: string,
  usedInBlock: Set<string>,
  usedArtistsInBlock: Set<string>,
  ctx: GradeContext,
  isFullDay: boolean = false,
): Promise<{ filename: string; artist: string; title: string; genre: string } | null> {
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const genreVariants = genres.flatMap(g => [
      g.toUpperCase(), g, g.charAt(0).toUpperCase() + g.slice(1).toLowerCase()
    ]);
    const uniqueVariants = [...new Set(genreVariants)];
    
    const { data, error } = await supabase
      .from('scraped_songs')
      .select('artist, title, station_name, ai_genre')
      .in('ai_genre', uniqueVariants)
      .order('scraped_at', { ascending: false })
      .limit(300);

    if (error || !data || data.length === 0) return null;

    const seen = new Set<string>();
    const candidates: Array<{ artist: string; title: string; station: string; genre: string }> = [];
    for (const s of data) {
      const key = `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ artist: s.artist, title: s.title, station: s.station_name, genre: s.ai_genre || genres[0] });
    }
    candidates.sort(() => Math.random() - 0.5);

    for (const candidate of candidates) {
      const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
      const normalizedArtist = candidate.artist.toLowerCase().trim();
      if (usedInBlock.has(key) || usedArtistsInBlock.has(normalizedArtist)) continue;
      if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) continue;

      const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
      if (libraryResult.exists) {
        const filename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
        return { filename, artist: candidate.artist, title: candidate.title, genre: candidate.genre };
      }
    }
  } catch (e) {
    console.warn(`[GENRE-BLOCK] Falha ao buscar por gênero ${genres.join('/')}:`, e);
  }
  return null;
}

/**
 * Generic year-based song finder for sequence positions.
 * Pulls a single song from the database filtered by year range.
 * Used by sequence positions with source "year_80s", "year_90s", etc.
 */
export async function findSongByYear(
  yearMin: number,
  yearMax: number,
  timeStr: string,
  usedInBlock: Set<string>,
  usedArtistsInBlock: Set<string>,
  ctx: GradeContext,
  isFullDay: boolean = false,
): Promise<{ filename: string; artist: string; title: string; yearRange: string } | null> {
  // === Strategy 1: Query DB for year-tagged songs ===
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    
    const { data, error } = await supabase
      .from('scraped_songs')
      .select('artist, title, station_name, year')
      .not('year', 'is', null)
      .gte('year', String(yearMin))
      .lte('year', String(yearMax))
      .order('scraped_at', { ascending: false })
      .limit(300);

    if (!error && data && data.length > 0) {
      const seen = new Set<string>();
      const candidates: Array<{ artist: string; title: string; station: string }> = [];
      for (const s of data) {
        const key = `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ artist: s.artist, title: s.title, station: s.station_name });
      }
      candidates.sort(() => Math.random() - 0.5);

      for (const candidate of candidates) {
        const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
        const normalizedArtist = candidate.artist.toLowerCase().trim();
        if (usedInBlock.has(key) || usedArtistsInBlock.has(normalizedArtist)) continue;
        if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) continue;

        const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
        if (libraryResult.exists) {
          const filename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          return { filename, artist: candidate.artist, title: candidate.title, yearRange: `${yearMin}-${yearMax}` };
        }
      }
    }
  } catch (e) {
    console.warn(`[YEAR-BLOCK] Falha ao buscar por ano ${yearMin}-${yearMax} no DB:`, e);
  }

  // === Strategy 2: Fallback — scan local library ID3 tags for year ===
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;
  if (isElectron && (window as any).electronAPI?.scanLibraryMetadata) {
    try {
      console.log(`[YEAR-BLOCK] 📂 DB sem resultados para ${yearMin}-${yearMax}, buscando na biblioteca local...`);
      const { useRadioStore } = await import('@/store/radioStore');
      const { config } = useRadioStore.getState();
      const allFolders = config.musicFolders?.filter(Boolean) || [];
      if (allFolders.length > 0) {
        const scanResult = await (window as any).electronAPI.scanLibraryMetadata({ musicFolders: allFolders });
        if (scanResult?.success && scanResult.songs?.length) {
          // Filter songs by year range from ID3 tags
          const yearFiltered = scanResult.songs
            .filter((s: any) => {
              if (!s.year) return false;
              const yr = parseInt(s.year, 10);
              return !isNaN(yr) && yr >= yearMin && yr <= yearMax && s.artist && s.artist !== 'Desconhecido';
            })
            .sort(() => Math.random() - 0.5);

          console.log(`[YEAR-BLOCK] 📂 Encontradas ${yearFiltered.length} músicas dos anos ${yearMin}-${yearMax} na biblioteca`);

          // Also batch-update DB with discovered years (async, non-blocking)
          if (yearFiltered.length > 0) {
            const { supabase } = await import('@/integrations/supabase/client');
            // Fire and forget — update DB so next time it's available from DB directly
            Promise.resolve().then(async () => {
              let updated = 0;
              for (const song of yearFiltered.slice(0, 100)) {
                try {
                  const { data: matchedSongs } = await supabase
                    .from('scraped_songs')
                    .select('id')
                    .ilike('artist', song.artist.trim())
                    .ilike('title', song.title.trim())
                    .is('year', null)
                    .limit(5);
                  if (matchedSongs?.length) {
                    for (const ms of matchedSongs) {
                      await supabase.from('scraped_songs').update({ year: String(song.year) }).eq('id', ms.id);
                      updated++;
                    }
                  }
                } catch { /* non-critical */ }
              }
              if (updated > 0) console.log(`[YEAR-BLOCK] 📅 Atualizadas ${updated} músicas no DB com ano do ID3`);
            });
          }

          for (const song of yearFiltered) {
            const key = `${song.title.toLowerCase().trim()}-${song.artist.toLowerCase().trim()}`;
            const normalizedArtist = song.artist.toLowerCase().trim();
            if (usedInBlock.has(key) || usedArtistsInBlock.has(normalizedArtist)) continue;
            if (ctx.isRecentlyUsed(song.title, song.artist, timeStr, isFullDay)) continue;

            // The file exists in library (we scanned it from there)
            const filename = song.filename || sanitizeFilename(`${song.artist} - ${song.title}.mp3`);
            return { filename, artist: song.artist, title: song.title, yearRange: `${yearMin}-${yearMax}` };
          }
        }
      }
    } catch (e) {
      console.warn(`[YEAR-BLOCK] Fallback local falhou:`, e);
    }
  }

  return null;
}

/**
 * Pulls 10 songs from years 2000-2010, intercalated with vhtn.
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

  // Fetch songs from DB filtered by year range
  let dbYearSongs: Array<{ artist: string; title: string; station_name: string; year: string }> = [];
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data, error } = await supabase
      .from('scraped_songs')
      .select('artist, title, station_name, year')
      .not('year', 'is', null)
      .gte('year', String(yearMin))
      .lte('year', String(yearMax))
      .order('scraped_at', { ascending: false })
      .limit(300);

    if (!error && data) {
      dbYearSongs = data as typeof dbYearSongs;
    }
  } catch (e) {
    console.warn('[TOP10-DECADA] Falha ao buscar músicas por ano:', e);
  }

  // Deduplicate and shuffle
  const seen = new Set<string>();
  const candidates: Array<{ artist: string; title: string; station: string }> = [];
  for (const s of dbYearSongs) {
    const key = `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ artist: s.artist, title: s.title, station: s.station_name });
  }
  candidates.sort(() => Math.random() - 0.5);

  // Batch check library
  const batchResults = await ctx.batchFindSongsInLibrary(
    candidates.slice(0, 60).map(c => ({ artist: c.artist, title: c.title }))
  );

  const decadeSongs: string[] = [];
  const usedArtists = new Set<string>();

  for (const candidate of candidates) {
    if (decadeSongs.length >= TARGET_SONGS) break;

    const normalizedArtist = candidate.artist.toLowerCase().trim();
    if (usedArtists.has(normalizedArtist)) continue;
    if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr)) continue;

    const batchKey = `${normalizedArtist}|${candidate.title.toLowerCase().trim()}`;
    const libraryResult = batchResults.get(batchKey) || await ctx.findSongInLibrary(candidate.artist, candidate.title);

    if (libraryResult.exists) {
      const filename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
      decadeSongs.push(`"${filename}"`);
      usedArtists.add(normalizedArtist);
      ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);

      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: candidate.title,
        artist: candidate.artist,
        station: candidate.station,
        reason: `TOP10 Década ${yearMin}-${yearMax}`,
      });
    }
  }

  // Fill remaining with coringa
  while (decadeSongs.length < TARGET_SONGS) {
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

  logs.push({
    blockTime: timeStr,
    type: 'fixed',
    title: `TOP10 Década ${yearMin}-${yearMax}`,
    artist: `${decadeSongs.length} músicas`,
    station: 'DÉCADA',
    reason: `10 músicas de ${yearMin} a ${yearMax} intercaladas com vhtn`,
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
 * Fixed template with sports news and music mix blocks.
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

  // Get real ranking songs for the 2 music slots (positions 1 and 2)
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

  // Collect songs per station
  const stationPools: Record<string, SongEntry[]> = {};
  for (const stName of SERTANEJO_STATIONS) {
    const directPool = songsByStation[stName] || [];
    if (directPool.length > 0) {
      stationPools[stName] = [...directPool].sort(() => Math.random() - 0.5);
    } else {
      // Try flexible matching
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

  // Pre-check library in batch
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
 * Generate Raridades block — filters songs by year range (e.g. 1990-2000).
 * Uses a fixed template with intercalated fixed content and decade songs.
 *
 * 12:00 template:
 *   NOTICIA_DA_HORA_12HORAS_{DIA}, vht, RARIDADES_BLOCO01_{DIA},
 *   AS_ULTIMAS_DO_ESPORTE_EDICAO01_{DIA}, vht, FATOS_E_BOATOS_EDICAO01_{DIA},
 *   RARIDADES_BLOCO02_{DIA}, vht, (década), vht, (década)
 *
 * 12:30 template:
 *   NOTICIA_DA_HORA_10HORAS_{DIA}, vht, RARIDADES_BLOCO03_{DIA},
 *   PATRULHA_DO_CONSUMIDOR_{DIA}, vht, AS_ULTIMAS_DO_ESPORTE_EDICAO02_{DIA},
 *   vht, FATOS_E_BOATOS_EDICAO04_{DIA}, RARIDADES_BLOCO04_{DIA},
 *   vht, (década), vht, (década)
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

  // === Fetch decade songs from DB ===
  let dbYearSongs: Array<{ artist: string; title: string; station_name: string; year: string }> = [];
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data, error } = await supabase
      .from('scraped_songs')
      .select('artist, title, station_name, year')
      .not('year', 'is', null)
      .gte('year', String(yearMin))
      .lte('year', String(yearMax))
      .order('scraped_at', { ascending: false })
      .limit(200);

    if (!error && data) {
      dbYearSongs = data as typeof dbYearSongs;
    }
  } catch (e) {
    console.warn('[RARIDADES] Falha ao buscar músicas por ano:', e);
  }

  // Deduplicate and shuffle
  const seen = new Set<string>();
  const candidates: Array<{ artist: string; title: string; station: string }> = [];
  for (const s of dbYearSongs) {
    const key = `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ artist: s.artist, title: s.title, station: s.station_name });
  }
  candidates.sort(() => Math.random() - 0.5);

  // Batch check library
  const batchResults = await ctx.batchFindSongsInLibrary(
    candidates.slice(0, 50).map(c => ({ artist: c.artist, title: c.title }))
  );

  // Select decade songs
  const decadeSongs: string[] = [];
  const usedArtists = new Set<string>();

  for (const candidate of candidates) {
    if (decadeSongs.length >= DECADE_SONGS_NEEDED) break;
    const normArtist = candidate.artist.toLowerCase().trim();
    if (usedArtists.has(normArtist)) continue;
    if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) continue;

    const batchKey = `${normArtist}|${candidate.title.toLowerCase().trim()}`;
    const libraryResult = batchResults.get(batchKey) || await ctx.findSongInLibrary(candidate.artist, candidate.title);

    if (libraryResult.exists) {
      const filename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
      decadeSongs.push(`"${filename}"`);
      usedArtists.add(normArtist);
      ctx.markSongAsUsed(candidate.title, candidate.artist, timeStr);

      logs.push({
        blockTime: timeStr,
        type: 'used',
        title: candidate.title,
        artist: candidate.artist,
        station: candidate.station,
        reason: `Raridades (ano ${yearMin}-${yearMax})`,
      });
    }
  }

  // Fill remaining decade slots with coringa
  while (decadeSongs.length < DECADE_SONGS_NEEDED) {
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

  // === Build template line ===
  let line: string;

  if (minute === 0) {
    // 12:00 block
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
    // 12:30 block
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

/**
 * Combined genre + year song finder for sequence positions.
 * Pulls a single song from the database filtered by BOTH ai_genre AND year range.
 * Used by sequence positions with source "genreyear_POP_90s", "genreyear_ROCK_80s", etc.
 */
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
  // === Strategy 1: Query DB for genre + year tagged songs ===
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const genreVariants = genres.flatMap(g => [
      g.toUpperCase(), g, g.charAt(0).toUpperCase() + g.slice(1).toLowerCase()
    ]);
    const uniqueVariants = [...new Set(genreVariants)];

    const { data, error } = await supabase
      .from('scraped_songs')
      .select('artist, title, station_name, ai_genre, year')
      .in('ai_genre', uniqueVariants)
      .not('year', 'is', null)
      .gte('year', String(yearMin))
      .lte('year', String(yearMax))
      .order('scraped_at', { ascending: false })
      .limit(300);

    if (!error && data && data.length > 0) {
      const seen = new Set<string>();
      const candidates: Array<{ artist: string; title: string; station: string; genre: string }> = [];
      for (const s of data) {
        const key = `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ artist: s.artist, title: s.title, station: s.station_name, genre: s.ai_genre || genres[0] });
      }
      candidates.sort(() => Math.random() - 0.5);

      for (const candidate of candidates) {
        const key = `${candidate.title.toLowerCase()}-${candidate.artist.toLowerCase()}`;
        const normalizedArtist = candidate.artist.toLowerCase().trim();
        if (usedInBlock.has(key) || usedArtistsInBlock.has(normalizedArtist)) continue;
        if (ctx.isRecentlyUsed(candidate.title, candidate.artist, timeStr, isFullDay)) continue;

        const libraryResult = await ctx.findSongInLibrary(candidate.artist, candidate.title);
        if (libraryResult.exists) {
          const filename = libraryResult.filename || sanitizeFilename(`${candidate.artist} - ${candidate.title}.mp3`);
          return { filename, artist: candidate.artist, title: candidate.title, genre: candidate.genre, yearRange: `${yearMin}-${yearMax}` };
        }
      }
    }
  } catch (e) {
    console.warn(`[GENRE-YEAR] Falha ao buscar ${genres.join('/')} ${yearMin}-${yearMax} no DB:`, e);
  }

  // === Strategy 2: Fallback — scan local library for genre + year ===
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;
  if (isElectron && (window as any).electronAPI?.scanLibraryMetadata) {
    try {
      console.log(`[GENRE-YEAR] 📂 DB sem resultados para ${genres.join('/')} ${yearMin}-${yearMax}, buscando localmente...`);
      const { useRadioStore } = await import('@/store/radioStore');
      const { config } = useRadioStore.getState();
      const allFolders = config.musicFolders?.filter(Boolean) || [];
      if (allFolders.length > 0) {
        const scanResult = await (window as any).electronAPI.scanLibraryMetadata({ musicFolders: allFolders });
        if (scanResult?.success && scanResult.songs?.length) {
          const { normalizeId3Genre } = await import('@/lib/id3GenreUtils');
          const genresNorm = genres.map(g => g.toUpperCase());
          
          const filtered = scanResult.songs
            .filter((s: any) => {
              if (!s.year || !s.genre) return false;
              const yr = parseInt(s.year, 10);
              if (isNaN(yr) || yr < yearMin || yr > yearMax) return false;
              const norm = normalizeId3Genre(s.genre)?.toUpperCase();
              return norm && genresNorm.some(g => norm.includes(g));
            })
            .sort(() => Math.random() - 0.5);

          for (const song of filtered) {
            const key = `${(song.title || '').toLowerCase()}-${(song.artist || '').toLowerCase()}`;
            const normalizedArtist = (song.artist || '').toLowerCase().trim();
            if (usedInBlock.has(key) || usedArtistsInBlock.has(normalizedArtist)) continue;
            if (ctx.isRecentlyUsed(song.title || '', song.artist || '', timeStr, isFullDay)) continue;
            
            return {
              filename: song.filename,
              artist: song.artist || 'Desconhecido',
              title: song.title || song.filename,
              genre: genres[0],
              yearRange: `${yearMin}-${yearMax}`,
            };
          }
        }
      }
    } catch (e) {
      console.warn(`[GENRE-YEAR] Scan local falhou:`, e);
    }
  }

  // === Strategy 3: Try genre-only (ignore year) as last resort ===
  console.log(`[GENRE-YEAR] Sem resultados para ${genres.join('/')} ${yearMin}-${yearMax}, tentando só gênero...`);
  const genreResult = await findSongByGenre(genres, timeStr, usedInBlock, usedArtistsInBlock, ctx, isFullDay);
  if (genreResult) {
    return { ...genreResult, yearRange: `${yearMin}-${yearMax} (fallback)` };
  }

  return null;
}
