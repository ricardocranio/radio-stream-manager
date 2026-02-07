import { useState, useEffect, lazy, Suspense } from 'react';
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
const ToolsView = lazy(() => import('@/components/views/ToolsView').then(m => ({ default: m.ToolsView })));

// Loading fallback for lazy components
const ViewSkeleton = () => (
  <div className="p-6 space-y-4">
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-64 w-full" />
    <Skeleton className="h-32 w-full" />
  </div>
);

const Index = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
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

  const renderView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView />;
      case 'stations':
        return <Suspense fallback={<ViewSkeleton />}><StationsView /></Suspense>;
      case 'specialmonitoring':
        return <Suspense fallback={<ViewSkeleton />}><SpecialMonitoringView /></Suspense>;
      case 'captured':
        return <Suspense fallback={<ViewSkeleton />}><CapturedSongsView /></Suspense>;
      case 'sequence':
        return <Suspense fallback={<ViewSkeleton />}><SequenceView /></Suspense>;
      case 'schedule':
        return <Suspense fallback={<ViewSkeleton />}><ScheduleView /></Suspense>;
      case 'gradebuilder':
        return <Suspense fallback={<ViewSkeleton />}><GradeBuilderView /></Suspense>;
      case 'blockeditor':
        return <Suspense fallback={<ViewSkeleton />}><BlockEditorView /></Suspense>;
      case 'fixedcontent':
        return <Suspense fallback={<ViewSkeleton />}><FixedContentView /></Suspense>;
      case 'ranking':
        return <Suspense fallback={<ViewSkeleton />}><RankingView /></Suspense>;
      case 'vozbrasil':
        return <Suspense fallback={<ViewSkeleton />}><VozBrasilView /></Suspense>;
      case 'logs':
        return <Suspense fallback={<ViewSkeleton />}><LogsView /></Suspense>;
      case 'export':
        return <Suspense fallback={<ViewSkeleton />}><ExportView /></Suspense>;
      case 'folders':
        return <Suspense fallback={<ViewSkeleton />}><FoldersView /></Suspense>;
      case 'missing':
        return <Suspense fallback={<ViewSkeleton />}><MissingView /></Suspense>;
      case 'tools':
        return <Suspense fallback={<ViewSkeleton />}><ToolsView /></Suspense>;
      case 'settings':
        return <Suspense fallback={<ViewSkeleton />}><SettingsView /></Suspense>;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 overflow-auto">{renderView()}</main>
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
