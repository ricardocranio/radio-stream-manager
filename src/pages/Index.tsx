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

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// Extended song database for realistic simulation
const simulatedSongsDatabase = {
  'BH FM': [
    { title: 'Evidências', artist: 'Chitãozinho e Xororo' },
    { title: 'Medo Bobo', artist: 'Maiara e Maraisa' },
    { title: 'Propaganda', artist: 'Jorge e Mateus' },
    { title: 'Atrasadinha', artist: 'Felipe Araujo' },
    { title: 'Péssimo Negócio', artist: 'Henrique e Juliano' },
    { title: 'Amando Individual', artist: 'Gusttavo Lima' },
    { title: 'Milu', artist: 'Luan Santana' },
    { title: 'Deixa Eu Te Amar', artist: 'Sorriso Maroto' },
    { title: 'Bebi Liguei', artist: 'Marilia Mendonca' },
    { title: 'Infiel', artist: 'Marilia Mendonca' },
    { title: 'Te Assumi Pro Brasil', artist: 'Matheus e Kauan' },
    { title: 'Corpo Sensual', artist: 'Pabllo Vittar' },
    { title: 'Regime Fechado', artist: 'Simone e Simaria' },
    { title: 'Nessas Horas', artist: 'Matheus e Kauan' },
    { title: 'Amor da Sua Cama', artist: 'Bruno e Marrone' },
  ],
  'Band FM': [
    { title: 'Sorte', artist: 'Thiaguinho' },
    { title: 'Fatalmente', artist: 'Turma do Pagode' },
    { title: 'Ta Vendo Aquela Lua', artist: 'Exaltasamba' },
    { title: 'Deixa Acontecer', artist: 'Grupo Revelacao' },
    { title: 'Samba de Roda', artist: 'Sorriso Maroto' },
    { title: 'Temporal', artist: 'Dilsinho' },
    { title: 'Vitamina', artist: 'Ludmilla' },
    { title: 'Acelera e Pisa', artist: 'Menos e Menos' },
    { title: 'Eu Vacilei', artist: 'Tiee' },
    { title: 'A Gente Fez Amor', artist: 'Mumuzinho' },
    { title: 'Deixa Eu Te Querer', artist: 'Ferrugem' },
    { title: 'Pirata e Tesouro', artist: 'Sorriso Maroto' },
    { title: 'Te Esperando', artist: 'Luan Santana' },
    { title: 'Onde Nasce o Sol', artist: 'Diogo Nogueira' },
    { title: 'Dona de Mim', artist: 'IZA' },
  ],
  'Clube FM': [
    { title: 'Shallow', artist: 'Lady Gaga' },
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    { title: 'Dance Monkey', artist: 'Tones and I' },
    { title: 'Watermelon Sugar', artist: 'Harry Styles' },
    { title: 'Hear Me Now', artist: 'Alok' },
    { title: 'Lean On', artist: 'Major Lazer' },
    { title: 'Shape of You', artist: 'Ed Sheeran' },
    { title: 'Uptown Funk', artist: 'Bruno Mars' },
    { title: 'Bad Guy', artist: 'Billie Eilish' },
    { title: 'Happier', artist: 'Marshmello' },
    { title: 'Something Just Like This', artist: 'Coldplay' },
    { title: 'Closer', artist: 'The Chainsmokers' },
    { title: 'Despacito', artist: 'Luis Fonsi' },
    { title: 'Perfect', artist: 'Ed Sheeran' },
    { title: 'Havana', artist: 'Camila Cabello' },
  ],
};

const Index = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { 
    addCapturedSong, 
    setIsRunning, 
    setLastUpdate, 
    stations,
    clearCapturedSongs,
  } = useRadioStore();
  
  const songIndexRef = useRef<Record<string, number>>({
    'BH FM': 0,
    'Band FM': 0,
    'Clube FM': 0,
  });
  const scrapeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Simulated capture for web preview
  const performSimulatedCapture = useCallback(() => {
    const stationNames = ['BH FM', 'Band FM', 'Clube FM'];
    const randomStation = stationNames[Math.floor(Math.random() * stationNames.length)];
    const stationSongs = simulatedSongsDatabase[randomStation as keyof typeof simulatedSongsDatabase];
    
    // Get next song index for this station
    const currentIndex = songIndexRef.current[randomStation] || 0;
    const song = stationSongs[currentIndex % stationSongs.length];
    
    // Update index for next time
    songIndexRef.current[randomStation] = (currentIndex + 1) % stationSongs.length;
    
    // Randomly mark some as missing (20% chance)
    const isMissing = Math.random() < 0.2;
    
    const capturedSong: CapturedSong = {
      id: `sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: song.title,
      artist: song.artist,
      station: randomStation,
      timestamp: new Date(),
      status: isMissing ? 'missing' : 'found',
    };
    
    addCapturedSong(capturedSong);
    setLastUpdate(new Date());
  }, [addCapturedSong, setLastUpdate]);

  // Start capture system
  useEffect(() => {
    setIsRunning(true);
    setLastUpdate(new Date());
    
    // Clear old songs on mount
    clearCapturedSongs();
    
    // Add initial songs
    const initialCount = 5;
    for (let i = 0; i < initialCount; i++) {
      setTimeout(() => {
        performSimulatedCapture();
      }, i * 500);
    }

    if (isElectron) {
      // In Electron: Use real scraping
      console.log('[CAPTURE] Using real scraping (Electron mode)');
      
      // Initial scrape
      performRealScrape();
      
      // Scrape every 20 minutes (1200000ms)
      scrapeIntervalRef.current = setInterval(() => {
        performRealScrape();
      }, 20 * 60 * 1000);
      
      // Also add simulated songs between scrapes for visual feedback
      const simInterval = setInterval(() => {
        performSimulatedCapture();
      }, 8000);
      
      return () => {
        if (scrapeIntervalRef.current) {
          clearInterval(scrapeIntervalRef.current);
        }
        clearInterval(simInterval);
      };
    } else {
      // In Web: Use simulation only
      console.log('[CAPTURE] Using simulation (Web mode)');
      
      // Add new simulated song every 5-10 seconds
      const interval = setInterval(() => {
        performSimulatedCapture();
      }, 5000 + Math.random() * 5000);

      return () => clearInterval(interval);
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
