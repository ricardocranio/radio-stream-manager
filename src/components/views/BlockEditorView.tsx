import { useState, useMemo } from 'react';
import { GripVertical, Music, Clock, Save, RotateCcw, Plus, Trash2, Newspaper } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRadioStore, BlockSong } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

interface SortableSongProps {
  song: BlockSong;
  onRemove: () => void;
}

function SortableSong({ song, onRemove }: SortableSongProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: song.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
        isDragging
          ? 'bg-primary/10 border-primary/50 shadow-lg z-50'
          : song.isFixed
          ? 'bg-accent/10 border-accent/30'
          : 'bg-secondary/30 border-border hover:border-primary/30'
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center shrink-0">
        {song.isFixed ? (
          <Newspaper className="w-4 h-4 text-accent" />
        ) : (
          <Music className="w-4 h-4 text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-foreground truncate">{song.title}</p>
        <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
      </div>
      <Badge
        variant="outline"
        className={
          song.isFixed
            ? 'bg-accent/20 text-accent border-accent/30'
            : 'bg-secondary text-muted-foreground'
        }
      >
        {song.source}
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// Demo songs pool
const songPool: Omit<BlockSong, 'id'>[] = [
  { title: 'Evidências', artist: 'Chitãozinho & Xororó', file: 'Evidências - Chitãozinho & Xororó.mp3', source: 'BH', isFixed: false },
  { title: 'Atrasadinha', artist: 'Felipe Araújo', file: 'Atrasadinha - Felipe Araújo.mp3', source: 'BH', isFixed: false },
  { title: 'Medo Bobo', artist: 'Maiara & Maraisa', file: 'Medo Bobo - Maiara & Maraisa.mp3', source: 'BH', isFixed: false },
  { title: 'Propaganda', artist: 'Jorge & Mateus', file: 'Propaganda - Jorge & Mateus.mp3', source: 'BH', isFixed: false },
  { title: 'Péssimo Negócio', artist: 'Henrique & Juliano', file: 'Péssimo Negócio - Henrique & Juliano.mp3', source: 'BH', isFixed: false },
  { title: 'Deixa Eu Te Amar', artist: 'Sorriso Maroto', file: 'Deixa Eu Te Amar - Sorriso Maroto.mp3', source: 'BAND', isFixed: false },
  { title: 'Sorte', artist: 'Thiaguinho', file: 'Sorte - Thiaguinho.mp3', source: 'BAND', isFixed: false },
  { title: 'Shallow', artist: 'Lady Gaga', file: 'Shallow - Lady Gaga.mp3', source: 'DISNEY', isFixed: false },
  { title: 'Hear Me Now', artist: 'Alok', file: 'Hear Me Now - Alok.mp3', source: 'METRO', isFixed: false },
  { title: 'Blinding Lights', artist: 'The Weeknd', file: 'Blinding Lights - The Weeknd.mp3', source: 'METRO', isFixed: false },
];

const fixedContentPool: Omit<BlockSong, 'id'>[] = [
  { title: 'Notícia da Hora', artist: 'Conteúdo Fixo', file: 'NOTICIA_DA_HORA_14HORAS.mp3', source: 'FIXO', isFixed: true },
  { title: 'Horóscopo do Dia', artist: 'Conteúdo Fixo', file: 'HOROSCOPO_DO_DIA.mp3', source: 'FIXO', isFixed: true },
  { title: 'Fique Sabendo', artist: 'Conteúdo Fixo', file: 'FIQUE_SABENDO.mp3', source: 'FIXO', isFixed: true },
  { title: 'As Últimas do Esporte', artist: 'Conteúdo Fixo', file: 'AS_ULTIMAS_DO_ESPORTE.mp3', source: 'FIXO', isFixed: true },
];

export function BlockEditorView() {
  const { blockSongs, setBlockSongs, fixedContent } = useRadioStore();
  const { toast } = useToast();
  const [selectedHour, setSelectedHour] = useState(14);
  const [selectedMinute, setSelectedMinute] = useState(0);

  const timeKey = `${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;

  // Initialize songs for this block if not exists
  const currentSongs = useMemo(() => {
    if (blockSongs[timeKey]) return blockSongs[timeKey];
    // Generate default songs
    return songPool.slice(0, 10).map((s, i) => ({ ...s, id: `${timeKey}-${i}` }));
  }, [blockSongs, timeKey]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = currentSongs.findIndex((s) => s.id === active.id);
      const newIndex = currentSongs.findIndex((s) => s.id === over.id);
      const newSongs = arrayMove(currentSongs, oldIndex, newIndex);
      setBlockSongs(timeKey, newSongs);
    }
  };

  const handleRemoveSong = (id: string) => {
    const newSongs = currentSongs.filter((s) => s.id !== id);
    setBlockSongs(timeKey, newSongs);
  };

  const handleAddSong = (song: Omit<BlockSong, 'id'>) => {
    const newSong: BlockSong = { ...song, id: `${timeKey}-${Date.now()}` };
    setBlockSongs(timeKey, [...currentSongs, newSong]);
    toast({ title: 'Item adicionado', description: song.title });
  };

  const handleReset = () => {
    const defaultSongs = songPool.slice(0, 10).map((s, i) => ({ ...s, id: `${timeKey}-${i}-${Date.now()}` }));
    setBlockSongs(timeKey, defaultSongs);
    toast({ title: 'Bloco resetado' });
  };

  const handleSave = () => {
    toast({ title: 'Bloco salvo', description: `Bloco ${timeKey} foi atualizado.` });
  };

  // Get scheduled fixed content for this time
  const scheduledFixed = fixedContent.filter((c) =>
    c.enabled && c.timeSlots.some((s) => s.hour === selectedHour && s.minute === selectedMinute)
  );

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Editor de Blocos</h2>
          <p className="text-muted-foreground">Arraste e solte para reordenar músicas em cada bloco</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-secondary/50 rounded-lg p-1">
            <Clock className="w-4 h-4 text-muted-foreground ml-2" />
            <Select value={selectedHour.toString()} onValueChange={(v) => setSelectedHour(parseInt(v))}>
              <SelectTrigger className="w-20 border-0 bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i} value={i.toString()}>
                    {i.toString().padStart(2, '0')}h
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">:</span>
            <Select value={selectedMinute.toString()} onValueChange={(v) => setSelectedMinute(parseInt(v))}>
              <SelectTrigger className="w-20 border-0 bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">00</SelectItem>
                <SelectItem value="30">30</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Resetar
          </Button>
          <Button onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Salvar Bloco
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Block Editor */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-lg px-3 py-1">
                  {timeKey}
                </Badge>
                <span className="text-muted-foreground">•</span>
                <span className="text-sm text-muted-foreground">{currentSongs.length} itens</span>
              </div>
              {scheduledFixed.length > 0 && (
                <Badge className="bg-accent/20 text-accent border-accent/30">
                  {scheduledFixed.length} conteúdo(s) fixo(s) programado(s)
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={currentSongs.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {currentSongs.map((song, index) => (
                    <div key={song.id} className="flex items-center gap-2">
                      <span className="w-6 text-center text-sm font-mono text-muted-foreground">
                        {(index + 1).toString().padStart(2, '0')}
                      </span>
                      <div className="flex-1">
                        <SortableSong song={song} onRemove={() => handleRemoveSong(song.id)} />
                      </div>
                    </div>
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {currentSongs.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Music className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Nenhum item neste bloco</p>
                <p className="text-sm">Adicione músicas ou conteúdos fixos</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add Items Panel */}
        <div className="space-y-6">
          {/* Add Fixed Content */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-accent" />
                Adicionar Conteúdo Fixo
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {fixedContentPool.map((content, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddSong(content)}
                    className="w-full flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors text-left"
                  >
                    <div className="w-6 h-6 rounded bg-accent/20 flex items-center justify-center">
                      <Plus className="w-3 h-3 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{content.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{content.file}</p>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Add Music */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Music className="w-4 h-4 text-primary" />
                Adicionar Música
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {songPool.map((song, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddSong(song)}
                    className="w-full flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors text-left"
                  >
                    <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center">
                      <Plus className="w-3 h-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{song.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {song.source}
                    </Badge>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Info */}
          <Card className="glass-card border-primary/20">
            <CardContent className="p-4">
              <h4 className="text-sm font-medium text-primary mb-2">💡 Dicas</h4>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Arraste os itens para reordenar</li>
                <li>• Conteúdos fixos aparecem em laranja</li>
                <li>• Músicas aparecem em azul</li>
                <li>• Clique no X para remover um item</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
