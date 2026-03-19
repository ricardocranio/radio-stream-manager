import { useState, useEffect } from 'react';
import { FileText, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface WeeklyReport {
  topSongs: Array<{ artist: string; title: string; plays: number }>;
  topArtists: Array<{ artist: string; plays: number }>;
  genreBreakdown: Record<string, number>;
  totalCaptures: number;
}

export function WeeklyReportCard() {
  const { toast } = useToast();
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('weekly-report');
      if (error) throw error;
      if (data?.report) {
        setReport({
          topSongs: (data.report.topSongs || []).slice(0, 5),
          topArtists: (data.report.topArtists || []).slice(0, 5),
          genreBreakdown: data.report.genreBreakdown || {},
          totalCaptures: data.report.totalCaptures || 0,
        });
      }
    } catch (err) {
      console.error('[WEEKLY] Error:', err);
      toast({ title: '⚠️ Erro ao carregar relatório', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  useEffect(() => { fetchReport(); }, []);

  const topGenres = report
    ? Object.entries(report.genreBreakdown)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
    : [];

  const maxGenreCount = topGenres.length > 0 ? topGenres[0][1] : 1;

  return (
    <Card className="glass-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Resumo Semanal</span>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchReport} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
        </div>

        {report && (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {report.totalCaptures.toLocaleString()} capturas
              </Badge>
            </div>

            {/* Top Artists */}
            {report.topArtists.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Top Artistas</p>
                <div className="space-y-1">
                  {report.topArtists.map((a, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate text-foreground">{i + 1}. {a.artist}</span>
                      <span className="text-muted-foreground font-mono shrink-0 ml-2">{a.plays}x</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Genre Breakdown */}
            {topGenres.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Gêneros</p>
                <div className="space-y-1">
                  {topGenres.map(([genre, count]) => (
                    <div key={genre} className="flex items-center gap-2 text-xs">
                      <span className="w-20 truncate text-foreground">{genre}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${(count / maxGenreCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground font-mono w-8 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!report && !isLoading && (
          <p className="text-xs text-muted-foreground">Clique em atualizar para gerar o relatório</p>
        )}
      </CardContent>
    </Card>
  );
}
