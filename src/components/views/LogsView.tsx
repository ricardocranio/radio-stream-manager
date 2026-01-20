import { useState, useEffect, useRef } from 'react';
import { Terminal, Play, Pause, Trash2, Download, Search, FileText, AlertCircle, CheckCircle2, SkipForward, Replace, Music, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRadioStore } from '@/store/radioStore';
import { useGradeLogStore, BlockLogEntry, SystemError } from '@/store/gradeLogStore';
import { useCountdown } from '@/hooks/useCountdown';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function LogsView() {
  const { isRunning } = useRadioStore();
  const { blockLogs, systemErrors, clearBlockLogs, clearSystemErrors } = useGradeLogStore();
  const { nextGradeCountdown, autoCleanCountdown, nextGradeSeconds, autoCleanSeconds } = useCountdown();
  
  const [isPaused, setIsPaused] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('blocks');
  const scrollRef = useRef<HTMLDivElement>(null);
  const errorsScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) {
      if (activeTab === 'blocks' && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      if (activeTab === 'errors' && errorsScrollRef.current) {
        errorsScrollRef.current.scrollTop = errorsScrollRef.current.scrollHeight;
      }
    }
  }, [blockLogs, systemErrors, autoScroll, activeTab]);

  // Filter block logs
  const filteredBlockLogs = blockLogs.filter((log) => {
    const matchesSearch = 
      log.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.artist.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.station.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filter === 'all' || log.type === filter;
    return matchesSearch && matchesFilter;
  });

  // Filter system errors
  const filteredErrors = systemErrors.filter((error) => {
    const matchesSearch = 
      error.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      error.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filter === 'all' || error.level === filter;
    return matchesSearch && matchesFilter;
  });

  // Get type icon and color
  const getTypeIcon = (type: BlockLogEntry['type']) => {
    switch (type) {
      case 'used':
        return <CheckCircle2 className="w-4 h-4 text-success" />;
      case 'skipped':
        return <SkipForward className="w-4 h-4 text-amber-500" />;
      case 'substituted':
        return <Replace className="w-4 h-4 text-blue-500" />;
      case 'missing':
        return <AlertTriangle className="w-4 h-4 text-destructive" />;
      case 'fixed':
        return <FileText className="w-4 h-4 text-purple-500" />;
      default:
        return <Music className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getTypeLabel = (type: BlockLogEntry['type']) => {
    switch (type) {
      case 'used': return 'Usada';
      case 'skipped': return 'Pulada';
      case 'substituted': return 'Substituída';
      case 'missing': return 'Faltando';
      case 'fixed': return 'Fixo';
      default: return type;
    }
  };

  const getTypeBadgeClass = (type: BlockLogEntry['type']) => {
    switch (type) {
      case 'used': return 'bg-success/20 text-success border-success/30';
      case 'skipped': return 'bg-amber-500/20 text-amber-500 border-amber-500/30';
      case 'substituted': return 'bg-blue-500/20 text-blue-500 border-blue-500/30';
      case 'missing': return 'bg-destructive/20 text-destructive border-destructive/30';
      case 'fixed': return 'bg-purple-500/20 text-purple-500 border-purple-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getLevelIcon = (level: SystemError['level']) => {
    switch (level) {
      case 'error':
        return <AlertCircle className="w-4 h-4 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      default:
        return <CheckCircle2 className="w-4 h-4 text-primary" />;
    }
  };

  const getLevelBadgeClass = (level: SystemError['level']) => {
    switch (level) {
      case 'error': return 'bg-destructive/20 text-destructive border-destructive/30';
      case 'warning': return 'bg-amber-500/20 text-amber-500 border-amber-500/30';
      default: return 'bg-primary/20 text-primary border-primary/30';
    }
  };

  const handleClear = () => {
    if (activeTab === 'blocks') {
      clearBlockLogs();
    } else {
      clearSystemErrors();
    }
  };

  const handleExportLogs = () => {
    let content = '';
    
    if (activeTab === 'blocks') {
      content = filteredBlockLogs
        .map((log) => `[${format(new Date(log.timestamp), 'HH:mm:ss')}] [${log.blockTime}] [${log.type.toUpperCase()}] ${log.artist} - ${log.title} (${log.station})${log.reason ? ` - ${log.reason}` : ''}`)
        .join('\n');
    } else {
      content = filteredErrors
        .map((error) => `[${format(new Date(error.timestamp), 'HH:mm:ss')}] [${error.level.toUpperCase()}] [${error.category}] ${error.message}${error.details ? ` - ${error.details}` : ''}`)
        .join('\n');
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pgm-fm-${activeTab}-${new Date().toISOString().split('T')[0]}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Stats for block logs
  const blockStats = {
    total: blockLogs.length,
    used: blockLogs.filter((l) => l.type === 'used').length,
    skipped: blockLogs.filter((l) => l.type === 'skipped').length,
    substituted: blockLogs.filter((l) => l.type === 'substituted').length,
    missing: blockLogs.filter((l) => l.type === 'missing').length,
    fixed: blockLogs.filter((l) => l.type === 'fixed').length,
  };

  // Stats for system errors
  const errorStats = {
    total: systemErrors.length,
    errors: systemErrors.filter((e) => e.level === 'error').length,
    warnings: systemErrors.filter((e) => e.level === 'warning').length,
    info: systemErrors.filter((e) => e.level === 'info').length,
  };

  // Group block logs by block time
  const logsByBlock = filteredBlockLogs.reduce((acc, log) => {
    if (!acc[log.blockTime]) {
      acc[log.blockTime] = [];
    }
    acc[log.blockTime].push(log);
    return acc;
  }, {} as Record<string, BlockLogEntry[]>);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground">Logs do Sistema</h2>
          <p className="text-muted-foreground text-sm">Monitoramento detalhado de blocos e erros</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Button variant="outline" size="sm" onClick={() => setIsPaused(!isPaused)}>
            {isPaused ? <Play className="w-4 h-4 sm:mr-2" /> : <Pause className="w-4 h-4 sm:mr-2" />}
            <span className="hidden sm:inline">{isPaused ? 'Retomar' : 'Pausar'}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportLogs}>
            <Download className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Exportar</span>
          </Button>
          <Button variant="destructive" size="sm" onClick={handleClear}>
            <Trash2 className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Limpar</span>
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="blocks" className="gap-2">
            <Music className="w-4 h-4" />
            Blocos Gerados
            {blockStats.total > 0 && (
              <Badge variant="secondary" className="ml-1">{blockStats.total}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="errors" className="gap-2">
            <AlertCircle className="w-4 h-4" />
            Erros do Sistema
            {errorStats.errors > 0 && (
              <Badge variant="destructive" className="ml-1">{errorStats.errors}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Block Logs Tab */}
        <TabsContent value="blocks" className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="glass-card">
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total</span>
                <Badge variant="secondary" className="font-mono text-xs">{blockStats.total}</Badge>
              </CardContent>
            </Card>
            <Card className="glass-card border-success/20">
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-xs text-success">Usadas</span>
                <Badge className="bg-success/20 text-success border-success/30 font-mono text-xs">{blockStats.used}</Badge>
              </CardContent>
            </Card>
            <Card className="glass-card border-amber-500/20">
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-xs text-amber-500">Puladas</span>
                <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 font-mono text-xs">{blockStats.skipped}</Badge>
              </CardContent>
            </Card>
            <Card className="glass-card border-blue-500/20">
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-xs text-blue-500">Substituídas</span>
                <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30 font-mono text-xs">{blockStats.substituted}</Badge>
              </CardContent>
            </Card>
            <Card className="glass-card border-destructive/20">
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-xs text-destructive">Faltando</span>
                <Badge className="bg-destructive/20 text-destructive border-destructive/30 font-mono text-xs">{blockStats.missing}</Badge>
              </CardContent>
            </Card>
            <Card className="glass-card border-purple-500/20">
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-xs text-purple-500">Fixos</span>
                <Badge className="bg-purple-500/20 text-purple-500 border-purple-500/30 font-mono text-xs">{blockStats.fixed}</Badge>
              </CardContent>
            </Card>
          </div>

          {/* Block Logs List */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border py-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Terminal className="w-4 h-4 text-primary" />
                  <span className="font-mono">grade-blocks.log</span>
                  {isRunning && !isPaused && (
                    <Badge className="bg-success/20 text-success border-success/30 text-xs animate-pulse">
                      AO VIVO
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex items-center gap-3 flex-wrap">
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
                  <div className="flex gap-1 flex-wrap">
                    {['all', 'used', 'skipped', 'substituted', 'missing'].map((f) => (
                      <Button
                        key={f}
                        variant={filter === f ? 'default' : 'ghost'}
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setFilter(f)}
                      >
                        {f === 'all' ? 'Todos' : getTypeLabel(f as BlockLogEntry['type'])}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]" ref={scrollRef}>
                <div className="p-4 space-y-4">
                  {Object.keys(logsByBlock).length === 0 ? (
                    <div className="text-center text-muted-foreground py-12">
                      <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
                      <p>Nenhum log de bloco ainda</p>
                      <p className="text-xs mt-2">Os logs aparecerão quando grades forem geradas</p>
                    </div>
                  ) : (
                    Object.entries(logsByBlock)
                      .sort(([a], [b]) => b.localeCompare(a))
                      .map(([blockTime, logs]) => (
                        <div key={blockTime} className="space-y-2">
                          <div className="flex items-center gap-2 sticky top-0 bg-background/95 backdrop-blur py-1 z-10">
                            <Badge variant="outline" className="font-mono text-sm">
                              🕒 {blockTime}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {logs.length} {logs.length === 1 ? 'entrada' : 'entradas'}
                            </span>
                          </div>
                          <div className="space-y-1 pl-4 border-l-2 border-border">
                            {logs.map((log) => (
                              <div
                                key={log.id}
                                className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/30 transition-colors group"
                              >
                                {getTypeIcon(log.type)}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-foreground text-sm truncate">
                                      {log.title}
                                    </span>
                                    <span className="text-muted-foreground text-sm">-</span>
                                    <span className="text-muted-foreground text-sm truncate">
                                      {log.artist}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <Badge variant="outline" className={`text-[10px] ${getTypeBadgeClass(log.type)}`}>
                                      {getTypeLabel(log.type)}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px]">
                                      {log.station}
                                    </Badge>
                                    {log.style && (
                                      <Badge variant="secondary" className="text-[10px]">
                                        {log.style}
                                      </Badge>
                                    )}
                                  </div>
                                  {log.reason && (
                                    <p className="text-xs text-muted-foreground mt-1 italic">
                                      {log.reason}
                                    </p>
                                  )}
                                </div>
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {format(new Date(log.timestamp), 'HH:mm:ss', { locale: ptBR })}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Errors Tab */}
        <TabsContent value="errors" className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <Card className="glass-card">
              <CardContent className="p-4 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total</span>
                <Badge variant="secondary" className="font-mono">{errorStats.total}</Badge>
              </CardContent>
            </Card>
            <Card className="glass-card border-primary/20">
              <CardContent className="p-4 flex items-center justify-between">
                <span className="text-sm text-primary">Info</span>
                <Badge className="bg-primary/20 text-primary border-primary/30 font-mono">{errorStats.info}</Badge>
              </CardContent>
            </Card>
            <Card className="glass-card border-amber-500/20">
              <CardContent className="p-4 flex items-center justify-between">
                <span className="text-sm text-amber-500">Avisos</span>
                <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 font-mono">{errorStats.warnings}</Badge>
              </CardContent>
            </Card>
            <Card className="glass-card border-destructive/20">
              <CardContent className="p-4 flex items-center justify-between">
                <span className="text-sm text-destructive">Erros</span>
                <Badge className="bg-destructive/20 text-destructive border-destructive/30 font-mono">{errorStats.errors}</Badge>
              </CardContent>
            </Card>
          </div>

          {/* Error Logs */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border py-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertCircle className="w-4 h-4 text-destructive" />
                  <span className="font-mono">system-errors.log</span>
                </CardTitle>
                <div className="flex items-center gap-3">
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
                    {['all', 'info', 'warning', 'error'].map((f) => (
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
              <ScrollArea className="h-[500px]" ref={errorsScrollRef}>
                <div className="p-4 space-y-2">
                  {filteredErrors.length === 0 ? (
                    <div className="text-center text-muted-foreground py-12">
                      <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-success opacity-50" />
                      <p>Nenhum erro registrado</p>
                      <p className="text-xs mt-2">O sistema está funcionando normalmente</p>
                    </div>
                  ) : (
                    filteredErrors.map((error) => (
                      <div
                        key={error.id}
                        className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                      >
                        {getLevelIcon(error.level)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={`text-[10px] ${getLevelBadgeClass(error.level)}`}>
                              {error.level.toUpperCase()}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {error.category}
                            </Badge>
                          </div>
                          <p className="text-sm text-foreground mt-1">{error.message}</p>
                          {error.details && (
                            <p className="text-xs text-muted-foreground mt-1 font-mono bg-background/50 p-2 rounded">
                              {error.details}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {format(new Date(error.timestamp), 'HH:mm:ss', { locale: ptBR })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

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
        </TabsContent>
      </Tabs>
    </div>
  );
}
