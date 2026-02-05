import { TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface TopArtist {
  name: string;
  count: number;
}

interface TopArtistsCardProps {
  artists: TopArtist[];
}

export function TopArtistsCard({ artists }: TopArtistsCardProps) {
  if (artists.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Top 10 Artistas Mais Tocados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            Sem dados para exibir
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Top 10 Artistas Mais Tocados
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {artists.map((artist, index) => (
            <div key={artist.name} className="flex items-center gap-4">
              <span className="text-lg font-bold text-muted-foreground w-8">
                #{index + 1}
              </span>
              <div className="flex-1">
                <p className="font-medium">{artist.name}</p>
                <div className="h-2 bg-secondary rounded-full mt-1 overflow-hidden">
                  <div 
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${(artist.count / artists[0].count) * 100}%` }}
                  />
                </div>
              </div>
              <Badge variant="secondary">{artist.count} músicas</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
