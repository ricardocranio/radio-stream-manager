import { Rocket, CheckCircle2, XCircle, Clock, Ban, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useBurstStatsStore, type BurstEvent } from '@/store/burstStatsStore';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_ICON = {
  downloaded: <CheckCircle2 className="w-3 h-3 text-green-500" />,
  failed: <XCircle className="w-3 h-3 text-red-500" />,
  timeout: <Clock className="w-3 h-3 text-amber-500" />,
  blocked: <Ban className="w-3 h-3 text-muted-foreground" />,
};

const STATUS_LABEL: Record<string, string> = {
  downloaded: 'Baixado',
  failed: 'Erro',
  timeout: 'Timeout',
  blocked: 'Bloqueado',
};

export function BurstStatsCard() {
  const events = useBurstStatsStore((s) => s.events);
  const [collapsed, setCollapsed] = useState(true);

  const last = events[0] as BurstEvent | undefined;

  if (!last) {
    return (
      <Card className="glass-card border-border/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Rocket className="w-4 h-4 text-muted-foreground" />
            Pre-Download Burst
            <Badge variant="outline" className="text-[9px] border-muted-foreground/40 text-muted-foreground">
              Aguardando
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">Nenhum burst executado ainda. O próximo bloco ativará o diagnóstico.</p>
        </CardContent>
      </Card>
    );
  }

  const successRate = last.candidates > 0 ? Math.round((last.downloaded / last.candidates) * 100) : 0;
  const badgeColor = successRate >= 70 ? 'border-green-500/40 text-green-400' :
    successRate >= 40 ? 'border-amber-500/40 text-amber-400' : 'border-red-500/40 text-red-400';

  return (
    <Card className="glass-card border-border/30">
      <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        <CardTitle className="text-sm flex items-center gap-2">
          <Rocket className="w-4 h-4 text-primary" />
          Pre-Download Burst
          <Badge variant="outline" className={`text-[9px] ${badgeColor}`}>
            {last.downloaded}/{last.candidates} ({successRate}%)
          </Badge>
          <span className="text-[9px] text-muted-foreground ml-auto mr-1">
            {formatDistanceToNow(last.timestamp, { addSuffix: true, locale: ptBR })}
          </span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${!collapsed ? 'rotate-180' : ''}`} />
        </CardTitle>
      </CardHeader>

      {/* Summary stats */}
      <CardContent className="pt-0 space-y-2">
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="p-1.5 rounded bg-green-500/10 border border-green-500/20">
            <div className="text-sm font-bold text-green-400">{last.downloaded}</div>
            <div className="text-[9px] text-muted-foreground">Baixados</div>
          </div>
          <div className="p-1.5 rounded bg-red-500/10 border border-red-500/20">
            <div className="text-sm font-bold text-red-400">{last.failed}</div>
            <div className="text-[9px] text-muted-foreground">Erros</div>
          </div>
          <div className="p-1.5 rounded bg-amber-500/10 border border-amber-500/20">
            <div className="text-sm font-bold text-amber-400">{last.timedOut}</div>
            <div className="text-[9px] text-muted-foreground">Timeout</div>
          </div>
          <div className="p-1.5 rounded bg-muted/30 border border-border/30">
            <div className="text-sm font-bold text-muted-foreground">{last.blocked}</div>
            <div className="text-[9px] text-muted-foreground">Bloqueados</div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>⏱ {(last.durationMs / 1000).toFixed(1)}s total</span>
          <span>•</span>
          <span>Bloco {last.blockTime}</span>
          <span>•</span>
          <span>{events.length} bursts no histórico</span>
        </div>

        {/* Detailed breakdown (collapsible) */}
        {!collapsed && last.details.length > 0 && (
          <ScrollArea className="h-[200px] border border-border/20 rounded-lg">
            <div className="p-2 space-y-1">
              {last.details.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/10 border border-border/10">
                  {STATUS_ICON[d.status]}
                  <span className="font-medium truncate max-w-[140px]">{d.artist}</span>
                  <span className="text-muted-foreground">-</span>
                  <span className="truncate max-w-[140px]">{d.title}</span>
                  <Badge variant="outline" className="text-[8px] ml-auto shrink-0">
                    {d.station}
                  </Badge>
                  <span className="text-[9px] text-muted-foreground shrink-0">{STATUS_LABEL[d.status]}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Previous bursts summary */}
        {!collapsed && events.length > 1 && (
          <div className="border-t border-border/20 pt-2 mt-2">
            <p className="text-[10px] text-muted-foreground mb-1">Histórico recente</p>
            <div className="space-y-1">
              {events.slice(1, 6).map((ev) => (
                <div key={ev.id} className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Bloco {ev.blockTime}</span>
                  <span>{ev.downloaded}/{ev.candidates} ✅</span>
                  <span>{(ev.durationMs / 1000).toFixed(0)}s</span>
                  <span>{formatDistanceToNow(ev.timestamp, { addSuffix: true, locale: ptBR })}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
