import { useState, useEffect } from 'react';
import { BarChart3 } from 'lucide-react';
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
  const [isLoading, setIsLoading] = useState(true);

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

        // Group by hour
        const counts = new Array(24).fill(0);
        data.forEach(s => {
          const h = new Date(s.scraped_at).getHours();
          counts[h]++;
        });

        const result = counts.map((count, hour) => ({ hour, count }));
        setHourlyData(result);

        const maxCount = Math.max(...counts);
        if (maxCount > 0) setPeakHour(counts.indexOf(maxCount));
      } catch { /* ignore */ }
      setIsLoading(false);
    };

    fetchData();
    const interval = setInterval(fetchData, 600_000); // 10 min
    return () => clearInterval(interval);
  }, []);

  const maxCount = Math.max(...hourlyData.map(d => d.count), 1);

  if (isLoading) return null;

  return (
    <Card className="glass-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Capturas por Hora (24h)</span>
          </div>
          {peakHour !== null && (
            <Badge variant="outline" className="text-xs">
              Pico: {peakHour}h
            </Badge>
          )}
        </div>

        <div className="flex items-end gap-[2px] h-16">
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
      </CardContent>
    </Card>
  );
}
