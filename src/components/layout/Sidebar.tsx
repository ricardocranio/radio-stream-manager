import { Radio, Settings, ListMusic, Activity, Clock, FolderOpen, AlertTriangle, TrendingUp, Terminal, Download, FileCode, Newspaper, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'stations', label: 'Emissoras', icon: Radio },
  { id: 'sequence', label: 'Sequência', icon: ListMusic },
  { id: 'schedule', label: 'Programação', icon: Clock },
  { id: 'gradebuilder', label: 'Montagem %dd%', icon: FileCode },
  { id: 'blockeditor', label: 'Editor de Blocos', icon: Layers, badge: 'NOVO' },
  { id: 'fixedcontent', label: 'Conteúdos Fixos', icon: Newspaper },
  { id: 'ranking', label: 'Ranking TOP50', icon: TrendingUp },
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
  return (
    <aside className="w-64 min-h-screen bg-card border-r border-border flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Radio className="w-5 h-5 text-primary-foreground" />
          </div>
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
              {item.badge && (
                <span className="text-[10px] font-bold bg-accent text-accent-foreground px-1.5 py-0.5 rounded">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Status Footer */}
      <div className="p-4 border-t border-border">
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
