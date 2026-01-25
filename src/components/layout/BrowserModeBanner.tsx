import { Globe, Monitor, Download, Save, FolderOpen, CheckCircle2, Info, Server, Loader2, ExternalLink } from 'lucide-react';
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
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { isElectron, checkElectronBackend, isServiceMode } from '@/lib/serviceMode';

// Use centralized service mode check with proper timeout and JSON validation
async function checkServiceModeStatus(): Promise<boolean> {
  // If in native Electron, no need to check
  if (isElectron) return false;
  
  // If on localhost, check if backend is available
  if (isServiceMode()) {
    return await checkElectronBackend();
  }
  
  return false;
}

interface FeatureStatus {
  name: string;
  available: boolean | 'service'; // 'service' means available when service mode detected
  description: string;
  icon: React.ReactNode;
}

const getFeatures = (serviceMode: boolean): FeatureStatus[] => [
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
    available: serviceMode, // Available in service mode!
    description: serviceMode 
      ? '✓ Conectado ao Electron em background' 
      : 'Requer Electron rodando em modo serviço',
    icon: <Download className="w-3.5 h-3.5" />,
  },
  {
    name: 'Salvar Arquivos',
    available: serviceMode,
    description: serviceMode 
      ? '✓ Salva via Electron em background' 
      : 'Salvar grades/configs diretamente em pastas locais',
    icon: <Save className="w-3.5 h-3.5" />,
  },
  {
    name: 'Selecionar Pastas',
    available: false, // Always requires desktop UI
    description: 'Escolher pastas do sistema via diálogo nativo',
    icon: <FolderOpen className="w-3.5 h-3.5" />,
  },
];

export function BrowserModeBanner() {
  const [isOpen, setIsOpen] = useState(false);
  const [serviceMode, setServiceMode] = useState<boolean | null>(null);

  // Check for service mode on mount
  useEffect(() => {
    checkServiceModeStatus().then(setServiceMode);
  }, []);

  // Don't show in Electron
  if (isElectron) {
    return null;
  }

  const features = getFeatures(serviceMode === true);
  const availableCount = features.filter(f => f.available === true).length;
  const desktopOnlyCount = features.filter(f => f.available === false).length;

  return (
    <Alert className={cn(
      "mb-4",
      serviceMode 
        ? "border-emerald-500/30 bg-emerald-500/5" 
        : "border-blue-500/30 bg-blue-500/5"
    )}>
      {serviceMode ? (
        <Server className="h-4 w-4 text-emerald-500" />
      ) : (
        <Globe className="h-4 w-4 text-blue-500" />
      )}
      <AlertDescription className="ml-2">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              {serviceMode === null ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground text-sm">Verificando conexão...</span>
                </>
              ) : serviceMode ? (
                <>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">🟢 Modo Serviço</span>
                  <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px]">
                    Electron conectado
                  </Badge>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="bg-primary/10 border-primary/30 text-primary text-[10px] cursor-help">
                          Downloads ativos ✓
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[250px]">
                        <p className="text-xs">O Electron está rodando em background e downloads automáticos funcionam normalmente!</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              ) : (
                <>
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
                        <p className="text-xs">Inicie o app desktop em Modo Serviço para habilitar downloads</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Button to open desktop version */}
              {!serviceMode && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-7 px-2 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => {
                          // Try to trigger desktop app or show instructions
                          const desktopUrl = 'pgmr://open';
                          window.open(desktopUrl, '_blank');
                        }}
                      >
                        <Monitor className="w-3.5 h-3.5" />
                        Abrir Desktop
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[280px]">
                      <p className="text-xs">Abre a versão desktop do aplicativo com todas as funcionalidades</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                  <Info className="w-3.5 h-3.5" />
                  {isOpen ? 'Ocultar' : 'Ver detalhes'}
                </Button>
              </CollapsibleTrigger>
            </div>
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
              {serviceMode ? (
                <>✅ <strong>Modo Serviço Ativo:</strong> Downloads automáticos estão funcionando normalmente via Electron em background.</>
              ) : (
                <>💡 <strong>Dica:</strong> Inicie o app desktop em "Modo Serviço" para habilitar downloads enquanto usa o navegador.</>
              )}
            </p>
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  );
}

// Small inline indicator for desktop-only features
export function DesktopOnlyBadge({ className }: { className?: string }) {
  const [serviceMode, setServiceMode] = useState<boolean>(false);
  
  useEffect(() => {
    if (!isElectron) {
      checkServiceModeStatus().then(setServiceMode);
    }
  }, []);
  
  // Don't show if in Electron OR in service mode (backend available)
  if (isElectron || serviceMode) return null;
  
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
          <p className="text-xs">Inicie o Electron em Modo Serviço para habilitar</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
