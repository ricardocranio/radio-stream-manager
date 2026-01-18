import { useState } from 'react';
import { GripVertical, Save, RotateCcw } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

export function SequenceView() {
  const { sequence, setSequence, stations } = useRadioStore();
  const { toast } = useToast();
  const [localSequence, setLocalSequence] = useState(sequence);

  const radioOptions = [
    ...stations.map((s) => ({ value: s.id, label: s.name })),
    { value: 'random_pop', label: '🎲 Aleatório (Disney/Metro)' },
    { value: 'top50', label: '🏆 TOP50 (Curadoria)' },
  ];

  const handleChange = (position: number, value: string) => {
    setLocalSequence((prev) =>
      prev.map((item) => (item.position === position ? { ...item, radioSource: value } : item))
    );
  };

  const handleSave = () => {
    setSequence(localSequence);
    toast({
      title: 'Sequência salva',
      description: 'A sequência de montagem foi atualizada.',
    });
  };

  const handleReset = () => {
    setLocalSequence(sequence);
    toast({
      title: 'Alterações descartadas',
      description: 'A sequência foi restaurada.',
    });
  };

  const getStationColor = (source: string) => {
    const colors: Record<string, string> = {
      bh: 'bg-primary/20 text-primary border-primary/30',
      band: 'bg-accent/20 text-accent border-accent/30',
      clube: 'bg-success/20 text-success border-success/30',
      disney: 'bg-warning/20 text-warning border-warning/30',
      metro: 'bg-destructive/20 text-destructive border-destructive/30',
      random_pop: 'bg-muted text-muted-foreground border-muted-foreground/30',
      top50: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    };
    return colors[source] || 'bg-secondary text-secondary-foreground';
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Sequência de Montagem</h2>
          <p className="text-muted-foreground">
            Configure a ordem das rádios para montar o arquivo %dd%.txt
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Resetar
          </Button>
          <Button onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Salvar Sequência
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sequence Configuration */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle>Ordem das Posições</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-3">
              {localSequence.map((item) => (
                <div
                  key={item.position}
                  className="flex items-center gap-4 p-3 rounded-lg bg-secondary/30 border border-border hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <GripVertical className="w-4 h-4" />
                    <span className="font-mono font-bold text-foreground w-6">
                      {item.position.toString().padStart(2, '0')}
                    </span>
                  </div>
                  <Select
                    value={item.radioSource}
                    onValueChange={(value) => handleChange(item.position, value)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {radioOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge variant="outline" className={getStationColor(item.radioSource)}>
                    {item.radioSource.toUpperCase()}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle>Prévia da Sequência</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Visualização de como as músicas serão selecionadas em cada bloco:
              </p>
              
              <div className="grid grid-cols-5 gap-2">
                {localSequence.map((item) => {
                  const station = stations.find((s) => s.id === item.radioSource);
                  return (
                    <div
                      key={item.position}
                      className={`aspect-square rounded-lg flex flex-col items-center justify-center ${getStationColor(item.radioSource)} border`}
                    >
                      <span className="text-2xl font-bold">{item.position}</span>
                      <span className="text-[10px] uppercase tracking-wide mt-1">
                        {station?.name || 'Random'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 p-4 rounded-lg bg-muted/30 border border-border">
                <h4 className="font-medium text-sm mb-2">Legenda</h4>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {stations.map((station) => (
                    <div key={station.id} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${getStationColor(station.id)}`} />
                      <span className="text-muted-foreground">{station.name}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-muted" />
                    <span className="text-muted-foreground">Aleatório</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-yellow-500/30" />
                    <span className="text-muted-foreground">TOP50</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <h4 className="font-medium text-sm text-primary mb-2">ℹ️ Informação</h4>
                <p className="text-xs text-muted-foreground">
                  Posições 1-5: Fonte principal (recomendado BH FM)<br />
                  Posições 6-9: Fonte secundária (recomendado Band FM)<br />
                  Posição 10: Variedade (Disney, Metro ou TOP50)<br />
                  <span className="text-yellow-400">TOP50:</span> Usa músicas do ranking de curadoria (POSICAO{'{N}'}.MP3)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
