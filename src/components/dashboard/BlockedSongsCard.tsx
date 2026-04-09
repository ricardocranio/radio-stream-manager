/**
 * Blocked Songs Dashboard Card
 * Shows how many songs were blocked today and by which rule.
 * Collapsible with expand/collapse toggle.
 */
import { useState, useMemo } from 'react';
import { Shield, Ban, User, Type, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

const STORAGE_KEY = 'pgmr_blocked_today';

export interface BlockedEvent {
  artist: string;
  title: string;
  rule: 'exact' | 'wildcard' | 'forbidden' | 'alias' | 'partial';
  source: 'download' | 'grade' | 'mapa' | 'captured-download';
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
    if (data.events.length > 200) data.events = data.events.slice(-200);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

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
  const [collapsed, setCollapsed] = useState(true);
  const events = useMemo(() => {
    const real = loadBlockedEvents();
    if (real.length > 0) return real;
    // Mock data for visual testing — remove after confirming
    const now = new Date();
    return [
      { artist: 'Naldo Lima', title: 'Retrovisor', rule: 'exact' as const, source: 'download' as const, timestamp: new Date(now.getTime() - 12 * 60000).toISOString() },
      { artist: 'MC Kevin', title: 'Cavalgada', rule: 'forbidden' as const, source: 'grade' as const, timestamp: new Date(now.getTime() - 25 * 60000).toISOString() },
      { artist: 'Deive Leonardo', title: 'Amanhã Não Existe', rule: 'alias' as const, source: 'captured-download' as const, timestamp: new Date(now.getTime() - 38 * 60000).toISOString() },
      { artist: 'Thiago Jose', title: 'Balançou Balançou', rule: 'wildcard' as const, source: 'download' as const, timestamp: new Date(now.getTime() - 50 * 60000).toISOString() },
      { artist: 'Promessa D', title: 'Pedido de Socorro', rule: 'partial' as const, source: 'download' as const, timestamp: new Date(now.getTime() - 65 * 60000).toISOString() },
    ];
  }, []);

  const stats = useMemo(() => {
    const byRule = { exact: 0, wildcard: 0, forbidden: 0, alias: 0, partial: 0 };
    const bySource = { download: 0, grade: 0, mapa: 0, 'captured-download': 0 };
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
    partial: { label: 'Parcial', icon: Shield, color: 'text-rose-400' },
  };

  return (
    <Card className="glass-card border-red-500/20">
      <CardContent className="p-4 space-y-3">
        {/* Header — always visible, clickable */}
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Bloqueios Hoje</p>
              <p className="text-xs text-muted-foreground">Músicas impedidas de entrar</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold font-mono text-red-400">{stats.total}</span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${!collapsed ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Rule badges — always visible as summary */}
        {stats.total > 0 && (
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
        )}

        {/* Expanded content */}
        {!collapsed && stats.total > 0 && (
          <>
            <div className="flex gap-3 text-xs text-muted-foreground">
              {stats.bySource.download > 0 && <span>📥 Downloads: {stats.bySource.download}</span>}
              {stats.bySource['captured-download'] > 0 && <span>🎙️ Capturadas: {stats.bySource['captured-download']}</span>}
              {stats.bySource.grade > 0 && <span>📋 Grade: {stats.bySource.grade}</span>}
              {stats.bySource.mapa > 0 && <span>🗺️ Mapa: {stats.bySource.mapa}</span>}
            </div>

            <ScrollArea className="max-h-[220px]">
              <div className="space-y-1">
                {events.slice(-15).reverse().map((e, i) => {
                  const time = new Date(e.timestamp);
                  const timeStr = time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                  const isAlias = e.rule === 'alias';
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/10 border border-border/10">
                      <Ban className="w-3 h-3 text-red-400/60 shrink-0" />
                      <span className="text-muted-foreground truncate flex-1">
                        {e.artist} — {e.title}
                      </span>
                      {isAlias && (
                        <Badge variant="outline" className="text-[9px] border-purple-500/30 text-purple-400 shrink-0">
                          Alias
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {ruleLabels[e.rule]?.label}
                      </Badge>
                      <span className="text-[9px] text-muted-foreground/70 shrink-0 font-mono">
                        {timeStr}
                      </span>
                    </div>
                  );
                })}
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
