/**
 * Phase 2: Competitor Mode View
 * Compares local library with monitored stations
 */

import { useEffect } from 'react';
import { useDeferredRender } from '@/hooks/useDeferredRender';
import { Swords, Loader2, RefreshCw, BarChart3, AlertTriangle, CheckCircle2, Music } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCompetitorAnalysis, CompetitorGap } from '@/hooks/useCompetitorAnalysis';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function CompetitorView() {
  const { stats, isAnalyzing, lastAnalysis, analyze } = useCompetitorAnalysis();

  useEffect(() => {
    if (!stats && !isAnalyzing) analyze();
  }, [stats, isAnalyzing, analyze]);

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Swords className="w-5 h-5 text-purple-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Modo Competidor</h2>
            <p className="text-xs text-muted-foreground">Compare seu repertório com as emissoras monitoradas</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastAnalysis && (
            <span className="text-[10px] text-muted-foreground">
              Última análise: {format(lastAnalysis, 'HH:mm dd/MM', { locale: ptBR })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={analyze} disabled={isAnalyzing} className="gap-2">
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isAnalyzing ? 'Analisando...' : 'Atualizar Análise'}
          </Button>
        </div>
      </div>

      {!stats ? (
        <div className="text-center py-12">
          {isAnalyzing ? (
            <>
              <Loader2 className="w-8 h-8 mx-auto text-primary animate-spin mb-3" />
              <p className="text-sm text-muted-foreground">Analisando repertório das emissoras...</p>
            </>
          ) : (
            <>
              <Swords className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Clique em "Atualizar Análise" para começar</p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Total Único', value: stats.totalUniqueSongs, icon: Music, color: '210 100% 60%' },
              { label: 'Na Biblioteca', value: stats.inLibrary, icon: CheckCircle2, color: '155 85% 42%' },
              { label: 'Faltando', value: stats.missing, icon: AlertTriangle, color: '0 80% 55%' },
              { label: 'Cobertura', value: `${stats.overallCoverage}%`, icon: BarChart3, color: '280 80% 60%' },
            ].map((stat, i) => {
              const Icon = stat.icon;
              return (
                <div key={i} className="glass-card p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `hsl(${stat.color} / 0.1)` }}>
                    <Icon className="w-4 h-4" style={{ color: `hsl(${stat.color})` }} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                    <p className="text-lg font-bold text-foreground font-mono tabular-nums">{stat.value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Per-Station Coverage */}
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Cobertura por Emissora</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {stats.stationComparisons.map((station) => (
                <div key={station.stationName} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{station.stationName}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {station.inLibrary}/{station.totalSongs}
                      </span>
                      <Badge variant="outline" className={`text-[9px] ${
                        station.coveragePercent >= 80 ? 'border-green-500/40 text-green-400' :
                        station.coveragePercent >= 50 ? 'border-amber-500/40 text-amber-400' :
                        'border-red-500/40 text-red-400'
                      }`}>
                        {station.coveragePercent}%
                      </Badge>
                    </div>
                  </div>
                  <Progress value={station.coveragePercent} className="h-2" />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Top Gaps */}
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Principais Gaps — Músicas que Faltam
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ScrollArea className="max-h-[400px]">
                <div className="space-y-1">
                  {stats.topGaps.slice(0, 30).map((gap, i) => (
                    <GapRow key={i} gap={gap} rank={i + 1} />
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function GapRow({ gap, rank }: { gap: CompetitorGap; rank: number }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/30 text-xs">
      <span className="font-mono text-[10px] text-muted-foreground w-5 text-right">{rank}.</span>
      <div className="min-w-0 flex-1">
        <span className="text-foreground font-medium truncate block">
          {gap.artist} — {gap.title}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {gap.stations.slice(0, 3).join(', ')}{gap.stations.length > 3 ? ` +${gap.stations.length - 3}` : ''}
        </span>
      </div>
      <Badge variant="outline" className="text-[9px] shrink-0">
        {gap.stationCount} rádio{gap.stationCount > 1 ? 's' : ''}
      </Badge>
      <Badge variant="secondary" className="text-[9px] shrink-0">
        {gap.totalPlays}x
      </Badge>
    </div>
  );
}
