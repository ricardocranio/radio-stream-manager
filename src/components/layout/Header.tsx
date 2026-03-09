import { Power, RefreshCw, Clock, Sun, Moon, Download, AlertTriangle, Wifi } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useCapturedDownloadStore } from '@/store/capturedDownloadStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { StatusIndicator } from '@/components/StatusIndicator';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function Header() {
  const { isRunning, setIsRunning, lastUpdate } = useRadioStore();
  const autoDownloadQueue = useAutoDownloadStore((s) => s.queueLength);
  const activeDownload = useAutoDownloadStore((s) => s.activeDownload);
  const arlValid = useAutoDownloadStore((s) => s.arlValid);
  const capturedDlProcessing = useCapturedDownloadStore((s) => s.isProcessing);
  const capturedDlQueue = useCapturedDownloadStore((s) => s.queueLength);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    if (!activeDownload) { setElapsed(0); return; }
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - activeDownload.startedAt) / 1000));
    }, 5000); // Update every 5s instead of 1s
    return () => clearInterval(timer);
  }, [activeDownload]);

  useEffect(() => {
    setMounted(true);
    // Update clock every 30 seconds — HH:mm:ss precision is not critical
    const timer = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="h-14 border-b border-border px-4 md:px-6 flex items-center justify-between"
      style={{
        background: 'linear-gradient(180deg, hsl(225 22% 10%) 0%, hsl(225 25% 7%) 100%)',
      }}
    >
      {/* Left side */}
      <div className="flex items-center gap-3">
        {/* Live/Paused indicator */}
        {isRunning ? (
          <div className="flex items-center gap-2 px-3 py-1 rounded-md border border-destructive/30"
            style={{ background: 'hsl(0 80% 55% / 0.08)' }}
          >
            <div className="w-2 h-2 rounded-full bg-destructive"
              style={{ boxShadow: '0 0 8px hsl(0 80% 55% / 0.6)' }}
            />
            <span className="text-[11px] font-bold tracking-[0.15em] text-destructive uppercase">
              AO VIVO
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1 rounded-md border border-warning/30"
            style={{ background: 'hsl(42 100% 50% / 0.06)' }}
          >
            <div className="w-2 h-2 rounded-full bg-warning animate-pulse" />
            <span className="text-[11px] font-bold tracking-[0.15em] text-warning uppercase">
              PAUSADO
            </span>
          </div>
        )}

        <div className="h-5 w-px bg-border hidden sm:block" />

        {/* Clock */}
        <div className="hidden sm:flex items-center gap-2">
          <span className="font-mono text-xs text-primary/80 tabular-nums" style={{ letterSpacing: '0.05em' }}>
            {format(currentTime, 'HH:mm')}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {format(currentTime, "EEEE, dd MMM", { locale: ptBR })}
          </span>
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Theme Toggle */}
        {mounted && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </Button>
        )}

        {/* ARL Warning */}
        {!arlValid && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-destructive/30 bg-destructive/10">
            <AlertTriangle className="w-3 h-3 text-destructive" />
            <span className="text-[10px] font-semibold text-destructive">ARL</span>
          </div>
        )}

        {/* Download Activity */}
        {(autoDownloadQueue > 0 || capturedDlProcessing || activeDownload) && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-primary/20 bg-primary/5 max-w-48">
                  <Download className="w-3 h-3 text-primary shrink-0 animate-pulse" />
                  <span className="text-[10px] font-medium text-primary truncate">
                    {activeDownload
                      ? `${activeDownload.artist} - ${activeDownload.title} (${elapsed}s)`
                      : `${autoDownloadQueue + capturedDlQueue} na fila`}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {activeDownload && (
                  <p className="text-xs">
                    Baixando: {activeDownload.artist} - {activeDownload.title}<br/>
                    Tempo: {elapsed}s | Fila: {autoDownloadQueue}
                  </p>
                )}
                {!activeDownload && <p className="text-xs">{autoDownloadQueue + capturedDlQueue} músicas na fila</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <StatusIndicator />

        {lastUpdate && (
          <span className="hidden md:inline text-[10px] text-muted-foreground/60 font-mono">
            {format(lastUpdate, 'HH:mm:ss')}
          </span>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-primary"
          onClick={() => setIsRunning(true)}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>

        <Button
          onClick={() => setIsRunning(!isRunning)}
          size="sm"
          className={
            isRunning
              ? 'h-8 px-3 text-xs bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/25'
              : 'h-8 px-3 text-xs bg-success/15 text-success border border-success/30 hover:bg-success/25'
          }
        >
          <Power className="w-3.5 h-3.5 mr-1.5" />
          {isRunning ? 'Parar' : 'Iniciar'}
        </Button>
      </div>
    </header>
  );
}
