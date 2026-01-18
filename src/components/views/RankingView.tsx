import { useState, useMemo } from 'react';
import { TrendingUp, Music, Crown, Medal, Award, BarChart3, RotateCcw, AlertTriangle, Search, Filter, Calendar, Download, FileJson } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useRadioStore } from '@/store/radioStore';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Area,
  AreaChart,
} from 'recharts';

// Demo ranking data
const rankingData = [
  { position: 1, title: 'Evidências', artist: 'Chitãozinho & Xororó', plays: 847, style: 'SERTANEJO', trend: 'up' },
  { position: 2, title: 'Atrasadinha', artist: 'Felipe Araújo', plays: 723, style: 'SERTANEJO', trend: 'up' },
  { position: 3, title: 'Hear Me Now', artist: 'Alok', plays: 689, style: 'DANCE', trend: 'stable' },
  { position: 4, title: 'Medo Bobo', artist: 'Maiara & Maraisa', plays: 654, style: 'SERTANEJO', trend: 'up' },
  { position: 5, title: 'Propaganda', artist: 'Jorge & Mateus', plays: 612, style: 'SERTANEJO', trend: 'down' },
  { position: 6, title: 'Deixa Eu Te Amar', artist: 'Sorriso Maroto', plays: 589, style: 'PAGODE', trend: 'up' },
  { position: 7, title: 'Shallow', artist: 'Lady Gaga', plays: 567, style: 'POP/VARIADO', trend: 'stable' },
  { position: 8, title: 'Péssimo Negócio', artist: 'Henrique & Juliano', plays: 534, style: 'SERTANEJO', trend: 'up' },
  { position: 9, title: 'Esse Cara Sou Eu', artist: 'Roberto Carlos', plays: 512, style: 'POP/VARIADO', trend: 'stable' },
  { position: 10, title: 'Blinding Lights', artist: 'The Weeknd', plays: 498, style: 'POP/VARIADO', trend: 'down' },
];

const top50Data = rankingData.slice(0, 10).map((item, index) => ({
  name: item.title.length > 12 ? item.title.substring(0, 12) + '...' : item.title,
  plays: item.plays,
  fill: index < 3 ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
}));

const styleDistribution = [
  { name: 'Sertanejo', value: 45, color: 'hsl(190, 95%, 50%)' },
  { name: 'Pagode', value: 20, color: 'hsl(25, 95%, 55%)' },
  { name: 'Pop/Variado', value: 20, color: 'hsl(150, 80%, 45%)' },
  { name: 'Dance', value: 10, color: 'hsl(280, 70%, 55%)' },
  { name: 'Agronejo', value: 5, color: 'hsl(40, 95%, 55%)' },
];

const weeklyTrend = [
  { day: 'Seg', plays: 120 },
  { day: 'Ter', plays: 145 },
  { day: 'Qua', plays: 132 },
  { day: 'Qui', plays: 178 },
  { day: 'Sex', plays: 210 },
  { day: 'Sáb', plays: 189 },
  { day: 'Dom', plays: 156 },
];

const getMedalIcon = (position: number) => {
  if (position === 1) return <Crown className="w-5 h-5 text-yellow-400" />;
  if (position === 2) return <Medal className="w-5 h-5 text-gray-300" />;
  if (position === 3) return <Award className="w-5 h-5 text-amber-600" />;
  return <span className="w-5 h-5 flex items-center justify-center text-sm font-bold text-muted-foreground">{position}</span>;
};

const getTrendColor = (trend: string) => {
  if (trend === 'up') return 'text-success';
  if (trend === 'down') return 'text-destructive';
  return 'text-muted-foreground';
};

const getStyleColor = (style: string) => {
  const colors: Record<string, string> = {
    'SERTANEJO': 'bg-primary/20 text-primary border-primary/30',
    'PAGODE': 'bg-accent/20 text-accent border-accent/30',
    'POP/VARIADO': 'bg-success/20 text-success border-success/30',
    'DANCE': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    'AGRONEJO': 'bg-warning/20 text-warning border-warning/30',
  };
  return colors[style] || 'bg-muted text-muted-foreground';
};

export function RankingView() {
  const { rankingSongs, clearRanking, setRankingSongs } = useRadioStore();
  const { toast } = useToast();
  const [selectedStyle, setSelectedStyle] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Calculate date filter based on dateRange
  const getDateThreshold = useMemo(() => {
    const now = new Date();
    switch (dateRange) {
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default:
        return null; // 'all' - no date filter
    }
  }, [dateRange]);

  // Use store data only - no demo fallback when ranking is cleared
  // Also filter by date if dateRange is set
  const currentRankingData = useMemo(() => {
    let filtered = rankingSongs;
    
    // Apply date filter
    if (getDateThreshold) {
      filtered = filtered.filter(song => 
        song.lastPlayed && new Date(song.lastPlayed) >= getDateThreshold
      );
    }
    
    return filtered.map((song, index) => ({
      position: index + 1,
      title: song.title,
      artist: song.artist,
      plays: song.plays,
      style: song.style,
      trend: song.trend,
      lastPlayed: song.lastPlayed,
    }));
  }, [rankingSongs, getDateThreshold]);
  
  // Filter ranking data by style and search
  const filteredRanking = useMemo(() => {
    return currentRankingData.filter(song => {
      const matchesStyle = selectedStyle === 'all' || song.style === selectedStyle;
      const matchesSearch = searchTerm === '' || 
        song.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        song.artist.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesStyle && matchesSearch;
    });
  }, [currentRankingData, selectedStyle, searchTerm]);
  
  const maxPlays = Math.max(...filteredRanking.map((r) => r.plays), 1);

  // Dynamic style distribution based on current data
  const dynamicStyleDistribution = useMemo(() => {
    if (currentRankingData.length === 0) return [];
    
    const styleColors: Record<string, string> = {
      'SERTANEJO': 'hsl(190, 95%, 50%)',
      'PAGODE': 'hsl(25, 95%, 55%)',
      'POP/VARIADO': 'hsl(150, 80%, 45%)',
      'DANCE': 'hsl(280, 70%, 55%)',
      'AGRONEJO': 'hsl(40, 95%, 55%)',
    };
    
    const styleCounts: Record<string, number> = {};
    for (const song of currentRankingData) {
      styleCounts[song.style] = (styleCounts[song.style] || 0) + 1;
    }
    
    const total = currentRankingData.length;
    return Object.entries(styleCounts).map(([name, count]) => ({
      name,
      value: Math.round((count / total) * 100),
      color: styleColors[name] || 'hsl(0, 0%, 50%)',
    }));
  }, [currentRankingData]);

  // Dynamic top 10 chart data
  const dynamicTop10Data = useMemo(() => {
    return filteredRanking.slice(0, 10).map((item, index) => ({
      name: item.title.length > 12 ? item.title.substring(0, 12) + '...' : item.title,
      plays: item.plays,
      fill: index < 3 ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
    }));
  }, [filteredRanking]);

  const handleResetRanking = () => {
    clearRanking();
    toast({
      title: '🔄 Ranking Zerado!',
      description: rankingSongs.length > 0 
        ? `${rankingSongs.length} músicas removidas do ranking. A nova validação começará do zero.`
        : 'O ranking foi resetado. A nova validação começará do zero.',
    });
  };

  // Load demo data into ranking if empty (first time)
  const handleLoadDemoData = () => {
    const demoSongs = rankingData.map((song, index) => ({
      id: `demo-${index}`,
      title: song.title,
      artist: song.artist,
      plays: song.plays,
      style: song.style,
      trend: song.trend as 'up' | 'down' | 'stable',
      lastPlayed: new Date(),
    }));
    setRankingSongs(demoSongs);
    toast({
      title: '📊 Dados Demo Carregados',
      description: `${demoSongs.length} músicas adicionadas ao ranking para demonstração.`,
    });
  };

  const handleExportJSON = () => {
    const exportData = {
      exportDate: new Date().toISOString(),
      totalSongs: filteredRanking.length,
      filters: {
        style: selectedStyle,
        dateRange: dateRange,
        searchTerm: searchTerm,
      },
      ranking: filteredRanking.map((song, index) => ({
        position: index + 1,
        title: song.title,
        artist: song.artist,
        plays: song.plays,
        style: song.style,
        trend: song.trend,
        // File format for grade: POSICAO{N}.MP3
        gradeFileName: `POSICAO${index + 1}.MP3`,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ranking_top50_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: '📥 Exportação concluída!',
      description: `${filteredRanking.length} músicas exportadas para JSON.`,
    });
  };

  const allStyles = ['SERTANEJO', 'PAGODE', 'POP/VARIADO', 'DANCE', 'AGRONEJO'];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Ranking TOP50</h2>
          <p className="text-muted-foreground">Curadoria através do monitoramento das rádios</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Show badge indicating data source */}
          {rankingSongs.length === 0 ? (
            <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
              Exibindo dados demo
            </Badge>
          ) : (
            <Badge variant="outline" className="border-success/50 text-success">
              {rankingSongs.length} músicas reais
            </Badge>
          )}
          
          <Button variant="outline" className="gap-2 border-primary/50 text-primary hover:bg-primary/10" onClick={handleExportJSON}>
            <FileJson className="w-4 h-4" />
            Exportar JSON
          </Button>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="gap-2 border-amber-500/50 text-amber-500 hover:bg-amber-500/10">
                <RotateCcw className="w-4 h-4" />
                Zerar Contagem
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  Zerar Ranking TOP50?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação irá resetar todas as contagens de reprodução. 
                  A nova validação começará do zero e todas as estatísticas serão perdidas.
                  <br /><br />
                  <strong>Esta ação não pode ser desfeita.</strong>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleResetRanking}
                  className="bg-amber-500 hover:bg-amber-600 text-white"
                >
                  Zerar Ranking
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Load Demo Data button - only show when ranking is empty */}
          {rankingSongs.length === 0 && (
            <Button 
              variant="outline" 
              className="gap-2 border-primary/50 text-primary hover:bg-primary/10"
              onClick={handleLoadDemoData}
            >
              <Music className="w-4 h-4" />
              Carregar Demo
            </Button>
          )}
          
          <Badge className="bg-primary/20 text-primary border border-primary/30 px-4 py-2">
            <TrendingUp className="w-4 h-4 mr-2" />
            {rankingSongs.length > 0 ? `${rankingSongs.length} músicas` : 'Sem dados'}
          </Badge>
        </div>
      </div>

      {/* Filters Card */}
      <Card className="glass-card border-primary/30">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar música ou artista..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-lg bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            {/* Style Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <select
                value={selectedStyle}
                onChange={(e) => setSelectedStyle(e.target.value)}
                className="bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="all">Todos os Estilos</option>
                {allStyles.map(style => (
                  <option key={style} value={style}>{style}</option>
                ))}
              </select>
            </div>

            {/* Date Range Filter */}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="24h">Últimas 24h</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="30d">Últimos 30 dias</option>
                <option value="all">Todo o período</option>
              </select>
            </div>

            {/* Active Filters Badge */}
            {(selectedStyle !== 'all' || searchTerm || dateRange !== 'all') && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => { setSelectedStyle('all'); setSearchTerm(''); setDateRange('all'); }}
                className="text-muted-foreground hover:text-foreground"
              >
                Limpar filtros
              </Button>
            )}
          </div>
          
          {/* Style Badges */}
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border/50">
            <Badge 
              variant={selectedStyle === 'all' ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setSelectedStyle('all')}
            >
              Todos ({currentRankingData.length})
            </Badge>
            {allStyles.map(style => {
              const count = currentRankingData.filter(s => s.style === style).length;
              return (
                <Badge 
                  key={style}
                  variant={selectedStyle === style ? 'default' : 'outline'}
                  className={`cursor-pointer ${getStyleColor(style)}`}
                  onClick={() => setSelectedStyle(style)}
                >
                  {style} ({count})
                </Badge>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card border-yellow-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <Crown className="w-6 h-6 text-yellow-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Líder Absoluto</p>
                <p className="font-bold text-foreground truncate max-w-[120px]">
                  {currentRankingData[0]?.title || 'Sem dados'}
                </p>
                <p className="text-xs text-yellow-400">
                  {currentRankingData[0]?.plays ? `${currentRankingData[0].plays} reproduções` : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Music className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Ranqueadas</p>
                <p className="text-2xl font-bold text-foreground">{currentRankingData.length}</p>
                <p className="text-xs text-primary">músicas</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-accent/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-accent" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Reproduções</p>
                <p className="text-2xl font-bold text-foreground">
                  {currentRankingData.reduce((acc, s) => acc + s.plays, 0).toLocaleString()}
                </p>
                <p className="text-xs text-accent">acumulado</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-success/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-success/10 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Estilo Dominante</p>
                <p className="font-bold text-foreground">
                  {dynamicStyleDistribution[0]?.name || 'Sem dados'}
                </p>
                <p className="text-xs text-success">
                  {dynamicStyleDistribution[0]?.value ? `${dynamicStyleDistribution[0].value}% do TOP50` : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="ranking" className="space-y-6">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="ranking">Ranking</TabsTrigger>
          <TabsTrigger value="charts">Gráficos</TabsTrigger>
          <TabsTrigger value="trends">Tendências</TabsTrigger>
        </TabsList>

        <TabsContent value="ranking">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top 10 List */}
            <Card className="glass-card lg:col-span-2">
              <CardHeader className="border-b border-border">
                <CardTitle className="flex items-center gap-2">
                  <Crown className="w-5 h-5 text-yellow-400" />
                  TOP 10 - Músicas Mais Tocadas
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {filteredRanking.length === 0 ? (
                  <div className="p-8 text-center">
                    <Music className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground">Nenhuma música no ranking</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">Os dados serão preenchidos conforme as músicas são capturadas</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredRanking.slice(0, 10).map((song, index) => (
                      <div
                        key={`${song.title}-${index}`}
                        className={`p-4 flex items-center gap-4 hover:bg-secondary/30 transition-colors ${
                          index < 3 ? 'bg-gradient-to-r from-primary/5 to-transparent' : ''
                        }`}
                      >
                        <div className="w-8 flex justify-center">{getMedalIcon(index + 1)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{song.title}</p>
                          <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                        </div>
                        <Badge variant="outline" className={getStyleColor(song.style)}>
                          {song.style}
                        </Badge>
                        <div className="w-32 hidden md:block">
                          <Progress value={(song.plays / maxPlays) * 100} className="h-2" />
                        </div>
                        <div className="text-right min-w-16">
                          <p className="font-mono font-bold text-foreground">{song.plays}</p>
                          <p className={`text-xs ${getTrendColor(song.trend)}`}>
                            {song.trend === 'up' ? '↑' : song.trend === 'down' ? '↓' : '→'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Style Distribution */}
            <Card className="glass-card">
              <CardHeader className="border-b border-border">
                <CardTitle>Distribuição por Estilo</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {dynamicStyleDistribution.length === 0 ? (
                  <div className="h-64 flex items-center justify-center">
                    <p className="text-muted-foreground text-sm">Sem dados para exibir</p>
                  </div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={dynamicStyleDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {dynamicStyleDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(220, 18%, 11%)',
                            border: '1px solid hsl(220, 20%, 18%)',
                            borderRadius: '8px',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {dynamicStyleDistribution.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {dynamicStyleDistribution.map((style) => (
                      <div key={style.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: style.color }} />
                        <span className="text-xs text-muted-foreground">{style.name}</span>
                        <span className="text-xs font-mono text-foreground ml-auto">{style.value}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="charts">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bar Chart */}
            <Card className="glass-card">
              <CardHeader className="border-b border-border">
                <CardTitle>TOP 10 - Reproduções</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {dynamicTop10Data.length === 0 ? (
                  <div className="h-80 flex items-center justify-center">
                    <p className="text-muted-foreground text-sm">Sem dados para exibir</p>
                  </div>
                ) : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dynamicTop10Data} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 20%, 18%)" />
                        <XAxis type="number" stroke="hsl(215, 15%, 55%)" fontSize={12} />
                        <YAxis dataKey="name" type="category" stroke="hsl(215, 15%, 55%)" fontSize={10} width={100} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(220, 18%, 11%)',
                            border: '1px solid hsl(220, 20%, 18%)',
                            borderRadius: '8px',
                          }}
                        />
                        <Bar dataKey="plays" fill="hsl(190, 95%, 50%)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Weekly Trend */}
            <Card className="glass-card">
              <CardHeader className="border-b border-border">
                <CardTitle>Reproduções Semanais</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weeklyTrend}>
                      <defs>
                        <linearGradient id="colorPlays" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(190, 95%, 50%)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(190, 95%, 50%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 20%, 18%)" />
                      <XAxis dataKey="day" stroke="hsl(215, 15%, 55%)" fontSize={12} />
                      <YAxis stroke="hsl(215, 15%, 55%)" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(220, 18%, 11%)',
                          border: '1px solid hsl(220, 20%, 18%)',
                          borderRadius: '8px',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="plays"
                        stroke="hsl(190, 95%, 50%)"
                        fillOpacity={1}
                        fill="url(#colorPlays)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trends">
          <Card className="glass-card">
            <CardHeader className="border-b border-border">
              <CardTitle>Análise de Tendências</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                  <h4 className="font-medium text-success mb-3">🔥 Em Alta</h4>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-success" />
                      <span className="text-foreground">Atrasadinha</span>
                      <span className="text-success ml-auto">+23%</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-success" />
                      <span className="text-foreground">Medo Bobo</span>
                      <span className="text-success ml-auto">+18%</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-success" />
                      <span className="text-foreground">Deixa Eu Te Amar</span>
                      <span className="text-success ml-auto">+15%</span>
                    </li>
                  </ul>
                </div>

                <div className="p-4 rounded-lg bg-muted/30 border border-border">
                  <h4 className="font-medium text-muted-foreground mb-3">→ Estáveis</h4>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <span className="w-4 h-4 text-center text-muted-foreground">—</span>
                      <span className="text-foreground">Hear Me Now</span>
                      <span className="text-muted-foreground ml-auto">0%</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-4 h-4 text-center text-muted-foreground">—</span>
                      <span className="text-foreground">Shallow</span>
                      <span className="text-muted-foreground ml-auto">0%</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-4 h-4 text-center text-muted-foreground">—</span>
                      <span className="text-foreground">Esse Cara Sou Eu</span>
                      <span className="text-muted-foreground ml-auto">0%</span>
                    </li>
                  </ul>
                </div>

                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                  <h4 className="font-medium text-destructive mb-3">📉 Em Queda</h4>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-destructive rotate-180" />
                      <span className="text-foreground">Propaganda</span>
                      <span className="text-destructive ml-auto">-8%</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-destructive rotate-180" />
                      <span className="text-foreground">Blinding Lights</span>
                      <span className="text-destructive ml-auto">-5%</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
