import { useState, useEffect, useRef } from 'react';
import { Terminal, Play, Pause, Trash2, Download, Filter, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { useCountdown } from '@/hooks/useCountdown';

interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  category: string;
}

const demoLogs: LogEntry[] = [
  { id: '1', timestamp: new Date(), level: 'info', message: '🎵 PGM-FM - PROGRAMAÇÃO ATIVA (V5.1)', category: 'SYSTEM' },
  { id: '2', timestamp: new Date(), level: 'info', message: '📝 Grade: C:\\Playlist\\pgm\\Grades', category: 'SYSTEM' },
  { id: '3', timestamp: new Date(), level: 'info', message: 'Iniciando primeira varredura do sistema...', category: 'SYSTEM' },
  { id: '4', timestamp: new Date(), level: 'info', message: '🔄 [13:30:00] ATUALIZAÇÃO DA GRADE', category: 'GRADE' },
  { id: '5', timestamp: new Date(), level: 'info', message: '🕒 Montando Bloco 14:00:', category: 'BLOCK' },
  { id: '6', timestamp: new Date(), level: 'success', message: '   1. [BH] ✅ Evidências - Chitãozinho & Xororó.mp3', category: 'SONG' },
  { id: '7', timestamp: new Date(), level: 'success', message: '   2. [BH] ✅ Atrasadinha - Felipe Araújo.mp3', category: 'SONG' },
  { id: '8', timestamp: new Date(), level: 'success', message: '   3. [BH] ✅ Medo Bobo - Maiara & Maraisa.mp3', category: 'SONG' },
  { id: '9', timestamp: new Date(), level: 'success', message: '   4. [BH] ✅ Propaganda - Jorge & Mateus.mp3', category: 'SONG' },
  { id: '10', timestamp: new Date(), level: 'success', message: '   5. [BH] ✅ Péssimo Negócio - Henrique & Juliano.mp3', category: 'SONG' },
  { id: '11', timestamp: new Date(), level: 'success', message: '   6. [BAND] ✅ Deixa Eu Te Amar - Sorriso Maroto.mp3', category: 'SONG' },
  { id: '12', timestamp: new Date(), level: 'success', message: '   7. [BAND] ✅ Sorte - Thiaguinho.mp3', category: 'SONG' },
  { id: '13', timestamp: new Date(), level: 'warning', message: '   8. [BAND] ⚠️ Música não encontrada: Perfect - Ed Sheeran', category: 'MISSING' },
  { id: '14', timestamp: new Date(), level: 'success', message: '   8. [CURADORIA] ✅ Amor Da Sua Cama - Bruno & Marrone.mp3', category: 'SONG' },
  { id: '15', timestamp: new Date(), level: 'success', message: '   9. [BAND] ✅ Fatalmente - Turma do Pagode.mp3', category: 'SONG' },
  { id: '16', timestamp: new Date(), level: 'success', message: '   10. [DISNEY] ✅ Shallow - Lady Gaga.mp3', category: 'SONG' },
  { id: '17', timestamp: new Date(), level: 'info', message: '   [PESCA] ✅ Sucesso: NOTICIA_DA_HORA_14HORAS_SEXTA.mp3', category: 'CONTENT' },
  { id: '18', timestamp: new Date(), level: 'info', message: '🕒 Montando Bloco 14:30:', category: 'BLOCK' },
];

export function LogsView() {
  const { isRunning } = useRadioStore();
  const { nextGradeCountdown, autoCleanCountdown, nextGradeSeconds, autoCleanSeconds } = useCountdown();
  const [logs, setLogs] = useState<LogEntry[]>(demoLogs);
  const [isPaused, setIsPaused] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Simulate real-time logs
  useEffect(() => {
    if (isPaused || !isRunning) return;

    const newLogMessages = [
      { level: 'success' as const, message: `   [BH] ✅ ${['Nova música encontrada', 'Processando playlist', 'Música adicionada'][Math.floor(Math.random() * 3)]}`, category: 'SONG' },
      { level: 'info' as const, message: `🔍 Verificando emissora ${['BH FM', 'Band FM', 'Disney FM', 'Metropolitana'][Math.floor(Math.random() * 4)]}...`, category: 'SCRAPE' },
      { level: 'success' as const, message: `   [CURADORIA] ✅ Música selecionada do TOP50`, category: 'SONG' },
      { level: 'warning' as const, message: `   ⚠️ Cache de inventário atualizado`, category: 'SYSTEM' },
    ];

    const interval = setInterval(() => {
      const randomLog = newLogMessages[Math.floor(Math.random() * newLogMessages.length)];
      const newEntry: LogEntry = {
        id: Date.now().toString(),
        timestamp: new Date(),
        ...randomLog,
      };
      setLogs((prev) => [...prev.slice(-100), newEntry]);
    }, 3000);

    return () => clearInterval(interval);
  }, [isPaused, isRunning]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch = log.message.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filter === 'all' || log.level === filter || log.category === filter;
    return matchesSearch && matchesFilter;
  });

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'success':
        return 'text-success';
      case 'warning':
        return 'text-warning';
      case 'error':
        return 'text-destructive';
      default:
        return 'text-foreground';
    }
  };

  const handleClear = () => setLogs([]);

  const handleExportLogs = () => {
    const content = logs
      .map((log) => `[${log.timestamp.toISOString()}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pgm-fm-logs-${new Date().toISOString().split('T')[0]}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = {
    total: logs.length,
    success: logs.filter((l) => l.level === 'success').length,
    warnings: logs.filter((l) => l.level === 'warning').length,
    errors: logs.filter((l) => l.level === 'error').length,
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Logs do Sistema</h2>
          <p className="text-muted-foreground">Monitoramento em tempo real das operações</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setIsPaused(!isPaused)}>
            {isPaused ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
            {isPaused ? 'Retomar' : 'Pausar'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportLogs}>
            <Download className="w-4 h-4 mr-2" />
            Exportar
          </Button>
          <Button variant="destructive" size="sm" onClick={handleClear}>
            <Trash2 className="w-4 h-4 mr-2" />
            Limpar
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <Badge variant="secondary" className="font-mono">{stats.total}</Badge>
          </CardContent>
        </Card>
        <Card className="glass-card border-success/20">
          <CardContent className="p-4 flex items-center justify-between">
            <span className="text-sm text-success">Sucesso</span>
            <Badge className="bg-success/20 text-success border-success/30 font-mono">{stats.success}</Badge>
          </CardContent>
        </Card>
        <Card className="glass-card border-warning/20">
          <CardContent className="p-4 flex items-center justify-between">
            <span className="text-sm text-warning">Avisos</span>
            <Badge className="bg-warning/20 text-warning border-warning/30 font-mono">{stats.warnings}</Badge>
          </CardContent>
        </Card>
        <Card className="glass-card border-destructive/20">
          <CardContent className="p-4 flex items-center justify-between">
            <span className="text-sm text-destructive">Erros</span>
            <Badge className="bg-destructive/20 text-destructive border-destructive/30 font-mono">{stats.errors}</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Terminal */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Terminal className="w-4 h-4 text-primary" />
              <span className="font-mono">pgm-fm.log</span>
              {isRunning && !isPaused && (
                <Badge className="bg-success/20 text-success border-success/30 text-xs animate-pulse">
                  AO VIVO
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="auto-scroll"
                  checked={autoScroll}
                  onCheckedChange={setAutoScroll}
                  className="scale-75"
                />
                <Label htmlFor="auto-scroll" className="text-xs text-muted-foreground">
                  Auto-scroll
                </Label>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input
                  placeholder="Filtrar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-7 w-40 pl-7 text-xs"
                />
              </div>
              <div className="flex gap-1">
                {['all', 'success', 'warning', 'error'].map((f) => (
                  <Button
                    key={f}
                    variant={filter === f ? 'default' : 'ghost'}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? 'Todos' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={scrollRef}
            className="h-[500px] overflow-y-auto bg-background/50 font-mono text-sm"
          >
            <div className="p-4 space-y-1">
              {/* ASCII Header */}
              <pre className="text-primary text-xs mb-4">
{`╔════════════════════════════════════════════════════════════╗
║  🎵 PGM-FM - Sistema de Programação Musical v5.1           ║
║  Programador Rádio - Interface Gráfica                     ║
╚════════════════════════════════════════════════════════════╝`}
              </pre>
              
              {filteredLogs.map((log) => (
                <div key={log.id} className="flex gap-2 hover:bg-secondary/30 px-2 py-0.5 rounded animate-fade-in">
                  <span className="text-muted-foreground text-xs shrink-0">
                    [{log.timestamp.toLocaleTimeString('pt-BR')}]
                  </span>
                  <span className={`${getLevelColor(log.level)} whitespace-pre-wrap break-all`}>
                    {log.message}
                  </span>
                </div>
              ))}
              
              {/* Blinking cursor */}
              {isRunning && !isPaused && (
                <div className="flex items-center gap-1 text-primary">
                  <span className="animate-pulse">▊</span>
                </div>
              )}
            </div>
          </div>

          {/* Status Bar */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-secondary/30 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className={nextGradeSeconds <= 60 ? 'text-amber-500 animate-pulse font-medium' : ''}>
                🕒 Próxima: {nextGradeCountdown}
              </span>
              <span className={autoCleanSeconds <= 60 ? 'text-amber-500 animate-pulse font-medium' : ''}>
                🧹 Clean: {autoCleanCountdown}
              </span>
            </div>
            <span>{isRunning ? 'Sistema Ativo ✅' : 'Sistema Parado ⏸️'}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
