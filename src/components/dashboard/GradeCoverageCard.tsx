import { useMemo } from 'react';
import { BarChart3, Music, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useGradeLogStore } from '@/store/gradeLogStore';

export function GradeCoverageCard() {
  const blockLogs = useGradeLogStore((s) => s.blockLogs);

  const stats = useMemo(() => {
    if (blockLogs.length === 0) return null;

    const used = blockLogs.filter(l => l.type === 'used').length;
    const missing = blockLogs.filter(l => l.type === 'missing').length;
    const substituted = blockLogs.filter(l => l.type === 'substituted').length;
    const total = used + missing + substituted;
    
    if (total === 0) return null;

    const realPercent = Math.round((used / total) * 100);
    const coringa = missing;
    
    // Unique blocks
    const blocks = new Set(blockLogs.map(l => l.blockTime));

    return {
      total,
      used,
      missing: coringa,
      substituted,
      realPercent,
      blockCount: blocks.size,
    };
  }, [blockLogs]);

  if (!stats) {
    return (
      <Card className="glass-card border-border/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 text-muted-foreground">
            <BarChart3 className="w-5 h-5" />
            <span className="text-sm">Cobertura da Grade — Aguardando dados...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const coverageColor = stats.realPercent >= 80 ? 'text-green-400' : stats.realPercent >= 50 ? 'text-amber-400' : 'text-red-400';
  const progressColor = stats.realPercent >= 80 ? 'bg-green-500' : stats.realPercent >= 50 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <Card className="glass-card border-border/30">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Cobertura da Grade (24h)
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="space-y-3">
          {/* Main percentage */}
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-bold ${coverageColor}`}>{stats.realPercent}%</span>
            <span className="text-xs text-muted-foreground">músicas reais</span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
              style={{ width: `${stats.realPercent}%` }}
            />
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="flex items-center justify-center gap-1">
                <Music className="w-3 h-3 text-green-400" />
                <span className="text-sm font-semibold text-green-400">{stats.used}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Reais</span>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span className="text-sm font-semibold text-amber-400">{stats.missing}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Coringas</span>
            </div>
            <div>
              <span className="text-sm font-semibold text-muted-foreground">{stats.blockCount}</span>
              <br />
              <span className="text-[10px] text-muted-foreground">Blocos</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
