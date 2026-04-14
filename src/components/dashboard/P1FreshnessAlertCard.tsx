/**
 * Sequence Freshness Alert Card
 * Monitors all stations in the active sequence with expand/collapse.
 * Shows last 3 songs per station with "used in grade" indicator.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, Radio, CheckCircle2, Clock, ChevronDown, ChevronRight, Music2, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { useGradeLogStore } from '@/store/gradeLogStore';
import { supabase } from '@/integrations/supabase/client';

const FRESHNESS_THRESHOLD_MIN = 10;
const FRESHNESS_WARNING_MIN = 15;
const CHECK_INTERVAL_MS = 60_000;

type FreshnessLevel = 'fresh' | 'warning' | 'stale' | 'unknown';

const FRESHNESS_STYLES: Record<FreshnessLevel, { icon: string; badge: string; text: string }> = {
  fresh: {
    icon: 'text-success',
    badge: 'border-success/25 bg-success/10 text-success',
    text: 'text-success',
  },
  warning: {
    icon: 'text-warning',
    badge: 'border-warning/25 bg-warning/10 text-warning',
    text: 'text-warning',
  },
  stale: {
    icon: 'text-destructive',
    badge: 'border-destructive/25 bg-destructive/10 text-destructive',
    text: 'text-destructive',
  },
  unknown: {
    icon: 'text-destructive',
    badge: 'border-destructive/25 bg-destructive/10 text-destructive',
    text: 'text-destructive',
  },
};

function getFreshnessLevel(ageMinutes: number | null): FreshnessLevel {
  if (ageMinutes == null) return 'unknown';
  if (ageMinutes <= FRESHNESS_THRESHOLD_MIN) return 'fresh';
  if (ageMinutes <= FRESHNESS_WARNING_MIN) return 'warning';
  return 'stale';
}

interface StationSong {
  title: string;
  artist: string;
  scraped_at: string;
}

interface StationInfo {
  lastSeen: Date | null;
  ageMinutes: number | null;
  fresh: boolean;
  level: FreshnessLevel;
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
            const ageMinutes = Math.floor((Date.now() - lastSeen.getTime()) / 60000);
            const level = getFreshnessLevel(ageMinutes);
            status[stationName] = {
              lastSeen,
              ageMinutes,
              fresh: level === 'fresh',
              level,
              recentSongs: data.map(d => ({ title: d.title, artist: d.artist, scraped_at: d.scraped_at })),
            };
          } else {
            status[stationName] = { lastSeen: null, ageMinutes: null, fresh: false, level: 'unknown', recentSongs: [] };
          }
        } catch {
          status[stationName] = { lastSeen: null, ageMinutes: null, fresh: false, level: 'unknown', recentSongs: [] };
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
    <Card className="glass-card">
      <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        <CardTitle className="text-sm md:text-base flex items-center gap-2">
          {hasAlert ? (
            <AlertTriangle className="w-4 h-4 text-warning animate-pulse" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-success" />
          )}
          Frescor da Sequência
          <span className="text-xs text-muted-foreground font-normal">{freshCount}/{entries.length} estações ativas</span>
          <Badge variant="outline" className={`text-xs ml-auto mr-2 ${hasAlert ? 'border-warning/25 bg-warning/10 text-warning' : 'border-success/25 bg-success/10 text-success'}`}>
            {hasAlert ? '⚠️ Atenção' : '✓ Ativo'}
          </Badge>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${!collapsed ? 'rotate-180' : ''}`} />
        </CardTitle>
      </CardHeader>
      <div className="collapsible-content" data-open={!collapsed}>
        <div>
          <CardContent className="pt-0 space-y-2">
            {/* Station list */}
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-1 pr-2">
                {entries
                  .sort(([, a], [, b]) => {
                    const severity = { unknown: 0, stale: 1, warning: 2, fresh: 3 } as const;
                    return severity[a.level] - severity[b.level];
                  })
                  .map(([station, status]) => {
                    const isExpanded = expandedStations.has(station);
                    const freshnessStyle = FRESHNESS_STYLES[status.level];
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
                            <Radio className={`w-3 h-3 ${freshnessStyle.icon}`} />
                            <span className="text-foreground font-medium">{station}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {status.lastSeen ? (
                              <Badge variant="outline" className={`h-5 gap-1 px-1.5 text-[10px] font-medium ${freshnessStyle.badge}`}>
                                <Clock className="w-3 h-3" />
                                {status.ageMinutes} min atrás
                              </Badge>
                            ) : (
                              <Badge variant="outline" className={`h-5 gap-1 px-1.5 text-[10px] font-medium ${freshnessStyle.badge}`}>
                                <Clock className="w-3 h-3" />
                                Sem dados
                              </Badge>
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
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-success/25 text-success">
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

            {allFresh && (
              <p className="text-xs text-success/70 text-center">
                Capturando normalmente — dados frescos &lt;{FRESHNESS_THRESHOLD_MIN}min
              </p>
            )}
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
