import { Power, RefreshCw, Clock, Sun, Moon, Layers, Zap, Server, Monitor, ExternalLink } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { useUIModeStore } from '@/store/uiModeStore';
import { useServiceModeStore } from '@/store/serviceModeStore';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { StatusIndicator } from '@/components/StatusIndicator';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

export function Header() {
  const { isRunning, setIsRunning, lastUpdate } = useRadioStore();
  const { mode, toggleMode } = useUIModeStore();
  const { serviceMode, toggleServiceMode, isServerRunning, setServerRunning } = useServiceModeStore();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [localhostUrl, setLocalhostUrl] = useState('http://localhost:8080');

  // Avoid hydration mismatch and setup Electron listeners
  useEffect(() => {
    setMounted(true);
    
    // Listen for server status updates from Electron
    if (isElectron && window.electronAPI?.onServerStatus) {
      window.electronAPI.onServerStatus((status) => {
        setServerRunning(status.running);
        setLocalhostUrl(status.url);
      });
    }
    
    // Listen for service mode changes from Electron (e.g., from tray)
    if (isElectron && window.electronAPI?.onServiceModeChanged) {
      window.electronAPI.onServiceModeChanged((mode) => {
        // Sync store with Electron's mode
        const store = useServiceModeStore.getState();
        if (store.serviceMode !== mode) {
          store.setServiceMode(mode);
        }
      });
    }
  }, [setServerRunning]);

  const handleToggle = () => {
    setIsRunning(!isRunning);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleServiceModeToggle = () => {
    if (isElectron) {
      toggleServiceMode();
    }
  };

  const handleOpenInBrowser = async () => {
    if (isElectron && window.electronAPI?.openInBrowser) {
      await window.electronAPI.openInBrowser();
    }
  };

  return (
    <header className="h-16 bg-card border-b border-border px-4 md:px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 md:gap-4">
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="live-indicator">
              <span className="text-xs md:text-sm font-semibold text-destructive uppercase tracking-wider">
                AO VIVO
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
        {/* Service Mode Toggle (Electron only) */}
        {mounted && isElectron && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleServiceModeToggle}
                  className={cn(
                    "gap-2 transition-all",
                    serviceMode === 'service' 
                      ? "bg-blue-500/10 border-blue-500/30 text-blue-500 hover:bg-blue-500/20" 
                      : "hover:bg-primary/10"
                  )}
                >
                  {serviceMode === 'service' ? (
                    <>
                      <Server className="w-4 h-4" />
                      <span className="hidden md:inline">Serviço</span>
                    </>
                  ) : (
                    <>
                      <Monitor className="w-4 h-4" />
                      <span className="hidden md:inline">Janela</span>
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {serviceMode === 'service' 
                  ? 'Modo Serviço: App na bandeja, acesso via localhost:8080'
                  : 'Clique para ativar Modo Serviço (menor consumo de RAM)'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Open in Browser Button (when in service mode) */}
        {mounted && isElectron && serviceMode === 'service' && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleOpenInBrowser}
                  className="h-9 w-9"
                >
                  <ExternalLink className="w-4 h-4 text-blue-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Abrir no navegador ({localhostUrl})
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* UI Mode Toggle */}
        {mounted && (
          <Button
            variant="outline"
            size="sm"
            onClick={toggleMode}
            className={cn(
              "gap-2 transition-all",
              mode === 'simplified' 
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20" 
                : "hover:bg-primary/10"
            )}
            title={mode === 'simplified' ? 'Modo Simplificado (leve)' : 'Modo Completo'}
          >
            {mode === 'simplified' ? (
              <>
                <Zap className="w-4 h-4" />
                <span className="hidden md:inline">Leve</span>
              </>
            ) : (
              <>
                <Layers className="w-4 h-4" />
                <span className="hidden md:inline">Completo</span>
              </>
            )}
          </Button>
        )}

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