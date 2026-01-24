import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ServiceModeState {
  // 'window' = normal electron window, 'service' = tray + localhost browser
  serviceMode: 'window' | 'service';
  localhostPort: number;
  isServerRunning: boolean;
  autoStartServiceMode: boolean; // Start in service mode on app launch
  
  setServiceMode: (mode: 'window' | 'service') => void;
  setServerRunning: (running: boolean) => void;
  setLocalhostPort: (port: number) => void;
  setAutoStartServiceMode: (autoStart: boolean) => void;
  toggleServiceMode: () => void;
}

export const useServiceModeStore = create<ServiceModeState>()(
  persist(
    (set, get) => ({
      serviceMode: 'window',
      localhostPort: 8080,
      isServerRunning: false,
      autoStartServiceMode: false,
      
      setServiceMode: (mode) => set({ serviceMode: mode }),
      setServerRunning: (running) => set({ isServerRunning: running }),
      setLocalhostPort: (port) => set({ localhostPort: port }),
      setAutoStartServiceMode: (autoStart) => set({ autoStartServiceMode: autoStart }),
      
      toggleServiceMode: () => {
        const current = get().serviceMode;
        const newMode = current === 'window' ? 'service' : 'window';
        set({ serviceMode: newMode });
        
        // Notify Electron about mode change (async, fire-and-forget)
        if (typeof window !== 'undefined' && window.electronAPI) {
          const api = window.electronAPI;
          if ('setServiceMode' in api && typeof api.setServiceMode === 'function') {
            api.setServiceMode(newMode).catch(console.error);
          }
        }
      },
    }),
    {
      name: 'service-mode-storage',
    }
  )
);
