import { useState, useEffect, useRef } from 'react';
import { Radio, Download, Trash2, Play, Pause, Clock, FolderOpen, AlertTriangle, CheckCircle, XCircle, RefreshCw, Settings2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore } from '@/store/radioStore';

interface VozBrasilConfig {
  enabled: boolean;
  downloadFolder: string;
  scheduleTime: string; // "HH:MM"
  retryIntervalMinutes: number;
  maxRetries: number;
  cleanupTime: string; // "HH:MM"
}

interface DownloadStatus {
  status: 'idle' | 'downloading' | 'success' | 'error' | 'retrying';
  lastAttempt: Date | null;
  attempts: number;
  errorMessage?: string;
  fileSize?: number;
  progress: number;
}

const defaultConfig: VozBrasilConfig = {
  enabled: true,
  downloadFolder: 'C:\\Playlist\\A Voz do Brasil',
  scheduleTime: '20:35',
  retryIntervalMinutes: 3,
  maxRetries: 5,
  cleanupTime: '23:59',
};

export function VozBrasilView() {
  const { toast } = useToast();
  const [config, setConfig] = useState<VozBrasilConfig>(() => {
    const saved = localStorage.getItem('vozBrasilConfig');
    return saved ? JSON.parse(saved) : defaultConfig;
  });
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({
    status: 'idle',
    lastAttempt: null,
    attempts: 0,
    progress: 0,
  });
  const [downloadHistory, setDownloadHistory] = useState<Array<{
    date: string;
    status: 'success' | 'error';
    fileSize?: number;
    attempts: number;
  }>>([]);
  const [nextDownload, setNextDownload] = useState<string>('');
  const [nextCleanup, setNextCleanup] = useState<string>('');
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const schedulerRef = useRef<NodeJS.Timeout | null>(null);

  // Save config to localStorage
  useEffect(() => {
    localStorage.setItem('vozBrasilConfig', JSON.stringify(config));
  }, [config]);

  // Calculate next download/cleanup times and schedule automatic download
  useEffect(() => {
    const isWeekday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;
    
    const getNextDownloadTime = () => {
      const now = new Date();
      const [scheduleHour, scheduleMinute] = config.scheduleTime.split(':').map(Number);
      
      const nextDl = new Date(now);
      nextDl.setHours(scheduleHour, scheduleMinute, 0, 0);
      
      if (nextDl <= now || !isWeekday(nextDl)) {
        nextDl.setDate(nextDl.getDate() + 1);
        while (!isWeekday(nextDl)) {
          nextDl.setDate(nextDl.getDate() + 1);
        }
      }
      
      return nextDl;
    };
    
    const updateTimes = () => {
      const now = new Date();
      const [cleanupHour, cleanupMinute] = config.cleanupTime.split(':').map(Number);
      
      // Next download
      const nextDl = getNextDownloadTime();
      const diffDl = nextDl.getTime() - now.getTime();
      const hoursDl = Math.floor(diffDl / (1000 * 60 * 60));
      const minutesDl = Math.floor((diffDl % (1000 * 60 * 60)) / (1000 * 60));
      setNextDownload(`${hoursDl}h ${minutesDl}min`);
      
      // Next cleanup
      const nextCl = new Date(now);
      nextCl.setHours(cleanupHour, cleanupMinute, 0, 0);
      if (nextCl <= now) {
        nextCl.setDate(nextCl.getDate() + 1);
      }
      const diffCl = nextCl.getTime() - now.getTime();
      const hoursCl = Math.floor(diffCl / (1000 * 60 * 60));
      const minutesCl = Math.floor((diffCl % (1000 * 60 * 60)) / (1000 * 60));
      setNextCleanup(`${hoursCl}h ${minutesCl}min`);
    };

    updateTimes();
    const updateInterval = setInterval(updateTimes, 60000);

    // Automatic scheduler for download (only in Electron and if enabled)
    const scheduleNextDownload = () => {
      if (!config.enabled || !window.electronAPI?.downloadVozBrasil) {
        return;
      }

      const now = new Date();
      const nextDl = getNextDownloadTime();
      const msUntilDownload = nextDl.getTime() - now.getTime();

      console.log(`[VOZ-SCHEDULER] Next scheduled download in ${Math.round(msUntilDownload / 60000)} minutes`);

      // Clear existing scheduler
      if (schedulerRef.current) {
        clearTimeout(schedulerRef.current);
      }

      // Schedule the download (max timeout is ~24 days, so this is fine for daily scheduling)
      if (msUntilDownload > 0 && msUntilDownload < 86400000) { // Only schedule if within 24h
        schedulerRef.current = setTimeout(() => {
          console.log('[VOZ-SCHEDULER] ⏰ Scheduled download triggered!');
          
          // Check again if it's a weekday and enabled
          const currentDay = new Date().getDay();
          if (config.enabled && currentDay >= 1 && currentDay <= 5) {
            toast({
              title: '📻 A Voz do Brasil',
              description: 'Iniciando download automático programado...',
            });
            performDownload();
          }
          
          // Schedule next download
          setTimeout(scheduleNextDownload, 60000); // Wait 1 min before scheduling next
        }, msUntilDownload);
      }
    };

    // Start scheduler
    scheduleNextDownload();

    return () => {
      clearInterval(updateInterval);
      if (schedulerRef.current) {
        clearTimeout(schedulerRef.current);
      }
    };
  }, [config.scheduleTime, config.cleanupTime, config.enabled]);

  // Generate download URL with current date
  const getDownloadUrl = () => {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    return `https://radiogov.ebc.com.br/programas/a-voz-do-brasil-download/${day}-${month}-${year}/@@download/file`;
  };

  // Generate filename with current date
  const getFilename = () => {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    return `VozDoBrasil_${day}-${month}-${year}.mp3`;
  };

  // Listen for download progress (Electron only)
  useEffect(() => {
    if (window.electronAPI?.onVozDownloadProgress) {
      window.electronAPI.onVozDownloadProgress((progressData) => {
        console.log('[VOZ] Progress:', progressData);
        setDownloadStatus(prev => ({
          ...prev,
          progress: progressData.progress,
        }));
      });
    }
  }, []);

  // Perform real download (Electron) or simulated (web)
  const performDownload = async (isRetry: boolean = false) => {
    const currentAttempts = isRetry ? downloadStatus.attempts + 1 : 1;
    
    setDownloadStatus({
      status: isRetry ? 'retrying' : 'downloading',
      lastAttempt: new Date(),
      attempts: currentAttempts,
      progress: 0,
    });

    const url = getDownloadUrl();
    const filename = getFilename();

    try {
      // Check if running in Electron
      if (window.electronAPI?.downloadVozBrasil) {
        console.log('[VOZ] Starting Electron download...');
        console.log('[VOZ] URL:', url);
        console.log('[VOZ] Folder:', config.downloadFolder);
        console.log('[VOZ] Filename:', filename);
        
        const result = await window.electronAPI.downloadVozBrasil({
          url,
          outputFolder: config.downloadFolder,
          filename,
        });

        console.log('[VOZ] Download result:', result);

        if (result.success) {
          setDownloadStatus({
            status: 'success',
            lastAttempt: new Date(),
            attempts: currentAttempts,
            fileSize: result.fileSize,
            progress: 100,
          });

          setDownloadHistory(prev => [{
            date: new Date().toLocaleDateString('pt-BR'),
            status: 'success',
            fileSize: result.fileSize,
            attempts: currentAttempts,
          }, ...prev.slice(0, 9)]);

          toast({
            title: '✅ Download concluído!',
            description: `A Voz do Brasil foi salva em ${config.downloadFolder}`,
          });
        } else {
          throw new Error(result.error || 'Erro desconhecido no download');
        }
      } else {
        // Web simulation fallback
        console.log('[VOZ] Web mode - simulating download...');
        for (let i = 0; i <= 100; i += 10) {
          await new Promise(resolve => setTimeout(resolve, 200));
          setDownloadStatus(prev => ({ ...prev, progress: i }));
        }

        toast({
          title: '⚠️ Modo Web',
          description: 'Download real disponível apenas no aplicativo desktop.',
          variant: 'destructive',
        });
        
        setDownloadStatus({
          status: 'error',
          lastAttempt: new Date(),
          attempts: currentAttempts,
          errorMessage: 'Use o aplicativo desktop para download real',
          progress: 0,
        });
      }
    } catch (error) {
      console.error('[VOZ] Download error:', error);
      
      if (currentAttempts < config.maxRetries) {
        setDownloadStatus(prev => ({
          ...prev,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
        }));

        toast({
          title: '⚠️ Falha no download',
          description: `Tentativa ${currentAttempts}/${config.maxRetries}. Próxima tentativa em ${config.retryIntervalMinutes} minutos.`,
          variant: 'destructive',
        });

        // Schedule retry
        retryTimeoutRef.current = setTimeout(() => {
          performDownload(true);
        }, config.retryIntervalMinutes * 60 * 1000);
      } else {
        setDownloadStatus({
          status: 'error',
          lastAttempt: new Date(),
          attempts: currentAttempts,
          errorMessage: 'Máximo de tentativas atingido',
          progress: 0,
        });

        setDownloadHistory(prev => [{
          date: new Date().toLocaleDateString('pt-BR'),
          status: 'error',
          attempts: currentAttempts,
        }, ...prev.slice(0, 9)]);

        toast({
          title: '❌ Download falhou',
          description: `Todas as ${config.maxRetries} tentativas falharam.`,
          variant: 'destructive',
        });
      }
    }
  };

  const handleManualDownload = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    setDownloadStatus({
      status: 'idle',
      lastAttempt: null,
      attempts: 0,
      progress: 0,
    });
    performDownload();
  };

  const handleCancelDownload = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    setDownloadStatus({
      status: 'idle',
      lastAttempt: null,
      attempts: 0,
      progress: 0,
    });
    toast({ title: 'Download cancelado' });
  };

  const handleCleanup = async () => {
    if (window.electronAPI?.cleanupVozBrasil) {
      try {
        const result = await window.electronAPI.cleanupVozBrasil({
          folder: config.downloadFolder,
          maxAgeDays: 7, // Delete files older than 7 days
        });
        
        if (result.success) {
          toast({
            title: '🗑️ Limpeza executada',
            description: result.deletedCount && result.deletedCount > 0
              ? `${result.deletedCount} arquivo(s) antigo(s) removido(s).`
              : 'Nenhum arquivo antigo encontrado.',
          });
        } else {
          toast({
            title: '❌ Erro na limpeza',
            description: result.error || 'Erro desconhecido',
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('[VOZ] Cleanup error:', error);
        toast({
          title: '❌ Erro na limpeza',
          description: 'Erro ao executar limpeza',
          variant: 'destructive',
        });
      }
    } else {
      toast({
        title: '⚠️ Modo web',
        description: 'Limpeza disponível apenas no aplicativo desktop.',
      });
    }
  };

  const handleSelectFolder = async () => {
    if (typeof window !== 'undefined' && window.electronAPI?.selectFolder) {
      try {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
          setConfig(prev => ({ ...prev, downloadFolder: folder }));
          toast({ title: 'Pasta selecionada', description: folder });
        }
      } catch (error) {
        console.error('Error selecting folder:', error);
      }
    } else {
      toast({
        title: 'Modo web',
        description: 'Seleção de pasta disponível apenas no aplicativo desktop.',
      });
    }
  };

  const isWeekday = () => {
    const day = new Date().getDay();
    return day >= 1 && day <= 5;
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Radio className="w-7 h-7 text-green-500" />
            A Voz do Brasil
          </h2>
          <p className="text-muted-foreground">Download automático do programa obrigatório (Seg-Sex 20:35)</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={config.enabled ? 'default' : 'secondary'} className={config.enabled ? 'bg-green-500/20 text-green-400 border-green-500/30' : ''}>
            {config.enabled ? '● Ativo' : '○ Inativo'}
          </Badge>
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) => setConfig(prev => ({ ...prev, enabled }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status Card */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" />
              Status do Download
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {/* Current Status */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
              <div className="flex items-center gap-4">
                {downloadStatus.status === 'idle' && (
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                    <Clock className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                {downloadStatus.status === 'downloading' && (
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
                    <Download className="w-6 h-6 text-primary" />
                  </div>
                )}
                {downloadStatus.status === 'retrying' && (
                  <div className="w-12 h-12 rounded-full bg-warning/20 flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 text-warning animate-spin" />
                  </div>
                )}
                {downloadStatus.status === 'success' && (
                  <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-success" />
                  </div>
                )}
                {downloadStatus.status === 'error' && (
                  <div className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center">
                    <XCircle className="w-6 h-6 text-destructive" />
                  </div>
                )}
                <div>
                  <p className="font-medium text-foreground">
                    {downloadStatus.status === 'idle' && 'Aguardando horário programado'}
                    {downloadStatus.status === 'downloading' && 'Baixando...'}
                    {downloadStatus.status === 'retrying' && `Tentando novamente (${downloadStatus.attempts}/${config.maxRetries})`}
                    {downloadStatus.status === 'success' && 'Download concluído!'}
                    {downloadStatus.status === 'error' && (downloadStatus.attempts >= config.maxRetries ? 'Todas as tentativas falharam' : 'Erro - Aguardando retry')}
                  </p>
                  {downloadStatus.lastAttempt && (
                    <p className="text-xs text-muted-foreground">
                      Última tentativa: {downloadStatus.lastAttempt.toLocaleTimeString('pt-BR')}
                    </p>
                  )}
                  {downloadStatus.status === 'success' && downloadStatus.fileSize && (
                    <p className="text-xs text-success">
                      Tamanho: {(downloadStatus.fileSize / 1024 / 1024).toFixed(1)} MB
                    </p>
                  )}
                  {downloadStatus.status === 'error' && downloadStatus.errorMessage && (
                    <p className="text-xs text-destructive">{downloadStatus.errorMessage}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {(downloadStatus.status === 'idle' || downloadStatus.status === 'success' || downloadStatus.status === 'error') && (
                  <Button onClick={handleManualDownload} className="gap-2">
                    <Download className="w-4 h-4" />
                    Baixar Agora
                  </Button>
                )}
                {(downloadStatus.status === 'downloading' || downloadStatus.status === 'retrying') && (
                  <Button variant="destructive" onClick={handleCancelDownload} className="gap-2">
                    <XCircle className="w-4 h-4" />
                    Cancelar
                  </Button>
                )}
              </div>
            </div>

            {/* Progress */}
            {(downloadStatus.status === 'downloading' || downloadStatus.status === 'retrying') && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progresso</span>
                  <span className="font-mono">{downloadStatus.progress}%</span>
                </div>
                <Progress value={downloadStatus.progress} className="h-2" />
              </div>
            )}

            {/* URL Preview */}
            <div className="p-3 rounded-lg bg-background/50 border border-border">
              <p className="text-xs text-muted-foreground mb-1">URL de hoje:</p>
              <code className="text-xs text-primary break-all">{getDownloadUrl()}</code>
            </div>

            {/* Schedule Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
                <div className="flex items-center gap-2 text-green-400 mb-2">
                  <Clock className="w-4 h-4" />
                  <span className="text-xs font-medium">Próximo Download</span>
                </div>
                <p className="font-mono font-bold text-foreground">{nextDownload}</p>
                <p className="text-xs text-muted-foreground">
                  {isWeekday() ? 'Hoje' : 'Próximo dia útil'} às {config.scheduleTime}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                <div className="flex items-center gap-2 text-destructive mb-2">
                  <Trash2 className="w-4 h-4" />
                  <span className="text-xs font-medium">Próxima Limpeza</span>
                </div>
                <p className="font-mono font-bold text-foreground">{nextCleanup}</p>
                <p className="text-xs text-muted-foreground">Às {config.cleanupTime}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Config Card */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              Configurações
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {/* Download Folder */}
            <div>
              <Label className="text-xs">Pasta de Download</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={config.downloadFolder}
                  onChange={(e) => setConfig(prev => ({ ...prev, downloadFolder: e.target.value }))}
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="icon" onClick={handleSelectFolder}>
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Schedule Time */}
            <div>
              <Label className="text-xs">Horário do Download</Label>
              <Input
                type="time"
                value={config.scheduleTime}
                onChange={(e) => setConfig(prev => ({ ...prev, scheduleTime: e.target.value }))}
                className="mt-1 font-mono"
              />
            </div>

            {/* Retry Config */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Intervalo Retry (min)</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={config.retryIntervalMinutes}
                  onChange={(e) => setConfig(prev => ({ ...prev, retryIntervalMinutes: parseInt(e.target.value) || 3 }))}
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <Label className="text-xs">Máx. Tentativas</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={config.maxRetries}
                  onChange={(e) => setConfig(prev => ({ ...prev, maxRetries: parseInt(e.target.value) || 5 }))}
                  className="mt-1 font-mono"
                />
              </div>
            </div>

            {/* Cleanup Time */}
            <div>
              <Label className="text-xs">Horário da Limpeza</Label>
              <Input
                type="time"
                value={config.cleanupTime}
                onChange={(e) => setConfig(prev => ({ ...prev, cleanupTime: e.target.value }))}
                className="mt-1 font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Apaga arquivos antigos automaticamente
              </p>
            </div>

            <Button variant="outline" className="w-full gap-2" onClick={handleCleanup}>
              <Trash2 className="w-4 h-4" />
              Limpar Agora
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-sm">Histórico de Downloads</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {downloadHistory.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Radio className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Nenhum download registrado ainda</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {downloadHistory.map((entry, index) => (
                <div key={index} className="p-4 flex items-center justify-between hover:bg-secondary/20">
                  <div className="flex items-center gap-3">
                    {entry.status === 'success' ? (
                      <CheckCircle className="w-5 h-5 text-success" />
                    ) : (
                      <XCircle className="w-5 h-5 text-destructive" />
                    )}
                    <div>
                      <p className="font-medium text-foreground">{entry.date}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.attempts} tentativa{entry.attempts !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={entry.status === 'success' ? 'default' : 'destructive'} className={entry.status === 'success' ? 'bg-success/20 text-success' : ''}>
                      {entry.status === 'success' ? 'Sucesso' : 'Falhou'}
                    </Badge>
                    {entry.fileSize && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {(entry.fileSize / 1024 / 1024).toFixed(1)} MB
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
