import { Power, RefreshCw, Clock, Sun, Moon, Download } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useCapturedDownloadStore } from '@/store/capturedDownloadStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { StatusIndicator } from '@/components/StatusIndicator';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function Header() {
  const { isRunning, setIsRunning, lastUpdate } = useRadioStore();
  const autoDownloadQueue = useAutoDownloadStore((s) => s.queueLength);
  const capturedDlProcessing = useCapturedDownloadStore((s) => s.isProcessing);
  const capturedDlQueue = useCapturedDownloadStore((s) => s.queueLength);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleToggle = () => {
    setIsRunning(!isRunning);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <header className="h-16 bg-card border-b border-border px-4 md:px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 md:gap-4">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <div className="live-indicator">
              <span className="text-xs md:text-sm font-semibold text-destructive uppercase tracking-wider">
                AO VIVO
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded-md">
            <div className="w-2 h-2 rounded-full bg-warning animate-pulse" />
              <span className="text-xs md:text-sm font-semibold text-warning uppercase tracking-wider">
                PAUSADO
              </span>
            </div>
          )}
        </div>
        <div className="h-6 w-px bg-border hidden sm:block" />
        <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span className="font-mono">
            {format(new Date(), "EEEE, dd 'de' MMMM • HH:mm", { locale: ptBR })}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {/* Theme Toggle */}
        {mounted && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-9 w-9"
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-yellow-500" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700" />
            )}
          </Button>
        )}

        {/* Download Activity Badge */}
        {(autoDownloadQueue > 0 || capturedDlProcessing) && (
          <Badge variant="secondary" className="gap-1.5 animate-pulse text-xs">
            <Download className="w-3 h-3" />
            {autoDownloadQueue + capturedDlQueue > 0
              ? `${autoDownloadQueue + capturedDlQueue} na fila`
              : 'Baixando...'}
          </Badge>
        )}

        {/* Status Indicator */}
        <StatusIndicator />
        
        {lastUpdate && (
          <span className="hidden md:inline text-xs text-muted-foreground">
            Última: {format(lastUpdate, 'HH:mm:ss')}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="gap-2 hidden sm:flex"
          onClick={() => setIsRunning(true)}
        >
          <RefreshCw className="w-4 h-4" />
          <span className="hidden md:inline">Atualizar</span>
        </Button>
        <Button
          onClick={handleToggle}
          size="sm"
          className={
            isRunning
              ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
              : 'bg-success hover:bg-success/90 text-success-foreground'
          }
        >
          <Power className="w-4 h-4 md:mr-2" />
          <span className="hidden md:inline">{isRunning ? 'Parar' : 'Iniciar'}</span>
        </Button>
      </div>
    </header>
  );
}