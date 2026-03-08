/**
 * Phase 2: Competitor Analysis
 * 
 * Compares the local music library against monitored stations' repertoire.
 * Identifies gaps (songs they play that we don't have) and opportunities.
 */

import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRadioStore } from '@/store/radioStore';

export interface CompetitorGap {
  title: string;
  artist: string;
  stationCount: number;
  stations: string[];
  totalPlays: number;
  lastSeen: string;
  inLibrary: boolean;
}

export interface StationComparison {
  stationName: string;
  totalSongs: number;
  inLibrary: number;
  missing: number;
  coveragePercent: number;
  topMissing: CompetitorGap[];
}

export interface CompetitorStats {
  totalUniqueSongs: number;
  inLibrary: number;
  missing: number;
  overallCoverage: number;
  stationComparisons: StationComparison[];
  topGaps: CompetitorGap[];
}

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

export function useCompetitorAnalysis() {
  const [stats, setStats] = useState<CompetitorStats | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<Date | null>(null);
  const abortRef = useRef(false);

  const analyze = useCallback(async () => {
    setIsAnalyzing(true);
    abortRef.current = false;

    try {
      // Fetch last 7 days of scraped songs for broader analysis
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const { data: songs, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .gte('scraped_at', cutoff)
        .order('scraped_at', { ascending: false })
        .limit(5000);

      if (error || !songs) {
        console.error('[COMPETITOR] Error fetching songs:', error);
        return;
      }

      // Also fetch from historico_stats for longer-term data
      const { data: statsData } = await supabase
        .from('radio_historico_stats')
        .select('title, artist, station_name, play_count, last_seen')
        .order('play_count', { ascending: false })
        .limit(3000);

      // Build unique song map
      const songMap = new Map<string, {
        title: string;
        artist: string;
        stations: Set<string>;
        totalPlays: number;
        lastSeen: string;
      }>();

      for (const song of songs) {
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        if (!songMap.has(key)) {
          songMap.set(key, {
            title: song.title,
            artist: song.artist,
            stations: new Set(),
            totalPlays: 0,
            lastSeen: song.scraped_at,
          });
        }
        const entry = songMap.get(key)!;
        entry.stations.add(song.station_name);
        entry.totalPlays++;
        if (song.scraped_at > entry.lastSeen) entry.lastSeen = song.scraped_at;
      }

      // Merge historico stats
      if (statsData) {
        for (const stat of statsData) {
          const key = `${stat.artist.toLowerCase().trim()}|${stat.title.toLowerCase().trim()}`;
          if (!songMap.has(key)) {
            songMap.set(key, {
              title: stat.title,
              artist: stat.artist,
              stations: new Set([stat.station_name]),
              totalPlays: stat.play_count,
              lastSeen: stat.last_seen,
            });
          } else {
            const entry = songMap.get(key)!;
            entry.stations.add(stat.station_name);
            entry.totalPlays += stat.play_count;
          }
        }
      }

      // Check library — batch check via Electron or simple store check
      const gaps: CompetitorGap[] = [];
      const { config } = useRadioStore.getState();
      
      let librarySet: Set<string> | null = null;
      
      if (isElectron && window.electronAPI?.checkSongExists && config.musicFolders?.length > 0) {
        // Batch check: sample up to 500 songs
        const toCheck = [...songMap.entries()].slice(0, 500);
        const results = await Promise.all(
          toCheck.map(async ([key, entry]) => {
            try {
              const exists = await window.electronAPI!.checkSongExists!({
                artist: entry.artist,
                title: entry.title,
              });
              return { key, exists: !!exists };
            } catch {
              return { key, exists: false };
            }
          })
        );
        librarySet = new Set(results.filter(r => r.exists).map(r => r.key));
      }

      // Build gap list
      for (const [key, entry] of songMap) {
        const inLibrary = librarySet ? librarySet.has(key) : false;
        gaps.push({
          title: entry.title,
          artist: entry.artist,
          stationCount: entry.stations.size,
          stations: [...entry.stations],
          totalPlays: entry.totalPlays,
          lastSeen: entry.lastSeen,
          inLibrary,
        });
      }

      // Build per-station comparisons
      const stationNames = [...new Set(songs.map(s => s.station_name))];
      const stationComparisons: StationComparison[] = stationNames.map(stationName => {
        const stationGaps = gaps.filter(g => g.stations.includes(stationName));
        const inLib = stationGaps.filter(g => g.inLibrary).length;
        const missing = stationGaps.filter(g => !g.inLibrary).length;
        return {
          stationName,
          totalSongs: stationGaps.length,
          inLibrary: inLib,
          missing,
          coveragePercent: stationGaps.length > 0 ? Math.round((inLib / stationGaps.length) * 100) : 0,
          topMissing: stationGaps
            .filter(g => !g.inLibrary)
            .sort((a, b) => b.totalPlays - a.totalPlays)
            .slice(0, 5),
        };
      }).sort((a, b) => a.coveragePercent - b.coveragePercent);

      const totalInLibrary = gaps.filter(g => g.inLibrary).length;
      const totalMissing = gaps.filter(g => !g.inLibrary).length;

      setStats({
        totalUniqueSongs: gaps.length,
        inLibrary: totalInLibrary,
        missing: totalMissing,
        overallCoverage: gaps.length > 0 ? Math.round((totalInLibrary / gaps.length) * 100) : 0,
        stationComparisons,
        topGaps: gaps
          .filter(g => !g.inLibrary)
          .sort((a, b) => b.stationCount - a.stationCount || b.totalPlays - a.totalPlays)
          .slice(0, 50),
      });

      setLastAnalysis(new Date());
      console.log(`[COMPETITOR] ✅ Analysis complete: ${gaps.length} songs, ${totalInLibrary} in library, ${totalMissing} gaps`);
    } catch (err) {
      console.error('[COMPETITOR] Analysis error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return { stats, isAnalyzing, lastAnalysis, analyze };
}
