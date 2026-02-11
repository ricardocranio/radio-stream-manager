import { Power, RefreshCw, Clock, Sun, Moon, Download } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { useCapturedDownloadStore } from '@/store/capturedDownloadStore';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { StatusIndicator } from '@/components/StatusIndicator';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function Header() {
  const { isRunning, setIsRunning, lastUpdate } = useRadioStore();
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

        {/* Captured Download Progress */}
        <CapturedDownloadBadge />

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

/** Small badge showing captured download progress — purely visual, no logic changes */
function CapturedDownloadBadge() {
  const { isProcessing, current, total } = useCapturedDownloadStore();

  if (!isProcessing || total === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 rounded-md animate-pulse" title="Downloads de músicas capturadas em andamento">
      <Download className="w-3.5 h-3.5 text-primary" />
      <span className="text-xs font-semibold text-primary tabular-nums">
        {current}/{total}
      </span>
    </div>
  );
}