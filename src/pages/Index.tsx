import { useState, useEffect, lazy, Suspense, useRef } from 'react';
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
  // Track which tabs have been visited so we only mount them once visited
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(['dashboard']));
  const { setIsRunning, setLastUpdate } = useRadioStore();
  
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

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 overflow-auto">
          {/* Dashboard is always mounted (eagerly loaded) */}
          <PersistentTabPanel tabId="dashboard" activeTab={activeTab}>
            <DashboardView />
          </PersistentTabPanel>

          {/* Lazy views: only mount when first visited, then keep alive */}
          {Object.entries(TAB_COMPONENTS).map(([tabId, Component]) => {
            if (tabId === 'dashboard') return null; // Already rendered above
            if (!visitedTabs.has(tabId)) return null; // Not visited yet, don't mount
            return (
              <PersistentTabPanel key={tabId} tabId={tabId} activeTab={activeTab}>
                <Suspense fallback={<ViewSkeleton />}>
                  <Component />
                </Suspense>
              </PersistentTabPanel>
            );
          })}
        </main>
        <footer className="border-t border-border bg-secondary/30 px-4 py-2 flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <img src={logo} alt="AudioSolutions" className="h-6 w-6 rounded" />
          <a href="https://audiosolutions.tech/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">audiosolutions.tech</a>
          <span className="text-muted-foreground/50">|</span>
          <span>Desenvolvido por <span className="font-medium text-foreground">Ricardo Amaral</span></span>
          <span className="text-muted-foreground/50">|</span>
          <span>Contato: <a href="tel:+5531988467222" className="text-primary hover:underline">+55 (31) 98846-7222</a></span>
        </footer>
      </div>
    </div>
  );
};

export default Index;
