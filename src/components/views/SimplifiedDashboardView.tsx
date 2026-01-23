/**
 * Simplified Dashboard View
 * 
 * Uma versão leve do dashboard que mostra apenas:
 * - Status da montagem de grade
 * - Status de downloads
 * - Músicas faltando
 * 
 * Ideal para rodar em segundo plano ou em redes lentas
 */

import { FileText, Download, AlertTriangle, Music, Loader2, CheckCircle2, Clock, Play, Pause, RefreshCw, FolderOpen, Settings2, Minus, Plus } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { useGlobalServices } from '@/contexts/GlobalServicesContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function SimplifiedDashboardView() {
  const { missingSongs, config, deezerConfig } = useRadioStore();
  const { gradeBuilder, downloads } = useGlobalServices();
  
  // Count missing by status
  const pendingDownloads = missingSongs.filter(s => s.status === 'missing').length;
  const downloading = missingSongs.filter(s => s.status === 'downloading').length;
  const downloaded = missingSongs.filter(s => s.status === 'downloaded').length;
  const errors = missingSongs.filter(s => s.status === 'error').length;

  // Handle open grade folder
  const handleOpenGradeFolder = async () => {
    if (window.electronAPI?.openFolder) {
      await window.electronAPI.openFolder(config.gradeFolder);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      {/* Header simplificado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Modo Simplificado</h1>
          <p className="text-sm text-muted-foreground">Sistema operando em segundo plano</p>
        </div>
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Automático
        </Badge>
      </div>

      {/* Grade Builder Status - Compacto */}
      <Card className="glass-card border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 to-transparent">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${gradeBuilder.isBuilding ? 'bg-amber-500/20' : gradeBuilder.isAutoEnabled ? 'bg-emerald-500/20' : 'bg-muted'}`}>
                {gradeBuilder.isBuilding ? (
                  <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                ) : (
                  <FileText className={`w-6 h-6 ${gradeBuilder.isAutoEnabled ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg text-foreground">Grade Automática</span>
                  <Switch 
                    checked={gradeBuilder.isAutoEnabled}
                    onCheckedChange={gradeBuilder.toggleAutoGeneration}
                  />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-muted-foreground">
                    Bloco: <span className="font-mono text-emerald-400">{gradeBuilder.currentBlock}</span>
                    {' → '}
                    <span className="font-mono text-amber-400">{gradeBuilder.nextBlock}</span>
                  </span>
                  {gradeBuilder.isAutoEnabled && gradeBuilder.nextBuildIn > 0 && (
                    <Badge variant="outline" className="text-xs">
                      <Clock className="w-3 h-3 mr-1" />
                      {Math.floor(gradeBuilder.nextBuildIn / 60)}:{(gradeBuilder.nextBuildIn % 60).toString().padStart(2, '0')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Minutes config - compacto */}
            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Antecedência</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => gradeBuilder.setMinutesBeforeBlock(gradeBuilder.minutesBeforeBlock - 1)}
                  disabled={gradeBuilder.minutesBeforeBlock <= 1}
                >
                  <Minus className="w-3 h-3" />
                </Button>
                <span className="font-mono text-sm w-5 text-center text-primary font-bold">{gradeBuilder.minutesBeforeBlock}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => gradeBuilder.setMinutesBeforeBlock(gradeBuilder.minutesBeforeBlock + 1)}
                  disabled={gradeBuilder.minutesBeforeBlock >= 10}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">min</span>
            </div>

            {/* Open folder button */}
            <Button variant="outline" size="sm" onClick={handleOpenGradeFolder} className="gap-2">
              <FolderOpen className="w-4 h-4" />
              Abrir Pasta
            </Button>
          </div>

          {/* Building progress */}
          {gradeBuilder.isBuilding && gradeBuilder.currentProcessingBlock && (
            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">
                  Processando bloco {gradeBuilder.currentProcessingBlock}
                </span>
                <span className="text-xs text-muted-foreground">
                  {gradeBuilder.fullDayProgress}/{gradeBuilder.fullDayTotal}
                </span>
              </div>
              <Progress 
                value={gradeBuilder.fullDayTotal > 0 ? (gradeBuilder.fullDayProgress / gradeBuilder.fullDayTotal) * 100 : 0} 
                className="h-2"
              />
              {gradeBuilder.currentProcessingSong && (
                <p className="text-xs text-muted-foreground mt-2 truncate">
                  🎵 {gradeBuilder.currentProcessingSong}
                </p>
              )}
            </div>
          )}

          {/* Last save info */}
          {gradeBuilder.lastBuildTime && (
            <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              Último salvamento: {formatDistanceToNow(gradeBuilder.lastBuildTime, { addSuffix: true, locale: ptBR })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Downloads Status */}
      <Card className="glass-card border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-5 h-5 text-primary" />
            Downloads Automáticos
            {deezerConfig.autoDownload && (
              <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 text-xs">
                Ativo
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Pending */}
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <span className="text-xs text-muted-foreground">Na fila</span>
              </div>
              <p className="text-2xl font-bold text-amber-500 mt-1">{pendingDownloads}</p>
            </div>
            
            {/* Downloading */}
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center gap-2">
                {downloads.isProcessing ? (
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 text-blue-500" />
                )}
                <span className="text-xs text-muted-foreground">Baixando</span>
              </div>
              <p className="text-2xl font-bold text-blue-500 mt-1">{downloading}</p>
            </div>
            
            {/* Downloaded */}
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-xs text-muted-foreground">Baixadas</span>
              </div>
              <p className="text-2xl font-bold text-emerald-500 mt-1">{downloaded}</p>
            </div>
            
            {/* Errors */}
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-xs text-muted-foreground">Erros</span>
              </div>
              <p className="text-2xl font-bold text-red-500 mt-1">{errors}</p>
            </div>
          </div>

          {/* Current download indicator */}
          {downloads.isProcessing && (
            <div className="mt-3 p-2 bg-muted/50 rounded-lg flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
              <span className="text-sm text-muted-foreground">Processando downloads automaticamente...</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Missing songs quick list - apenas últimas 5 */}
      {missingSongs.filter(s => s.status === 'missing').length > 0 && (
        <Card className="glass-card border-red-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Próximas na Fila
              <Badge variant="destructive" className="ml-auto text-xs">
                {pendingDownloads}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {missingSongs
                .filter(s => s.status === 'missing')
                .slice(0, 5)
                .map((song) => (
                  <div key={song.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                    <Music className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{song.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{song.artist} • {song.station}</p>
                    </div>
                  </div>
                ))}
              {pendingDownloads > 5 && (
                <p className="text-xs text-center text-muted-foreground">
                  +{pendingDownloads - 5} músicas na fila
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status footer */}
      <div className="text-center text-xs text-muted-foreground">
        <p>💡 Sistema funcionando automaticamente em segundo plano</p>
        <p className="mt-1">Mude para o modo completo para acessar todas as configurações</p>
      </div>
    </div>
  );
}
