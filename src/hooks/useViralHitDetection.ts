/**
 * Phase 1: Viral Hit Detection
 * 
 * Periodically queries scraped_songs to find songs appearing on 3+ stations
 * within the last 24 hours. Also detects repertoire shifts (stations playing
 * unusual genres).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ViralHit {
  title: string;
  artist: string;
  stationCount: number;
  stations: string[];
  firstSeen: string;
  trend: 'rising' | 'exploding'; // 3-4 = rising, 5+ = exploding
}

export interface RepertoireShift {
  stationName: string;
  description: string;
  newArtists: string[];
  detectedAt: string;
}

export interface SmartNotification {
  id: string;
  type: 'viral_hit' | 'repertoire_shift' | 'new_trend';
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  data?: ViralHit | RepertoireShift;
  dismissed: boolean;
}

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MIN_STATIONS_FOR_VIRAL = 3;
const DISMISSED_KEY = 'pgmr_dismissed_notifications';

function getDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedIds(ids: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

export function useViralHitDetection() {
  const [notifications, setNotifications] = useState<SmartNotification[]>([]);
  const [viralHits, setViralHits] = useState<ViralHit[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRef = useRef<Set<string>>(getDismissedIds());

  const detectViralHits = useCallback(async () => {
    try {
      setIsChecking(true);
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Fetch last 24h of scraped songs
      const { data: songs, error } = await supabase
        .from('scraped_songs')
        .select('title, artist, station_name, scraped_at')
        .gte('scraped_at', cutoff)
        .order('scraped_at', { ascending: false });

      if (error || !songs) {
        console.warn('[VIRAL] Error fetching songs:', error);
        return;
      }

      // Group by normalized "artist|title" and count unique stations
      const songMap = new Map<string, { title: string; artist: string; stations: Set<string>; firstSeen: string }>();

      for (const song of songs) {
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        if (!songMap.has(key)) {
          songMap.set(key, {
            title: song.title,
            artist: song.artist,
            stations: new Set(),
            firstSeen: song.scraped_at,
          });
        }
        const entry = songMap.get(key)!;
        entry.stations.add(song.station_name);
        if (song.scraped_at < entry.firstSeen) entry.firstSeen = song.scraped_at;
      }

      // Filter for viral hits (3+ unique stations)
      const hits: ViralHit[] = [];
      for (const [, entry] of songMap) {
        if (entry.stations.size >= MIN_STATIONS_FOR_VIRAL) {
          hits.push({
            title: entry.title,
            artist: entry.artist,
            stationCount: entry.stations.size,
            stations: [...entry.stations],
            firstSeen: entry.firstSeen,
            trend: entry.stations.size >= 5 ? 'exploding' : 'rising',
          });
        }
      }

      // Sort by station count descending
      hits.sort((a, b) => b.stationCount - a.stationCount);
      setViralHits(hits);

      // Generate notifications
      const newNotifications: SmartNotification[] = hits.map(hit => {
        const id = `viral_${hit.artist.toLowerCase()}_${hit.title.toLowerCase()}`.replace(/\s+/g, '_');
        return {
          id,
          type: 'viral_hit' as const,
          title: hit.trend === 'exploding' ? '🔥 Hit Explosivo!' : '📈 Hit em Alta',
          description: `${hit.artist} - ${hit.title} está tocando em ${hit.stationCount} emissoras`,
          severity: hit.trend === 'exploding' ? 'critical' as const : 'warning' as const,
          timestamp: new Date().toISOString(),
          data: hit,
          dismissed: dismissedRef.current.has(id),
        };
      });

      // Detect repertoire shifts — stations with unusual new artists
      const stationArtists = new Map<string, Set<string>>();
      const recentWindow = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // last 6h
      const olderWindow = songs.filter(s => s.scraped_at < recentWindow);
      const recentSongs = songs.filter(s => s.scraped_at >= recentWindow);

      for (const s of olderWindow) {
        if (!stationArtists.has(s.station_name)) stationArtists.set(s.station_name, new Set());
        stationArtists.get(s.station_name)!.add(s.artist.toLowerCase().trim());
      }

      for (const [station, oldArtists] of stationArtists) {
        const recentForStation = recentSongs.filter(s => s.station_name === station);
        const newArtists = recentForStation
          .filter(s => !oldArtists.has(s.artist.toLowerCase().trim()))
          .map(s => s.artist);
        const uniqueNew = [...new Set(newArtists)];

        if (uniqueNew.length >= 3) {
          const shiftId = `shift_${station.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
          newNotifications.push({
            id: shiftId,
            type: 'repertoire_shift',
            title: '🔄 Mudança de Repertório',
            description: `${station} começou a tocar ${uniqueNew.length} artistas novos`,
            severity: 'info',
            timestamp: new Date().toISOString(),
            data: {
              stationName: station,
              description: `${uniqueNew.length} novos artistas nas últimas 6h`,
              newArtists: uniqueNew.slice(0, 5),
              detectedAt: new Date().toISOString(),
            } as RepertoireShift,
            dismissed: dismissedRef.current.has(shiftId),
          });
        }
      }

      setNotifications(newNotifications);
      setLastCheck(new Date());
      console.log(`[VIRAL] ✅ Check completo: ${hits.length} hits virais, ${newNotifications.length} notificações`);
    } catch (err) {
      console.error('[VIRAL] Detection error:', err);
    } finally {
      setIsChecking(false);
    }
  }, []);

  const dismissNotification = useCallback((id: string) => {
    dismissedRef.current.add(id);
    saveDismissedIds(dismissedRef.current);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, dismissed: true } : n));
  }, []);

  const dismissAll = useCallback(() => {
    setNotifications(prev => {
      prev.forEach(n => dismissedRef.current.add(n.id));
      saveDismissedIds(dismissedRef.current);
      return prev.map(n => ({ ...n, dismissed: true }));
    });
  }, []);

  // Start periodic checks
  useEffect(() => {
    detectViralHits(); // Initial check
    intervalRef.current = setInterval(detectViralHits, CHECK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [detectViralHits]);

  const activeNotifications = notifications.filter(n => !n.dismissed);

  return {
    notifications: activeNotifications,
    allNotifications: notifications,
    viralHits,
    isChecking,
    lastCheck,
    dismissNotification,
    dismissAll,
    refresh: detectViralHits,
  };
}
