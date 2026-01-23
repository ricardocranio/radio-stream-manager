import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UIMode = 'simplified' | 'complete';

interface UIModeState {
  mode: UIMode;
  setMode: (mode: UIMode) => void;
  toggleMode: () => void;
}

export const useUIModeStore = create<UIModeState>()(
  persist(
    (set) => ({
      mode: 'complete', // Default to complete mode
      setMode: (mode) => set({ mode }),
      toggleMode: () => set((state) => ({ 
        mode: state.mode === 'complete' ? 'simplified' : 'complete' 
      })),
    }),
    {
      name: 'ui-mode-storage',
    }
  )
);
