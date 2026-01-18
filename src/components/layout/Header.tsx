import { Power, RefreshCw, Clock } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import logo from '@/assets/logo.png';

export function Header() {
  const { isRunning, setIsRunning, lastUpdate } = useRadioStore();

  const handleToggle = () => {
    setIsRunning(!isRunning);
  };

  return (
    <header className="h-16 bg-card border-b border-border px-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <img src={logo} alt="AudioSolutions" className="h-10 w-10 rounded-lg" />
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="live-indicator">
              <span className="text-sm font-semibold text-destructive uppercase tracking-wider">
                AO VIVO
              </span>
            </div>
          )}
        </div>
        <div className="h-6 w-px bg-border" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span className="font-mono">
            {format(new Date(), "EEEE, dd 'de' MMMM • HH:mm", { locale: ptBR })}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {lastUpdate && (
          <span className="text-xs text-muted-foreground">
            Última atualização: {format(lastUpdate, 'HH:mm:ss')}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setIsRunning(true)}
        >
          <RefreshCw className="w-4 h-4" />
          Atualizar
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
          <Power className="w-4 h-4 mr-2" />
          {isRunning ? 'Parar' : 'Iniciar'}
        </Button>
      </div>
    </header>
  );
}
