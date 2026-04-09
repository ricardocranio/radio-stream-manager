/**
 * Sequence Freshness Alert Card
 * Monitors all stations in the active sequence with expand/collapse.
 */
import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, Radio, CheckCircle2, Clock, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { supabase } from '@/integrations/supabase/client';

const FRESHNESS_THRESHOLD_MIN = 20;
const CHECK_INTERVAL_MS = 60_000;

export function P1FreshnessAlertCard() {
  const sequence = useRadioStore((s) => s.sequence);
  const stations = useRadioStore((s) => s.stations);
  const [stationStatus, setStationStatus] = useState<Record<string, { lastSeen: Date | null; fresh: boolean }>>({});
  const [collapsed, setCollapsed] = useState(true);

  const p1Stations = useMemo(() => {
    if (!sequence.length) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const entry of sequence) {
      const src = entry.radioSource;
      if (!src || src.startsWith('program_')) continue;
      const station = stations.find(s => s.id === src || s.name === src);
      const name = station?.name ?? src;
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  }, [sequence, stations]);

  useEffect(() => {
    if (p1Stations.length === 0) return;

    const checkFreshness = async () => {
      const cutoff = new Date(Date.now() - FRESHNESS_THRESHOLD_MIN * 60 * 1000).toISOString();
      const status: Record<string, { lastSeen: Date | null; fresh: boolean }> = {};

      for (const stationName of p1Stations) {
        try {
          const { data } = await supabase
            .from('scraped_songs')
            .select('scraped_at')
            .eq('station_name', stationName)
            .order('scraped_at', { ascending: false })
            .limit(1);

          if (data && data.length > 0) {
            const lastSeen = new Date(data[0].scraped_at);
            status[stationName] = { lastSeen, fresh: lastSeen.toISOString() > cutoff };
          } else {
            status[stationName] = { lastSeen: null, fresh: false };
          }
        } catch {
          status[stationName] = { lastSeen: null, fresh: false };
        }
      }

      setStationStatus(status);
    };

    checkFreshness();
    const interval = setInterval(checkFreshness, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [p1Stations]);

  const entries = Object.entries(stationStatus);
  const hasAlert = entries.some(([, s]) => !s.fresh);
  const freshCount = entries.filter(([, s]) => s.fresh).length;
  const allFresh = entries.length > 0 && !hasAlert;

  if (p1Stations.length === 0) return null;

  return (
    <Card className={`glass-card ${hasAlert ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/20'}`}>
      <CardContent className="p-4 space-y-2">
        {/* Header — always visible, clickable */}
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasAlert ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
              {hasAlert ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Frescor da Sequência</p>
              <p className="text-xs text-muted-foreground">{freshCount}/{entries.length} estações ativas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-xs ${hasAlert ? 'border-amber-500/30 text-amber-400' : 'border-emerald-500/30 text-emerald-400'}`}>
              {hasAlert ? '⚠️ Sem dados' : '✓ Ativo'}
            </Badge>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${!collapsed ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Summary when collapsed — show first offline or first station */}
        {collapsed && entries.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {entries.slice(0, 2).map(([station, status]) => (
              <span key={station} className="flex items-center gap-1">
                <Radio className={`w-3 h-3 ${status.fresh ? 'text-emerald-400' : 'text-amber-400'}`} />
                {station}
                {status.lastSeen && <span className="text-[10px]">({Math.floor((Date.now() - status.lastSeen.getTime()) / 60000)}m)</span>}
              </span>
            ))}
            {entries.length > 2 && <span className="text-[10px]">+{entries.length - 2}</span>}
          </div>
        )}

        {/* Expanded station list */}
        {!collapsed && (
          <ScrollArea className="max-h-[200px]">
            <div className="space-y-1">
              {entries
                .sort(([, a], [, b]) => (a.fresh === b.fresh ? 0 : a.fresh ? 1 : -1))
                .map(([station, status]) => (
                  <div key={station} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Radio className={`w-3 h-3 ${status.fresh ? 'text-emerald-400' : 'text-amber-400'}`} />
                      <span className="text-foreground font-medium">{station}</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {status.lastSeen ? (
                        <span className={status.fresh ? '' : 'text-amber-400 font-medium'}>
                          {Math.floor((Date.now() - status.lastSeen.getTime()) / 60000)} min atrás
                        </span>
                      ) : (
                        <span className="text-amber-400">Sem dados</span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </ScrollArea>
        )}

        {allFresh && collapsed && (
          <p className="text-xs text-emerald-400/60 text-center">
            Capturando normalmente — dados frescos &lt;{FRESHNESS_THRESHOLD_MIN}min
          </p>
        )}
      </CardContent>
    </Card>
  );
}
