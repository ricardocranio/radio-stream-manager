/**
 * Phase 4: Advanced Analytics View
 * 
 * Provides:
 * - Heatmap of peak capture hours per station
 * - Weekly renewal vs repetition rate
 * - Capture-to-grade utilization rate
 * - Period filter (7d/14d/30d)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDeferredRender } from '@/hooks/useDeferredRender';
import { BarChart3, Loader2, RefreshCw, Clock, TrendingUp, Repeat, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useRadioStore } from '@/store/radioStore';

interface HeatmapCell {
  hour: number;
  station: string;
  count: number;
}

interface RenewalStats {
  date: string;
  newSongs: number;
  repeatedSongs: number;
  renewalRate: number;
}

type PeriodDays = 7 | 14 | 30;

export function AnalyticsView() {
  const isReady = useDeferredRender();
  const [heatmapData, setHeatmapData] = useState<HeatmapCell[]>([]);
  const [renewalData, setRenewalData] = useState<RenewalStats[]>([]);
  const [hourlyDistribution, setHourlyDistribution] = useState<{ hour: string; count: number }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [periodDays, setPeriodDays] = useState<PeriodDays>(7);
  const [gradeUtilization, setGradeUtilization] = useState<{
    totalCaptured: number;
    usedInGrade: number;
    utilizationRate: number;
  } | null>(null);

  const loadAnalytics = useCallback(async (days: PeriodDays = periodDays) => {
    setIsLoading(true);
    try {
      const cutoff = subDays(new Date(), days).toISOString();

      // Fetch data for selected period
      const { data: songs, error } = await supabase
        .from('scraped_songs')
        .select('station_name, scraped_at, artist, title')
        .gte('scraped_at', cutoff)
        .order('scraped_at', { ascending: false })
        .limit(5000);

      if (error || !songs) return;

      // Hourly distribution
      const hourCounts: Record<number, number> = {};
      const stationHourCounts: Record<string, Record<number, number>> = {};

      for (const song of songs) {
        const hour = new Date(song.scraped_at).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;

        if (!stationHourCounts[song.station_name]) stationHourCounts[song.station_name] = {};
        stationHourCounts[song.station_name][hour] = (stationHourCounts[song.station_name][hour] || 0) + 1;
      }

      const hourlyDist = Array.from({ length: 24 }, (_, h) => ({
        hour: `${h.toString().padStart(2, '0')}h`,
        count: hourCounts[h] || 0,
      }));
      setHourlyDistribution(hourlyDist);

      // Build heatmap cells
      const heatCells: HeatmapCell[] = [];
      for (const [station, hours] of Object.entries(stationHourCounts)) {
        for (const [hour, count] of Object.entries(hours)) {
          heatCells.push({ hour: parseInt(hour), station, count });
        }
      }
      setHeatmapData(heatCells);

      // Renewal vs Repetition by day
      const dailySongs: Record<string, { all: Set<string>; new: Set<string> }> = {};
      const globalSeen = new Set<string>();

      const sorted = [...songs].sort((a, b) => 
        new Date(a.scraped_at).getTime() - new Date(b.scraped_at).getTime()
      );

      const capturedArtistTitleKeys = new Set<string>();

      for (const song of sorted) {
        const day = format(new Date(song.scraped_at), 'yyyy-MM-dd');
        const key = `${song.artist.toLowerCase().trim()}|${song.title.toLowerCase().trim()}`;
        capturedArtistTitleKeys.add(key);

        if (!dailySongs[day]) dailySongs[day] = { all: new Set(), new: new Set() };
        dailySongs[day].all.add(key);

        if (!globalSeen.has(key)) {
          dailySongs[day].new.add(key);
          globalSeen.add(key);
        }
      }

      const renewal: RenewalStats[] = Object.entries(dailySongs)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date: format(new Date(date), 'dd/MM', { locale: ptBR }),
          newSongs: data.new.size,
          repeatedSongs: data.all.size - data.new.size,
          renewalRate: data.all.size > 0 ? Math.round((data.new.size / data.all.size) * 100) : 0,
        }));
      setRenewalData(renewal);

      // Grade utilization: cross-reference captures with pending grade lines from global services
      try {
        const storeState = useRadioStore.getState();
        let usedInGrade = 0;

        // Check download history as proxy for "utilized" songs
        const downloadHistory = (storeState as any).downloadHistory || [];
        const downloadedKeys = new Set(
          downloadHistory
            .filter((h: any) => h.status === 'success' || h.status === 'success_fallback')
            .map((h: any) => `${(h.artist || '').toLowerCase().trim()}|${(h.title || '').toLowerCase().trim()}`)
        );

        for (const capturedKey of capturedArtistTitleKeys) {
          if (downloadedKeys.has(capturedKey)) usedInGrade++;
        }

        // Also check missingSongs that were resolved (downloaded)
        const missingSongs = (storeState as any).missingSongs || [];
        const resolvedKeys = new Set(
          missingSongs
            .filter((m: any) => m.status === 'downloaded')
            .map((m: any) => `${(m.artist || '').toLowerCase().trim()}|${(m.title || '').toLowerCase().trim()}`)
        );

        for (const capturedKey of capturedArtistTitleKeys) {
          if (resolvedKeys.has(capturedKey) && !downloadedKeys.has(capturedKey)) usedInGrade++;
        }

        setGradeUtilization({
          totalCaptured: capturedArtistTitleKeys.size,
          usedInGrade,
          utilizationRate: capturedArtistTitleKeys.size > 0
            ? Math.round((usedInGrade / capturedArtistTitleKeys.size) * 100)
            : 0,
        });
      } catch {
        setGradeUtilization(null);
      }

      setLastUpdate(new Date());
    } catch (err) {
      console.error('[ANALYTICS] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [periodDays]);

  useEffect(() => {
    loadAnalytics(periodDays);
  }, [periodDays]);

  const maxHourCount = Math.max(...hourlyDistribution.map(h => h.count), 1);

  if (!isReady) {
    return <div className="h-full flex items-center justify-center"><div className="text-center space-y-2"><BarChart3 className="w-8 h-8 text-primary/30 mx-auto animate-pulse" /><p className="text-sm text-muted-foreground/60">Carregando Analytics...</p></div></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-cyan-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Analytics Avançado</h2>
            <p className="text-xs text-muted-foreground">Análise de padrões — últimos {periodDays} dias</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period Filter */}
          <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-0.5">
            {([7, 14, 30] as PeriodDays[]).map(days => (
              <Button
                key={days}
                variant={periodDays === days ? 'default' : 'ghost'}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setPeriodDays(days)}
              >
                {days}d
              </Button>
            ))}
          </div>
          {lastUpdate && (
            <span className="text-[10px] text-muted-foreground">
              {format(lastUpdate, 'HH:mm', { locale: ptBR })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => loadAnalytics(periodDays)} disabled={isLoading} className="gap-2">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Atualizar
          </Button>
        </div>
      </div>

      {/* Grade Utilization Card */}
      {gradeUtilization && (
        <Card className="glass-card border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Target className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Taxa de Aproveitamento</p>
                <p className="text-xs text-muted-foreground">
                  {gradeUtilization.usedInGrade} de {gradeUtilization.totalCaptured} capturas únicas foram escaladas na grade
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-primary font-mono">{gradeUtilization.utilizationRate}%</p>
                <p className="text-[10px] text-muted-foreground">capturas → grade</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hourly Distribution Chart */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-500" />
            Distribuição Horária de Capturas
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: 'hsl(var(--foreground))',
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {hourlyDistribution.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={`hsl(185 100% ${30 + (entry.count / maxHourCount) * 40}%)`}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Renewal vs Repetition */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Repeat className="w-4 h-4 text-purple-500" />
            Renovação vs Repetição — Por Dia
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {renewalData.length > 0 ? (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={renewalData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'hsl(var(--foreground))',
                    }}
                  />
                  <Bar dataKey="newSongs" name="Novas" fill="hsl(155 85% 42%)" radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="repeatedSongs" name="Repetidas" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">Sem dados suficientes</p>
          )}
        </CardContent>
      </Card>

      {/* Station Heatmap (simplified grid) */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-amber-500" />
            Heatmap — Picos por Emissora
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ScrollArea className="max-h-[300px]">
            {(() => {
              const stations = [...new Set(heatmapData.map(h => h.station))];
              const maxCount = Math.max(...heatmapData.map(h => h.count), 1);

              return (
                <div className="space-y-2">
                  {/* Hour labels */}
                  <div className="flex items-center gap-0.5 ml-[120px]">
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="w-5 text-[8px] text-muted-foreground text-center">
                        {h % 3 === 0 ? `${h}h` : ''}
                      </div>
                    ))}
                  </div>
                  {stations.map(station => {
                    const stationData = heatmapData.filter(h => h.station === station);
                    return (
                      <div key={station} className="flex items-center gap-0.5">
                        <span className="text-[10px] text-muted-foreground w-[120px] truncate text-right pr-2">
                          {station}
                        </span>
                        {Array.from({ length: 24 }, (_, h) => {
                          const cell = stationData.find(c => c.hour === h);
                          const intensity = cell ? cell.count / maxCount : 0;
                          return (
                            <div
                              key={h}
                              className="w-5 h-5 rounded-sm border border-border/30"
                              style={{
                                background: intensity > 0
                                  ? `hsl(185 100% 48% / ${0.1 + intensity * 0.8})`
                                  : 'hsl(var(--muted) / 0.3)',
                              }}
                              title={`${station} ${h}h: ${cell?.count || 0} capturas`}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Renewal Rate Summary */}
      {renewalData.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(() => {
            const avgRenewal = Math.round(renewalData.reduce((s, d) => s + d.renewalRate, 0) / renewalData.length);
            const totalNew = renewalData.reduce((s, d) => s + d.newSongs, 0);
            const totalRepeated = renewalData.reduce((s, d) => s + d.repeatedSongs, 0);
            const bestDay = renewalData.reduce((best, d) => d.renewalRate > best.renewalRate ? d : best, renewalData[0]);

            return [
              { label: 'Taxa Renovação Média', value: `${avgRenewal}%`, color: 'hsl(155 85% 42%)' },
              { label: `Músicas Novas (${periodDays}d)`, value: totalNew, color: 'hsl(210 100% 60%)' },
              { label: `Repetições (${periodDays}d)`, value: totalRepeated, color: 'hsl(var(--muted-foreground))' },
              { label: 'Melhor Dia', value: `${bestDay.date} (${bestDay.renewalRate}%)`, color: 'hsl(45 100% 50%)' },
            ].map((stat, i) => (
              <div key={i} className="glass-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                <p className="text-lg font-bold font-mono tabular-nums mt-1"
                  style={{ color: stat.color }}>{stat.value}</p>
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
