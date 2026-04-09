import { useState, useEffect } from 'react';
import { WifiOff, CheckCircle2, ChevronDown, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';

interface StationInfo {
  name: string;
  lastSeen: string;
  minutesAgo: number;
  offline: boolean;
}

export function OfflineAlertsCard() {
  const [allStations, setAllStations] = useState<StationInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const { data: stations } = await supabase
          .from('radio_stations')
          .select('name, enabled')
          .eq('enabled', true);

        if (!stations?.length) { setIsLoading(false); return; }

        const stationNames = stations.map(s => s.name);
        const { data: songs } = await supabase
          .from('scraped_songs')
          .select('station_name, scraped_at')
          .in('station_name', stationNames)
          .order('scraped_at', { ascending: false })
          .limit(1000);

        const latestByStation = new Map<string, string>();
        (songs || []).forEach(s => {
          if (!latestByStation.has(s.station_name)) {
            latestByStation.set(s.station_name, s.scraped_at);
          }
        });

        const now = Date.now();
        const OFFLINE_THRESHOLD = 30 * 60 * 1000;

        const result: StationInfo[] = [];
        for (const station of stations) {
          const lastSeen = latestByStation.get(station.name);
          if (!lastSeen) {
            result.push({ name: station.name, lastSeen: 'Nunca', minutesAgo: 9999, offline: true });
          } else {
            const diff = now - new Date(lastSeen).getTime();
            result.push({
              name: station.name,
              lastSeen: new Date(lastSeen).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
              minutesAgo: Math.floor(diff / 60000),
              offline: diff > OFFLINE_THRESHOLD,
            });
          }
        }

        setAllStations(result.sort((a, b) => {
          if (a.offline !== b.offline) return a.offline ? -1 : 1;
          return b.minutesAgo - a.minutesAgo;
        }));
      } catch { /* ignore */ }
      setIsLoading(false);
    };

    check();
    const interval = setInterval(check, 120_000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) return null;

  const offlineCount = allStations.filter(s => s.offline).length;
  const onlineCount = allStations.filter(s => !s.offline).length;

  return (
    <Card className={`glass-card ${offlineCount > 0 ? 'border-amber-500/30' : 'border-emerald-500/20'}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2">
            {offlineCount > 0 ? (
              <WifiOff className="w-4 h-4 text-amber-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <div>
              <span className="text-sm font-medium text-foreground">Status das Emissoras</span>
              <p className="text-xs text-muted-foreground">{allStations.length} emissoras monitoradas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-xs ${offlineCount > 0 ? 'border-amber-500/30 text-amber-400' : 'border-emerald-500/30 text-emerald-400'}`}>
              {offlineCount > 0 ? `${offlineCount} offline` : 'Todas online'}
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
              {allStations.map((s) => (
                <div key={s.name} className={`flex items-center justify-between text-xs p-2 rounded ${s.offline ? 'bg-amber-500/5 border border-amber-500/10' : 'bg-muted/30'}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${s.offline ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                    <span className="text-foreground font-medium truncate">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground shrink-0 ml-2">
                    <Clock className="w-3 h-3" />
                    {s.minutesAgo >= 9999 ? (
                      <span className="text-amber-400">Nunca</span>
                    ) : s.minutesAgo >= 60 ? (
                      <span className={s.offline ? 'text-amber-400 font-medium' : ''}>
                        {Math.floor(s.minutesAgo / 60)}h{s.minutesAgo % 60}min
                      </span>
                    ) : (
                      <span className={s.offline ? 'text-amber-400 font-medium' : ''}>
                        {s.minutesAgo}min
                      </span>
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
