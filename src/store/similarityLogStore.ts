import { create } from 'zustand';

export type MatchStrategy = 'prefix' | 'includes' | 'word' | 'levenshtein' | 'unknown';

export interface SimilarityLogEntry {
  id: string;
  timestamp: Date;
  artist: string;
  title: string;
  matchedFilename?: string;
  similarity: number;
  threshold: number;
  accepted: boolean;
  reason: 'match_found' | 'below_threshold' | 'no_match' | 'error';
  strategy?: MatchStrategy;
}

interface SimilarityLogState {
  logs: SimilarityLogEntry[];
  stats: {
    totalChecked: number;
    accepted: number;
    rejected: number;
    belowThreshold: number;
    noMatch: number;
    errors: number;
    averageSimilarity: number;
  };
  strategyStats: {
    prefix: number;
    includes: number;
    word: number;
    levenshtein: number;
    unknown: number;
    miss: number;
  };
  
  // Actions
  addLog: (entry: Omit<SimilarityLogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  resetStats: () => void;
}

const initialStats = {
  totalChecked: 0,
  accepted: 0,
  rejected: 0,
  belowThreshold: 0,
  noMatch: 0,
  errors: 0,
  averageSimilarity: 0,
};

const initialStrategyStats = {
  prefix: 0,
  includes: 0,
  word: 0,
  levenshtein: 0,
  unknown: 0,
  miss: 0,
};

export const useSimilarityLogStore = create<SimilarityLogState>((set) => ({
  logs: [],
  stats: { ...initialStats },
  strategyStats: { ...initialStrategyStats },

  addLog: (entry) =>
    set((state) => {
      const newEntry: SimilarityLogEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
      };

      const newLogs = [newEntry, ...state.logs].slice(0, 200);

      // Update stats
      const newStats = { ...state.stats };
      newStats.totalChecked++;
      
      if (entry.accepted) {
        newStats.accepted++;
      } else {
        newStats.rejected++;
        if (entry.reason === 'below_threshold') {
          newStats.belowThreshold++;
        } else if (entry.reason === 'no_match') {
          newStats.noMatch++;
        } else if (entry.reason === 'error') {
          newStats.errors++;
        }
      }

      // Update strategy stats
      const newStrategyStats = { ...state.strategyStats };
      if (entry.accepted && entry.strategy) {
        newStrategyStats[entry.strategy] = (newStrategyStats[entry.strategy] || 0) + 1;
      } else if (!entry.accepted) {
        newStrategyStats.miss++;
      } else if (entry.accepted && !entry.strategy) {
        newStrategyStats.unknown++;
      }

      // Calculate average similarity (only for matches found)
      const matchLogs = newLogs.filter(l => l.similarity > 0);
      if (matchLogs.length > 0) {
        newStats.averageSimilarity = matchLogs.reduce((sum, l) => sum + l.similarity, 0) / matchLogs.length;
      }

      if (newStats.totalChecked % 25 === 0) {
        const acceptRate = newStats.totalChecked > 0 
          ? Math.round((newStats.accepted / newStats.totalChecked) * 100) 
          : 0;
        console.log(
          `[SIMILARITY] 📊 Resumo: ${newStats.accepted}/${newStats.totalChecked} aceitas (${acceptRate}%) | ` +
          `Prefix=${newStrategyStats.prefix} Includes=${newStrategyStats.includes} Word=${newStrategyStats.word} Lev=${newStrategyStats.levenshtein} Miss=${newStrategyStats.miss}`
        );
      }

      return { logs: newLogs, stats: newStats, strategyStats: newStrategyStats };
    }),

  clearLogs: () => set({ logs: [] }),
  
  resetStats: () => set({ stats: { ...initialStats }, strategyStats: { ...initialStrategyStats } }),
}));

// Helper to get formatted stats
export function getSimilarityStatsText(stats: SimilarityLogState['stats']): string {
  const acceptRate = stats.totalChecked > 0 
    ? Math.round((stats.accepted / stats.totalChecked) * 100) 
    : 0;
  
  return `Verificadas: ${stats.totalChecked} | Aceitas: ${stats.accepted} (${acceptRate}%) | ` +
    `Rejeitadas: ${stats.rejected} | Média: ${Math.round(stats.averageSimilarity * 100)}%`;
}
