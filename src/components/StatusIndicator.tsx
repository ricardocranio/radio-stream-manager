import { useState } from 'react';
import { Wifi, WifiOff, Database, Radio, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function StatusIndicator() {
  const { status, runHealthCheck, isHealthy } = useHealthCheck();
  const [isChecking, setIsChecking] = useState(false);

  const handleRefresh = async () => {
    setIsChecking(true);
    await runHealthCheck();
    setIsChecking(false);
  };

  const getStatusColor = (s: 'ok' | 'degraded' | 'offline' | 'online' | 'unavailable') => {
    switch (s) {
      case 'ok':
      case 'online':
        return 'text-green-500';
      case 'degraded':
        return 'text-yellow-500';
      case 'offline':
        return 'text-red-500';
      case 'unavailable':
        return 'text-muted-foreground';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusIcon = (s: 'ok' | 'degraded' | 'offline' | 'online' | 'unavailable') => {
    switch (s) {
      case 'ok':
      case 'online':
        return <CheckCircle2 className="w-3 h-3" />;
      case 'degraded':
        return <AlertTriangle className="w-3 h-3" />;
      case 'offline':
        return <WifiOff className="w-3 h-3" />;
      default:
        return <AlertTriangle className="w-3 h-3" />;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-7 px-2 gap-1.5"
        >
          <div className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
          {status.network === 'online' ? (
            <Wifi className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-red-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Status do Sistema</h4>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={handleRefresh}
              disabled={isChecking}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <div className="space-y-2">
            {/* Network */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-muted-foreground" />
                <span>Rede</span>
              </div>
              <Badge variant="outline" className={`text-xs ${getStatusColor(status.network)}`}>
                {getStatusIcon(status.network)}
                <span className="ml-1">{status.network === 'online' ? 'Online' : 'Offline'}</span>
              </Badge>
            </div>

            {/* Supabase */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-muted-foreground" />
                <span>Banco de Dados</span>
              </div>
              <Badge variant="outline" className={`text-xs ${getStatusColor(status.supabase)}`}>
                {getStatusIcon(status.supabase)}
                <span className="ml-1 capitalize">{status.supabase === 'ok' ? 'OK' : status.supabase}</span>
              </Badge>
            </div>

            {/* Realtime */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-muted-foreground" />
                <span>Tempo Real</span>
              </div>
              <Badge variant="outline" className={`text-xs ${getStatusColor(status.realtime)}`}>
                {getStatusIcon(status.realtime)}
                <span className="ml-1 capitalize">{status.realtime === 'ok' ? 'OK' : status.realtime}</span>
              </Badge>
            </div>
          </div>

          {/* Issues */}
          {status.issues.length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1">Problemas detectados:</p>
              <div className="space-y-1">
                {status.issues.map((issue, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-yellow-500">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last check */}
          {status.lastCheck && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Última verificação: {format(status.lastCheck, 'HH:mm:ss', { locale: ptBR })}
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
