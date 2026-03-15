import { Activity, CheckCircle2, AlertTriangle, XCircle, ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getServiceStatuses } from '@/hooks/useServiceWatchdog';

const SERVICE_LABELS: Record<string, string> = {
  'scraping': '📡 Scraping',
  'downloads': '📥 Downloads',
  'grade-builder': '📝 Grade Builder',
  'captured-downloads': '💾 Capturadas DL',
  'maintenance': '🔧 Manutenção',
};

export function ServiceHealthCard() {
  const [statuses, setStatuses] = useState(getServiceStatuses());
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatuses(getServiceStatuses());
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const allAlive = Object.values(statuses).every(s => s.alive || !s.lastHeartbeat);
  const hasWarning = Object.values(statuses).some(s => s.lastHeartbeat && !s.alive);

  return (
    <Card className={`glass-card ${hasWarning ? 'border-amber-500/20' : 'border-green-500/10'}`}>
      <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className={`w-4 h-4 ${hasWarning ? 'text-amber-500' : 'text-green-500'}`} />
          Saúde dos Serviços
          <Badge variant="outline" className={`text-[9px] ${
            allAlive ? 'border-green-500/40 text-green-400' : 'border-amber-500/40 text-amber-400'
          }`}>
            {allAlive ? 'Todos OK' : 'Atenção'}
          </Badge>
          <ChevronDown className={`w-4 h-4 text-muted-foreground ml-auto transition-transform duration-300 ${!collapsed ? 'rotate-180' : ''}`} />
        </CardTitle>
      </CardHeader>
      <div className="collapsible-content" data-open={!collapsed}>
        <div>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {Object.entries(statuses).map(([name, status]) => (
                <div key={name} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30">
                  {status.alive ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  ) : status.lastHeartbeat ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-foreground">
                      {SERVICE_LABELS[name] || name}
                    </p>
                    <p className="text-[9px] text-muted-foreground">
                      {status.alive
                        ? `Ativo (${status.staleSinceMin}min atrás)`
                        : status.lastHeartbeat
                        ? `Parado há ${status.staleSinceMin}min`
                        : 'Aguardando início'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
