import { useState } from 'react';
import { TrendingUp, Music, Crown, Medal, Award, BarChart3, RotateCcw, AlertTriangle, Search, Filter, Calendar } from 'lucide-react';
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
  const { clearRanking } = useRadioStore();
  const { toast } = useToast();
  const [selectedStyle, setSelectedStyle] = useState<string>('all');
  const [dateRange, setDateRange] = useState<string>('7d');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filter ranking data
  const filteredRanking = rankingData.filter(song => {
    const matchesStyle = selectedStyle === 'all' || song.style === selectedStyle;
    const matchesSearch = searchTerm === '' || 
      song.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      song.artist.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStyle && matchesSearch;
  });
  
  const maxPlays = Math.max(...filteredRanking.map((r) => r.plays), 1);

  const handleResetRanking = () => {
    clearRanking();
    toast({
      title: '🔄 Ranking Zerado!',
      description: 'Todas as contagens foram resetadas. A nova validação começará do zero.',
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
          
          <Badge className="bg-primary/20 text-primary border border-primary/30 px-4 py-2">
            <TrendingUp className="w-4 h-4 mr-2" />
            Atualizado agora
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
                <option value="1d">Hoje</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="30d">Últimos 30 dias</option>
                <option value="90d">Últimos 90 dias</option>
                <option value="all">Todo o período</option>
              </select>
            </div>

            {/* Active Filters Badge */}
            {(selectedStyle !== 'all' || searchTerm) && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => { setSelectedStyle('all'); setSearchTerm(''); }}
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
              Todos ({rankingData.length})
            </Badge>
            {allStyles.map(style => {
              const count = rankingData.filter(s => s.style === style).length;
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
                <p className="font-bold text-foreground">Evidências</p>
                <p className="text-xs text-yellow-400">847 reproduções</p>
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
                <p className="text-2xl font-bold text-foreground">247</p>
                <p className="text-xs text-primary">+12 esta semana</p>
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
                <p className="text-2xl font-bold text-foreground">8.4K</p>
                <p className="text-xs text-accent">Últimos 7 dias</p>
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
                <p className="font-bold text-foreground">Sertanejo</p>
                <p className="text-xs text-success">45% do TOP50</p>
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
                <div className="divide-y divide-border">
                  {rankingData.map((song) => (
                    <div
                      key={song.position}
                      className={`p-4 flex items-center gap-4 hover:bg-secondary/30 transition-colors ${
                        song.position <= 3 ? 'bg-gradient-to-r from-primary/5 to-transparent' : ''
                      }`}
                    >
                      <div className="w-8 flex justify-center">{getMedalIcon(song.position)}</div>
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
              </CardContent>
            </Card>

            {/* Style Distribution */}
            <Card className="glass-card">
              <CardHeader className="border-b border-border">
                <CardTitle>Distribuição por Estilo</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={styleDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {styleDistribution.map((entry, index) => (
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
                <div className="grid grid-cols-2 gap-2 mt-4">
                  {styleDistribution.map((style) => (
                    <div key={style.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: style.color }} />
                      <span className="text-xs text-muted-foreground">{style.name}</span>
                      <span className="text-xs font-mono text-foreground ml-auto">{style.value}%</span>
                    </div>
                  ))}
                </div>
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
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={top50Data} layout="vertical">
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
