/**
 * Blocked Songs Dashboard Card
 * Shows how many songs were blocked today and by which rule.
 */
import { useMemo } from 'react';
import { Shield, Ban, User, Type } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

const STORAGE_KEY = 'pgmr_blocked_today';

export interface BlockedEvent {
  artist: string;
  title: string;
  rule: 'exact' | 'wildcard' | 'forbidden' | 'alias';
  source: 'download' | 'grade' | 'mapa';
  timestamp: string;
}

/** Record a blocked event (called from download service, grade builder, etc.) */
export function recordBlockedEvent(event: Omit<BlockedEvent, 'timestamp'>): void {
  try {
    const today = new Date().toDateString();
    const raw = localStorage.getItem(STORAGE_KEY);
    let data: { day: string; events: BlockedEvent[] } = { day: today, events: [] };
    if (raw) {
      data = JSON.parse(raw);
      if (data.day !== today) data = { day: today, events: [] };
    }
    data.events.push({ ...event, timestamp: new Date().toISOString() });
    // Keep max 200 events per day
    if (data.events.length > 200) data.events = data.events.slice(-200);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

/** Load today's blocked events */
function loadBlockedEvents(): BlockedEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data.day !== new Date().toDateString()) return [];
    return data.events || [];
  } catch { return []; }
}

export function BlockedSongsCard() {
  const events = useMemo(() => loadBlockedEvents(), []);

  const stats = useMemo(() => {
    const byRule = { exact: 0, wildcard: 0, forbidden: 0, alias: 0 };
    const bySource = { download: 0, grade: 0, mapa: 0 };
    for (const e of events) {
      byRule[e.rule] = (byRule[e.rule] || 0) + 1;
      bySource[e.source] = (bySource[e.source] || 0) + 1;
    }
    return { byRule, bySource, total: events.length };
  }, [events]);

  const ruleLabels: Record<string, { label: string; icon: typeof Ban; color: string }> = {
    exact: { label: 'Exata', icon: Ban, color: 'text-red-400' },
    wildcard: { label: 'Artista *', icon: User, color: 'text-orange-400' },
    forbidden: { label: 'Proibida', icon: Type, color: 'text-amber-400' },
    alias: { label: 'Alias', icon: Shield, color: 'text-purple-400' },
  };

  return (
    <Card className="glass-card border-red-500/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Bloqueios Hoje</p>
              <p className="text-xs text-muted-foreground">Músicas impedidas de entrar</p>
            </div>
          </div>
          <span className="text-2xl font-bold font-mono text-red-400">{stats.total}</span>
        </div>

        {stats.total > 0 && (
          <>
            {/* Rule breakdown */}
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.byRule)
                .filter(([, count]) => count > 0)
                .map(([rule, count]) => {
                  const info = ruleLabels[rule];
                  const Icon = info.icon;
                  return (
                    <Badge key={rule} variant="outline" className={`text-xs ${info.color} border-current/30`}>
                      <Icon className="w-3 h-3 mr-1" />
                      {info.label}: {count}
                    </Badge>
                  );
                })}
            </div>

            {/* Source breakdown */}
            <div className="flex gap-3 text-xs text-muted-foreground">
              {stats.bySource.download > 0 && <span>📥 Downloads: {stats.bySource.download}</span>}
              {stats.bySource.grade > 0 && <span>📋 Grade: {stats.bySource.grade}</span>}
              {stats.bySource.mapa > 0 && <span>🗺️ Mapa: {stats.bySource.mapa}</span>}
            </div>

            {/* Recent blocked songs */}
            <ScrollArea className="max-h-32">
              <div className="space-y-1">
                {events.slice(-5).reverse().map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Ban className="w-3 h-3 text-red-400/60 shrink-0" />
                    <span className="text-muted-foreground truncate">
                      {e.artist} — {e.title}
                    </span>
                    <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
                      {ruleLabels[e.rule]?.label}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        {stats.total === 0 && (
          <p className="text-xs text-muted-foreground/60 text-center py-2">
            Nenhuma música bloqueada hoje
          </p>
        )}
      </CardContent>
    </Card>
  );
}
