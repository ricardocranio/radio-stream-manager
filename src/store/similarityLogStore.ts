import { create } from 'zustand';

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

export const useSimilarityLogStore = create<SimilarityLogState>((set) => ({
  logs: [],
  stats: { ...initialStats },

  addLog: (entry) =>
    set((state) => {
      const newEntry: SimilarityLogEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
      };

      const newLogs = [newEntry, ...state.logs].slice(0, 500); // Keep last 500

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

      // Calculate average similarity (only for matches found)
      const matchLogs = newLogs.filter(l => l.similarity > 0);
      if (matchLogs.length > 0) {
        newStats.averageSimilarity = matchLogs.reduce((sum, l) => sum + l.similarity, 0) / matchLogs.length;
      }

      // Log to console with detailed info
      const thresholdPercent = Math.round(entry.threshold * 100);
      const similarityPercent = Math.round(entry.similarity * 100);
      
      if (entry.accepted) {
        console.log(
          `[SIMILARITY] ✅ ACEITA: ${entry.artist} - ${entry.title} → ${entry.matchedFilename} (${similarityPercent}% ≥ ${thresholdPercent}%)`
        );
      } else if (entry.reason === 'below_threshold') {
        console.log(
          `[SIMILARITY] ❌ REJEITADA (abaixo threshold): ${entry.artist} - ${entry.title} → ${entry.matchedFilename} (${similarityPercent}% < ${thresholdPercent}%)`
        );
      } else if (entry.reason === 'no_match') {
        console.log(
          `[SIMILARITY] ⚠️ SEM MATCH: ${entry.artist} - ${entry.title} (nenhum arquivo similar encontrado)`
        );
      } else {
        console.log(
          `[SIMILARITY] 🔴 ERRO: ${entry.artist} - ${entry.title}`
        );
      }

      // Log summary every 10 checks
      if (newStats.totalChecked % 10 === 0) {
        const acceptRate = newStats.totalChecked > 0 
          ? Math.round((newStats.accepted / newStats.totalChecked) * 100) 
          : 0;
        console.log(
          `[SIMILARITY] 📊 Resumo: ${newStats.accepted}/${newStats.totalChecked} aceitas (${acceptRate}%) | ` +
          `Rejeitadas: ${newStats.rejected} (${newStats.belowThreshold} abaixo threshold, ${newStats.noMatch} sem match) | ` +
          `Média similaridade: ${Math.round(newStats.averageSimilarity * 100)}%`
        );
      }

      return { logs: newLogs, stats: newStats };
    }),

  clearLogs: () => set({ logs: [] }),
  
  resetStats: () => set({ stats: { ...initialStats } }),
}));

// Helper to get formatted stats
export function getSimilarityStatsText(stats: SimilarityLogState['stats']): string {
  const acceptRate = stats.totalChecked > 0 
    ? Math.round((stats.accepted / stats.totalChecked) * 100) 
    : 0;
  
  return `Verificadas: ${stats.totalChecked} | Aceitas: ${stats.accepted} (${acceptRate}%) | ` +
    `Rejeitadas: ${stats.rejected} | Média: ${Math.round(stats.averageSimilarity * 100)}%`;
}
