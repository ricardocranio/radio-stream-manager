/**
 * Grade Decision Log Card
 * Visual timeline showing why each song was chosen in the last grade build.
 */
import { useMemo, useState } from 'react';
import { Brain, ChevronDown, Music, SkipForward, ArrowRightLeft, AlertTriangle, FileText, Search, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useGradeLogStore, BlockLogEntry } from '@/store/gradeLogStore';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const typeConfig: Record<string, { icon: typeof Music; label: string; color: string; bg: string }> = {
  used: { icon: Music, label: 'Usada', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  skipped: { icon: SkipForward, label: 'Pulada', color: 'text-muted-foreground', bg: 'bg-muted/30' },
  substituted: { icon: ArrowRightLeft, label: 'Substituída', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  missing: { icon: AlertTriangle, label: 'Faltando', color: 'text-red-400', bg: 'bg-red-500/10' },
  fixed: { icon: FileText, label: 'Fixo', color: 'text-blue-400', bg: 'bg-blue-500/10' },
};

/** Detect special matching strategies from the reason string */
/** Extract freshness age in minutes from reason string */
function extractFreshnessMin(reason?: string): number | null {
  if (!reason) return null;
  const match = reason.match(/frescor:\s*(\d+)min/);
  return match ? parseInt(match[1], 10) : null;
}

/** Get freshness color class based on age */
function getFreshnessColorClass(ageMin: number): string {
  if (ageMin < 10) return 'text-green-400 border-green-500/30 bg-green-500/10';
  if (ageMin <= 15) return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
  return 'text-red-400 border-red-500/30 bg-red-500/10';
}

function getSpecialBadges(reason?: string): Array<{ label: string; className: string }> {
  if (!reason) return [];
  const badges: Array<{ label: string; className: string }> = [];
  
  // P1 FRESCOR (≤15min, the freshest)
  if (reason.includes('[P1]') && !reason.includes('[P1-')) {
    const ageMin = extractFreshnessMin(reason);
    const colorClass = ageMin !== null ? getFreshnessColorClass(ageMin) : 'text-green-400 border-green-500/30 bg-green-500/10';
    const label = ageMin !== null ? `🔥 P1 ${ageMin}min` : '🔥 P1 FRESCOR';
    badges.push({ label, className: colorClass });
  }
  
  // P1-EXT (graduated tiers ≤30min, ≤1h, ≤2h, >2h)
  if (reason.includes('[P1-EXT]')) {
    const ageMin = extractFreshnessMin(reason);
    const colorClass = ageMin !== null ? getFreshnessColorClass(ageMin) : 'text-amber-400 border-amber-500/30 bg-amber-500/10';
    const label = ageMin !== null ? `📡 P1-EXT ${ageMin}min` : '📡 P1-EXT';
    badges.push({ label, className: colorClass });
  }
  
  if (reason.includes('P1-DEEP')) {
    badges.push({ label: '🔎 P1-DEEP', className: 'text-purple-400 border-purple-500/30 bg-purple-500/10' });
  }
  if (reason.includes('relaxed') || reason.includes('relaxado')) {
    badges.push({ label: '⚡ Relaxed', className: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' });
  }
  if (reason.includes('alias forward') || reason.includes('alias reverso')) {
    badges.push({ label: '🔄 Alias', className: 'text-orange-400 border-orange-500/30 bg-orange-500/10' });
  }
  if (reason.includes('JIT')) {
    badges.push({ label: '⏬ JIT', className: 'text-sky-400 border-sky-500/30 bg-sky-500/10' });
  }
  return badges;
}

export function GradeDecisionLogCard() {
  const blockLogs = useGradeLogStore((s) => s.blockLogs);
  const [isOpen, setIsOpen] = useState(false);

  // Get logs from the latest build (within 2min window)
  const latestBuildLogs = useMemo(() => {
    if (blockLogs.length === 0) return [];
    const latestTime = new Date(blockLogs[0]?.timestamp || 0).getTime();
    return blockLogs.filter(l => {
      const t = new Date(l.timestamp).getTime();
      return latestTime - t < 120_000;
    });
  }, [blockLogs]);

  // Group by block time
  const grouped = useMemo(() => {
    const map = new Map<string, BlockLogEntry[]>();
    for (const log of latestBuildLogs) {
      const key = log.blockTime;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    // Sort by block time
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [latestBuildLogs]);

  const specialCounts = useMemo(() => {
    let p1Fresh = 0, p1Ext = 0, deep = 0, relaxed = 0, jit = 0;
    for (const log of latestBuildLogs) {
      if (log.reason?.includes('[P1]') && !log.reason?.includes('[P1-')) p1Fresh++;
      if (log.reason?.includes('[P1-EXT]')) p1Ext++;
      if (log.reason?.includes('P1-DEEP')) deep++;
      if (log.reason?.includes('relaxed') || log.reason?.includes('relaxado')) relaxed++;
      if (log.reason?.includes('JIT')) jit++;
    }
    return { p1Fresh, p1Ext, deep, relaxed, jit };
  }, [latestBuildLogs]);

  const summary = useMemo(() => {
    const s = { used: 0, skipped: 0, substituted: 0, missing: 0, fixed: 0 };
    for (const log of latestBuildLogs) {
      s[log.type] = (s[log.type] || 0) + 1;
    }
    return s;
  }, [latestBuildLogs]);

  if (latestBuildLogs.length === 0) return null;

  return (
    <Card className="glass-card border-indigo-500/20">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="w-full">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Decisões da Grade</p>
                  <p className="text-xs text-muted-foreground">
                    {grouped.length} blocos · {latestBuildLogs.length} decisões
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  {summary.used > 0 && (
                    <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">
                      ✓{summary.used}
                    </Badge>
                  )}
                  {summary.substituted > 0 && (
                    <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                      ↔{summary.substituted}
                    </Badge>
                  )}
                  {summary.missing > 0 && (
                    <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30">
                      ✗{summary.missing}
                    </Badge>
                  )}
                  {specialCounts.deep > 0 && (
                    <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-500/30">
                      🔎{specialCounts.deep}
                    </Badge>
                  )}
                  {specialCounts.relaxed > 0 && (
                    <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/30">
                      ⚡{specialCounts.relaxed}
                    </Badge>
                  )}
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </CardContent>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4">
            <ScrollArea className="max-h-80">
              <div className="space-y-3">
                {grouped.map(([blockTime, logs]) => (
                  <div key={blockTime} className="space-y-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono font-bold text-primary">{blockTime}</span>
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] text-muted-foreground">{logs.length} itens</span>
                    </div>
                    {logs.map((log, i) => {
                      const cfg = typeConfig[log.type] || typeConfig.used;
                      const Icon = cfg.icon;
                      const specialBadges = getSpecialBadges(log.reason);
                      return (
                        <div key={i} className={`flex items-center gap-2 text-xs p-1.5 rounded ${cfg.bg}`}>
                          <Icon className={`w-3 h-3 ${cfg.color} shrink-0`} />
                          <span className="text-foreground truncate flex-1">
                            {log.artist} — {log.title}
                          </span>
                          {specialBadges.map((sb, j) => (
                            <Badge key={j} variant="outline" className={`text-[10px] shrink-0 ${sb.className}`}>
                              {sb.label}
                            </Badge>
                          ))}
                          {log.station && log.station !== 'FALLBACK' && (
                            <Badge variant="outline" className="text-[10px] shrink-0">{log.station}</Badge>
                          )}
                          {log.station === 'FALLBACK' && (
                            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 shrink-0">Coringa</Badge>
                          )}
                          {log.reason && (
                            <span className="text-[10px] text-muted-foreground shrink-0 max-w-24 truncate" title={log.reason}>
                              {log.reason}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
