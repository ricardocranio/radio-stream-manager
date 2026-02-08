import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface BlockLogEntry {
  id: string;
  timestamp: Date;
  blockTime: string;
  type: 'used' | 'skipped' | 'substituted' | 'missing' | 'fixed';
  title: string;
  artist: string;
  station: string;
  reason?: string;
  style?: string;
  substituteFor?: string;
}

export interface SystemError {
  id: string;
  timestamp: Date;
  level: 'info' | 'warning' | 'error';
  category: 'GRADE' | 'SCRAPE' | 'DOWNLOAD' | 'SUPABASE' | 'ELECTRON' | 'REALTIME' | 'SYSTEM';
  message: string;
  details?: string;
}

interface GradeLogState {
  // Block logs for generated grades
  blockLogs: BlockLogEntry[];
  addBlockLog: (entry: Omit<BlockLogEntry, 'id' | 'timestamp'>) => void;
  addBlockLogs: (entries: Omit<BlockLogEntry, 'id' | 'timestamp'>[]) => void;
  clearBlockLogs: () => void;
  getLogsByBlock: (blockTime: string) => BlockLogEntry[];
  
  // System errors
  systemErrors: SystemError[];
  addSystemError: (entry: Omit<SystemError, 'id' | 'timestamp'>) => void;
  clearSystemErrors: () => void;
  
  // Statistics
  getBlockStats: (blockTime: string) => {
    used: number;
    skipped: number;
    substituted: number;
    missing: number;
    fixed: number;
  };
}

// Helper to convert dates back after rehydration
const dateReviver = (value: unknown): unknown => {
  if (typeof value === 'string') {
    const dateMatch = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
    if (dateMatch) return new Date(value);
  }
  return value;
};

export const useGradeLogStore = create<GradeLogState>()(
  persist(
    (set, get) => ({
      blockLogs: [],
      
      addBlockLog: (entry) => {
        const newEntry: BlockLogEntry = {
          ...entry,
          id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
        };
        set((state) => ({
          blockLogs: [newEntry, ...state.blockLogs].slice(0, 300), // Reduced from 1000 — saves ~70KB localStorage I/O
        }));
      },
      
      addBlockLogs: (entries) => {
        const newEntries = entries.map((entry) => ({
          ...entry,
          id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
        }));
        set((state) => ({
          blockLogs: [...newEntries, ...state.blockLogs].slice(0, 300),
        }));
      },
      
      clearBlockLogs: () => set({ blockLogs: [] }),
      
      getLogsByBlock: (blockTime) => {
        return get().blockLogs.filter((log) => log.blockTime === blockTime);
      },
      
      systemErrors: [],
      
      addSystemError: (entry) => {
        const newError: SystemError = {
          ...entry,
          id: `err-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
        };
        set((state) => ({
          systemErrors: [newError, ...state.systemErrors].slice(0, 150), // Reduced from 500 — saves ~30KB localStorage I/O
        }));
        
        // Also log to console
        const levelEmoji = entry.level === 'error' ? '❌' : entry.level === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`[${entry.category}] ${levelEmoji} ${entry.message}`);
      },
      
      clearSystemErrors: () => set({ systemErrors: [] }),
      
      getBlockStats: (blockTime) => {
        const logs = get().blockLogs.filter((log) => log.blockTime === blockTime);
        return {
          used: logs.filter((l) => l.type === 'used').length,
          skipped: logs.filter((l) => l.type === 'skipped').length,
          substituted: logs.filter((l) => l.type === 'substituted').length,
          missing: logs.filter((l) => l.type === 'missing').length,
          fixed: logs.filter((l) => l.type === 'fixed').length,
        };
      },
    }),
    {
      name: 'grade-log-storage',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Convert date strings back to Date objects
          state.blockLogs = state.blockLogs.map((log) => ({
            ...log,
            timestamp: new Date(log.timestamp),
          }));
          state.systemErrors = state.systemErrors.map((error) => ({
            ...error,
            timestamp: new Date(error.timestamp),
          }));
        }
      },
    }
  )
);

// Global error handler integration
export function logSystemError(
  category: SystemError['category'],
  level: SystemError['level'],
  message: string,
  details?: string
) {
  useGradeLogStore.getState().addSystemError({
    category,
    level,
    message,
    details,
  });
}
