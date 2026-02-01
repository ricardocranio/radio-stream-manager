import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { DashboardView } from '@/components/views/DashboardView';
import { StationsView } from '@/components/views/StationsView';
import { CapturedSongsView } from '@/components/views/CapturedSongsView';
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
import { VozBrasilView } from '@/components/views/VozBrasilView';
import { SpecialMonitoringView } from '@/components/views/SpecialMonitoringView';
import { useRadioStore, MissingSong } from '@/store/radioStore';
import { CapturedSong } from '@/types/radio';
import { useAutoDownload } from '@/hooks/useAutoDownload';
import { useCheckMusicLibrary } from '@/hooks/useCheckMusicLibrary';
import { useInitializeFolders } from '@/hooks/useInitializeFolders';
import logo from '@/assets/logo.png';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// Extended song database for realistic simulation per style - dynamically used based on station styles
const simulatedSongsByStyle: Record<string, { title: string; artist: string }[]> = {
  'SERTANEJO': [
    { title: 'Ciumeira', artist: 'Marilia Mendonca' },
    { title: 'Mete Um Block Nele', artist: 'Joao Gomes' },
    { title: 'Entregador de Flor', artist: 'Diego e Victor Hugo' },
    { title: 'Saudade Sua', artist: 'Joao Gomes' },
    { title: 'Facas', artist: 'Diego e Victor Hugo' },
    { title: 'Radar', artist: 'Joao Gomes' },
    { title: 'Menos e Mais', artist: 'Jorge e Mateus' },
    { title: 'Dengo', artist: 'Joao Gomes' },
    { title: 'Enquanto Eu Brindo Ce Chora', artist: 'Matheus e Kauan' },
    { title: 'Gostoso Demais', artist: 'Marilia Mendonca' },
    { title: 'Infiel', artist: 'Marilia Mendonca' },
    { title: 'Se For Amor', artist: 'Joao Gomes' },
    { title: 'Lapada Dela', artist: 'Joao Gomes' },
    { title: 'Aquelas Coisas', artist: 'Gusttavo Lima' },
    { title: 'Termina Comigo Antes', artist: 'Marilia Mendonca' },
  ],
  'PAGODE': [
    { title: 'Sorte', artist: 'Thiaguinho' },
    { title: 'Fatalmente', artist: 'Turma do Pagode' },
    { title: 'Ta Vendo Aquela Lua', artist: 'Exaltasamba' },
    { title: 'Deixa Acontecer', artist: 'Grupo Revelacao' },
    { title: 'Samba de Roda', artist: 'Sorriso Maroto' },
    { title: 'Temporal', artist: 'Dilsinho' },
    { title: 'Eu Vacilei', artist: 'Tiee' },
    { title: 'A Gente Fez Amor', artist: 'Mumuzinho' },
    { title: 'Deixa Eu Te Querer', artist: 'Ferrugem' },
    { title: 'Pirata e Tesouro', artist: 'Sorriso Maroto' },
    { title: 'Onde Nasce o Sol', artist: 'Diogo Nogueira' },
    { title: 'Cicatrizes', artist: 'Ferrugem' },
  ],
  'POP': [
    { title: 'Shallow', artist: 'Lady Gaga' },
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    { title: 'Dance Monkey', artist: 'Tones and I' },
    { title: 'Watermelon Sugar', artist: 'Harry Styles' },
    { title: 'Hear Me Now', artist: 'Alok' },
    { title: 'Shape of You', artist: 'Ed Sheeran' },
    { title: 'Perfect', artist: 'Ed Sheeran' },
    { title: 'Dona de Mim', artist: 'IZA' },
    { title: 'Havana', artist: 'Camila Cabello' },
    { title: 'Vai Malandra', artist: 'Anitta' },
  ],
  'DANCE': [
    { title: 'Lean On', artist: 'Major Lazer' },
    { title: 'Uptown Funk', artist: 'Bruno Mars' },
    { title: 'Bad Guy', artist: 'Billie Eilish' },
    { title: 'Happier', artist: 'Marshmello' },
    { title: 'Something Just Like This', artist: 'Coldplay' },
    { title: 'Closer', artist: 'The Chainsmokers' },
    { title: 'Despacito', artist: 'Luis Fonsi' },
    { title: 'Titanium', artist: 'David Guetta' },
    { title: 'Levels', artist: 'Avicii' },
  ],
  'POP/VARIADO': [
    { title: 'Vitamina', artist: 'Ludmilla' },
    { title: 'Acelera e Pisa', artist: 'Menos e Menos' },
    { title: 'Te Esperando', artist: 'Luan Santana' },
    { title: 'Cobaia', artist: 'Lauana Prado' },
    { title: 'Canudinho', artist: 'Gusttavo Lima' },
  ],
  'AGRONEJO': [
    { title: 'Boate Azul', artist: 'Bruno e Marrone' },
    { title: 'Rionegro e Solimoes', artist: 'Frio da Madrugada' },
    { title: 'Chora Me Liga', artist: 'Joao Bosco e Vinicius' },
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
    addMissingSong,
    addOrUpdateRankingSong,
    deezerConfig,
    config,
    missingSongs,
  } = useRadioStore();
  
  // Initialize auto-download hook (manages queue in global store)
  useAutoDownload();
  
  // Initialize required folders on startup (Electron only)
  useInitializeFolders();
  
  // Hook for checking songs in local music library (Electron IPC)
  const { checkSongExists } = useCheckMusicLibrary();
  
  // Check if song is already in missing list (avoid duplicates)
  const isSongAlreadyMissing = useCallback((artist: string, title: string): boolean => {
    return missingSongs.some(
      s => s.artist.toLowerCase() === artist.toLowerCase() && 
           s.title.toLowerCase() === title.toLowerCase()
    );
  }, [missingSongs]);
  
  // Dynamic song index per station (no longer hardcoded - initialized empty, stations added on demand)
  const songIndexRef = useRef<Record<string, number>>({});
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

  // Capture handler - checks music library and adds to missing if needed
  // Now uses ALL enabled stations from the store dynamically
  const performCapture = useCallback(async () => {
    // Get enabled stations from store
    const enabledStations = stations.filter(s => s.enabled);
    if (enabledStations.length === 0) {
      console.warn('[CAPTURE] No enabled stations found');
      return;
    }
    
    // Pick a random enabled station
    const randomStationObj = enabledStations[Math.floor(Math.random() * enabledStations.length)];
    const randomStation = randomStationObj.name;
    
    // Get the style for this station (first style in array, fallback to POP/VARIADO)
    const stationStyle = randomStationObj.styles?.[0] || 'POP/VARIADO';
    
    // Get songs for this style from simulatedSongsByStyle
    const styleSongs = simulatedSongsByStyle[stationStyle] || simulatedSongsByStyle['POP/VARIADO'] || [];
    
    if (styleSongs.length === 0) {
      console.warn(`[CAPTURE] No simulated songs for style: ${stationStyle}`);
      return;
    }
    
    // Get next song index for this station (round-robin)
    const currentIndex = songIndexRef.current[randomStation] || 0;
    const song = styleSongs[currentIndex % styleSongs.length];
    
    // Update index for next time
    songIndexRef.current[randomStation] = (currentIndex + 1) % styleSongs.length;
    
    // Check if song exists in local music library using Electron IPC (or fallback)
    const libraryCheck = await checkSongExists(song.artist, song.title);
    const existsInLibrary = libraryCheck.exists;
    const alreadyMissing = isSongAlreadyMissing(song.artist, song.title);
    
    const capturedSong: CapturedSong = {
      id: `cap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: song.title,
      artist: song.artist,
      station: randomStation,
      timestamp: new Date(),
      status: existsInLibrary ? 'found' : 'missing',
    };
    
    addCapturedSong(capturedSong);
    
    // UPDATE RANKING - Integração com TOP50
    addOrUpdateRankingSong(song.title, song.artist, stationStyle);
    console.log(`[RANKING] Música adicionada ao ranking: ${song.artist} - ${song.title} (${stationStyle})`);
    
    // If song is missing AND not already in missing list, add to missing songs for auto-download
    if (!existsInLibrary && !alreadyMissing) {
      const missingSong: MissingSong = {
        id: capturedSong.id,
        title: song.title,
        artist: song.artist,
        station: randomStation,
        timestamp: new Date(),
        status: 'missing',
      };
      addMissingSong(missingSong);
      console.log(`[AUTO-FLOW] ✅ Nova música faltando detectada: ${song.artist} - ${song.title}`);
      console.log(`[AUTO-FLOW] → Adicionada à lista Faltando → Download automático via Deemix (se configurado)`);
    } else if (!existsInLibrary && alreadyMissing) {
      console.log(`[CAPTURE] Música já está na lista de faltando: ${song.artist} - ${song.title}`);
    } else {
      console.log(`[CAPTURE] ✓ Música encontrada no banco musical: ${song.artist} - ${song.title}${libraryCheck.path ? ` (${libraryCheck.path})` : ''}`);
    }
    
    setLastUpdate(new Date());
  }, [stations, addCapturedSong, addMissingSong, addOrUpdateRankingSong, setLastUpdate, checkSongExists, isSongAlreadyMissing]);

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
        performCapture();
      }, i * 500);
    }

    if (isElectron) {
      // In Electron: Use real scraping + music library check
      console.log('[CAPTURE] Modo Electron - Verificação real do banco musical ativa');
      
      // Initial scrape
      performRealScrape();
      
      // Scrape every 20 minutes (1200000ms)
      scrapeIntervalRef.current = setInterval(() => {
        performRealScrape();
      }, 20 * 60 * 1000);
      
      // Also run capture between scrapes for continuous monitoring
      const captureInterval = setInterval(() => {
        performCapture();
      }, 8000);
      
      return () => {
        if (scrapeIntervalRef.current) {
          clearInterval(scrapeIntervalRef.current);
        }
        clearInterval(captureInterval);
      };
    } else {
      // In Web: Use simulation only (no real music library check)
      console.log('[CAPTURE] Modo Web - Simulação de verificação do banco musical');
      
      // Add new captured song every 5-10 seconds
      const interval = setInterval(() => {
        performCapture();
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
      case 'specialmonitoring':
        return <SpecialMonitoringView />;
      case 'captured':
        return <CapturedSongsView />;
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
      case 'vozbrasil':
        return <VozBrasilView />;
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
