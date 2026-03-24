import { useState, useEffect, useRef, useCallback } from 'react';
import { BarChart3, TrendingUp, Music, Radio, Zap, RefreshCw, Loader2, Calendar, Award, Disc3, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

interface WeeklyReport {
  generatedAt: string;
  period: { start: string; end: string };
  summary: {
    totalSongsArchived: number;
    totalRecentCaptures: number;
    totalClassified: number;
    uniqueArtists: number;
    activeStations: number;
  };
  topSongs: Array<{ artist: string; title: string; playCount: number; stations: string }>;
  topArtists: Array<{ artist: string; count: number }>;
  stationRanking: Array<{ station: string; count: number }>;
  genreDistribution: Array<{ genre: string; count: number }>;
  energyDistribution: Array<{ energy: string; count: number }>;
  yearDistribution?: Array<{ year: string; count: number }>;
  stationGenres: Array<{ station: string; genres: Array<{ genre: string; count: number }> }>;
}

const GENRE_COLORS: Record<string, string> = {
  POP: '#3b82f6',
  ROCK: '#ef4444',
  SERTANEJO: '#f59e0b',
  PAGODE: '#10b981',
  MPB: '#8b5cf6',
  'RAP/HIP-HOP': '#f97316',
  ELETRONICA: '#06b6d4',
  FUNK: '#ec4899',
  GOSPEL: '#6366f1',
  FORRO: '#14b8a6',
  REGGAETON: '#eab308',
  'R&B': '#a855f7',
  COUNTRY: '#84cc16',
  JAZZ: '#0ea5e9',
  LATINA: '#f43f5e',
  INDIE: '#d946ef',
  METAL: '#64748b',
  REGGAE: '#22c55e',
  OUTRO: '#94a3b8',
};

const ENERGY_COLORS: Record<string, string> = {
  LOW: '#3b82f6',
  MEDIUM: '#10b981',
  HIGH: '#f59e0b',
  VERY_HIGH: '#ef4444',
};

const ENERGY_LABELS: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  VERY_HIGH: 'Muito Alta',
};

type PeriodDays = 7 | 14 | 30;

// Local cache for edge function responses — avoids re-calling on every tab switch
const _reportCache = new Map<PeriodDays, { report: WeeklyReport; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function TrendsView() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState<PeriodDays>(7);
  const { toast } = useToast();

  const fetchReport = useCallback(async (days: PeriodDays = periodDays, forceRefresh = false) => {
    // Check cache first
    if (!forceRefresh) {
      const cached = _reportCache.get(days);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        setReport(cached.report);
        setIsLoading(false);
        return;
      }
    }

    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('weekly-report', {
        body: { days },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setReport(data);
      // Save to cache
      _reportCache.set(days, { report: data, fetchedAt: Date.now() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar relatório';
      setError(msg);
      toast({ title: '❌ Erro', description: msg, variant: 'destructive' });
    }
    setIsLoading(false);
  }, [periodDays, toast]);

  useEffect(() => { fetchReport(periodDays); }, [periodDays]);

  const handlePeriodChange = (days: PeriodDays) => {
    setPeriodDays(days);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Gerando relatório ({periodDays} dias)...</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6 space-y-4">
        <Card className="glass-card border-destructive/30">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-destructive">{error || 'Relatório indisponível'}</p>
            <Button onClick={() => fetchReport(periodDays, true)} variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" /> Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const maxStationCount = report.stationRanking[0]?.count || 1;
  const maxArtistCount = report.topArtists[0]?.count || 1;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <BarChart3 className="w-7 h-7 text-primary" />
            Relatório de Tendências
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Período: {format(new Date(report.period.start), "dd/MM", { locale: ptBR })} — {format(new Date(report.period.end), "dd/MM/yyyy", { locale: ptBR })}
          </p>
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
                onClick={() => handlePeriodChange(days)}
              >
                {days}d
              </Button>
            ))}
          </div>
          <Badge variant="outline" className="text-xs gap-1">
            <Calendar className="w-3 h-3" />
            Gerado {format(new Date(report.generatedAt), "HH:mm dd/MM", { locale: ptBR })}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => fetchReport(periodDays, true)} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Capturas Recentes', value: report.summary.totalRecentCaptures, icon: Music, color: 'text-primary' },
          { label: 'Músicas Arquivadas', value: report.summary.totalSongsArchived, icon: Disc3, color: 'text-emerald-500' },
          { label: 'Classificadas (IA)', value: report.summary.totalClassified, icon: Zap, color: 'text-amber-500' },
          { label: 'Artistas Únicos', value: report.summary.uniqueArtists, icon: Award, color: 'text-purple-500' },
          { label: 'Emissoras Ativas', value: report.summary.activeStations, icon: Radio, color: 'text-rose-500' },
        ].map(item => (
          <Card key={item.label} className="glass-card">
            <CardContent className="p-4 text-center">
              <item.icon className={`w-5 h-5 mx-auto mb-1 ${item.color}`} />
              <p className="text-2xl font-bold">{item.value.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Genre Distribution Pie */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              Distribuição por Gênero (IA)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.genreDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={report.genreDistribution}
                    dataKey="count"
                    nameKey="genre"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ genre, percent }) => `${genre} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {report.genreDistribution.map((entry) => (
                      <Cell key={entry.genre} fill={GENRE_COLORS[entry.genre] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`${value} músicas`, 'Capturas']} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">
                Nenhuma música classificada ainda. A IA classifica automaticamente a cada 30 minutos.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Energy Distribution */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Distribuição de Energia (IA)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.energyDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={report.energyDistribution.map(e => ({ ...e, name: ENERGY_LABELS[e.energy] || e.energy }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Bar dataKey="count" name="Músicas" radius={[6, 6, 0, 0]}>
                    {report.energyDistribution.map((entry) => (
                      <Cell key={entry.energy} fill={ENERGY_COLORS[entry.energy] || '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">
                Dados de energia serão gerados pela classificação IA.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Year Distribution */}
      {report.yearDistribution && report.yearDistribution.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              Distribuição por Ano de Lançamento (ID3)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={report.yearDistribution}
                  dataKey="count"
                  nameKey="year"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ year, percent }) => `${year} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {report.yearDistribution.map((entry) => {
                    const yearNum = parseInt(entry.year);
                    let color = '#94a3b8';
                    if (yearNum >= 2024) color = '#10b981';
                    else if (yearNum >= 2020) color = '#3b82f6';
                    else if (yearNum >= 2015) color = '#8b5cf6';
                    else if (yearNum >= 2010) color = '#f59e0b';
                    else if (yearNum >= 2000) color = '#f97316';
                    else color = '#ef4444';
                    return <Cell key={entry.year} fill={color} />;
                  })}
                </Pie>
                <Tooltip formatter={(value: number) => [`${value} músicas`, 'Capturas']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Top Artists & Station Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Artists */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Award className="w-4 h-4 text-purple-500" />
              Top Artistas ({periodDays}d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[320px]">
              <div className="space-y-2">
                {report.topArtists.map((artist, i) => (
                  <div key={artist.artist} className="flex items-center gap-3">
                    <span className={`text-xs font-mono w-6 text-right ${i < 3 ? 'text-amber-500 font-bold' : 'text-muted-foreground'}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{artist.artist}</p>
                      <Progress value={(artist.count / maxArtistCount) * 100} className="h-1.5 mt-1" />
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {artist.count}x
                    </Badge>
                  </div>
                ))}
                {report.topArtists.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">Sem dados de artistas</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Station Ranking */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Radio className="w-4 h-4 text-rose-500" />
              Emissoras Mais Ativas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[320px]">
              <div className="space-y-2">
                {report.stationRanking.map((station, i) => (
                  <div key={station.station} className="flex items-center gap-3">
                    <span className={`text-xs font-mono w-6 text-right ${i < 3 ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{station.station}</p>
                      <Progress value={(station.count / maxStationCount) * 100} className="h-1.5 mt-1" />
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {station.count} capturas
                    </Badge>
                  </div>
                ))}
                {report.stationRanking.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">Sem dados de emissoras</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Top Songs */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            Músicas Mais Tocadas (Histórico Agregado)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[350px]">
            <div className="space-y-1.5">
              {report.topSongs.map((song, i) => (
                <div key={`${song.artist}-${song.title}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                  <span className={`text-sm font-mono w-7 text-right shrink-0 ${i < 3 ? 'text-amber-500 font-bold text-base' : 'text-muted-foreground'}`}>
                    #{i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{song.title || 'Sem título'}</p>
                    <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {song.stations}
                  </Badge>
                  <Badge className="text-[10px] shrink-0 bg-primary/20 text-primary border-primary/30">
                    {song.playCount}x
                  </Badge>
                </div>
              ))}
              {report.topSongs.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  A compressão de histórico acontece diariamente às 4:00. Os dados aparecerão após o primeiro ciclo.
                </p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Genre by Station */}
      {report.stationGenres.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Gêneros por Emissora (IA)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {report.stationGenres.map(station => (
                <div key={station.station} className="p-3 rounded-lg bg-secondary/30 border border-border">
                  <p className="text-sm font-medium mb-2 truncate">{station.station}</p>
                  <div className="space-y-1">
                    {station.genres.slice(0, 4).map(g => (
                      <div key={g.genre} className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: GENRE_COLORS[g.genre] || '#94a3b8' }}
                        />
                        <span className="text-xs flex-1 truncate">{g.genre}</span>
                        <span className="text-xs text-muted-foreground">{g.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
