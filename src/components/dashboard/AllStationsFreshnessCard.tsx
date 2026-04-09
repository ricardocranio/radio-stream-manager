/**
 * All Stations Freshness Card
 * Monitors freshness of ALL enabled stations, not just the sequence ones.
 */
import { useState, useEffect, useMemo } from 'react';
import { Radio, CheckCircle2, AlertTriangle, Clock, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { supabase } from '@/integrations/supabase/client';

const FRESHNESS_THRESHOLD_MIN = 20;
const CHECK_INTERVAL_MS = 60_000;

type StationStatus = { lastSeen: Date | null; fresh: boolean };

export function AllStationsFreshnessCard() {
  const stations = useRadioStore((s) => s.stations);
  const [statusMap, setStatusMap] = useState<Record<string, StationStatus>>({});
  const [collapsed, setCollapsed] = useState(true);

  const enabledStations = useMemo(
    () => stations.filter((s) => s.enabled).map((s) => s.name),
    [stations]
  );

  useEffect(() => {
    if (enabledStations.length === 0) return;

    const check = async () => {
      const cutoff = new Date(Date.now() - FRESHNESS_THRESHOLD_MIN * 60_000).toISOString();
      const result: Record<string, StationStatus> = {};

      // Batch: get latest capture per station in one query
      const { data } = await supabase
        .from('scraped_songs')
        .select('station_name, scraped_at')
        .in('station_name', enabledStations)
        .order('scraped_at', { ascending: false })
        .limit(500);

      // Build a map of latest per station
      const latestMap = new Map<string, string>();
      if (data) {
        for (const row of data) {
          if (!latestMap.has(row.station_name)) {
            latestMap.set(row.station_name, row.scraped_at);
          }
        }
      }

      for (const name of enabledStations) {
        const ts = latestMap.get(name);
        if (ts) {
          const lastSeen = new Date(ts);
          result[name] = { lastSeen, fresh: lastSeen.toISOString() > cutoff };
        } else {
          result[name] = { lastSeen: null, fresh: false };
        }
      }

      setStatusMap(result);
    };

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabledStations]);

  const entries = Object.entries(statusMap);
  const onlineCount = entries.filter(([, s]) => s.fresh).length;
  const offlineCount = entries.filter(([, s]) => !s.fresh).length;
  const allOnline = entries.length > 0 && offlineCount === 0;

  if (enabledStations.length === 0) return null;

  return (
    <Card className={`glass-card ${offlineCount > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/20'}`}>
      <CardContent className="p-4 space-y-2">
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${offlineCount > 0 ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
              {offlineCount > 0 ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Status das Emissoras</p>
              <p className="text-xs text-muted-foreground">{enabledStations.length} emissoras habilitadas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`text-xs ${allOnline ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-400'}`}
            >
              {allOnline ? 'Todas online' : `${offlineCount} offline`}
            </Badge>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${!collapsed ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Summary chips */}
        <div className="flex gap-2 text-[10px]">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            ✓ {onlineCount} online
          </span>
          {offlineCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              ⚠ {offlineCount} offline
            </span>
          )}
        </div>

        {/* Expanded list */}
        {!collapsed && (
          <ScrollArea className="max-h-[220px]">
            <div className="space-y-1">
              {entries
                .sort(([, a], [, b]) => (a.fresh === b.fresh ? 0 : a.fresh ? 1 : -1))
                .map(([station, status]) => (
                  <div key={station} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Radio className={`w-3 h-3 ${status.fresh ? 'text-emerald-400' : 'text-amber-400'}`} />
                      <span className="text-foreground font-medium">{station}</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {status.lastSeen ? (
                        <span className={status.fresh ? '' : 'text-amber-400 font-medium'}>
                          {Math.floor((Date.now() - status.lastSeen.getTime()) / 60000)} min
                        </span>
                      ) : (
                        <span className="text-amber-400">Sem dados</span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
