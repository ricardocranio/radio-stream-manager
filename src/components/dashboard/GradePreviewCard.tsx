import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Eye, Music, Clock, RefreshCw, Loader2, CheckCircle, XCircle, HardDrive, AlertTriangle, FileText, Flame, Radio } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { STATION_ID_TO_DB_NAME } from '@/lib/gradeBuilder/constants';
import { normalizeStr } from '@/lib/songUtils';
import { useGlobalServices } from '@/contexts/GlobalServicesContext';
import { useGradeLogStore } from '@/store/gradeLogStore';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

type LibraryStatus = 'checking' | 'found' | 'missing' | 'unavailable';

interface PreviewSong {
  position: number;
  filename: string;
  artist: string;
  title: string;
  isSpecial: boolean;
  durationSec?: number;
}

/**
 * Parse a builder grade line into PreviewSong entries.
 * This is the ONLY source of truth — matches the TXT file exactly.
 */
import { isVinhetaOrJingle } from '@/lib/vinhetaFilter';

/**
 * Parse a builder grade line into PreviewSong entries.
 * This is the ONLY source of truth — matches the TXT file exactly.
 * Marks vinhetas/jingles as isSpecial so they never go to Deemix.
 */
function parseGradeLine(line: string): PreviewSong[] {
  const songs: PreviewSong[] = [];
  const matches = line.matchAll(/"([^"]+)"/g);
  let pos = 1;
  for (const match of matches) {
    const filename = match[1];
    const withoutExt = filename.replace(/\.mp3$/i, '');
    const parts = withoutExt.split(' - ');
    const artist = parts[0] || filename;
    const title = parts.slice(1).join(' - ') || '';
    // Mark as special if no " - " separator OR if it's a vinheta/jingle
    const isSpecial = !filename.includes(' - ') || isVinhetaOrJingle(artist, title, filename);
    songs.push({
      position: pos++,
      filename,
      artist,
      title,
      isSpecial,
    });
  }
  return songs;
}

export function GradePreviewCard() {
  const { config, stations, scheduledSequences, setGradePreviewSongKeys, setConfig } = useRadioStore();
  const { gradeBuilder } = useGlobalServices();
  const { getLogsByBlock, blockLogs } = useGradeLogStore();
  const [libraryStatus, setLibraryStatus] = useState<Record<string, LibraryStatus>>({});
  const [isCheckingLibrary, setIsCheckingLibrary] = useState(false);
  const [realBlockDuration, setRealBlockDuration] = useState<number | null>(null);
  const [songDurations, setSongDurations] = useState<Record<string, number>>({});
  const [vhtCount, setVhtCount] = useState(0);
  const [songCount, setSongCount] = useState(0);
  const [dynamicMockSongs, setDynamicMockSongs] = useState<PreviewSong[]>([]);
  const [dynamicStationMap, setDynamicStationMap] = useState<Record<string, string>>({});
  const [freshnessMap, setFreshnessMap] = useState<Record<string, number>>({});

  // === DYNAMIC MOCK DATA: Fetch real songs from DB based on active sequence ===
  useEffect(() => {
    if (isElectron) return;

    const fetchRealSongsForPreview = async () => {
      const buildRecentFallbackSongs = async () => {
        try {
          const sinceIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
          const { data } = await supabase
            .from('scraped_songs')
            .select('artist, title, station_name, scraped_at')
            .gte('scraped_at', sinceIso)
            .order('scraped_at', { ascending: false })
            .limit(80);

          if (!data || data.length === 0) {
            setDynamicMockSongs(getDefaultMockSongs());
            setDynamicStationMap({});
            return;
          }

          const uniqueRows: Array<{ artist: string; title: string; station_name: string | null }> = [];
          const usedKeys = new Set<string>();

          for (const row of data) {
            const key = `${row.artist.toLowerCase().trim()}|${row.title.toLowerCase().trim()}`;
            if (usedKeys.has(key)) continue;
            usedKeys.add(key);
            uniqueRows.push(row);
            if (uniqueRows.length >= 8) break;
          }

          if (uniqueRows.length === 0) {
            setDynamicMockSongs(getDefaultMockSongs());
            setDynamicStationMap({});
            return;
          }

          const fallbackSongs: PreviewSong[] = [];
          const fallbackStationMap: Record<string, string> = {};
          let position = 1;

          uniqueRows.forEach((row, index) => {
            fallbackSongs.push({
              position: position++,
              filename: `${row.artist} - ${row.title}.mp3`,
              artist: row.artist,
              title: row.title,
              isSpecial: false,
              durationSec: 210,
            });

            const normalizedKey = `${row.artist.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')}-${row.title.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')}`;
            fallbackStationMap[normalizedKey] = row.station_name || 'Recente';

            const shouldInsertVht = index < uniqueRows.length - 1 && (index % 2 === 0);
            if (shouldInsertVht) {
              fallbackSongs.push({
                position: position++,
                filename: 'VHT_RADIO.mp3',
                artist: 'VHT_RADIO',
                title: '',
                isSpecial: true,
                durationSec: 7,
              });
            }
          });

          setDynamicMockSongs(fallbackSongs);
          setDynamicStationMap(fallbackStationMap);
        } catch {
          setDynamicMockSongs(getDefaultMockSongs());
          setDynamicStationMap({});
        }
      };

      // Get active sequence for the next block time
      const activeSeq = getActiveSequence();
      
      // Extract genres from the sequence
      const genrePositions = activeSeq
        .filter(s => s.radioSource.startsWith('genre_'))
        .map(s => {
          const genreStr = s.radioSource.replace('genre_', '');
          return { position: s.position, genres: genreStr.split(',').map(g => g.trim()) };
        });
      
      // Also get station-based positions
      const stationPositions = activeSeq.filter(s => 
        !s.radioSource.startsWith('genre_') && 
        !s.radioSource.startsWith('year_') &&
        !s.radioSource.startsWith('fixo_') && 
        s.radioSource !== 'fixo' &&
        s.radioSource !== 'top50' &&
        s.radioSource !== 'random_pop'
      );

      const yearPositions = activeSeq
        .filter(s => s.radioSource.startsWith('year_'))
        .map(s => {
          const yearKey = s.radioSource.replace('year_', '');
          const yearRanges: Record<string, [number, number]> = {
            '80s': [1980, 1989], '90s': [1990, 1999], '2000s': [2000, 2009],
            '2010s': [2010, 2019], '2020s': [2020, 2030],
          };
          return { position: s.position, yearKey, range: yearRanges[yearKey] || [2000, 2030] };
        });

      if (genrePositions.length === 0 && stationPositions.length === 0 && yearPositions.length === 0) {
        // No direct station/genre/year sources — use latest real captures as fallback
        await buildRecentFallbackSongs();
        return;
      }

      const songs: PreviewSong[] = [];
      const stationMap: Record<string, string> = {};
      const usedKeys = new Set<string>();
      let pos = 1;

      // For each position in the sequence, fetch matching songs
      for (const seqItem of activeSeq) {
        if (seqItem.radioSource.startsWith('genre_')) {
          const genreStr = seqItem.radioSource.replace('genre_', '');
          const genres = genreStr.split(',').map(g => g.trim());
          const genreVariants = genres.flatMap(g => [
            g.toUpperCase(), g, g.charAt(0).toUpperCase() + g.slice(1).toLowerCase()
          ]);
          const uniqueVariants = [...new Set(genreVariants)];

          try {
            const { data } = await supabase
              .from('scraped_songs')
              .select('artist, title, station_name, ai_genre')
              .in('ai_genre', uniqueVariants)
              .order('scraped_at', { ascending: false })
              .limit(50);

            if (data && data.length > 0) {
              // Find first unused song
              for (const s of data) {
                const key = `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
                if (usedKeys.has(key)) continue;
                usedKeys.add(key);
                
                const filename = `${s.artist} - ${s.title}.mp3`;
                songs.push({
                  position: pos++,
                  filename,
                  artist: s.artist,
                  title: s.title,
                  isSpecial: false,
                  durationSec: 210,
                });
                
                // Map to genre label as station
                const normalizedKey = `${s.artist.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')}-${s.title.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')}`;
                stationMap[normalizedKey] = (s.ai_genre || genres[0]).toUpperCase();
                break;
              }
            } else {
              // No data for this genre — skip
              pos++;
            }
          } catch {
            pos++;
          }

          // Add VHT between songs (not after last)
          if (seqItem.position < activeSeq.length) {
            songs.push({
              position: pos++,
              filename: 'VHT_RADIO.mp3',
              artist: 'VHT_RADIO',
              title: '',
              isSpecial: true,
              durationSec: 7,
            });
          }
        } else if (seqItem.radioSource.startsWith('year_')) {
          // Year/decade-based: fetch songs by year range
          const yearKey = seqItem.radioSource.replace('year_', '');
          const yearRanges: Record<string, [number, number]> = {
            '80s': [1980, 1989], '90s': [1990, 1999], '2000s': [2000, 2009],
            '2010s': [2010, 2019], '2020s': [2020, 2030],
          };
          const range = yearRanges[yearKey] || [2000, 2030];

          try {
            const { data } = await supabase
              .from('scraped_songs')
              .select('artist, title, station_name, year')
              .not('year', 'is', null)
              .gte('year', String(range[0]))
              .lte('year', String(range[1]))
              .order('scraped_at', { ascending: false })
              .limit(50);

            if (data && data.length > 0) {
              for (const s of data) {
                const key = `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
                if (usedKeys.has(key)) continue;
                usedKeys.add(key);
                
                const filename = `${s.artist} - ${s.title}.mp3`;
                songs.push({
                  position: pos++,
                  filename,
                  artist: s.artist,
                  title: s.title,
                  isSpecial: false,
                  durationSec: 210,
                });
                
                const normalizedKey = `${s.artist.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')}-${s.title.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')}`;
                stationMap[normalizedKey] = `ANOS ${yearKey.toUpperCase()}`;
                break;
              }
            } else {
              pos++;
            }
          } catch {
            pos++;
          }

          if (seqItem.position < activeSeq.length) {
            songs.push({
              position: pos++,
              filename: 'VHT_RADIO.mp3',
              artist: 'VHT_RADIO',
              title: '',
              isSpecial: true,
              durationSec: 7,
            });
          }
        } else if (
          !seqItem.radioSource.startsWith('fixo_') && 
          !seqItem.radioSource.startsWith('year_') &&
          seqItem.radioSource !== 'fixo' &&
          seqItem.radioSource !== 'top50' &&
          seqItem.radioSource !== 'random_pop'
        ) {
          // Resolve station: try legacy short-ID map first, then UUID lookup, then raw string
          const legacyName = STATION_ID_TO_DB_NAME[seqItem.radioSource] || STATION_ID_TO_DB_NAME[seqItem.radioSource.toLowerCase()];
          const station = stations.find(s => s.id === seqItem.radioSource);
          const stationName = legacyName || station?.name || seqItem.radioSource;

          try {
            let { data } = await supabase
              .from('scraped_songs')
              .select('artist, title, station_name')
              .eq('station_name', stationName)
              .order('scraped_at', { ascending: false })
              .limit(30);

            // Fallback: case-insensitive search if exact match found nothing
            if ((!data || data.length === 0) && stationName) {
              const fallback = await supabase
                .from('scraped_songs')
                .select('artist, title, station_name')
                .ilike('station_name', stationName)
                .order('scraped_at', { ascending: false })
                .limit(30);
              data = fallback.data;
            }

            if (data && data.length > 0) {
              for (const s of data) {
                const key = `${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`;
                if (usedKeys.has(key)) continue;
                usedKeys.add(key);
                
                const filename = `${s.artist} - ${s.title}.mp3`;
                songs.push({
                  position: pos++,
                  filename,
                  artist: s.artist,
                  title: s.title,
                  isSpecial: false,
                  durationSec: 210,
                });
                
                const normalizedKey = `${s.artist.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')}-${s.title.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')}`;
                stationMap[normalizedKey] = stationName;
                break;
              }
            } else {
              pos++;
            }
          } catch {
            pos++;
          }

          if (seqItem.position < activeSeq.length) {
            songs.push({
              position: pos++,
              filename: 'VHT_RADIO.mp3',
              artist: 'VHT_RADIO',
              title: '',
              isSpecial: true,
              durationSec: 7,
            });
          }
        }
      }

      if (songs.filter(s => !s.isSpecial).length > 0) {
        setDynamicMockSongs(songs);
        setDynamicStationMap(stationMap);
      } else {
        await buildRecentFallbackSongs();
      }
    };

    fetchRealSongsForPreview();
  }, [scheduledSequences, stations]);

  // Default fallback mock songs
  const getDefaultMockSongs = (): PreviewSong[] => [
    { position: 1, filename: 'Anitta - Envolver.mp3', artist: 'Anitta', title: 'Envolver', isSpecial: false, durationSec: 197 },
    { position: 2, filename: 'VHT_RADIO.mp3', artist: 'VHT_RADIO', title: '', isSpecial: true, durationSec: 7 },
    { position: 3, filename: 'Jorge & Mateus - Enquanto Houver Razões.mp3', artist: 'Jorge & Mateus', title: 'Enquanto Houver Razões', isSpecial: false, durationSec: 223 },
    { position: 4, filename: 'Marília Mendonça - Supera.mp3', artist: 'Marília Mendonça', title: 'Supera', isSpecial: false, durationSec: 185 },
    { position: 5, filename: 'VHTN_NOSSA.mp3', artist: 'VHTN_NOSSA', title: '', isSpecial: true, durationSec: 8 },
    { position: 6, filename: 'Henrique & Juliano - Vidinha de Balada.mp3', artist: 'Henrique & Juliano', title: 'Vidinha de Balada', isSpecial: false, durationSec: 241 },
    { position: 7, filename: 'Luísa Sonza - Sentadona.mp3', artist: 'Luísa Sonza', title: 'Sentadona', isSpecial: false, durationSec: 178 },
    { position: 8, filename: 'VHT_RADIO.mp3', artist: 'VHT_RADIO', title: '', isSpecial: true, durationSec: 7 },
    { position: 9, filename: 'Zé Neto & Cristiano - Largado Às Traças.mp3', artist: 'Zé Neto & Cristiano', title: 'Largado Às Traças', isSpecial: false, durationSec: 215 },
    { position: 10, filename: 'Gusttavo Lima - Balada.mp3', artist: 'Gusttavo Lima', title: 'Balada', isSpecial: false, durationSec: 202 },
    { position: 11, filename: 'VHT_RADIO.mp3', artist: 'VHT_RADIO', title: '', isSpecial: true, durationSec: 7 },
    { position: 12, filename: 'Luan Santana - Acordando o Prédio.mp3', artist: 'Luan Santana', title: 'Acordando o Prédio', isSpecial: false, durationSec: 193 },
  ];

  // Use dynamic songs or default
  const mockSongs: PreviewSong[] = useMemo(() => {
    if (isElectron) return [];
    return dynamicMockSongs.length > 0 ? dynamicMockSongs : getDefaultMockSongs();
  }, [dynamicMockSongs]);

  // Use builder's nextBlock directly as single source of truth
  const nextBlockTime = gradeBuilder.nextBlock || (isElectron ? '--:--' : (() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes() < 30 ? '30' : '00';
    const nextH = m === '00' ? (h + 1) % 24 : h;
    return `${nextH.toString().padStart(2, '0')}:${m}`;
  })());

  const resolvedPreviewLine = useMemo(() => {
    if (!isElectron) return null;
    const lines = gradeBuilder.pendingGradeLines;
    if (!lines || lines.size === 0) return null;

    const nextLine = lines.get(nextBlockTime);
    if (nextLine) return nextLine;

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${(now.getMinutes() < 30 ? '00' : '30')}`;
    const currentLine = lines.get(currentTime);
    if (currentLine) return currentLine;

    const sortedKeys = Array.from(lines.keys()).sort();
    if (sortedKeys.length > 0) {
      return lines.get(sortedKeys[sortedKeys.length - 1]) || null;
    }

    return null;
  }, [gradeBuilder.pendingGradeLines, nextBlockTime]);

  const displaySongs = useMemo(() => {
    if (!isElectron) return mockSongs;
    return resolvedPreviewLine ? parseGradeLine(resolvedPreviewLine) : [];
  }, [resolvedPreviewLine, mockSongs]);

  const blockDuration = realBlockDuration
    ?? gradeBuilder.pendingBlockDurations?.get(nextBlockTime)
    ?? (displaySongs.length > 0
      ? parseFloat(((displaySongs.filter(s => !s.isSpecial).length * 210 + displaySongs.filter(s => s.isSpecial).length * 7) / 60).toFixed(1))
      : undefined);

  // === Sync display songs to store for cross-component tracking ===
  useEffect(() => {
    const keys = new Set<string>();
    for (const song of displaySongs) {
      if (!song.isSpecial && song.artist && song.title) {
        keys.add(`${normalizeStr(song.artist)}|||${normalizeStr(song.title)}`);
      }
    }
    setGradePreviewSongKeys(keys);
  }, [displaySongs, setGradePreviewSongKeys]);


  const normalizeKey = useCallback((str: string) => {
    return str
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9 ]/g, '')     // remove special chars
      .replace(/\s+/g, ' ');
  }, []);

  const buildFreshnessKey = useCallback((artist: string, title: string, stationName?: string | null) => {
    const songKey = `${normalizeKey(artist)}-${normalizeKey(title || '')}`;
    return stationName ? `${normalizeKey(stationName)}::${songKey}` : songKey;
  }, [normalizeKey]);

  const getFreshnessTone = useCallback((freshnessMin: number | null) => {
    if (freshnessMin === null) {
      return {
        row: 'bg-card/50 border-border/50 hover:border-border',
        text: '',
        badge: '',
      };
    }

    if (freshnessMin < 10) {
      return {
        row: 'bg-success/10 border-success/30 hover:border-success/40',
        text: 'text-success',
        badge: 'text-success border-success/30 bg-success/10',
      };
    }

    if (freshnessMin <= 15) {
      return {
        row: 'bg-warning/10 border-warning/30 hover:border-warning/40',
        text: 'text-warning',
        badge: 'text-warning border-warning/30 bg-warning/10',
      };
    }

    return {
      row: 'bg-destructive/10 border-destructive/30 hover:border-destructive/40',
      text: 'text-destructive',
      badge: 'text-destructive border-destructive/30 bg-destructive/10',
    };
  }, []);

  // Build a map of song key -> station from builder's pendingStationMap (immediate)
  // Falls back to gradeLogStore for backwards compatibility
  const songStationMap = useMemo(() => {
    if (!isElectron) return dynamicStationMap;
    
    // PRIMARY: Use pendingStationMap from grade builder (available immediately after build)
    const builderMap = gradeBuilder.pendingStationMap;
    if (builderMap && Object.keys(builderMap).length > 0) {
      return builderMap;
    }
    
    // FALLBACK: Use gradeLogStore (may have timing lag)
    const map: Record<string, string> = {};
    if (nextBlockTime === '--:--') return map;
    
    const logs = getLogsByBlock(nextBlockTime);
    
    if (logs.length === 0) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${(now.getMinutes() < 30 ? '00' : '30')}`;
      if (currentTime !== nextBlockTime) {
        logs.push(...getLogsByBlock(currentTime));
      }
    }
    
    for (const log of logs) {
      if (log.station && log.title && log.artist) {
        const key = `${normalizeKey(log.artist)}-${normalizeKey(log.title || '')}`;
        map[key] = log.station;
      }
    }
    return map;
  }, [nextBlockTime, getLogsByBlock, dynamicStationMap, normalizeKey, gradeBuilder.pendingStationMap]);

  const freshnessFromLogs = useMemo(() => {
    const map: Record<string, number> = {};

    const registerLogs = (logs: ReturnType<typeof getLogsByBlock>) => {
      for (const log of logs) {
        if (!log.artist || !log.title || !log.reason) continue;
        const match = log.reason.match(/frescor:\s*(\d+)min/i);
        if (!match) continue;

        const freshnessMin = parseInt(match[1], 10);
        const baseKey = buildFreshnessKey(log.artist, log.title);
        const stationKey = log.station ? buildFreshnessKey(log.artist, log.title, log.station) : null;

        if (map[baseKey] === undefined || freshnessMin < map[baseKey]) {
          map[baseKey] = freshnessMin;
        }

        if (stationKey && (map[stationKey] === undefined || freshnessMin < map[stationKey])) {
          map[stationKey] = freshnessMin;
        }
      }
    };

    if (nextBlockTime !== '--:--') {
      registerLogs(getLogsByBlock(nextBlockTime));
    }

    const now = new Date();
    const currentBlockTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes() < 30 ? '00' : '30'}`;
    if (currentBlockTime !== nextBlockTime) {
      registerLogs(getLogsByBlock(currentBlockTime));
    }

    registerLogs(blockLogs.filter(log => log.type === 'used'));

    return map;
  }, [nextBlockTime, getLogsByBlock, blockLogs, buildFreshnessKey]);

  useEffect(() => {
    const songsToResolve = displaySongs
      .filter(song => !song.isSpecial && song.artist && song.title)
      .map(song => {
        const baseSongKey = `${normalizeKey(song.artist)}-${normalizeKey(song.title || '')}`;
        return {
          artist: song.artist,
          title: song.title || '',
          stationName: songStationMap[baseSongKey] || null,
        };
      });

    if (songsToResolve.length === 0) {
      setFreshnessMap({});
      return;
    }

    let cancelled = false;

    const loadFreshness = async () => {
      const recentFreshness: Record<string, number> = {};
      const sinceIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

      const applyRows = (rows: Array<{ artist: string; title: string; station_name: string | null; scraped_at: string }>) => {
        for (const row of rows) {
          const freshnessMin = Math.max(0, Math.round((Date.now() - new Date(row.scraped_at).getTime()) / 60000));
          const baseKey = buildFreshnessKey(row.artist, row.title);
          const stationKey = row.station_name ? buildFreshnessKey(row.artist, row.title, row.station_name) : null;

          if (recentFreshness[baseKey] === undefined || freshnessMin < recentFreshness[baseKey]) {
            recentFreshness[baseKey] = freshnessMin;
          }

          if (stationKey && (recentFreshness[stationKey] === undefined || freshnessMin < recentFreshness[stationKey])) {
            recentFreshness[stationKey] = freshnessMin;
          }
        }
      };

      const coverageCount = () => songsToResolve.filter(song => {
        const stationKey = song.stationName ? buildFreshnessKey(song.artist, song.title, song.stationName) : null;
        const baseKey = buildFreshnessKey(song.artist, song.title);
        return (stationKey && recentFreshness[stationKey] !== undefined) || recentFreshness[baseKey] !== undefined;
      }).length;

      try {
        const stationNames = [...new Set(songsToResolve.map(song => song.stationName).filter(Boolean))] as string[];

        if (stationNames.length > 0) {
          const { data } = await supabase
            .from('scraped_songs')
            .select('artist, title, station_name, scraped_at')
            .in('station_name', stationNames)
            .gte('scraped_at', sinceIso)
            .order('scraped_at', { ascending: false })
            .limit(400);

          if (data) applyRows(data);
        }

        if (coverageCount() < songsToResolve.length) {
          const { data } = await supabase
            .from('scraped_songs')
            .select('artist, title, station_name, scraped_at')
            .gte('scraped_at', sinceIso)
            .order('scraped_at', { ascending: false })
            .limit(400);

          if (data) applyRows(data);
        }
      } catch (error) {
        console.warn('[PREVIEW] Falha ao carregar frescor real para o preview:', error);
      }

      if (!cancelled) {
        setFreshnessMap(recentFreshness);
      }
    };

    loadFreshness();

    return () => {
      cancelled = true;
    };
  }, [displaySongs, songStationMap, normalizeKey, buildFreshnessKey]);

  // Get the raw grade line from builder
  const nextBlockLine = useMemo(() => {
    const lines = gradeBuilder.pendingGradeLines;
    if (!lines || lines.size === 0) return null;
    return lines.get(nextBlockTime) || null;
  }, [gradeBuilder.pendingGradeLines, nextBlockTime]);

  // Check library availability
  const checkLibrary = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.findSongMatch || displaySongs.length === 0) {
      const newStatus: Record<string, LibraryStatus> = {};
      displaySongs.forEach(s => {
        if (!s.isSpecial) newStatus[s.filename.toLowerCase()] = isElectron ? 'checking' : 'unavailable';
      });
      setLibraryStatus(newStatus);
      return;
    }

    setIsCheckingLibrary(true);
    const newStatus: Record<string, LibraryStatus> = {};
    const musicFolders = config.musicFolders || [];
    const threshold = config.similarityThreshold || 0.75;

    const songsToCheck = displaySongs.filter(s => !s.isSpecial);

    for (let i = 0; i < songsToCheck.length; i += 3) {
      const batch = songsToCheck.slice(i, i + 3);
      const results = await Promise.all(
        batch.map(async (song) => {
          const key = song.filename.toLowerCase();
          try {
            const result = await Promise.race([
              window.electronAPI!.findSongMatch({
                artist: song.artist,
                title: song.title || song.artist,
                musicFolders,
                threshold,
              } as any),
              new Promise<{ exists: false }>((resolve) => setTimeout(() => resolve({ exists: false }), 10000)),
            ]);
            return { key, status: (result.exists ? 'found' : 'missing') as LibraryStatus };
          } catch {
            return { key, status: 'missing' as LibraryStatus };
          }
        })
      );
      for (const { key, status } of results) {
        newStatus[key] = status;
      }
      setLibraryStatus({ ...newStatus });
    }

    setIsCheckingLibrary(false);

    // Send missing to download queue
    const missingFiles = songsToCheck.filter(s => newStatus[s.filename.toLowerCase()] === 'missing');
    if (missingFiles.length > 0) {
      const { addMissingSong, missingSongs: existingMissing } = useRadioStore.getState();
      const existingKeys = new Set(
        existingMissing.map(m => `${m.artist.toLowerCase().trim()}|${m.title.toLowerCase().trim()}`)
      );
      for (const s of missingFiles) {
        const dlKey = `${s.artist.toLowerCase().trim()}|${(s.title || '').toLowerCase().trim()}`;
        if (!existingKeys.has(dlKey) && s.artist && s.title) {
          addMissingSong({
            id: `preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: s.title, artist: s.artist,
            station: 'preview',
            status: 'missing', timestamp: new Date(), urgency: 'grade',
          });
          existingKeys.add(dlKey);
        }
      }
    }
  }, [displaySongs, config.musicFolders, config.similarityThreshold]);

  useEffect(() => {
    if (displaySongs.length > 0 && displaySongs.some(s => !s.isSpecial)) {
      checkLibrary();
    }
  }, [displaySongs, checkLibrary]);

  // === REAL DURATION CALCULATION from actual files ===
  useEffect(() => {
    // Count VHTs and songs from displaySongs directly
    const vhts = displaySongs.filter(s => s.isSpecial).length;
    const songsOnly = displaySongs.filter(s => !s.isSpecial).length;
    setVhtCount(vhts);
    setSongCount(songsOnly);

    // Non-Electron: use mock durations from durationSec
    if (!isElectron) {
      if (displaySongs.length > 0) {
        const durMap: Record<string, number> = {};
        displaySongs.forEach(s => { if (s.durationSec) durMap[s.filename.toLowerCase()] = s.durationSec; });
        setSongDurations(durMap);
        const totalSec = displaySongs.reduce((acc, s) => acc + (s.durationSec || (s.isSpecial ? 7 : 210)), 0);
        setRealBlockDuration(parseFloat((totalSec / 60).toFixed(1)));
      } else {
        setSongDurations({});
        setRealBlockDuration(null);
      }
      return;
    }

    // Electron: calculate REAL durations from disk
    if (!window.electronAPI?.getFileDurationsBatch || displaySongs.length === 0) {
      setRealBlockDuration(null);
      setSongDurations({});
      return;
    }

    const calculateDuration = async () => {
      try {
        const musicFolders = [
          ...(config.musicFolders || []),
          config.contentFolder,
          config.vinhetasFolder || 'C:\\Playlist\\Vinhetas',
        ].filter(Boolean);

        // Get ALL filenames from display songs (not just from raw line)
        const filenames = displaySongs
          .map(s => s.filename)
          .filter(Boolean);

        const DEFAULT_SONG = 210;
        const DEFAULT_VHT = 7;
        const perSongDurs: Record<string, number> = {};
        let totalSec = 0;

        if (filenames.length > 0) {
          const result = await window.electronAPI!.getFileDurationsBatch({
            filenames,
            musicFolders,
          });

          for (const song of displaySongs) {
            if (song.isSpecial) {
              totalSec += DEFAULT_VHT;
              perSongDurs[song.filename.toLowerCase()] = DEFAULT_VHT;
            } else {
              const dur = result.success && result.durations ? result.durations[song.filename] : null;
              const finalDur = (dur && dur > 0) ? dur : DEFAULT_SONG;
              totalSec += finalDur;
              perSongDurs[song.filename.toLowerCase()] = finalDur;
            }
          }
        } else {
          totalSec = songsOnly * DEFAULT_SONG + vhts * DEFAULT_VHT;
          displaySongs.forEach(s => {
            perSongDurs[s.filename.toLowerCase()] = s.isSpecial ? DEFAULT_VHT : DEFAULT_SONG;
          });
        }

        setSongDurations(perSongDurs);
        setRealBlockDuration(parseFloat((totalSec / 60).toFixed(1)));
        console.log(`[PREVIEW] ⏱️ Durações reais: ${Object.values(perSongDurs).filter(d => d !== DEFAULT_SONG && d !== DEFAULT_VHT).length}/${filenames.length} lidas do disco`);
      } catch (e) {
        console.warn('[PREVIEW] Failed to calculate real duration:', e);
        const estimated = (songsOnly * 210 + vhts * 7) / 60;
        setRealBlockDuration(parseFloat(estimated.toFixed(1)));
      }
    };

    calculateDuration();
  }, [displaySongs, config.musicFolders, config.contentFolder, config.vinhetasFolder]);

  const getLibraryIcon = (song: PreviewSong) => {
    if (song.isSpecial) return null;
    const key = song.filename.toLowerCase();
    const status = libraryStatus[key];
    if (!status || status === 'unavailable') return null;
    if (status === 'checking') return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
    if (status === 'found') return <CheckCircle className="w-3 h-3 text-green-400" />;
    if (status === 'missing') return <XCircle className="w-3 h-3 text-red-400" />;
    return null;
  };

  const foundCount = Object.values(libraryStatus).filter(s => s === 'found').length;
  const missingCount = Object.values(libraryStatus).filter(s => s === 'missing').length;
  const isLoading = gradeBuilder.isBuilding;
  const isBlockShort = blockDuration !== undefined && blockDuration < 29;
  const isBlockLong = blockDuration !== undefined && blockDuration > 32;
  const isBlockOk = blockDuration !== undefined && blockDuration >= 29 && blockDuration <= 32;

  // Auto-rebuild when block is too short (with debounce to avoid loops)
  const autoFixAttemptedRef = useRef<string>('');
  useEffect(() => {
    if (isBlockShort && !isLoading && nextBlockTime !== '--:--') {
      const key = `${nextBlockTime}-${blockDuration}`;
      if (autoFixAttemptedRef.current !== key) {
        autoFixAttemptedRef.current = key;
        console.log(`[PREVIEW] ⚠️ Bloco ${nextBlockTime} com ${blockDuration} min (<29). Tentando rebuild automático...`);
        // Delay to avoid rapid loops
        const timer = setTimeout(() => {
          gradeBuilder.buildGrade(false, true);
        }, 5000);
        return () => clearTimeout(timer);
      }
    }
  }, [isBlockShort, isLoading, nextBlockTime, blockDuration, gradeBuilder]);

  // Trigger rebuild when mode changes
  useEffect(() => {
    if (!isLoading && nextBlockTime !== '--:--') {
      gradeBuilder.buildGrade(false, true);
    }
  }, [config.gradeMode]);

  return (
    <Card className={`glass-card ${isBlockShort ? 'border-red-500/40' : isBlockOk ? 'border-green-500/20' : 'border-amber-500/20'}`}>
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="w-5 h-5 text-amber-500" />
            Preview da Próxima Grade
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
              {nextBlockTime}
            </Badge>
            {blockDuration && (
              <Badge variant="outline" className={`text-xs ${
                blockDuration >= 29 && blockDuration <= 32
                  ? 'bg-green-500/10 text-green-400 border-green-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30'
              }`}>
                <Clock className="w-3 h-3 mr-1" />
                {blockDuration} min
              </Badge>
            )}
            {displaySongs.length > 0 && (
              <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30">
                TXT
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex bg-muted/50 p-0.5 rounded-md mr-1">
              <Button
                variant={config.gradeMode === 'custom' ? 'secondary' : 'ghost'}
                size="sm"
                className={`h-7 text-[10px] px-2 font-semibold ${config.gradeMode === 'custom' ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border-amber-500/30' : ''}`}
                onClick={() => setConfig({ gradeMode: 'custom' })}
              >
                Modo Personalizado
              </Button>
              <Button
                variant={config.gradeMode !== 'custom' ? 'secondary' : 'ghost'}
                size="sm"
                className={`h-7 text-[10px] px-2 font-semibold ${config.gradeMode !== 'custom' ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/30' : ''}`}
                onClick={() => setConfig({ gradeMode: 'standard' })}
              >
                Modo Padrão
              </Button>
            </div>
            {isCheckingLibrary && (
              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                Verificando
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => gradeBuilder.buildGrade(false, true)}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Music className="w-3 h-3" />
            {songCount} músicas
          </span>
          {blockDuration && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <Clock className="w-3 h-3" />
              {blockDuration} min
            </span>
          )}
          {isElectron && (foundCount > 0 || missingCount > 0) && (
            <span className="flex items-center gap-1">
              <HardDrive className="w-3 h-3" />
              {foundCount}✅ {missingCount}❌
            </span>
          )}
          {gradeBuilder.lastBuildTime && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {format(gradeBuilder.lastBuildTime, 'HH:mm', { locale: ptBR })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        {/* Duration alert banner */}
        {isBlockShort && (
          <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 animate-pulse">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-red-400">
                ⚠️ Bloco abaixo de 29 min ({blockDuration} min) — rebuild automático em andamento
              </p>
              <p className="text-[10px] text-red-400/70">
                O sistema está tentando adicionar músicas extras para atingir o mínimo
              </p>
            </div>
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-red-400 shrink-0" />}
          </div>
        )}
        {isBlockLong && (
          <div className="mb-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-400">
              Bloco acima de 32 min ({blockDuration} min) — pode ultrapassar a janela
            </p>
          </div>
        )}
        <ScrollArea className="h-[320px]">
          {displaySongs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Music className="w-8 h-8 opacity-50" />
              <p className="text-sm">
                {isLoading ? 'Montando grade...' : 'Aguardando montagem da grade'}
              </p>
              <p className="text-xs opacity-60">
                A grade será montada automaticamente antes do próximo bloco
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {displaySongs
                .filter(s => !s.isSpecial)
                .map((song, index, arr) => {
                  // Renumber visible positions sequentially (1..N), ignoring vinhetas
                  const displayPosition = index + 1;
                const isMissing = libraryStatus[song.filename.toLowerCase()] === 'missing';
                const stationKey = `${normalizeKey(song.artist)}-${normalizeKey(song.title || '')}`;
                const stationName = songStationMap[stationKey];
                const baseFreshnessKey = buildFreshnessKey(song.artist, song.title || '');
                const stationFreshnessKey = stationName ? buildFreshnessKey(song.artist, song.title || '', stationName) : null;
                const freshnessMin = song.isSpecial
                  ? null
                  : (stationFreshnessKey ? freshnessMap[stationFreshnessKey] : undefined)
                    ?? freshnessMap[baseFreshnessKey]
                    ?? (stationFreshnessKey ? freshnessFromLogs[stationFreshnessKey] : undefined)
                    ?? freshnessFromLogs[baseFreshnessKey]
                    ?? null;
                const freshnessTone = getFreshnessTone(freshnessMin);

                return (
                  <div
                    key={index}
                    className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                      isMissing
                        ? 'bg-red-500/10 border-red-500/30'
                        : song.isSpecial
                          ? 'bg-purple-500/10 border-purple-500/20'
                          : freshnessTone.row
                    }`}
                  >
                    {/* Position */}
                    <span className="text-xs font-mono text-muted-foreground w-5 text-right shrink-0">
                      {displayPosition}
                    </span>

                    {/* Library icon */}
                    <span className="shrink-0">{getLibraryIcon(song)}</span>

                    {/* Song info */}
                    <div className="flex-1 min-w-0">
                      {song.isSpecial ? (
                        <span className="text-xs font-mono text-purple-400 truncate block">
                          {song.filename}
                        </span>
                      ) : (
                        <>
                          <p className={`text-sm font-medium truncate leading-tight ${freshnessTone.text}`}>
                            {song.title || song.artist}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <p className={`text-xs truncate ${freshnessTone.text || 'text-muted-foreground'}`}>
                              {song.artist}
                            </p>
                            {freshnessMin !== null && (
                              <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 ${freshnessTone.badge}`}>
                                {freshnessMin}min
                              </Badge>
                            )}
                            {stationName && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 bg-accent/30 text-accent-foreground/70 border-accent/40 shrink-0">
                                <Radio className="w-2.5 h-2.5 mr-0.5" />
                                {stationName}
                              </Badge>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Duration badge - prominent */}
                    {(() => {
                      const dur = songDurations[song.filename.toLowerCase()];
                      if (!dur) return null;
                      const mins = Math.floor(dur / 60);
                      const secs = Math.floor(dur % 60);
                      const isEstimated = dur === 210 || dur === 7;
                      return (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-mono tabular-nums shrink-0 ${
                          isEstimated 
                            ? 'text-muted-foreground/50 border-border/30' 
                            : 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10'
                        }`}>
                          <Clock className="w-2.5 h-2.5 mr-0.5" />
                          {mins}:{secs.toString().padStart(2, '0')}
                        </Badge>
                      );
                    })()}

                    {/* Missing badge */}
                    {isMissing && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-red-500/20 text-red-400 border-red-500/30 shrink-0">
                        <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                        FALTA
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Raw grade line from builder */}
        {nextBlockLine && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-[10px] text-muted-foreground font-mono break-all leading-relaxed opacity-60">
              {nextBlockLine}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
