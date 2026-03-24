/**
 * useHistoryTabState - Manages download history pagination, filtering and batch retry
 */
import { useMemo, useCallback } from 'react';
import { useRadioStore, DownloadHistoryEntry, getDownloadStats } from '@/store/radioStore';
import { useToast } from '@/hooks/use-toast';

export function useHistoryTabState() {
  const { downloadHistory, clearDownloadHistory } = useRadioStore();
  const { toast } = useToast();

  const stats = useMemo(() => getDownloadStats(), [downloadHistory]);

  const failedDownloads = useMemo(() =>
    downloadHistory.filter(e => e.status === 'error'),
    [downloadHistory]
  );

  const successDownloads = useMemo(() =>
    downloadHistory.filter(e => e.status === 'success'),
    [downloadHistory]
  );

  const handleClearHistory = useCallback(() => {
    clearDownloadHistory();
    toast({ title: '🗑️ Histórico limpo', description: 'Todo o histórico de downloads foi removido.' });
  }, [clearDownloadHistory, toast]);

  return {
    downloadHistory,
    stats,
    failedDownloads,
    successDownloads,
    handleClearHistory,
  };
}
