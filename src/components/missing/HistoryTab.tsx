/**
 * HistoryTab - Sub-component for the download history tab
 * Handles: stats cards, failed retry, history list with pagination
 */
import { Download, CheckCircle, XCircle, TrendingUp, Clock, History, RotateCcw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { DownloadHistoryEntry } from '@/store/radioStore';

interface HistoryTabProps {
  downloadHistory: DownloadHistoryEntry[];
  stats: { total: number; success: number; failed: number; successRate: number };
  failedDownloads: DownloadHistoryEntry[];
  onRetry: (entry: DownloadHistoryEntry) => void;
  onRetryAll: () => void;
  onClearHistory: () => void;
  batchIsRunning: boolean;
  deemixInstalled: boolean | null;
}

export function HistoryTab({
  downloadHistory, stats, failedDownloads,
  onRetry, onRetryAll, onClearHistory,
  batchIsRunning, deemixInstalled,
}: HistoryTabProps) {
  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Download className="w-8 h-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total Downloads</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card border-green-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{stats.success}</p>
                <p className="text-xs text-muted-foreground">Sucesso</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card border-destructive/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <XCircle className="w-8 h-8 text-destructive" />
              <div>
                <p className="text-2xl font-bold">{stats.failed}</p>
                <p className="text-xs text-muted-foreground">Falhas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card border-blue-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{stats.successRate}%</p>
                <p className="text-xs text-muted-foreground">Taxa de Sucesso</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Retry Failed Card */}
      {failedDownloads.length > 0 && (
        <Card className="glass-card border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-destructive/20 flex items-center justify-center">
                  <RotateCcw className="w-6 h-6 text-destructive" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Downloads com Falha</h3>
                  <p className="text-sm text-muted-foreground">
                    {failedDownloads.length} downloads falharam. Tente novamente.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={onRetryAll}
                disabled={batchIsRunning || deemixInstalled === false}
                className="gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Retry Todos ({failedDownloads.length})
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History List */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Histórico de Downloads
          </CardTitle>
          {downloadHistory.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Limpar Histórico
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Limpar histórico de downloads?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação não pode ser desfeita. Todo o histórico de {downloadHistory.length} downloads será removido.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onClearHistory}>Limpar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {downloadHistory.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                <History className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">Nenhum download ainda</h3>
              <p className="text-muted-foreground mt-2">O histórico de downloads aparecerá aqui.</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="divide-y divide-border">
                {downloadHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className={`p-4 flex items-center justify-between hover:bg-secondary/30 transition-colors ${
                      entry.status === 'success' ? 'bg-green-500/5' : 'bg-destructive/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        entry.status === 'success' ? 'bg-green-500/10' : 'bg-destructive/10'
                      }`}>
                        {entry.status === 'success' ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (
                          <XCircle className="w-5 h-5 text-destructive" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{entry.title}</p>
                        <p className="text-sm text-muted-foreground truncate">{entry.artist}</p>
                        {entry.errorMessage && (
                          <p className="text-xs text-destructive truncate mt-1">{entry.errorMessage}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(entry.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div>{new Date(entry.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</div>
                        {entry.duration && <div className="text-[10px]">{Math.round(entry.duration / 1000)}s</div>}
                      </div>
                      {entry.status === 'error' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRetry(entry)}
                          disabled={batchIsRunning || deemixInstalled === false}
                          title="Tentar novamente"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
