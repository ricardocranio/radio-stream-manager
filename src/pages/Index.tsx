import { useState, useEffect, lazy, Suspense, useRef, useCallback } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
// OPTIMIZED: Dashboard is eagerly loaded (most used), others are lazy
import { DashboardView } from '@/components/views/DashboardView';
import { useRadioStore } from '@/store/radioStore';
import { useInitializeFolders } from '@/hooks/useInitializeFolders';
import { useAutoCleanup } from '@/hooks/useAutoCleanup';
import { Skeleton } from '@/components/ui/skeleton';
import logo from '@/assets/logo.png';

// OPTIMIZED: Lazy load ALL heavy views except Dashboard
const StationsView = lazy(() => import('@/components/views/StationsView').then(m => ({ default: m.StationsView })));
const CapturedSongsView = lazy(() => import('@/components/views/CapturedSongsView').then(m => ({ default: m.CapturedSongsView })));
const SequenceView = lazy(() => import('@/components/views/SequenceView').then(m => ({ default: m.SequenceView })));
const ScheduleView = lazy(() => import('@/components/views/ScheduleView').then(m => ({ default: m.ScheduleView })));
const FoldersView = lazy(() => import('@/components/views/FoldersView').then(m => ({ default: m.FoldersView })));
const MissingView = lazy(() => import('@/components/views/MissingView').then(m => ({ default: m.MissingView })));
const SettingsView = lazy(() => import('@/components/views/SettingsView').then(m => ({ default: m.SettingsView })));
const FixedContentView = lazy(() => import('@/components/views/FixedContentView').then(m => ({ default: m.FixedContentView })));
const BlockEditorView = lazy(() => import('@/components/views/BlockEditorView').then(m => ({ default: m.BlockEditorView })));
const VozBrasilView = lazy(() => import('@/components/views/VozBrasilView').then(m => ({ default: m.VozBrasilView })));
const SpecialMonitoringView = lazy(() => import('@/components/views/SpecialMonitoringView').then(m => ({ default: m.SpecialMonitoringView })));
const RankingView = lazy(() => import('@/components/views/RankingView').then(m => ({ default: m.RankingView })));
const LogsView = lazy(() => import('@/components/views/LogsView').then(m => ({ default: m.LogsView })));
const ExportView = lazy(() => import('@/components/views/ExportView').then(m => ({ default: m.ExportView })));
const GradeBuilderView = lazy(() => import('@/components/views/GradeBuilderView').then(m => ({ default: m.GradeBuilderView })));
const TrendsView = lazy(() => import('@/components/views/TrendsView').then(m => ({ default: m.TrendsView })));
const AnalyticsView = lazy(() => import('@/components/views/AnalyticsView').then(m => ({ default: m.AnalyticsView })));
const CompetitorView = lazy(() => import('@/components/views/CompetitorView').then(m => ({ default: m.CompetitorView })));

// Prefetch map: preload chunk on hover for instant navigation
const PREFETCH_MAP: Record<string, () => void> = {
  stations: () => import('@/components/views/StationsView'),
  captured: () => import('@/components/views/CapturedSongsView'),
  sequence: () => import('@/components/views/SequenceView'),
  schedule: () => import('@/components/views/ScheduleView'),
  gradebuilder: () => import('@/components/views/GradeBuilderView'),
  blockeditor: () => import('@/components/views/BlockEditorView'),
  fixedcontent: () => import('@/components/views/FixedContentView'),
  ranking: () => import('@/components/views/RankingView'),
  trends: () => import('@/components/views/TrendsView'),
  analytics: () => import('@/components/views/AnalyticsView'),
  competitor: () => import('@/components/views/CompetitorView'),
  vozbrasil: () => import('@/components/views/VozBrasilView'),
  specialmonitoring: () => import('@/components/views/SpecialMonitoringView'),
  logs: () => import('@/components/views/LogsView'),
  export: () => import('@/components/views/ExportView'),
  folders: () => import('@/components/views/FoldersView'),
  missing: () => import('@/components/views/MissingView'),
  settings: () => import('@/components/views/SettingsView'),
};

// Loading fallback for lazy components
const ViewSkeleton = () => (
  <div className="p-6 space-y-4">
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-64 w-full" />
    <Skeleton className="h-32 w-full" />
  </div>
);

// All tab definitions with their components
const TAB_COMPONENTS: Record<string, React.LazyExoticComponent<React.ComponentType> | React.ComponentType> = {
  dashboard: DashboardView,
  stations: StationsView,
  specialmonitoring: SpecialMonitoringView,
  captured: CapturedSongsView,
  sequence: SequenceView,
  schedule: ScheduleView,
  gradebuilder: GradeBuilderView,
  blockeditor: BlockEditorView,
  fixedcontent: FixedContentView,
  ranking: RankingView,
  trends: TrendsView,
  analytics: AnalyticsView,
  competitor: CompetitorView,
  vozbrasil: VozBrasilView,
  logs: LogsView,
  export: ExportView,
  folders: FoldersView,
  missing: MissingView,
  
  settings: SettingsView,
};

/**
 * Persistent tab panel: once a tab is visited, it stays mounted (hidden via CSS).
 * This prevents re-initialization delays when switching between tabs.
 */
function PersistentTabPanel({ tabId, activeTab, children }: { tabId: string; activeTab: string; children: React.ReactNode }) {
  const isActive = tabId === activeTab;
  return (
    <div
      className={isActive ? 'block' : 'hidden'}
      role="tabpanel"
      aria-hidden={!isActive}
    >
      {children}
    </div>
  );
}

const Index = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Track which tabs have been visited so we only mount them once visited
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(['dashboard']));
  const { setIsRunning, setLastUpdate } = useRadioStore();
  const prefetchedRef = useRef<Set<string>>(new Set());
  
  // NOTE: All background services (scraping, downloads, grade builder) 
  // are handled by GlobalServicesContext at App level
  
  // Initialize required folders on startup (Electron only)
  useInitializeFolders();
  
  // Auto cleanup of old data (>24h) - runs every hour
  useAutoCleanup();

  // Mark system as running on mount
  useEffect(() => {
    setIsRunning(true);
    setLastUpdate(new Date());
  }, []);

  // Track visited tabs
  useEffect(() => {
    setVisitedTabs(prev => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  // Prefetch chunk on hover (only once per tab)
  const handleTabHover = useCallback((tabId: string) => {
    if (prefetchedRef.current.has(tabId) || visitedTabs.has(tabId)) return;
    const prefetch = PREFETCH_MAP[tabId];
    if (prefetch) {
      prefetch();
      prefetchedRef.current.add(tabId);
    }
  }, [visitedTabs]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onTabHover={handleTabHover}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto"
          style={{ background: 'linear-gradient(180deg, hsl(225 25% 7%) 0%, hsl(225 25% 6%) 100%)' }}
        >
          {/* Dashboard is always mounted (eagerly loaded) */}
          <PersistentTabPanel tabId="dashboard" activeTab={activeTab}>
            <DashboardView />
          </PersistentTabPanel>

          {/* Lazy views: only mount when first visited, then keep alive */}
          {Object.entries(TAB_COMPONENTS).map(([tabId, Component]) => {
            if (tabId === 'dashboard') return null;
            if (!visitedTabs.has(tabId)) return null;
            return (
              <PersistentTabPanel key={tabId} tabId={tabId} activeTab={activeTab}>
                <Suspense fallback={<ViewSkeleton />}>
                  <Component />
                </Suspense>
              </PersistentTabPanel>
            );
          })}
        </main>
        <footer className="border-t border-border/50 px-4 py-2 flex items-center justify-center gap-3 text-[10px] text-muted-foreground/50"
          style={{ background: 'hsl(225 25% 6%)' }}
        >
          <img src={logo} alt="AudioSolutions" className="h-4 w-4 rounded opacity-40" />
          <a href="https://audiosolutions.tech/" target="_blank" rel="noopener noreferrer" className="text-primary/40 hover:text-primary/70 transition-colors">audiosolutions.tech</a>
          <span className="opacity-30">·</span>
          <span>Ricardo Amaral</span>
          <span className="opacity-30">·</span>
          <a href="tel:+5531988467222" className="text-primary/40 hover:text-primary/70 transition-colors">+55 (31) 98846-7222</a>
        </footer>
      </div>
    </div>
  );
};

export default Index;
