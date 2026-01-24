import { Power, RefreshCw, Clock, Sun, Moon, Layers, Zap, Server, Monitor, ExternalLink, Wifi, WifiOff, AlertCircle, X, LogOut } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

export function Header() {
  const { isRunning, setIsRunning, lastUpdate } = useRadioStore();
  const { mode, toggleMode } = useUIModeStore();
  const { serviceMode, toggleServiceMode, isServerRunning, setServerRunning, localhostPort, setLocalhostPort } = useServiceModeStore();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [serverUrl, setServerUrl] = useState(`http://localhost:${localhostPort}`);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isOpeningBrowser, setIsOpeningBrowser] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  // Avoid hydration mismatch and setup Electron listeners
  useEffect(() => {
    setMounted(true);
    
    // Listen for server status updates from Electron
    if (isElectron && window.electronAPI?.onServerStatus) {
      window.electronAPI.onServerStatus((status: any) => {
        setServerRunning(status.running);
        if (status.running) {
          setServerUrl(status.url);
          setServerError(null);
          // Update port in store if it changed (fallback port)
          if (status.port && status.port !== localhostPort) {
            setLocalhostPort(status.port);
          }
        } else if (status.error) {
          setServerError(status.details || 'Erro desconhecido');
        }
      });
    }
    
    // Listen for service mode changes from Electron (e.g., from tray)
    if (isElectron && window.electronAPI?.onServiceModeChanged) {
      window.electronAPI.onServiceModeChanged((mode: 'window' | 'service') => {
        // Sync store with Electron's mode
        const store = useServiceModeStore.getState();
        if (store.serviceMode !== mode) {
          store.setServiceMode(mode);
        }
      });
    }
  }, [setServerRunning, setLocalhostPort, localhostPort]);

  // Update server URL when port changes
  useEffect(() => {
    setServerUrl(`http://localhost:${localhostPort}`);
  }, [localhostPort]);

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
      setIsOpeningBrowser(true);
      try {
        const result: { success: boolean; port?: number; url?: string; error?: string; message?: string } = 
          await window.electronAPI.openInBrowser();
        
        if (!result.success) {
          toast({
            title: '❌ Erro ao abrir navegador',
            description: result.message || 'Não foi possível iniciar o servidor local',
            variant: 'destructive',
          });
          setServerError(result.message || null);
        } else {
          // Update port if it changed (fallback)
          if (result.port && result.port !== localhostPort) {
            setLocalhostPort(result.port);
          }
          setServerError(null);
        }
      } catch (error: unknown) {
        console.error('Error opening browser:', error);
        toast({
          title: '❌ Erro',
          description: 'Falha ao comunicar com o servidor local',
          variant: 'destructive',
        });
      } finally {
        setIsOpeningBrowser(false);
      }
    }
  };

  // Handle app close with confirmation
  const handleCloseApp = () => {
    if (isElectron && window.electronAPI?.quitApp) {
      window.electronAPI.quitApp();
    }
  };

  // Handle minimize to tray (service mode)
  const handleMinimizeToTray = () => {
    if (isElectron && window.electronAPI?.minimizeToTray) {
      window.electronAPI.minimizeToTray();
      setShowCloseDialog(false);
      toast({
        title: '📥 Modo Serviço Ativado',
        description: 'O app está rodando na bandeja do sistema. Acesse via localhost.',
      });
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
        
        {/* Server Status Indicator (when in service mode or server is running) */}
        {mounted && isElectron && isServerRunning && !serverError && (
          <div className="hidden md:flex items-center gap-1.5 ml-2">
            <Badge 
              variant="outline" 
              className="bg-blue-500/10 border-blue-500/30 text-blue-500 gap-1.5 text-[10px] px-2 py-0.5"
            >
              <Wifi className="w-3 h-3" />
              localhost:{localhostPort}
            </Badge>
          </div>
        )}
        
        {/* Server Error Indicator */}
        {mounted && isElectron && serverError && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline" 
                  className="bg-destructive/10 border-destructive/30 text-destructive gap-1.5 text-[10px] px-2 py-0.5 cursor-help"
                >
                  <AlertCircle className="w-3 h-3" />
                  Erro Servidor
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-[300px]">
                <p className="text-sm">{serverError}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
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
                      {isServerRunning && (
                        <span className="hidden lg:inline text-[10px] opacity-70">:{localhostPort}</span>
                      )}
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
                  ? `Modo Serviço: App na bandeja, acesso via localhost:${localhostPort}`
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
                  disabled={isOpeningBrowser}
                  className={cn(
                    "h-9 w-9 transition-all",
                    isOpeningBrowser && "animate-pulse"
                  )}
                >
                  {isOpeningBrowser ? (
                    <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
                  ) : (
                    <ExternalLink className="w-4 h-4 text-blue-500" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isOpeningBrowser 
                  ? 'Iniciando servidor...' 
                  : `Abrir no navegador (${serverUrl})`}
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

        {/* Close App Button (Electron only) */}
        {mounted && isElectron && (
          <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="Fechar aplicativo"
              >
                <X className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <Power className="w-5 h-5 text-primary" />
                  Deseja sair do aplicativo?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-left space-y-3">
                  <p>Escolha como deseja continuar:</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2 p-2 rounded-md bg-blue-500/10 border border-blue-500/20">
                      <Server className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium text-blue-600 dark:text-blue-400">Modo Serviço:</span>
                        <span className="text-muted-foreground ml-1">
                          Minimiza na bandeja. Downloads e monitoramento continuam funcionando.
                        </span>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
                      <LogOut className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium text-destructive">Fechar:</span>
                        <span className="text-muted-foreground ml-1">
                          Encerra completamente o aplicativo.
                        </span>
                      </div>
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                <AlertDialogCancel className="sm:flex-1">Cancelar</AlertDialogCancel>
                <Button 
                  variant="outline" 
                  className="sm:flex-1 gap-2 border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
                  onClick={handleMinimizeToTray}
                >
                  <Server className="w-4 h-4" />
                  Modo Serviço
                </Button>
                <AlertDialogAction 
                  className="sm:flex-1 gap-2 bg-destructive hover:bg-destructive/90"
                  onClick={handleCloseApp}
                >
                  <LogOut className="w-4 h-4" />
                  Fechar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </header>
  );
}