import { Radio, Settings, ListMusic, Activity, Clock, FolderOpen, AlertTriangle, TrendingUp, Terminal, Download, FileCode, Newspaper, Layers, Mic, Music, Database, Calendar, BarChart3, ChevronDown, PanelLeftClose, PanelLeftOpen, Swords } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useRadioStore } from '@/store/radioStore';
import logo from '@/assets/logo.png';
import { useState } from 'react';

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeType?: 'static' | 'dynamic';
  group: string;
}

const NAV_GROUPS = [
  { id: 'monitor', label: 'MONITORAMENTO', icon: Radio },
  { id: 'grade', label: 'GRADE', icon: FileCode },
  { id: 'library', label: 'BIBLIOTECA', icon: Music },
  { id: 'system', label: 'SISTEMA', icon: Settings },
];

const staticNavItems: Omit<NavItem, 'badge' | 'badgeType'>[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity, group: 'top' },
  { id: 'stations', label: 'Emissoras', icon: Radio, group: 'monitor' },
  { id: 'specialmonitoring', label: 'Monit. Especial', icon: Calendar, group: 'monitor' },
  { id: 'captured', label: 'Capturadas', icon: Database, group: 'monitor' },
  { id: 'trends', label: 'Tendências', icon: BarChart3, group: 'monitor' },
  { id: 'analytics', label: 'Analytics', icon: Activity, group: 'monitor' },
  { id: 'competitor', label: 'Competidor', icon: Swords, group: 'monitor' },
  { id: 'sequence', label: 'Sequência', icon: ListMusic, group: 'grade' },
  { id: 'schedule', label: 'Programação', icon: Clock, group: 'grade' },
  { id: 'gradebuilder', label: 'Montagem', icon: FileCode, group: 'grade' },
  { id: 'blockeditor', label: 'Editor Blocos', icon: Layers, group: 'grade' },
  { id: 'fixedcontent', label: 'Conteúdos Fixos', icon: Newspaper, group: 'grade' },
  { id: 'ranking', label: 'Ranking TOP25', icon: TrendingUp, group: 'library' },
  { id: 'vozbrasil', label: 'Voz do Brasil', icon: Mic, group: 'library' },
  { id: 'missing', label: 'Faltando', icon: AlertTriangle, group: 'library' },
  { id: 'folders', label: 'Pastas', icon: FolderOpen, group: 'library' },
  { id: 'logs', label: 'Logs', icon: Terminal, group: 'system' },
  { id: 'export', label: 'Exportar', icon: Download, group: 'system' },
  { id: 'settings', label: 'Configurações', icon: Settings, group: 'system' },
];

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onTabHover?: (tab: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ activeTab, onTabChange, onTabHover, collapsed = false, onToggleCollapse }: SidebarProps) {
  const { queueLength, isProcessing } = useAutoDownloadStore();
  const missingSongs = useRadioStore((state) => state.missingSongs);
  const missingSongsCount = missingSongs.filter(s => s.status === 'missing').length;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const navItems: NavItem[] = staticNavItems.map(item => {
    if (item.id === 'missing') {
      const badgeCount = queueLength > 0 ? queueLength : missingSongsCount;
      if (badgeCount > 0) {
        return { ...item, badge: badgeCount, badgeType: 'dynamic' as const };
      }
    }
    return item as NavItem;
  });

  const dashboardItem = navItems.find(i => i.id === 'dashboard')!;
  const groupedItems = NAV_GROUPS.map(g => ({
    ...g,
    items: navItems.filter(i => i.group === g.id),
  }));

  const renderNavButton = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <button
        key={item.id}
        onClick={() => onTabChange(item.id)}
        onMouseEnter={() => onTabHover?.(item.id)}
        title={collapsed ? item.label : undefined}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all duration-200',
          collapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2',
          isActive
            ? 'nav-item-active text-primary border border-primary/15'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60 border border-transparent'
        )}
      >
        <div className={cn("flex items-center", collapsed ? 'gap-0' : 'gap-2.5')}>
          <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-primary drop-shadow-[0_0_6px_hsl(185_100%_48%/0.5)]' : '')} />
          {!collapsed && <span>{item.label}</span>}
        </div>
        {!collapsed && item.badge !== undefined && (
          <span className={cn(
            "text-[10px] font-bold px-1.5 py-0.5 rounded-md min-w-[20px] text-center",
            item.badgeType === 'dynamic'
              ? "bg-destructive/20 text-destructive border border-destructive/30"
              : "bg-accent/20 text-accent border border-accent/30"
          )}>
            {item.badge}
          </span>
        )}
        {collapsed && item.badge !== undefined && (
          <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-destructive" />
        )}
      </button>
    );
  };

  return (
    <aside
      className={cn(
        "min-h-screen flex flex-col border-r border-border transition-all duration-300 ease-in-out relative",
        collapsed ? 'w-[60px]' : 'w-[240px]'
      )}
      style={{
        background: 'linear-gradient(180deg, hsl(225 25% 8%) 0%, hsl(225 25% 6%) 100%)',
      }}
    >
      {/* Logo */}
      <div className={cn("pb-4", collapsed ? 'p-2 pt-4' : 'p-5')}>
        <div className={cn("flex items-center", collapsed ? 'justify-center' : 'gap-3')}>
          <div className="relative">
            <img src={logo} alt="AudioSolutions" className={cn("rounded-lg", collapsed ? 'w-8 h-8' : 'w-9 h-9')} />
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success border-2 border-background"
              style={{ boxShadow: '0 0 6px hsl(155 85% 42% / 0.5)' }}
            />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-base tracking-tight bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent animate-pulse leading-tight">PROGRAMADOR</h1>
              <p className="text-[10px] tracking-[0.2em] font-semibold bg-gradient-to-r from-muted-foreground via-primary to-muted-foreground bg-clip-text text-transparent animate-pulse">AUDIOSOLUTIONS</p>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" style={{ boxShadow: '0 0 4px hsl(155 85% 42% / 0.6)' }} />
                <span className="text-[9px] font-mono text-muted-foreground/70">v8.0.0 • <span className="text-success/80">Ativo</span></span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* Collapse toggle */}
      <button
        onClick={onToggleCollapse}
        className="absolute -right-3 top-[72px] z-10 w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}
      >
        {collapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
      </button>

      {/* Dashboard — always at top */}
      <div className={cn("pt-3 pb-1", collapsed ? 'px-1.5' : 'px-3')}>
        {renderNavButton(dashboardItem)}
      </div>

      {/* Navigation Groups */}
      <nav className={cn("flex-1 py-2 space-y-1 overflow-y-auto", collapsed ? 'px-1.5' : 'px-3')}>
        {groupedItems.map(group => {
          const isGroupCollapsed = collapsedGroups.has(group.id);
          const hasActiveChild = group.items.some(i => activeTab === i.id);

          if (collapsed) {
            // In collapsed mode, show just icons with a subtle separator
            return (
              <div key={group.id} className="space-y-0.5 py-1">
                <div className="mx-1 h-px bg-border/30 mb-1" />
                {group.items.map(renderNavButton)}
              </div>
            );
          }

          return (
            <div key={group.id}>
              <button
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold tracking-[0.15em] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  {hasActiveChild && (
                    <div className="w-1 h-1 rounded-full bg-primary" style={{ boxShadow: '0 0 4px hsl(185 100% 48% / 0.5)' }} />
                  )}
                  {group.label}
                </span>
                <ChevronDown className={cn('w-3 h-3 transition-transform duration-200', isGroupCollapsed && '-rotate-90')} />
              </button>
              {!isGroupCollapsed && (
                <div className="space-y-0.5 pb-1">
                  {group.items.map(renderNavButton)}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Status Footer */}
      <div className={cn("space-y-2", collapsed ? 'p-1.5' : 'p-3')}>
        {/* Download activity */}
        {(queueLength > 0 || isProcessing) && (
          <div className={cn("rounded-lg border border-primary/20", collapsed ? 'p-1.5' : 'p-2.5')}
            style={{ background: 'linear-gradient(135deg, hsl(185 100% 48% / 0.06), hsl(185 100% 48% / 0.02))' }}
          >
            <div className="flex items-center gap-2">
              <Download className={cn("w-3.5 h-3.5 text-primary shrink-0", isProcessing && "animate-bounce")} />
              {!collapsed && (
                <div>
                  <span className="text-[11px] font-semibold text-primary">
                    {isProcessing ? 'Baixando...' : 'Na fila'}
                  </span>
                  <p className="text-[10px] text-muted-foreground">
                    {queueLength} música{queueLength !== 1 ? 's' : ''}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </aside>
  );
}
