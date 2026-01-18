import { Radio, Music, CheckCircle, XCircle, TrendingUp, Timer, History, Trash2 } from 'lucide-react';
import { useRadioStore, GradeHistoryEntry } from '@/store/radioStore';
import { useCountdown } from '@/hooks/useCountdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function DashboardView() {
  const { stations, capturedSongs, missingSongs, isRunning, config, gradeHistory, clearGradeHistory } = useRadioStore();
  const { nextGradeCountdown, autoCleanCountdown, nextGradeSeconds, autoCleanSeconds, nextBlockTime, buildTime } = useCountdown();

  const stats = {
    activeStations: stations.filter((s) => s.enabled).length,
    totalCaptured: capturedSongs.length,
    foundSongs: capturedSongs.filter((s) => s.status === 'found').length,
    missingSongsCount: missingSongs.length,
  };

  // Demo grade history if empty
  const displayGradeHistory: GradeHistoryEntry[] = gradeHistory.length > 0 
    ? gradeHistory
    : [
        { id: '1', timestamp: new Date(Date.now() - 30 * 60000), blockTime: '21:00', songsProcessed: 10, songsFound: 9, songsMissing: 1, programName: 'Noite NOSSA' },
        { id: '2', timestamp: new Date(Date.now() - 60 * 60000), blockTime: '20:30', songsProcessed: 10, songsFound: 10, songsMissing: 0, programName: 'FIXO' },
        { id: '3', timestamp: new Date(Date.now() - 90 * 60000), blockTime: '20:00', songsProcessed: 10, songsFound: 8, songsMissing: 2, programName: 'FIXO' },
        { id: '4', timestamp: new Date(Date.now() - 120 * 60000), blockTime: '19:30', songsProcessed: 10, songsFound: 10, songsMissing: 0, programName: 'TOP10' },
      ];

  // Simulated captured songs for demo
  const recentCaptures = capturedSongs.length > 0 
    ? capturedSongs.slice(0, 8)
    : [
        { id: '1', title: 'Evidências', artist: 'Chitãozinho & Xororó', station: 'BH FM', timestamp: new Date(), status: 'found' as const },
        { id: '2', title: 'Atrasadinha', artist: 'Felipe Araújo', station: 'Band FM', timestamp: new Date(), status: 'found' as const },
        { id: '3', title: 'Shallow', artist: 'Lady Gaga', station: 'Disney FM', timestamp: new Date(), status: 'missing' as const },
        { id: '4', title: 'Medo Bobo', artist: 'Maiara & Maraisa', station: 'BH FM', timestamp: new Date(), status: 'found' as const },
        { id: '5', title: 'Hear Me Now', artist: 'Alok', station: 'Metropolitana', timestamp: new Date(), status: 'found' as const },
      ];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="glass-card border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Emissoras Ativas</p>
                <p className="text-3xl font-bold text-foreground">{stats.activeStations}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Radio className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-success/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Músicas Capturadas</p>
                <p className="text-3xl font-bold text-foreground">{stats.totalCaptured || 24}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-success/10 flex items-center justify-center">
                <Music className="w-6 h-6 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-accent/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Encontradas</p>
                <p className="text-3xl font-bold text-foreground">{stats.foundSongs || 21}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-accent" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-destructive/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Faltando</p>
                <p className="text-3xl font-bold text-foreground">{stats.missingSongsCount || 3}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-destructive/10 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Feed */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              Captura em Tempo Real
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
              {recentCaptures.map((song, index) => (
                <div
                  key={song.id}
                  className="p-4 flex items-center justify-between hover:bg-secondary/30 transition-colors animate-slide-in"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                      <Music className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{song.title}</p>
                      <p className="text-sm text-muted-foreground">{song.artist}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className={
                        song.status === 'found'
                          ? 'border-success/40 text-success bg-success/10'
                          : 'border-destructive/40 text-destructive bg-destructive/10'
                      }
                    >
                      {song.status === 'found' ? 'Encontrada' : 'Faltando'}
                    </Badge>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {song.station}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Status Panel */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="w-5 h-5 text-primary" />
              Status do Sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge className={isRunning ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}>
                  {isRunning ? 'Ativo' : 'Parado'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm text-muted-foreground">Intervalo</span>
                <span className="text-sm font-mono text-foreground">{config.updateIntervalMinutes} min</span>
              </div>
              
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm text-muted-foreground">Repetição</span>
                <span className="text-sm font-mono text-foreground">{config.artistRepetitionMinutes} min</span>
              </div>

              <div className="p-3 rounded-lg bg-secondary/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <Timer className="w-4 h-4" />
                    Próxima Grade
                  </span>
                  <div className="text-right">
                    <span className={`text-sm font-mono ${nextGradeSeconds <= 60 ? 'text-amber-500 animate-pulse' : 'text-primary'}`}>
                      {nextGradeCountdown}
                    </span>
                    {isRunning && (
                      <p className="text-xs text-muted-foreground">
                        Bloco {nextBlockTime} (monta às {buildTime})
                      </p>
                    )}
                  </div>
                </div>
                {isRunning && (
                  <Progress 
                    value={Math.max(0, 100 - (nextGradeSeconds / 600) * 100)} 
                    className="h-1"
                  />
                )}
              </div>

              <div className="p-3 rounded-lg bg-secondary/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">🧹 Auto-Clean</span>
                  <span className={`text-sm font-mono ${autoCleanSeconds <= 60 ? 'text-amber-500 animate-pulse' : 'text-foreground'}`}>
                    {autoCleanCountdown}
                  </span>
                </div>
                {isRunning && (
                  <Progress 
                    value={Math.max(0, 100 - (autoCleanSeconds / 3600) * 100)} 
                    className="h-1"
                  />
                )}
              </div>
            </div>

            {/* Audio Visualizer */}
            <div className="pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-3">Atividade</p>
              <div className="flex items-end justify-center gap-1 h-12">
                {[...Array(16)].map((_, i) => (
                  <div
                    key={i}
                    className="w-2 bg-primary rounded-full animate-wave"
                    style={{
                      height: `${Math.random() * 100}%`,
                      animationDelay: `${i * 0.1}s`,
                      opacity: isRunning ? 1 : 0.3,
                    }}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grade History */}
      <Card className="glass-card">
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="w-5 h-5 text-primary" />
              Histórico de Grades
            </CardTitle>
            {gradeHistory.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearGradeHistory}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Limpar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[200px]">
            {displayGradeHistory.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Nenhuma grade gerada ainda</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {displayGradeHistory.slice(0, 10).map((entry, index) => (
                  <div
                    key={entry.id}
                    className="p-3 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-bold text-primary">{entry.blockTime}</span>
                      </div>
                      <div>
                        <p className="font-medium text-foreground text-sm">{entry.programName}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(entry.timestamp), "HH:mm:ss", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs border-success/40 text-success bg-success/10">
                        ✓ {entry.songsFound}
                      </Badge>
                      {entry.songsMissing > 0 && (
                        <Badge variant="outline" className="font-mono text-xs border-destructive/40 text-destructive bg-destructive/10">
                          ✗ {entry.songsMissing}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-1">
                        / {entry.songsProcessed}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
