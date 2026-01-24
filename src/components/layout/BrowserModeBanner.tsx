import { Globe, Monitor, Download, Save, FolderOpen, CheckCircle2, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { cn } from '@/lib/utils';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

interface FeatureStatus {
  name: string;
  available: boolean;
  description: string;
  icon: React.ReactNode;
}

const features: FeatureStatus[] = [
  {
    name: 'Dashboard & Monitoramento',
    available: true,
    description: 'Visualização de estatísticas, ranking e músicas capturadas',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  {
    name: 'Gerenciar Estações',
    available: true,
    description: 'Adicionar, editar e ativar/desativar estações de rádio',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  {
    name: 'Visualizar Grades',
    available: true,
    description: 'Ver grade gerada e prévia de programação',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  {
    name: 'Configurações',
    available: true,
    description: 'Ajustar intervalos, filtros e preferências',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  {
    name: 'Downloads Automáticos',
    available: false,
    description: 'Requer Deemix instalado no desktop',
    icon: <Download className="w-3.5 h-3.5" />,
  },
  {
    name: 'Salvar Arquivos',
    available: false,
    description: 'Salvar grades/configs diretamente em pastas locais',
    icon: <Save className="w-3.5 h-3.5" />,
  },
  {
    name: 'Selecionar Pastas',
    available: false,
    description: 'Escolher pastas do sistema via diálogo nativo',
    icon: <FolderOpen className="w-3.5 h-3.5" />,
  },
];

export function BrowserModeBanner() {
  const [isOpen, setIsOpen] = useState(false);

  // Don't show in Electron
  if (isElectron) {
    return null;
  }

  const availableCount = features.filter(f => f.available).length;
  const desktopOnlyCount = features.filter(f => !f.available).length;

  return (
    <Alert className="border-blue-500/30 bg-blue-500/5 mb-4">
      <Globe className="h-4 w-4 text-blue-500" />
      <AlertDescription className="ml-2">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-blue-600 dark:text-blue-400">Modo Navegador</span>
              <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px]">
                {availableCount} funções disponíveis
              </Badge>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 text-[10px] cursor-help">
                      {desktopOnlyCount} apenas desktop
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[250px]">
                    <p className="text-xs">Downloads e salvamento de arquivos requerem o app desktop com Deemix instalado</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                <Info className="w-3.5 h-3.5" />
                {isOpen ? 'Ocultar' : 'Ver detalhes'}
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="mt-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {features.map((feature) => (
                <div
                  key={feature.name}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-md text-sm",
                    feature.available 
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" 
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  )}
                >
                  <span className={cn(
                    "mt-0.5",
                    feature.available ? "text-emerald-500" : "text-amber-500"
                  )}>
                    {feature.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-xs">{feature.name}</div>
                    <div className="text-[10px] opacity-80">{feature.description}</div>
                  </div>
                  {!feature.available && (
                    <Monitor className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground pt-2 border-t border-border/50">
              💡 <strong>Dica:</strong> O modo navegador é ideal para monitoramento leve. Para downloads automáticos, use o app desktop.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  );
}

// Small inline indicator for desktop-only features
export function DesktopOnlyBadge({ className }: { className?: string }) {
  if (isElectron) return null;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={cn(
              "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 text-[9px] px-1.5 py-0 cursor-help",
              className
            )}
          >
            <Monitor className="w-2.5 h-2.5 mr-0.5" />
            Desktop
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Esta função requer o aplicativo desktop</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
