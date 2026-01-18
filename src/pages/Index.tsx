import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { DashboardView } from '@/components/views/DashboardView';
import { StationsView } from '@/components/views/StationsView';
import { SequenceView } from '@/components/views/SequenceView';
import { ScheduleView } from '@/components/views/ScheduleView';
import { FoldersView } from '@/components/views/FoldersView';
import { MissingView } from '@/components/views/MissingView';
import { SettingsView } from '@/components/views/SettingsView';
import { RankingView } from '@/components/views/RankingView';
import { LogsView } from '@/components/views/LogsView';
import { GradeBuilderView } from '@/components/views/GradeBuilderView';
import { ExportView } from '@/components/views/ExportView';
import { FixedContentView } from '@/components/views/FixedContentView';
import { BlockEditorView } from '@/components/views/BlockEditorView';
import { useRadioStore } from '@/store/radioStore';
import { CapturedSong } from '@/types/radio';
import { getLatestTracks } from '@/services/radioScraper';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

const Index = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { 
    addCapturedSong, 
    setIsRunning, 
    setLastUpdate, 
    stations,
    clearCapturedSongs,
  } = useRadioStore();
  
  const scrapeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isScrapingRef = useRef(false);

  // Real scraping function for Electron
  const performRealScrape = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.scrapeStations) return;
    
    try {
      const enabledStations = stations.filter(s => s.enabled);
      if (enabledStations.length === 0) return;
      
      console.log('[SCRAPE] Starting real scrape for', enabledStations.length, 'stations');
      const result = await window.electronAPI.scrapeStations(enabledStations);
      
      if (result.songs && result.songs.length > 0) {
        for (const song of result.songs) {
          const capturedSong: CapturedSong = {
            id: song.id,
            title: song.title,
            artist: song.artist,
            station: song.station,
            timestamp: new Date(song.timestamp),
            status: song.status,
          };
          addCapturedSong(capturedSong);
        }
        console.log('[SCRAPE] Added', result.songs.length, 'new songs');
      }
      
      if (result.errors && result.errors.length > 0) {
        console.warn('[SCRAPE] Errors:', result.errors);
      }
      
      setLastUpdate(new Date());
    } catch (error) {
      console.error('[SCRAPE] Error:', error);
    }
  }, [stations, addCapturedSong, setLastUpdate]);

  // Web scraping using CORS proxy
  const performWebScrape = useCallback(async () => {
    if (isScrapingRef.current) return;
    isScrapingRef.current = true;
    
    try {
      const enabledStations = stations.filter(s => s.enabled);
      if (enabledStations.length === 0) {
        isScrapingRef.current = false;
        return;
      }
      
      console.log('[SCRAPE-WEB] Starting web scrape for', enabledStations.length, 'stations');
      
      const tracks = await getLatestTracks(enabledStations);
      
      if (tracks.length > 0) {
        for (const track of tracks) {
          // Random chance to mark as missing (for demo purposes)
          const isMissing = Math.random() < 0.15;
          
          const capturedSong: CapturedSong = {
            id: `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: track.title,
            artist: track.artist,
            station: track.station,
            timestamp: track.timestamp,
            status: isMissing ? 'missing' : 'found',
          };
          addCapturedSong(capturedSong);
        }
        console.log('[SCRAPE-WEB] Added', tracks.length, 'tracks from radio stations');
      }
      
      setLastUpdate(new Date());
    } catch (error) {
      console.error('[SCRAPE-WEB] Error:', error);
    } finally {
      isScrapingRef.current = false;
    }
  }, [stations, addCapturedSong, setLastUpdate]);

  // Start capture system
  useEffect(() => {
    setIsRunning(true);
    setLastUpdate(new Date());
    
    // Clear old songs on mount
    clearCapturedSongs();

    if (isElectron) {
      // In Electron: Use real scraping via main process
      console.log('[CAPTURE] Using Electron real-time scraping');
      
      // Initial scrape
      performRealScrape();
      
      // Scrape every 2 minutes (120000ms)
      scrapeIntervalRef.current = setInterval(() => {
        performRealScrape();
      }, 120000);
      
      return () => {
        if (scrapeIntervalRef.current) {
          clearInterval(scrapeIntervalRef.current);
        }
      };
    } else {
      // In Web: Use CORS proxy scraping with realistic data
      console.log('[CAPTURE] Using web scraping with CORS proxy');
      
      // Initial scrape (with delay for page load)
      const initialTimeout = setTimeout(() => {
        performWebScrape();
      }, 1000);
      
      // Scrape every 30 seconds for more realistic real-time updates
      const interval = setInterval(() => {
        performWebScrape();
      }, 30000);

      return () => {
        clearTimeout(initialTimeout);
        clearInterval(interval);
      };
    }
  }, []);
  const renderView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView />;
      case 'stations':
        return <StationsView />;
      case 'sequence':
        return <SequenceView />;
      case 'schedule':
        return <ScheduleView />;
      case 'gradebuilder':
        return <GradeBuilderView />;
      case 'blockeditor':
        return <BlockEditorView />;
      case 'fixedcontent':
        return <FixedContentView />;
      case 'ranking':
        return <RankingView />;
      case 'logs':
        return <LogsView />;
      case 'export':
        return <ExportView />;
      case 'folders':
        return <FoldersView />;
      case 'missing':
        return <MissingView />;
      case 'settings':
        return <SettingsView />;
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
      </div>
    </div>
  );
};

export default Index;
