import { useState, useEffect, useCallback, useRef } from 'react';
import { Terminal, Play, Square, RotateCw, Radio, Loader2, Clock, Music, FolderOpen, Settings2, Check, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

type MonitorStatus = {
  running: boolean;
  installing?: boolean;
  message?: string;
  error?: string;
  exitCode?: number;
  pid?: number | null;
};

export function RadioMonitorCard() {
  const [status, setStatus] = useState<MonitorStatus>({ running: false });
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [uptimeStart, setUptimeStart] = useState<number | null>(null);
  const [uptimeText, setUptimeText] = useState('');
  const [showPathConfig, setShowPathConfig] = useState(false);
  const [scriptPath, setScriptPath] = useState('');
  const [scriptPathInfo, setScriptPathInfo] = useState<{ path: string; customPath: string | null; exists: boolean } | null>(null);
  const [pathSaving, setPathSaving] = useState(false);
  const { toast } = useToast();
  const isElectron = !!window.electronAPI;

  // Load script path info on mount
  useEffect(() => {
    if (!window.electronAPI?.getRadioMonitorScriptPath) return;
    window.electronAPI.getRadioMonitorScriptPath().then((info) => {
      setScriptPathInfo(info);
      setScriptPath(info.customPath || '');
    });
  }, []);

  // Poll status on mount
  useEffect(() => {
    if (!window.electronAPI?.getRadioMonitorStatus) return;
    const fetchStatus = async () => {
      try {
        const s = await window.electronAPI!.getRadioMonitorStatus();
        setStatus(prev => ({ ...prev, running: s.running, pid: s.pid }));
      } catch { /* ignore */ }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  // Listen to status events
  useEffect(() => {
    if (!window.electronAPI?.onRadioMonitorStatus) return;
    window.electronAPI.onRadioMonitorStatus((s) => {
      setStatus(s);
      setIsActing(false);
      if (s.running && !uptimeStart) {
        setUptimeStart(Date.now());
        setCaptureCount(0);
      } else if (!s.running) {
        setUptimeStart(null);
      }
      if (s.error) {
        toast({ title: '⚠️ Radio Monitor', description: s.error, variant: 'destructive' });
      }
    });
  }, [toast, uptimeStart]);

  // Listen to log events & count captures
  useEffect(() => {
    if (!window.electronAPI?.onRadioMonitorLog) return;
    window.electronAPI.onRadioMonitorLog((log) => {
      setLogs(prev => [...prev.slice(-100), log]);
      if (log.includes('☁️') || log.includes('Enviado para Supabase')) {
        setCaptureCount(prev => prev + 1);
      }
    });
  }, []);

  // Track uptime when running
  useEffect(() => {
    if (status.running && !uptimeStart) {
      setUptimeStart(Date.now());
    }
  }, [status.running, uptimeStart]);

  // Update uptime text every 30s
  useEffect(() => {
    if (!uptimeStart || !status.running) {
      setUptimeText('');
      return;
    }
    const update = () => {
      const elapsed = Math.floor((Date.now() - uptimeStart) / 1000);
      if (elapsed < 60) {
        setUptimeText(`${elapsed}s`);
      } else if (elapsed < 3600) {
        setUptimeText(`${Math.floor(elapsed / 60)}min`);
      } else {
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        setUptimeText(`${h}h${m.toString().padStart(2, '0')}min`);
      }
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [uptimeStart, status.running]);

  const handleStart = useCallback(async () => {
    setIsActing(true);
    setCaptureCount(0);
    setUptimeStart(Date.now());
    try {
      await window.electronAPI!.startRadioMonitor();
      toast({ title: '▶️ Radio Monitor', description: 'Iniciando monitor...' });
    } catch { setIsActing(false); }
  }, [toast]);

  const handleStop = useCallback(async () => {
    setIsActing(true);
    setUptimeStart(null);
    try {
      await window.electronAPI!.stopRadioMonitor();
      toast({ title: '⏹ Radio Monitor', description: 'Monitor parado.' });
    } catch { setIsActing(false); }
  }, [toast]);

  const handleRestart = useCallback(async () => {
    setIsActing(true);
    setCaptureCount(0);
    setUptimeStart(Date.now());
    try {
      await window.electronAPI!.restartRadioMonitor();
      toast({ title: '🔄 Radio Monitor', description: 'Reiniciando monitor...' });
    } catch { setIsActing(false); }
  }, [toast]);

  const handleBrowseScript = useCallback(async () => {
    if (!window.electronAPI?.browseRadioMonitorScript) return;
    const result = await window.electronAPI.browseRadioMonitorScript();
    if (!result.canceled && result.path) {
      setScriptPath(result.path);
    }
  }, []);

  const handleSavePath = useCallback(async () => {
    if (!window.electronAPI?.setRadioMonitorScriptPath) return;
    setPathSaving(true);
    try {
      const result = await window.electronAPI.setRadioMonitorScriptPath(scriptPath || null);
      if (result.success) {
        toast({ title: '✅ Caminho salvo', description: scriptPath ? `Script: ${scriptPath}` : 'Usando caminho padrão' });
        const info = await window.electronAPI.getRadioMonitorScriptPath();
        setScriptPathInfo(info);
      } else {
        toast({ title: '❌ Erro', description: result.error, variant: 'destructive' });
      }
    } finally {
      setPathSaving(false);
    }
  }, [scriptPath, toast]);

  const handleClearPath = useCallback(async () => {
    setScriptPath('');
    if (!window.electronAPI?.setRadioMonitorScriptPath) return;
    const result = await window.electronAPI.setRadioMonitorScriptPath(null);
    if (result.success) {
      const info = await window.electronAPI.getRadioMonitorScriptPath();
      setScriptPathInfo(info);
      toast({ title: '✅ Caminho resetado', description: 'Usando caminho padrão do sistema' });
    }
  }, [toast]);

  if (!isElectron) return null;

  const isInstalling = status.installing;
  const isRunning = status.running;

  return (
    <Card className="glass-card border-teal-500/20 bg-gradient-to-r from-teal-500/5 to-transparent">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
              isInstalling ? 'bg-amber-500/20' : isRunning ? 'bg-teal-500/20' : 'bg-muted'
            }`}>
              {isInstalling ? (
                <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
              ) : isRunning ? (
                <Radio className="w-5 h-5 text-teal-500 animate-pulse" />
              ) : (
                <Radio className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-foreground">Radio Monitor Python</span>
                {isInstalling ? (
                  <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Instalando...
                  </Badge>
                ) : isRunning ? (
                  <Badge className="bg-teal-500/20 text-teal-500 border-teal-500/30">
                    <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse mr-1.5 inline-block" />
                    Rodando
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Parado
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <p className="text-xs text-muted-foreground">
                  {isInstalling 
                    ? (status.message || 'Instalando dependências...')
                    : isRunning 
                      ? 'Scraping via Playwright/Chromium • MyTuner Radio'
                      : status.error || 'Clique em Iniciar para começar o monitoramento'
                  }
                </p>
                {isRunning && (
                  <div className="flex items-center gap-3 text-xs">
                    {uptimeText && (
                      <span className="flex items-center gap-1 text-teal-400">
                        <Clock className="w-3 h-3" />
                        {uptimeText}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-teal-400">
                      <Music className="w-3 h-3" />
                      {captureCount} capturadas
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isRunning ? (
              <Button
                variant="default"
                size="sm"
                onClick={handleStart}
                disabled={isActing || isInstalling}
                className="gap-1.5 bg-teal-600 hover:bg-teal-700"
              >
                {isActing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Iniciar
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStop}
                disabled={isActing}
                className="gap-1.5"
              >
                {isActing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                Parar
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestart}
              disabled={isActing || isInstalling}
              className="gap-1.5"
            >
              <RotateCw className="w-4 h-4" />
              Reiniciar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPathConfig(!showPathConfig)}
              className={`gap-1.5 ${showPathConfig ? 'bg-accent' : ''}`}
              title="Configurar caminho do script"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowLogs(!showLogs)}
              className="gap-1.5"
            >
              <Terminal className="w-4 h-4" />
              Logs
            </Button>
          </div>
        </div>

        {/* Script path configuration */}
        {showPathConfig && (
          <div className="mt-3 rounded-lg bg-background/80 border border-border p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">Caminho do script Python</p>
            <p className="text-xs text-muted-foreground">
              {scriptPathInfo?.exists 
                ? `✅ Atual: ${scriptPathInfo.path}`
                : `❌ Não encontrado: ${scriptPathInfo?.path || 'N/A'}`
              }
              {scriptPathInfo?.customPath && ' (personalizado)'}
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={scriptPath}
                onChange={(e) => setScriptPath(e.target.value)}
                placeholder="Ex: C:\Scripts\radio_monitor_supabase.py"
                className="text-xs h-8 flex-1"
              />
              <Button size="sm" variant="outline" className="h-8 px-2" onClick={handleBrowseScript} title="Procurar arquivo">
                <FolderOpen className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="default" className="h-8 px-2 bg-teal-600 hover:bg-teal-700" onClick={handleSavePath} disabled={pathSaving} title="Salvar">
                {pathSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </Button>
              {scriptPathInfo?.customPath && (
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={handleClearPath} title="Resetar para padrão">
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Logs panel */}
        {showLogs && (
          <div className="mt-3 rounded-lg bg-background/80 border border-border">
            <ScrollArea className="h-40">
              <div className="p-3 font-mono text-xs space-y-0.5">
                {logs.length === 0 ? (
                  <p className="text-muted-foreground italic">Nenhum log ainda...</p>
                ) : (
                  logs.map((log, i) => (
                    <p key={i} className={`${
                      log.includes('✅') || log.includes('✓') ? 'text-green-400' :
                      log.includes('❌') || log.includes('✗') || log.includes('Erro') ? 'text-red-400' :
                      log.includes('⚠️') ? 'text-amber-400' :
                      log.includes('🎵') || log.includes('☁️') ? 'text-teal-400' :
                      'text-muted-foreground'
                    }`}>
                      {log}
                    </p>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}