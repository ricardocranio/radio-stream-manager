/**
 * Sequence Freshness Alert Card
 * Monitors all stations in the active sequence with expand/collapse.
 * Shows last 3 songs per station with "used in grade" indicator.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, Radio, CheckCircle2, Clock, ChevronDown, ChevronRight, Music2, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { useGradeLogStore } from '@/store/gradeLogStore';
import { supabase } from '@/integrations/supabase/client';

const FRESHNESS_THRESHOLD_MIN = 10;
const CHECK_INTERVAL_MS = 60_000;

interface StationSong {
  title: string;
  artist: string;
  scraped_at: string;
}

interface StationInfo {
  lastSeen: Date | null;
  fresh: boolean;
  recentSongs: StationSong[];
}

export function P1FreshnessAlertCard() {
  const sequence = useRadioStore((s) => s.sequence);
  const stations = useRadioStore((s) => s.stations);
  const blockLogs = useGradeLogStore((s) => s.blockLogs);
  const [stationStatus, setStationStatus] = useState<Record<string, StationInfo>>({});
  const [collapsed, setCollapsed] = useState(true);
  const [expandedStations, setExpandedStations] = useState<Set<string>>(new Set());

  // Build a set of used song keys from grade logs for quick lookup
  const usedSongKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const log of blockLogs) {
      if (log.type === 'used') {
        keys.add(`${log.artist.toLowerCase().trim()}|${log.title.toLowerCase().trim()}`);
      }
    }
    return keys;
  }, [blockLogs]);

  const isSongUsed = useCallback((artist: string, title: string) => {
    return usedSongKeys.has(`${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`);
  }, [usedSongKeys]);

  const p1Stations = useMemo(() => {
    if (!sequence.length) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const entry of sequence) {
      const src = entry.radioSource;
      if (!src || src.startsWith('program_')) continue;
      const station = stations.find(s => s.id === src || s.name === src);
      const name = station?.name ?? src;
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  }, [sequence, stations]);

  const toggleStation = (stationName: string) => {
    setExpandedStations(prev => {
      const next = new Set(prev);
      if (next.has(stationName)) next.delete(stationName);
      else next.add(stationName);
      return next;
    });
  };

  useEffect(() => {
    if (p1Stations.length === 0) return;

    const checkFreshness = async () => {
      const cutoff = new Date(Date.now() - FRESHNESS_THRESHOLD_MIN * 60 * 1000).toISOString();
      const status: Record<string, StationInfo> = {};

      for (const stationName of p1Stations) {
        try {
          const { data } = await supabase
            .from('scraped_songs')
            .select('title, artist, scraped_at')
            .eq('station_name', stationName)
            .order('scraped_at', { ascending: false })
            .limit(3);

          if (data && data.length > 0) {
            const lastSeen = new Date(data[0].scraped_at);
            status[stationName] = {
              lastSeen,
              fresh: lastSeen.toISOString() > cutoff,
              recentSongs: data.map(d => ({ title: d.title, artist: d.artist, scraped_at: d.scraped_at })),
            };
          } else {
            status[stationName] = { lastSeen: null, fresh: false, recentSongs: [] };
          }
        } catch {
          status[stationName] = { lastSeen: null, fresh: false, recentSongs: [] };
        }
      }

      setStationStatus(status);
    };

    checkFreshness();
    const interval = setInterval(checkFreshness, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [p1Stations]);

  const entries = Object.entries(stationStatus);
  const hasAlert = entries.some(([, s]) => !s.fresh);
  const freshCount = entries.filter(([, s]) => s.fresh).length;
  const allFresh = entries.length > 0 && !hasAlert;

  if (p1Stations.length === 0) return null;

  return (
    <Card className={`glass-card ${hasAlert ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/20'}`}>
      <CardContent className="p-4 space-y-2">
        {/* Header */}
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasAlert ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
              {hasAlert ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Frescor da Sequência</p>
              <p className="text-xs text-muted-foreground">{freshCount}/{entries.length} estações ativas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-xs ${hasAlert ? 'border-amber-500/30 text-amber-400' : 'border-emerald-500/30 text-emerald-400'}`}>
              {hasAlert ? '⚠️ Sem dados' : '✓ Ativo'}
            </Badge>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${!collapsed ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Summary when collapsed */}
        {collapsed && entries.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {entries.slice(0, 2).map(([station, status]) => (
              <span key={station} className="flex items-center gap-1">
                <Radio className={`w-3 h-3 ${status.fresh ? 'text-emerald-400' : 'text-amber-400'}`} />
                {station}
                {status.lastSeen && <span className="text-[10px]">({Math.floor((Date.now() - status.lastSeen.getTime()) / 60000)}m)</span>}
              </span>
            ))}
            {entries.length > 2 && <span className="text-[10px]">+{entries.length - 2}</span>}
          </div>
        )}

        {/* Expanded station list */}
        {!collapsed && (
          <ScrollArea className="max-h-[350px]">
            <div className="space-y-1">
              {entries
                .sort(([, a], [, b]) => (a.fresh === b.fresh ? 0 : a.fresh ? 1 : -1))
                .map(([station, status]) => {
                  const isExpanded = expandedStations.has(station);
                  return (
                    <div key={station} className="rounded bg-muted/30 overflow-hidden">
                      {/* Station row */}
                      <div
                        className="flex items-center justify-between text-xs p-2 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={(e) => { e.stopPropagation(); toggleStation(station); }}
                      >
                        <div className="flex items-center gap-2">
                          {status.recentSongs.length > 0 ? (
                            <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                          ) : (
                            <span className="w-3" />
                          )}
                          <Radio className={`w-3 h-3 ${status.fresh ? 'text-emerald-400' : 'text-amber-400'}`} />
                          <span className="text-foreground font-medium">{station}</span>
                        </div>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {status.lastSeen ? (
                            <span className={status.fresh ? '' : 'text-amber-400 font-medium'}>
                              {Math.floor((Date.now() - status.lastSeen.getTime()) / 60000)} min atrás
                            </span>
                          ) : (
                            <span className="text-amber-400">Sem dados</span>
                          )}
                        </div>
                      </div>

                      {/* Expanded: last 3 songs */}
                      {isExpanded && status.recentSongs.length > 0 && (
                        <div className="border-t border-border/30 px-2 pb-2">
                          {status.recentSongs.map((song, idx) => {
                            const used = isSongUsed(song.artist, song.title);
                            const ago = Math.floor((Date.now() - new Date(song.scraped_at).getTime()) / 60000);
                            return (
                              <div
                                key={`${station}-${idx}`}
                                className={`flex items-center justify-between text-[11px] py-1.5 px-2 mt-1 rounded ${used ? 'bg-emerald-500/10' : 'bg-background/30'}`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  {used ? (
                                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                                  ) : (
                                    <Music2 className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                                  )}
                                  <span className="truncate text-foreground/80">
                                    <span className="font-medium">{song.artist}</span>
                                    <span className="text-muted-foreground"> — {song.title}</span>
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 ml-2">
                                  {used && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-emerald-500/30 text-emerald-400">
                                      Usada
                                    </Badge>
                                  )}
                                  <span className="text-muted-foreground text-[10px]">{ago}m</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </ScrollArea>
        )}

        {allFresh && collapsed && (
          <p className="text-xs text-emerald-400/60 text-center">
            Capturando normalmente — dados frescos &lt;{FRESHNESS_THRESHOLD_MIN}min
          </p>
        )}
      </CardContent>
    </Card>
  );
}
