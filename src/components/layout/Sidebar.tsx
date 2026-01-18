import { Radio, Settings, ListMusic, Activity, Clock, FolderOpen, AlertTriangle, TrendingUp, Terminal, Download, FileCode, Newspaper, Layers, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import logo from '@/assets/logo.png';

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeType?: 'static' | 'dynamic';
}

const staticNavItems: Omit<NavItem, 'badge' | 'badgeType'>[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'stations', label: 'Emissoras', icon: Radio },
  { id: 'sequence', label: 'Sequência', icon: ListMusic },
  { id: 'schedule', label: 'Programação', icon: Clock },
  { id: 'gradebuilder', label: 'Montagem %dd%', icon: FileCode },
  { id: 'blockeditor', label: 'Editor de Blocos', icon: Layers },
  { id: 'fixedcontent', label: 'Conteúdos Fixos', icon: Newspaper },
  { id: 'ranking', label: 'Ranking TOP50', icon: TrendingUp },
  { id: 'vozbrasil', label: 'Voz do Brasil', icon: Mic },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'export', label: 'Exportar Config', icon: Download },
  { id: 'folders', label: 'Pastas', icon: FolderOpen },
  { id: 'missing', label: 'Faltando', icon: AlertTriangle },
  { id: 'settings', label: 'Configurações', icon: Settings },
];

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { queueLength, isProcessing } = useAutoDownloadStore();
  
  // Build nav items with dynamic badges
  const navItems: NavItem[] = staticNavItems.map(item => {
    if (item.id === 'missing' && queueLength > 0) {
      return {
        ...item,
        badge: queueLength,
        badgeType: 'dynamic' as const,
      };
    }
    return item;
  });

  return (
    <aside className="w-64 min-h-screen bg-card border-r border-border flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <img src={logo} alt="AudioSolutions" className="w-10 h-10 rounded-lg" />
          <div>
            <h1 className="font-bold text-lg text-foreground">Programador</h1>
            <p className="text-xs text-primary font-medium">RÁDIO</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                'w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )}
            >
              <div className="flex items-center gap-3">
                <Icon className={cn('w-5 h-5', isActive && 'text-primary')} />
                {item.label}
              </div>
              {item.badge !== undefined && (
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded min-w-[20px] text-center",
                  item.badgeType === 'dynamic' 
                    ? "bg-destructive text-destructive-foreground animate-pulse"
                    : "bg-accent text-accent-foreground"
                )}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Status Footer */}
      <div className="p-4 border-t border-border space-y-2">
        {/* Auto-download status */}
        {(queueLength > 0 || isProcessing) && (
          <div className="glass-card p-3 bg-primary/5 border border-primary/20">
            <div className="flex items-center gap-2 mb-1">
              <Download className={cn("w-4 h-4 text-primary", isProcessing && "animate-bounce")} />
              <span className="text-xs font-medium text-primary">
                {isProcessing ? 'Baixando...' : 'Na fila'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {queueLength} música{queueLength !== 1 ? 's' : ''} pendente{queueLength !== 1 ? 's' : ''}
            </p>
          </div>
        )}
        
        {/* System status */}
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs font-medium text-success">Sistema Ativo</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Versão 5.1 • PGM-FM
          </p>
        </div>
      </div>
    </aside>
  );
}
