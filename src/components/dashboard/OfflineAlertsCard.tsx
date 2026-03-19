import { useState, useEffect } from 'react';
import { WifiOff, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface OfflineStation {
  name: string;
  lastSeen: string;
  minutesAgo: number;
}

export function OfflineAlertsCard() {
  const [offlineStations, setOfflineStations] = useState<OfflineStation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        // Get enabled stations
        const { data: stations } = await supabase
          .from('radio_stations')
          .select('name, enabled')
          .eq('enabled', true);

        if (!stations?.length) { setIsLoading(false); return; }

        // Get latest song per station
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
        const OFFLINE_THRESHOLD = 30 * 60 * 1000; // 30 min without data = offline

        const offline: OfflineStation[] = [];
        for (const station of stations) {
          const lastSeen = latestByStation.get(station.name);
          if (!lastSeen) {
            offline.push({ name: station.name, lastSeen: 'Nunca', minutesAgo: 9999 });
          } else {
            const diff = now - new Date(lastSeen).getTime();
            if (diff > OFFLINE_THRESHOLD) {
              offline.push({
                name: station.name,
                lastSeen: new Date(lastSeen).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                minutesAgo: Math.floor(diff / 60000),
              });
            }
          }
        }

        setOfflineStations(offline.sort((a, b) => b.minutesAgo - a.minutesAgo));
      } catch { /* ignore */ }
      setIsLoading(false);
    };

    check();
    const interval = setInterval(check, 120_000); // 2 min
    return () => clearInterval(interval);
  }, []);

  if (isLoading) return null;

  return (
    <Card className={`glass-card ${offlineStations.length > 0 ? 'border-amber-500/30' : 'border-success/20'}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {offlineStations.length > 0 ? (
              <WifiOff className="w-4 h-4 text-amber-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-success" />
            )}
            <span className="text-sm font-medium text-foreground">Status das Emissoras</span>
          </div>
          <Badge variant="outline" className={`text-xs ${offlineStations.length > 0 ? 'border-amber-500/30 text-amber-400' : 'border-success/30 text-success'}`}>
            {offlineStations.length > 0 ? `${offlineStations.length} offline` : 'Todas online'}
          </Badge>
        </div>

        {offlineStations.length > 0 && (
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {offlineStations.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-amber-500/5">
                <span className="text-foreground font-medium truncate">{s.name}</span>
                <span className="text-muted-foreground shrink-0 ml-2">
                  {s.minutesAgo >= 60 ? `${Math.floor(s.minutesAgo / 60)}h${s.minutesAgo % 60}min` : `${s.minutesAgo}min`}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
