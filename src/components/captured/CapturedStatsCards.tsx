import { Database, Music, Radio, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface CapturedStatsCardsProps {
  totalCount: number;
  periodCount: number;
  stationsCount: number;
  rankingCount: number;
}

export function CapturedStatsCards({
  totalCount,
  periodCount,
  stationsCount,
  rankingCount,
}: CapturedStatsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Database className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total no Banco</p>
              <p className="text-2xl font-bold text-foreground">{totalCount.toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <Music className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Período Atual</p>
              <p className="text-2xl font-bold text-foreground">{periodCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border-orange-500/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <Radio className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Emissoras</p>
              <p className="text-2xl font-bold text-foreground">{stationsCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">No Ranking</p>
              <p className="text-2xl font-bold text-foreground">{rankingCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
