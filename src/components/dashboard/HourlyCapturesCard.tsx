import { useState, useEffect } from 'react';
import { BarChart3, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface HourlyData {
  hour: number;
  count: number;
}

export function HourlyCapturesCard() {
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [peakHour, setPeakHour] = useState<number | null>(null);
  const [totalCaptures, setTotalCaptures] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from('scraped_songs')
          .select('scraped_at')
          .gte('scraped_at', since)
          .limit(5000);

        if (error || !data) { setIsLoading(false); return; }

        const counts = new Array(24).fill(0);
        data.forEach(s => {
          const h = new Date(s.scraped_at).getHours();
          counts[h]++;
        });

        const result = counts.map((count, hour) => ({ hour, count }));
        setHourlyData(result);
        setTotalCaptures(data.length);

        const maxCount = Math.max(...counts);
        if (maxCount > 0) setPeakHour(counts.indexOf(maxCount));
      } catch { /* ignore */ }
      setIsLoading(false);
    };

    fetchData();
    const interval = setInterval(fetchData, 600_000);
    return () => clearInterval(interval);
  }, []);

  const maxCount = Math.max(...hourlyData.map(d => d.count), 1);

  if (isLoading) return null;

  return (
    <Card className="glass-card">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <div>
              <span className="text-sm font-medium text-foreground">Capturas por Hora (24h)</span>
              <p className="text-xs text-muted-foreground">{totalCaptures.toLocaleString()} capturas totais</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {peakHour !== null && (
              <Badge variant="outline" className="text-xs">
                Pico: {peakHour}h
              </Badge>
            )}
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${!collapsed ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Mini bar chart — always visible */}
        <div className="flex items-end gap-[2px] h-12">
          {hourlyData.map((d) => {
            const height = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
            const isNow = new Date().getHours() === d.hour;
            return (
              <div
                key={d.hour}
                className="flex-1 rounded-t transition-all"
                style={{
                  height: `${Math.max(height, 2)}%`,
                  background: isNow
                    ? 'hsl(var(--primary))'
                    : d.count > 0
                    ? 'hsl(var(--primary) / 0.4)'
                    : 'hsl(var(--muted))',
                }}
                title={`${d.hour}h: ${d.count} capturas`}
              />
            );
          })}
        </div>

        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>0h</span>
          <span>6h</span>
          <span>12h</span>
          <span>18h</span>
          <span>23h</span>
        </div>

        {/* Expanded: detailed table */}
        {!collapsed && (
          <div className="grid grid-cols-6 gap-1 pt-1">
            {hourlyData.map((d) => {
              const isNow = new Date().getHours() === d.hour;
              return (
                <div
                  key={d.hour}
                  className={`text-center p-1 rounded text-[10px] ${isNow ? 'bg-primary/20 text-primary font-bold' : 'bg-muted/30 text-muted-foreground'}`}
                >
                  <div>{d.hour}h</div>
                  <div className="font-mono">{d.count}</div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
