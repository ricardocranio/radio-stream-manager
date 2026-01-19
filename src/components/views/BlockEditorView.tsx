import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { GripVertical, Music, Clock, Save, RotateCcw, Plus, Trash2, Newspaper, FileText, Copy, BookmarkPlus, Bookmark, Download, Upload, AlertTriangle, CheckCircle, Eye, Undo2, Redo2, Layers, BarChart3, Pencil } from 'lucide-react';
import { sanitizeFilename } from '@/lib/sanitizeFilename';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  useDroppable,
  useDraggable,
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
  onEdit: () => void;
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

function SortableSong({ song, onRemove, onEdit, hasWarning }: SortableSongProps) {
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
        className="h-7 w-7 text-muted-foreground hover:text-primary"
        onClick={onEdit}
        title="Editar"
      >
        <Pencil className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        title="Remover"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// Draggable item for fixed content and music pool
interface DraggablePoolItemProps {
  item: Omit<BlockSong, 'id'>;
  index: number;
  type: 'fixed' | 'music';
  onAdd: () => void;
  onEdit?: () => void;
}

function DraggablePoolItem({ item, index, type, onAdd, onEdit }: DraggablePoolItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pool-${type}-${index}`,
    data: { item, type },
  });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`w-full flex items-center gap-2 p-2 rounded transition-colors cursor-grab active:cursor-grabbing ${
        isDragging ? 'bg-primary/20 border border-primary/50' : 'hover:bg-secondary/50'
      }`}
      {...attributes}
      {...listeners}
    >
      <div className={`w-6 h-6 rounded flex items-center justify-center ${type === 'fixed' ? 'bg-accent/20' : 'bg-primary/20'}`}>
        <GripVertical className={`w-3 h-3 ${type === 'fixed' ? 'text-accent' : 'text-primary'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
        <p className="text-xs text-muted-foreground truncate">{type === 'fixed' ? item.file : item.artist}</p>
      </div>
      {type === 'music' && (
        <Badge variant="secondary" className="text-xs shrink-0">
          {item.source}
        </Badge>
      )}
      {type === 'fixed' && onEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Editar horários"
        >
          <Pencil className="w-3 h-3" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        title="Adicionar ao bloco"
      >
        <Plus className="w-3 h-3" />
      </Button>
    </div>
  );
}

// Demo songs pool - REMOVED: Now using dynamicSongPool from captured songs

const fixedContentPool: Omit<BlockSong, 'id'>[] = [
  { title: 'Notícia da Hora', artist: 'Conteúdo Fixo', file: 'NOTICIA_DA_HORA_14HORAS.mp3', source: 'FIXO', isFixed: true },
  { title: 'Horóscopo do Dia', artist: 'Conteúdo Fixo', file: 'HOROSCOPO_DO_DIA.mp3', source: 'FIXO', isFixed: true },
  { title: 'Fique Sabendo', artist: 'Conteúdo Fixo', file: 'FIQUE_SABENDO.mp3', source: 'FIXO', isFixed: true },
  { title: 'As Últimas do Esporte', artist: 'Conteúdo Fixo', file: 'AS_ULTIMAS_DO_ESPORTE.mp3', source: 'FIXO', isFixed: true },
];

// Default templates - now empty, templates are created dynamically from captured songs
const defaultTemplates: BlockTemplate[] = [];

// Dynamic source colors palette
const colorPalette = [
  'bg-primary',
  'bg-accent', 
  'bg-emerald-500',
  'bg-pink-500',
  'bg-orange-500',
  'bg-cyan-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-teal-500',
];

export function BlockEditorView() {
  const { blockSongs, setBlockSongs, fixedContent, addFixedContent, updateFixedContent, programs, stations, capturedSongs } = useRadioStore();
  
  // Generate dynamic source colors based on registered stations
  const sourceColors = useMemo(() => {
    const colors: Record<string, string> = { 'FIXO': 'bg-purple-500' };
    stations.forEach((station, index) => {
      // Use station name abbreviation (first letters or ID)
      const abbrev = station.name.split(' ').map(w => w[0]).join('').toUpperCase();
      colors[abbrev] = colorPalette[index % colorPalette.length];
      colors[station.name] = colorPalette[index % colorPalette.length];
      colors[station.id.toUpperCase()] = colorPalette[index % colorPalette.length];
    });
    return colors;
  }, [stations]);
  
  // Generate song pool from captured songs (real data from stations)
  const dynamicSongPool = useMemo(() => {
    if (capturedSongs.length === 0) {
      // Fallback to station-based demo songs if no captures yet
      // Generate enough songs to fill 10 slots per block
      const demoSongs: Omit<BlockSong, 'id'>[] = [];
      let songIndex = 0;
      
      // Keep adding songs until we have at least 10
      while (demoSongs.length < 12 && stations.length > 0) {
        const station = stations[songIndex % stations.length];
        const abbrev = station.name.split(' ').map(w => w[0]).join('').toUpperCase();
        const songNum = Math.floor(songIndex / stations.length) + 1;
        
        demoSongs.push({
          title: `Demo Song ${songNum} - ${station.name}`,
          artist: 'Artista Demo',
          file: `demo_${station.id}_${songNum}.mp3`,
          source: abbrev,
          isFixed: false,
        });
        songIndex++;
      }
      
      return demoSongs;
    }
    
    // Use real captured songs - get unique songs
    const uniqueSongs = new Map<string, Omit<BlockSong, 'id'>>();
    capturedSongs.forEach(song => {
      const key = `${song.title}-${song.artist}`;
      if (!uniqueSongs.has(key)) {
        const stationAbbrev = song.station.split(' ').map(w => w[0]).join('').toUpperCase();
        uniqueSongs.set(key, {
          title: song.title,
          artist: song.artist,
          file: `${song.artist} - ${song.title}.mp3`,
          source: stationAbbrev,
          isFixed: false,
        });
      }
    });
    return Array.from(uniqueSongs.values()).slice(0, 50); // Max 50 songs
  }, [capturedSongs, stations]);
  // Generate automatic templates based on station styles
  const autoTemplates = useMemo(() => {
    const templates: BlockTemplate[] = [];
    
    stations.forEach((station) => {
      const abbrev = station.name.split(' ').map(w => w[0]).join('').toUpperCase();
      const stationSongs = dynamicSongPool.filter(s => s.source === abbrev);
      
      if (stationSongs.length >= 3) {
        templates.push({
          id: `auto-${station.id}`,
          name: `${station.name} - ${station.styles?.[0] || 'Mix'}`,
          songs: stationSongs.slice(0, 8).map((s, i) => ({ ...s, id: `auto-${station.id}-${i}` })),
          createdAt: new Date().toISOString(),
        });
      }
    });
    
    // Mixed template with songs from all stations
    if (dynamicSongPool.length >= 8) {
      const mixedSongs: typeof dynamicSongPool = [];
      let index = 0;
      while (mixedSongs.length < 10 && index < dynamicSongPool.length) {
        // Distribute songs evenly from different sources
        const sourcesUsed = new Set(mixedSongs.map(s => s.source));
        const song = dynamicSongPool[index];
        if (!sourcesUsed.has(song.source) || mixedSongs.length >= stations.length) {
          mixedSongs.push(song);
        }
        index++;
      }
      
      if (mixedSongs.length >= 5) {
        templates.push({
          id: 'auto-mixed',
          name: 'Mix de Emissoras',
          songs: mixedSongs.map((s, i) => ({ ...s, id: `auto-mixed-${i}` })),
          createdAt: new Date().toISOString(),
        });
      }
    }
    
    return templates;
  }, [stations, dynamicSongPool]);
  
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedHour, setSelectedHour] = useState(14);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [templates, setTemplates] = useState<BlockTemplate[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showTemplateInput, setShowTemplateInput] = useState(false);
  const [showDayPreview, setShowDayPreview] = useState(false);
  const [showBatchMode, setShowBatchMode] = useState(false);
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<string[]>([]);
  const [selectedTemplateForBatch, setSelectedTemplateForBatch] = useState<string>('');
  
  // Edit song state
  const [editingSong, setEditingSong] = useState<BlockSong | null>(null);
  const [editForm, setEditForm] = useState({ title: '', artist: '', file: '', source: '' });
  
  // Edit fixed content state
  const [editingFixedContent, setEditingFixedContent] = useState<number | null>(null);
  const [editFixedForm, setEditFixedForm] = useState({ title: '', file: '', timeSlots: '' });
  
  // History for undo/redo
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isUndoRedo, setIsUndoRedo] = useState(false);

  const timeKey = `${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;

  // Initialize songs for this block ONCE and save to store - blocks stay fixed after creation
  const currentSongs = useMemo(() => {
    // If block already exists in store, use it (stable)
    if (blockSongs[timeKey] && blockSongs[timeKey].length > 0) {
      return blockSongs[timeKey];
    }
    // Block doesn't exist - will be initialized on first render
    return [];
  }, [blockSongs, timeKey]);

  // Auto-initialize empty blocks with songs from pool (only once)
  useEffect(() => {
    if (!blockSongs[timeKey] || blockSongs[timeKey].length === 0) {
      if (dynamicSongPool.length > 0) {
        const initialSongs = dynamicSongPool.slice(0, 10).map((s, i) => ({ 
          ...s, 
          id: `${timeKey}-init-${i}-${Date.now()}` 
        }));
        setBlockSongs(timeKey, initialSongs);
        console.log(`[BLOCK-EDITOR] Bloco ${timeKey} inicializado com ${initialSongs.length} músicas`);
      }
    }
  }, [timeKey, blockSongs, dynamicSongPool, setBlockSongs]);

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
  const generateTxtLineForTime = useCallback((hour: number, minute: number) => {
    const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const key = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const program = getProgramForHour(hour);
    const songs = blockSongs[key] || dynamicSongPool.slice(0, 10).map((s, i) => ({ ...s, id: `${key}-${i}` }));
    // Sanitize filenames: remove accents, replace & with "e", remove special chars
    const songFiles = songs.map(s => `"${sanitizeFilename(s.file)}"`).join(',vht,');
    return `${time} (ID=${program}) ${songFiles}`;
  }, [blockSongs, dynamicSongPool]);

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
    
    // Check if it's a drag from the pool (fixed content or music)
    const activeId = String(active.id);
    if (activeId.startsWith('pool-')) {
      // Adding new item from pool
      const data = active.data.current as { item: Omit<BlockSong, 'id'>; type: string } | undefined;
      if (data?.item) {
        const newSong: BlockSong = { ...data.item, id: `${timeKey}-drag-${Date.now()}` };
        const newSongs = [...currentSongs, newSong];
        setBlockSongs(timeKey, newSongs);
        addToHistory(timeKey, newSongs, `Arrastar ${data.item.title}`);
        toast({ title: 'Item adicionado', description: data.item.title });
      }
      return;
    }
    
    // Reordering within the list
    if (over && active.id !== over.id) {
      const oldIndex = currentSongs.findIndex((s) => s.id === active.id);
      const newIndex = currentSongs.findIndex((s) => s.id === over.id);
      if (oldIndex >= 0 && newIndex >= 0) {
        const newSongs = arrayMove(currentSongs, oldIndex, newIndex);
        setBlockSongs(timeKey, newSongs);
        addToHistory(timeKey, newSongs, 'Reordenar músicas');
      }
    }
  };

  const handleRemoveSong = (id: string) => {
    const newSongs = currentSongs.filter((s) => s.id !== id);
    setBlockSongs(timeKey, newSongs);
    addToHistory(timeKey, newSongs, 'Remover música');
  };

  const handleEditSong = (song: BlockSong) => {
    setEditingSong(song);
    setEditForm({
      title: song.title,
      artist: song.artist,
      file: song.file,
      source: song.source,
    });
  };

  const handleSaveEdit = () => {
    if (!editingSong) return;
    
    const newSongs = currentSongs.map(s => 
      s.id === editingSong.id 
        ? { ...s, title: editForm.title, artist: editForm.artist, file: editForm.file, source: editForm.source }
        : s
    );
    setBlockSongs(timeKey, newSongs);
    addToHistory(timeKey, newSongs, `Editar ${editForm.title}`);
    setEditingSong(null);
    toast({ title: 'Item atualizado', description: editForm.title });
  };

  const handleCancelEdit = () => {
    setEditingSong(null);
    setEditForm({ title: '', artist: '', file: '', source: '' });
  };

  const handleAddSong = (song: Omit<BlockSong, 'id'>) => {
    const newSong: BlockSong = { ...song, id: `${timeKey}-${Date.now()}` };
    const newSongs = [...currentSongs, newSong];
    setBlockSongs(timeKey, newSongs);
    addToHistory(timeKey, newSongs, `Adicionar ${song.title}`);
    toast({ title: 'Item adicionado', description: song.title });
  };

  // Fixed content edit handlers
  const handleEditFixedContent = (index: number) => {
    const content = fixedContentPool[index];
    setEditingFixedContent(index);
    setEditFixedForm({
      title: content.title,
      file: content.file,
      timeSlots: '', // Will be populated from fixedContent store if exists
    });
    
    // Find corresponding entry in store
    const storeContent = fixedContent.find(fc => fc.name === content.title);
    if (storeContent) {
      setEditFixedForm(prev => ({
        ...prev,
        timeSlots: storeContent.timeSlots.map(ts => `${ts.hour.toString().padStart(2, '0')}:${ts.minute.toString().padStart(2, '0')}`).join(', ')
      }));
    }
  };

  const handleSaveFixedContentEdit = () => {
    if (editingFixedContent === null) return;
    
    const content = fixedContentPool[editingFixedContent];
    
    // Parse time slots
    const timeSlots = editFixedForm.timeSlots
      .split(',')
      .map(s => s.trim())
      .filter(s => s.match(/^\d{2}:\d{2}$/))
      .map(s => {
        const [hour, minute] = s.split(':').map(Number);
        return { hour, minute };
      });
    
    // Find or create fixed content entry in store
    const existingIndex = fixedContent.findIndex(fc => fc.name === content.title);
    
    if (existingIndex >= 0) {
      updateFixedContent(fixedContent[existingIndex].id, {
        fileName: editFixedForm.file,
        timeSlots,
      });
    } else {
      addFixedContent({
        id: `fixed-${Date.now()}`,
        name: editFixedForm.title,
        fileName: editFixedForm.file,
        type: 'other',
        dayPattern: 'ALL',
        timeSlots,
        enabled: true,
      });
    }
    
    setEditingFixedContent(null);
    toast({ title: 'Conteúdo fixo atualizado', description: `Horários: ${timeSlots.length}` });
  };

  const handleReset = () => {
    console.log('[BLOCK-EDITOR] Resetando bloco:', timeKey);
    const defaultSongs = dynamicSongPool.slice(0, 10).map((s, i) => ({ ...s, id: `${timeKey}-reset-${i}-${Date.now()}` }));
    console.log('[BLOCK-EDITOR] Novas músicas:', defaultSongs.length);
    setBlockSongs(timeKey, defaultSongs);
    addToHistory(timeKey, defaultSongs, 'Resetar bloco');
    toast({ title: 'Bloco resetado', description: `${defaultSongs.length} músicas restauradas.` });
  };

  // Auto-fix duplicates: replace with same DNA/source or next available song
  const handleFixDuplicates = useCallback(() => {
    if (validationWarnings.length === 0) return;
    
    const usedSongs = new Set<string>();
    const newSongs: BlockSong[] = [];
    
    currentSongs.forEach((song) => {
      const songKey = `${song.title}-${song.artist}`;
      
      if (song.isFixed || !usedSongs.has(songKey)) {
        // Not a duplicate, keep it
        usedSongs.add(songKey);
        newSongs.push(song);
      } else {
        // Duplicate found - find replacement with same source/DNA
        const sameSourceSongs = dynamicSongPool.filter(s => 
          s.source === song.source && 
          !usedSongs.has(`${s.title}-${s.artist}`) &&
          !currentSongs.some(cs => cs.title === s.title && cs.artist === s.artist)
        );
        
        if (sameSourceSongs.length > 0) {
          // Replace with same DNA
          const replacement = sameSourceSongs[0];
          usedSongs.add(`${replacement.title}-${replacement.artist}`);
          newSongs.push({ ...replacement, id: `${timeKey}-fix-${Date.now()}-${newSongs.length}` });
        } else {
          // No same DNA available, use any available song
          const anySong = dynamicSongPool.find(s => 
            !usedSongs.has(`${s.title}-${s.artist}`) &&
            !currentSongs.some(cs => cs.title === s.title && cs.artist === s.artist)
          );
          
          if (anySong) {
            usedSongs.add(`${anySong.title}-${anySong.artist}`);
            newSongs.push({ ...anySong, id: `${timeKey}-fix-${Date.now()}-${newSongs.length}` });
          }
          // If no replacement found, skip the duplicate
        }
      }
    });
    
    setBlockSongs(timeKey, newSongs);
    addToHistory(timeKey, newSongs, 'Corrigir duplicatas');
    toast({ 
      title: 'Duplicatas corrigidas', 
      description: `${validationWarnings.length} músicas substituídas por mesmo DNA/fonte.` 
    });
  }, [currentSongs, dynamicSongPool, validationWarnings, timeKey, setBlockSongs, addToHistory, toast]);

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

      {/* Source Statistics - Shows ALL registered stations */}
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Distribuição por Fonte:</span>
            </div>
            <div className="flex-1 flex items-center gap-3 flex-wrap">
              {/* Show all registered stations, even if count is 0 */}
              {stations.map((station) => {
                const abbrev = station.name.split(' ').map(w => w[0]).join('').toUpperCase();
                const count = sourceStats[abbrev] || 0;
                return (
                  <div key={station.id} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${sourceColors[abbrev] || 'bg-muted'}`} />
                    <span className="text-sm font-medium">{abbrev}</span>
                    <Badge variant="secondary" className="text-xs">
                      {count} ({totalSongs > 0 ? Math.round((count / totalSongs) * 100) : 0}%)
                    </Badge>
                  </div>
                );
              })}
              {/* Show FIXO if present */}
              {sourceStats['FIXO'] && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500" />
                  <span className="text-sm font-medium">FIXO</span>
                  <Badge variant="secondary" className="text-xs">
                    {sourceStats['FIXO']} ({Math.round((sourceStats['FIXO'] / totalSongs) * 100)}%)
                  </Badge>
                </div>
              )}
            </div>
            <div className="flex h-4 w-48 rounded-full overflow-hidden bg-secondary">
              {stations.map((station) => {
                const abbrev = station.name.split(' ').map(w => w[0]).join('').toUpperCase();
                const count = sourceStats[abbrev] || 0;
                return (
                  <div 
                    key={station.id} 
                    className={`h-full ${sourceColors[abbrev] || 'bg-muted'}`}
                    style={{ width: totalSongs > 0 ? `${(count / totalSongs) * 100}%` : '0%' }}
                    title={`${station.name}: ${count}`}
                  />
                );
              })}
              {sourceStats['FIXO'] && (
                <div 
                  className="h-full bg-purple-500"
                  style={{ width: `${(sourceStats['FIXO'] / totalSongs) * 100}%` }}
                  title={`FIXO: ${sourceStats['FIXO']}`}
                />
              )}
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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
            <SortableContext items={currentSongs.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 min-h-[200px] border-2 border-dashed border-transparent hover:border-primary/30 rounded-lg transition-colors">
                {currentSongs.map((song, index) => (
                  <div key={song.id} className="flex items-center gap-2">
                    <span className="w-6 text-center text-sm font-mono text-muted-foreground">
                      {(index + 1).toString().padStart(2, '0')}
                    </span>
                    <div className="flex-1">
                      <SortableSong
                        song={song}
                        onRemove={() => handleRemoveSong(song.id)}
                        onEdit={() => handleEditSong(song)}
                        hasWarning={warningSongIds.has(song.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </SortableContext>

            {currentSongs.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Music className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Nenhum item neste bloco</p>
                <p className="text-sm">Adicione músicas ou conteúdos fixos</p>
              </div>
            )}

            {/* Edit Song Modal */}
            {editingSong && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <Card className="w-full max-w-md mx-4">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Pencil className="w-4 h-4" />
                      Editar Item
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-foreground">Título</label>
                      <Input
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        placeholder="Título da música"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Artista</label>
                      <Input
                        value={editForm.artist}
                        onChange={(e) => setEditForm({ ...editForm, artist: e.target.value })}
                        placeholder="Nome do artista"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Arquivo</label>
                      <Input
                        value={editForm.file}
                        onChange={(e) => setEditForm({ ...editForm, file: e.target.value })}
                        placeholder="nome_do_arquivo.mp3"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Fonte</label>
                      <Select value={editForm.source} onValueChange={(v) => setEditForm({ ...editForm, source: v })}>
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Selecione a fonte" />
                        </SelectTrigger>
                        <SelectContent>
                          {stations.map(station => {
                            const abbrev = station.name.split(' ').map(w => w[0]).join('').toUpperCase();
                            return (
                              <SelectItem key={station.id} value={abbrev}>{station.name} ({abbrev})</SelectItem>
                            );
                          })}
                          <SelectItem value="FIXO">Conteúdo Fixo (FIXO)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button onClick={handleSaveEdit} className="flex-1">
                        <Save className="w-4 h-4 mr-2" />
                        Salvar
                      </Button>
                      <Button variant="outline" onClick={handleCancelEdit} className="flex-1">
                        Cancelar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
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
              {/* Auto-generated templates based on stations */}
              {autoTemplates.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs text-muted-foreground px-2 mb-1">🤖 Automáticos</p>
                  {autoTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center gap-2 p-2 rounded hover:bg-accent/20 transition-colors"
                    >
                      <button
                        onClick={() => handleLoadTemplate(template)}
                        className="flex-1 flex items-center gap-2 text-left"
                      >
                        <Layers className="w-4 h-4 text-accent" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{template.name}</p>
                          <p className="text-xs text-muted-foreground">{template.songs.length} itens</p>
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              {/* User-created templates */}
              {templates.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground px-2 mb-1">📁 Meus Templates</p>
                  <div className="space-y-1">
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
                </div>
              )}
              
              {autoTemplates.length === 0 && templates.length === 0 && (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  <Bookmark className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  <p>Nenhum template</p>
                  <p className="text-xs">Capture músicas para gerar automáticos</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add Fixed Content - Draggable with Edit */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-accent" />
                Conteúdos Fixos
                <Badge variant="outline" className="text-xs ml-auto">Arraste</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {fixedContentPool.map((content, i) => (
                  <DraggablePoolItem
                    key={i}
                    item={content}
                    index={i}
                    type="fixed"
                    onAdd={() => handleAddSong(content)}
                    onEdit={() => handleEditFixedContent(i)}
                  />
                ))}
              </div>
              
              {/* Edit Fixed Content Modal */}
              {editingFixedContent !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                  <Card className="w-full max-w-md mx-4">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Pencil className="w-4 h-4" />
                        Editar Conteúdo Fixo - Horários
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-foreground">Nome</label>
                        <Input
                          value={editFixedForm.title}
                          onChange={(e) => setEditFixedForm({ ...editFixedForm, title: e.target.value })}
                          placeholder="Nome do conteúdo"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground">Arquivo</label>
                        <Input
                          value={editFixedForm.file}
                          onChange={(e) => setEditFixedForm({ ...editFixedForm, file: e.target.value })}
                          placeholder="NOME_DO_ARQUIVO.mp3"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground">Horários (separados por vírgula)</label>
                        <Input
                          value={editFixedForm.timeSlots}
                          onChange={(e) => setEditFixedForm({ ...editFixedForm, timeSlots: e.target.value })}
                          placeholder="06:00, 12:00, 18:00"
                          className="mt-1"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Formato: HH:MM separados por vírgula
                        </p>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button onClick={handleSaveFixedContentEdit} className="flex-1">
                          <Save className="w-4 h-4 mr-2" />
                          Salvar
                        </Button>
                        <Button variant="outline" onClick={() => setEditingFixedContent(null)} className="flex-1">
                          Cancelar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add Music - Draggable */}
          <Card className="glass-card">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Music className="w-4 h-4 text-primary" />
                Músicas ({dynamicSongPool.length})
                <Badge variant="outline" className="text-xs ml-auto">Arraste</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              {dynamicSongPool.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  <Music className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Nenhuma música capturada</p>
                  <p className="text-xs">Ative as emissoras para capturar</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {dynamicSongPool.map((song, i) => (
                    <DraggablePoolItem
                      key={i}
                      item={song}
                      index={i}
                      type="music"
                      onAdd={() => handleAddSong(song)}
                    />
                  ))}
                </div>
              )}
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
                <li>• 🖱️ Arraste itens para a grade</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
      </DndContext>
    </div>
  );
}
