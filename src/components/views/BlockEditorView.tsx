import { useState, useMemo, useRef, useCallback } from 'react';
import { GripVertical, Music, Clock, Save, RotateCcw, Plus, Trash2, Newspaper, FileText, Copy, BookmarkPlus, Bookmark, Download, Upload, AlertTriangle, CheckCircle, Eye, Undo2, Redo2, Layers, BarChart3 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

interface SortableSongProps {
  song: BlockSong;
  onRemove: () => void;
  hasWarning?: boolean;
}

interface BlockTemplate {
  id: string;
  name: string;
  songs: BlockSong[];
  createdAt: string;
}

interface ValidationWarning {
  songId: string;
  songTitle: string;
  artist: string;
  type: 'same-block' | 'nearby-block';
  conflictTime?: string;
}

interface HistoryEntry {
  timeKey: string;
  songs: BlockSong[];
  timestamp: Date;
  action: string;
}

function SortableSong({ song, onRemove, hasWarning }: SortableSongProps) {
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
          : hasWarning
          ? 'bg-warning/10 border-warning/50'
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
      {hasWarning && <AlertTriangle className="w-4 h-4 text-warning shrink-0" />}
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

// Default templates
const defaultTemplates: BlockTemplate[] = [
  {
    id: 'morning-hits',
    name: 'Manhã de Hits',
    songs: songPool.slice(0, 8).map((s, i) => ({ ...s, id: `template-morning-${i}` })),
    createdAt: new Date().toISOString(),
  },
  {
    id: 'afternoon-mix',
    name: 'Tarde Mix',
    songs: [...songPool.slice(2, 6), fixedContentPool[0], ...songPool.slice(6, 10)].map((s, i) => ({ ...s, id: `template-afternoon-${i}` })),
    createdAt: new Date().toISOString(),
  },
  {
    id: 'news-block',
    name: 'Bloco com Notícias',
    songs: [fixedContentPool[0], ...songPool.slice(0, 5), fixedContentPool[2], ...songPool.slice(5, 8)].map((s, i) => ({ ...s, id: `template-news-${i}` })),
    createdAt: new Date().toISOString(),
  },
];

// Source colors for statistics
const sourceColors: Record<string, string> = {
  'BH': 'bg-primary',
  'BAND': 'bg-accent',
  'DISNEY': 'bg-pink-500',
  'METRO': 'bg-emerald-500',
  'FIXO': 'bg-purple-500',
};

export function BlockEditorView() {
  const { blockSongs, setBlockSongs, fixedContent, programs } = useRadioStore();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedHour, setSelectedHour] = useState(14);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [templates, setTemplates] = useState<BlockTemplate[]>(defaultTemplates);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showTemplateInput, setShowTemplateInput] = useState(false);
  const [showDayPreview, setShowDayPreview] = useState(false);
  const [showBatchMode, setShowBatchMode] = useState(false);
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<string[]>([]);
  const [selectedTemplateForBatch, setSelectedTemplateForBatch] = useState<string>('');
  
  // History for undo/redo
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isUndoRedo, setIsUndoRedo] = useState(false);

  const timeKey = `${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;

  // Initialize songs for this block if not exists
  const currentSongs = useMemo(() => {
    if (blockSongs[timeKey]) return blockSongs[timeKey];
    return songPool.slice(0, 10).map((s, i) => ({ ...s, id: `${timeKey}-${i}` }));
  }, [blockSongs, timeKey]);

  // Statistics by source
  const sourceStats = useMemo(() => {
    const stats: Record<string, number> = {};
    currentSongs.forEach(song => {
      stats[song.source] = (stats[song.source] || 0) + 1;
    });
    return stats;
  }, [currentSongs]);

  const totalSongs = currentSongs.length;

  // Get program name for current hour
  const getProgramForHour = (hour: number) => {
    for (const prog of programs) {
      const [start, end] = prog.timeRange.split('-').map(Number);
      if (hour >= start && hour <= end) {
        return prog.programName;
      }
    }
    return 'PROGRAMA';
  };

  // Generate .txt line for a specific time
  const generateTxtLineForTime = (hour: number, minute: number) => {
    const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const key = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const program = getProgramForHour(hour);
    const songs = blockSongs[key] || songPool.slice(0, 10).map((s, i) => ({ ...s, id: `${key}-${i}` }));
    const songFiles = songs.map(s => `"${s.file}"`).join(',vht,');
    return `${time} (ID=${program}) ${songFiles}`;
  };

  // Generate .txt line preview for current block
  const generateTxtLine = useMemo(() => {
    return generateTxtLineForTime(selectedHour, selectedMinute);
  }, [currentSongs, selectedHour, selectedMinute, programs, blockSongs]);

  // Generate full day preview
  const generateFullDayPreview = useMemo(() => {
    const lines: string[] = [];
    for (let hour = 0; hour < 24; hour++) {
      lines.push(generateTxtLineForTime(hour, 0));
      lines.push(generateTxtLineForTime(hour, 30));
    }
    return lines.join('\n');
  }, [blockSongs, programs]);

  // Validation: Check for repeated songs in same block or nearby blocks
  const validationWarnings = useMemo(() => {
    const warnings: ValidationWarning[] = [];
    const songCounts: Record<string, number> = {};
    
    currentSongs.forEach((song) => {
      if (song.isFixed) return;
      const key = `${song.title}-${song.artist}`;
      songCounts[key] = (songCounts[key] || 0) + 1;
      if (songCounts[key] > 1) {
        warnings.push({
          songId: song.id,
          songTitle: song.title,
          artist: song.artist,
          type: 'same-block',
        });
      }
    });

    const nearbyTimes = [
      { hour: selectedHour - 1, minute: 0 },
      { hour: selectedHour - 1, minute: 30 },
      { hour: selectedHour, minute: selectedMinute === 0 ? 30 : 0 },
      { hour: selectedHour + 1, minute: 0 },
      { hour: selectedHour + 1, minute: 30 },
    ].filter(t => t.hour >= 0 && t.hour < 24 && !(t.hour === selectedHour && t.minute === selectedMinute));

    nearbyTimes.forEach(({ hour, minute }) => {
      const nearbyKey = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const nearbySongs = blockSongs[nearbyKey] || [];
      
      currentSongs.forEach((song) => {
        if (song.isFixed) return;
        const found = nearbySongs.find(ns => ns.title === song.title && ns.artist === song.artist && !ns.isFixed);
        if (found && !warnings.find(w => w.songId === song.id)) {
          warnings.push({
            songId: song.id,
            songTitle: song.title,
            artist: song.artist,
            type: 'nearby-block',
            conflictTime: nearbyKey,
          });
        }
      });
    });

    return warnings;
  }, [currentSongs, blockSongs, selectedHour, selectedMinute]);

  const warningSongIds = new Set(validationWarnings.map(w => w.songId));

  // Add to history
  const addToHistory = useCallback((newTimeKey: string, newSongs: BlockSong[], action: string) => {
    if (isUndoRedo) return;
    
    const entry: HistoryEntry = {
      timeKey: newTimeKey,
      songs: [...newSongs],
      timestamp: new Date(),
      action,
    };
    
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      return [...newHistory, entry].slice(-50); // Keep last 50 entries
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex, isUndoRedo]);

  // Undo
  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    
    setIsUndoRedo(true);
    const prevEntry = history[historyIndex - 1];
    if (prevEntry) {
      setBlockSongs(prevEntry.timeKey, prevEntry.songs);
      setHistoryIndex(prev => prev - 1);
      toast({ title: 'Desfeito', description: prevEntry.action });
    }
    setTimeout(() => setIsUndoRedo(false), 100);
  }, [history, historyIndex, setBlockSongs, toast]);

  // Redo
  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    
    setIsUndoRedo(true);
    const nextEntry = history[historyIndex + 1];
    if (nextEntry) {
      setBlockSongs(nextEntry.timeKey, nextEntry.songs);
      setHistoryIndex(prev => prev + 1);
      toast({ title: 'Refeito', description: nextEntry.action });
    }
    setTimeout(() => setIsUndoRedo(false), 100);
  }, [history, historyIndex, setBlockSongs, toast]);

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
      addToHistory(timeKey, newSongs, 'Reordenar músicas');
    }
  };

  const handleRemoveSong = (id: string) => {
    const newSongs = currentSongs.filter((s) => s.id !== id);
    setBlockSongs(timeKey, newSongs);
    addToHistory(timeKey, newSongs, 'Remover música');
  };

  const handleAddSong = (song: Omit<BlockSong, 'id'>) => {
    const newSong: BlockSong = { ...song, id: `${timeKey}-${Date.now()}` };
    const newSongs = [...currentSongs, newSong];
    setBlockSongs(timeKey, newSongs);
    addToHistory(timeKey, newSongs, `Adicionar ${song.title}`);
    toast({ title: 'Item adicionado', description: song.title });
  };

  const handleReset = () => {
    const defaultSongs = songPool.slice(0, 10).map((s, i) => ({ ...s, id: `${timeKey}-${i}-${Date.now()}` }));
    setBlockSongs(timeKey, defaultSongs);
    addToHistory(timeKey, defaultSongs, 'Resetar bloco');
    toast({ title: 'Bloco resetado' });
  };

  const handleSave = () => {
    toast({ title: 'Bloco salvo', description: `Bloco ${timeKey} foi atualizado.` });
  };

  const handleCopyTxt = () => {
    navigator.clipboard.writeText(generateTxtLine);
    toast({ title: 'Copiado!', description: 'Linha copiada para a área de transferência.' });
  };

  const handleCopyFullDay = () => {
    navigator.clipboard.writeText(generateFullDayPreview);
    toast({ title: 'Copiado!', description: 'Arquivo completo do dia copiado.' });
  };

  const handleSaveTemplate = () => {
    if (!newTemplateName.trim()) {
      toast({ title: 'Erro', description: 'Digite um nome para o template.', variant: 'destructive' });
      return;
    }
    const newTemplate: BlockTemplate = {
      id: `template-${Date.now()}`,
      name: newTemplateName,
      songs: currentSongs.map((s, i) => ({ ...s, id: `saved-${Date.now()}-${i}` })),
      createdAt: new Date().toISOString(),
    };
    setTemplates([...templates, newTemplate]);
    setNewTemplateName('');
    setShowTemplateInput(false);
    toast({ title: 'Template salvo!', description: `"${newTemplateName}" disponível para reutilização.` });
  };

  const handleLoadTemplate = (template: BlockTemplate) => {
    const loadedSongs = template.songs.map((s, i) => ({ ...s, id: `${timeKey}-loaded-${i}-${Date.now()}` }));
    setBlockSongs(timeKey, loadedSongs);
    addToHistory(timeKey, loadedSongs, `Carregar template "${template.name}"`);
    toast({ title: 'Template carregado', description: `"${template.name}" aplicado ao bloco ${timeKey}.` });
  };

  const handleDeleteTemplate = (templateId: string) => {
    setTemplates(templates.filter(t => t.id !== templateId));
    toast({ title: 'Template removido' });
  };

  // Batch apply template to multiple time slots
  const handleBatchApply = () => {
    if (!selectedTemplateForBatch || selectedTimeSlots.length === 0) {
      toast({ title: 'Erro', description: 'Selecione um template e ao menos um horário.', variant: 'destructive' });
      return;
    }

    const template = templates.find(t => t.id === selectedTemplateForBatch);
    if (!template) return;

    selectedTimeSlots.forEach(slot => {
      const loadedSongs = template.songs.map((s, i) => ({ ...s, id: `${slot}-batch-${i}-${Date.now()}` }));
      setBlockSongs(slot, loadedSongs);
    });

    toast({ 
      title: 'Aplicado em lote!', 
      description: `"${template.name}" aplicado a ${selectedTimeSlots.length} horários.` 
    });
    setShowBatchMode(false);
    setSelectedTimeSlots([]);
    setSelectedTemplateForBatch('');
  };

  const toggleTimeSlot = (slot: string) => {
    setSelectedTimeSlots(prev => 
      prev.includes(slot) ? prev.filter(s => s !== slot) : [...prev, slot]
    );
  };

  const selectAllTimeSlots = () => {
    const allSlots: string[] = [];
    for (let h = 0; h < 24; h++) {
      allSlots.push(`${h.toString().padStart(2, '0')}:00`);
      allSlots.push(`${h.toString().padStart(2, '0')}:30`);
    }
    setSelectedTimeSlots(allSlots);
  };

  // Export templates to JSON
  const handleExportTemplates = () => {
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      templates: templates,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `templates_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Exportado!', description: `${templates.length} templates exportados.` });
  };

  // Import templates from JSON
  const handleImportTemplates = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.templates && Array.isArray(data.templates)) {
          const importedTemplates = data.templates.map((t: BlockTemplate) => ({
            ...t,
            id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          }));
          setTemplates([...templates, ...importedTemplates]);
          toast({ title: 'Importado!', description: `${importedTemplates.length} templates importados.` });
        } else {
          throw new Error('Formato inválido');
        }
      } catch {
        toast({ title: 'Erro', description: 'Arquivo JSON inválido.', variant: 'destructive' });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
        <div className="flex items-center gap-2">
          {/* Undo/Redo */}
          <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              title="Desfazer (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              title="Refazer (Ctrl+Y)"
            >
              <Redo2 className="w-4 h-4" />
            </Button>
          </div>

          {/* Batch Mode */}
          <Dialog open={showBatchMode} onOpenChange={setShowBatchMode}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Layers className="w-4 h-4 mr-2" />
                Lote
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Edição em Lote</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Template a aplicar:</label>
                  <Select value={selectedTemplateForBatch} onValueChange={setSelectedTemplateForBatch}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Selecione um template..." />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border border-border z-50">
                      {templates.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name} ({t.songs.length} itens)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium">Horários ({selectedTimeSlots.length} selecionados):</label>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={selectAllTimeSlots}>
                        Selecionar Todos
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSelectedTimeSlots([])}>
                        Limpar
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-8 gap-2 max-h-60 overflow-y-auto p-2 bg-secondary/30 rounded-lg">
                    {Array.from({ length: 24 }, (_, h) => (
                      <>
                        <label key={`${h}-0`} className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 cursor-pointer">
                          <Checkbox
                            checked={selectedTimeSlots.includes(`${h.toString().padStart(2, '0')}:00`)}
                            onCheckedChange={() => toggleTimeSlot(`${h.toString().padStart(2, '0')}:00`)}
                          />
                          <span className="text-xs font-mono">{h.toString().padStart(2, '0')}:00</span>
                        </label>
                        <label key={`${h}-30`} className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 cursor-pointer">
                          <Checkbox
                            checked={selectedTimeSlots.includes(`${h.toString().padStart(2, '0')}:30`)}
                            onCheckedChange={() => toggleTimeSlot(`${h.toString().padStart(2, '0')}:30`)}
                          />
                          <span className="text-xs font-mono">{h.toString().padStart(2, '0')}:30</span>
                        </label>
                      </>
                    ))}
                  </div>
                </div>

                <Button className="w-full" onClick={handleBatchApply} disabled={!selectedTemplateForBatch || selectedTimeSlots.length === 0}>
                  <Layers className="w-4 h-4 mr-2" />
                  Aplicar a {selectedTimeSlots.length} horários
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showDayPreview} onOpenChange={setShowDayPreview}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Eye className="w-4 h-4 mr-2" />
                Preview do Dia
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between">
                  <span>Preview Completo - SEX.txt</span>
                  <Button size="sm" onClick={handleCopyFullDay}>
                    <Copy className="w-4 h-4 mr-2" />
                    Copiar Tudo
                  </Button>
                </DialogTitle>
              </DialogHeader>
              <div className="bg-background/80 rounded-lg p-4 font-mono text-xs overflow-auto max-h-[60vh] border border-border">
                <pre className="whitespace-pre text-foreground">
                  {generateFullDayPreview}
                </pre>
              </div>
            </DialogContent>
          </Dialog>

          <div className="flex items-center gap-2 bg-secondary/50 rounded-lg p-1">
            <Clock className="w-4 h-4 text-muted-foreground ml-2" />
            <Select value={selectedHour.toString()} onValueChange={(v) => setSelectedHour(parseInt(v))}>
              <SelectTrigger className="w-20 border-0 bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border border-border z-50">
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
              <SelectContent className="bg-popover border border-border z-50">
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
            Salvar
          </Button>
        </div>
      </div>

      {/* Source Statistics */}
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Distribuição por Fonte:</span>
            </div>
            <div className="flex-1 flex items-center gap-3 flex-wrap">
              {Object.entries(sourceStats).map(([source, count]) => (
                <div key={source} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${sourceColors[source] || 'bg-muted'}`} />
                  <span className="text-sm font-medium">{source}</span>
                  <Badge variant="secondary" className="text-xs">
                    {count} ({Math.round((count / totalSongs) * 100)}%)
                  </Badge>
                </div>
              ))}
            </div>
            <div className="flex h-4 w-48 rounded-full overflow-hidden bg-secondary">
              {Object.entries(sourceStats).map(([source, count]) => (
                <div 
                  key={source} 
                  className={`h-full ${sourceColors[source] || 'bg-muted'}`}
                  style={{ width: `${(count / totalSongs) * 100}%` }}
                  title={`${source}: ${count}`}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Validation Warnings */}
      {validationWarnings.length > 0 && (
        <Card className="glass-card border-warning/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-medium text-warning mb-2">Músicas Repetidas Detectadas</h4>
                <div className="space-y-1">
                  {validationWarnings.map((warning, i) => (
                    <div key={i} className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{warning.songTitle}</span>
                      <span className="text-muted-foreground"> - {warning.artist}</span>
                      {warning.type === 'same-block' ? (
                        <Badge variant="outline" className="ml-2 text-xs border-warning/50 text-warning">Duplicada no bloco</Badge>
                      ) : (
                        <Badge variant="outline" className="ml-2 text-xs border-accent/50 text-accent">Também em {warning.conflictTime}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live .TXT Preview */}
      <Card className="glass-card border-primary/30">
        <CardHeader className="py-3 border-b border-border">
          <CardTitle className="text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              Preview ao Vivo - Linha no Arquivo .txt
              {validationWarnings.length === 0 && (
                <Badge className="bg-success/20 text-success border-success/30 ml-2">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Validado
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={handleCopyTxt}>
              <Copy className="w-4 h-4 mr-2" />
              Copiar
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="bg-background/80 rounded-lg p-4 font-mono text-xs overflow-x-auto border border-border">
            <pre className="whitespace-pre-wrap break-all text-foreground">
              {generateTxtLine}
            </pre>
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span>📄 Arquivo: SEX.txt (exemplo)</span>
            <span>🕐 Bloco: {timeKey}</span>
            <span>🎵 {currentSongs.length} itens</span>
            {history.length > 0 && (
              <span>📝 Histórico: {historyIndex + 1}/{history.length}</span>
            )}
          </div>
        </CardContent>
      </Card>

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
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                  {currentSongs.map((song, index) => (
                    <div key={song.id} className="flex items-center gap-2">
                      <span className="w-6 text-center text-sm font-mono text-muted-foreground">
                        {(index + 1).toString().padStart(2, '0')}
                      </span>
                      <div className="flex-1">
                        <SortableSong
                          song={song}
                          onRemove={() => handleRemoveSong(song.id)}
                          hasWarning={warningSongIds.has(song.id)}
                        />
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

        {/* Right Panel */}
        <div className="space-y-4">
          {/* Templates Section */}
          <Card className="glass-card border-accent/20">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bookmark className="w-4 h-4 text-accent" />
                  Templates ({templates.length})
                </div>
                <div className="flex items-center gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportTemplates}
                    className="hidden"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => fileInputRef.current?.click()}
                    title="Importar templates"
                  >
                    <Upload className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleExportTemplates}
                    title="Exportar templates"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setShowTemplateInput(!showTemplateInput)}
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              {showTemplateInput && (
                <div className="p-2 mb-2 rounded-lg bg-secondary/30 space-y-2">
                  <Input
                    placeholder="Nome do template..."
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={handleSaveTemplate}>
                      <Save className="w-3 h-3 mr-1" />
                      Salvar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowTemplateInput(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors group"
                  >
                    <button
                      onClick={() => handleLoadTemplate(template)}
                      className="flex-1 flex items-center gap-2 text-left"
                    >
                      <Bookmark className="w-4 h-4 text-accent" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{template.name}</p>
                        <p className="text-xs text-muted-foreground">{template.songs.length} itens</p>
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteTemplate(template.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Add Fixed Content */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-accent" />
                Adicionar Conteúdo Fixo
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <div className="space-y-1 max-h-36 overflow-y-auto">
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
              <div className="space-y-1 max-h-48 overflow-y-auto">
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
              <h4 className="text-sm font-medium text-primary mb-2">💡 Atalhos</h4>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• ↶↷ Desfazer/Refazer alterações</li>
                <li>• 📊 Barra mostra distribuição</li>
                <li>• 🗂️ "Lote" aplica a vários horários</li>
                <li>• ⚠️ Amarelo = música repetida</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
