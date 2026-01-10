import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { DashboardView } from '@/components/views/DashboardView';
import { StationsView } from '@/components/views/StationsView';
import { SequenceView } from '@/components/views/SequenceView';
import { ScheduleView } from '@/components/views/ScheduleView';
import { FoldersView } from '@/components/views/FoldersView';
import { MissingView } from '@/components/views/MissingView';
import { SettingsView } from '@/components/views/SettingsView';
import { useRadioStore } from '@/store/radioStore';
import { CapturedSong } from '@/types/radio';

const Index = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { addCapturedSong, setIsRunning, setLastUpdate } = useRadioStore();

  // Simulate real-time data capture
  useEffect(() => {
    setIsRunning(true);
    setLastUpdate(new Date());

    const demoSongs: CapturedSong[] = [
      { id: '1', title: 'Evidências', artist: 'Chitãozinho & Xororó', station: 'BH FM', timestamp: new Date(), status: 'found' },
      { id: '2', title: 'Atrasadinha', artist: 'Felipe Araújo', station: 'Band FM', timestamp: new Date(), status: 'found' },
      { id: '3', title: 'Medo Bobo', artist: 'Maiara & Maraisa', station: 'BH FM', timestamp: new Date(), status: 'found' },
      { id: '4', title: 'Hear Me Now', artist: 'Alok', station: 'Metropolitana', timestamp: new Date(), status: 'found' },
      { id: '5', title: 'Shallow', artist: 'Lady Gaga', station: 'Disney FM', timestamp: new Date(), status: 'missing' },
    ];

    let index = 0;
    const interval = setInterval(() => {
      if (index < demoSongs.length) {
        addCapturedSong(demoSongs[index]);
        index++;
      }
    }, 2000);

    return () => clearInterval(interval);
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
