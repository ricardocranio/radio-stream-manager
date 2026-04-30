import { useState, useMemo, useCallback } from 'react';
import { GripVertical, Save, RotateCcw, Plus, Trash2, Clock, Edit2, Calendar, Power, PlusCircle, MinusCircle, Pencil, X, Check, ChevronDown, FolderOpen, Download, Upload } from 'lucide-react';
import { useRadioStore, getActiveSequence } from '@/store/radioStore';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ScheduledSequence, SequenceConfig, WeekDay } from '@/types/radio';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { LocucaoBadgePopover } from '@/components/locucao/LocucaoBadgePopover';
import { Grade24hCard } from '@/components/locucao/Grade24hCard';
import { clearAllOverrides } from '@/lib/locucao/locucaoSchedulePolicy';

const WEEK_DAYS: { value: WeekDay; label: string }[] = [
  { value: 'dom', label: 'Dom' },
  { value: 'seg', label: 'Seg' },
  { value: 'ter', label: 'Ter' },
  { value: 'qua', label: 'Qua' },
  { value: 'qui', label: 'Qui' },
  { value: 'sex', label: 'Sex' },
  { value: 'sab', label: 'Sáb' },
];

interface SortableSequenceItemProps {
  item: SequenceConfig;
  isFixoItem: boolean;
  isEditing: boolean;
  editingFileName: string;
  setEditingFileName: (v: string) => void;
  handleChange: (position: number, value: string) => void;
  openComboDialog: (type: 'default' | 'form', position: number) => void;
  handleSelectFile: (type: 'default' | 'form', position: number) => void;
  startEditFileName: (position: number, currentFileName: string, source: string) => void;
  saveEditFileName: () => void;
  cancelEditFileName: () => void;
  handleRemovePosition: (position: number) => void;
  getStationColor: (source: string) => string;
  getSourceBadgeLabel: (source: string) => string;
  getDefaultFileName: (source: string) => string;
  localSequenceLength: number;
  catGenres: boolean; setCatGenres: React.Dispatch<React.SetStateAction<boolean>>;
  catDecades: boolean; setCatDecades: React.Dispatch<React.SetStateAction<boolean>>;
  catGenreYear: boolean; setCatGenreYear: React.Dispatch<React.SetStateAction<boolean>>;
  catPrograms: boolean; setCatPrograms: React.Dispatch<React.SetStateAction<boolean>>;
  catSpecials: boolean; setCatSpecials: React.Dispatch<React.SetStateAction<boolean>>;
  catStations: boolean; setCatStations: React.Dispatch<React.SetStateAction<boolean>>;
  catLocucao: boolean; setCatLocucao: React.Dispatch<React.SetStateAction<boolean>>;
  genreOptions: Array<{ value: string; label: string }>;
  yearOptions: Array<{ value: string; label: string }>;
  genreYearOptions: Array<{ value: string; label: string }>;
  programOptions: Array<{ value: string; label: string }>;
  fixedContentOptions: Array<{ value: string; label: string }>;
  stationOptions: Array<{ value: string; label: string }>;
}

function SortableSequenceItem({ item, isFixoItem, isEditing, ...props }: SortableSequenceItemProps & { justDropped?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `seq-${item.position}`,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-2 rounded-lg bg-secondary/30 border transition-all duration-300 group ${
        isFixoItem ? 'border-emerald-500/30 hover:border-emerald-500/50' : 'border-border hover:border-primary/30'
      } ${isDragging ? 'shadow-lg ring-2 ring-primary/40 scale-105' : ''} ${
        props.justDropped ? 'ring-2 ring-primary/60 bg-primary/10 animate-scale-in' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-muted-foreground cursor-grab active:cursor-grabbing touch-none" {...attributes} {...listeners}>
          <GripVertical className="w-3 h-3" />
          <span className="font-mono font-bold text-foreground w-5 text-xs">{item.position.toString().padStart(2, '0')}</span>
        </div>
        <Select value={item.radioSource} onValueChange={(value) => props.handleChange(item.position, value)}>
          <SelectTrigger className="flex-1 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-[400px]">
            <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-secondary/50 rounded select-none" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); props.setCatGenres(v => !v); }}>
              <span>🎵 Gêneros</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${props.catGenres ? 'rotate-180' : ''}`} />
            </div>
            {props.catGenres && props.genreOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            <div className="px-2 py-1.5 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-secondary/50 rounded select-none" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); props.setCatDecades(v => !v); }}>
              <span>📅 Décadas</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${props.catDecades ? 'rotate-180' : ''}`} />
            </div>
            {props.catDecades && props.yearOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            <div className="px-2 py-1.5 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-secondary/50 rounded select-none" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); props.setCatGenreYear(v => !v); }}>
              <span>🎵📅 Gênero + Década</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${props.catGenreYear ? 'rotate-180' : ''}`} />
            </div>
            {props.catGenreYear && props.genreYearOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            <div className="px-2 py-1.5 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-secondary/50 rounded select-none" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); props.setCatPrograms(v => !v); }}>
              <span>📺 Programas</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${props.catPrograms ? 'rotate-180' : ''}`} />
            </div>
            {props.catPrograms && props.programOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            <div className="px-2 py-1.5 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-secondary/50 rounded select-none" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); props.setCatSpecials(v => !v); }}>
              <span>⭐ Especiais</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${props.catSpecials ? 'rotate-180' : ''}`} />
            </div>
            {props.catSpecials && (<>
              <SelectItem value="random_pop">🎲 Aleatório (Disney/Metro)</SelectItem>
              <SelectItem value="top50">🏆 TOP25 (Curadoria)</SelectItem>
              {props.fixedContentOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </>)}
            <div className="px-2 py-1.5 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-secondary/50 rounded select-none" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); props.setCatLocucao(v => !v); }}>
              <span>🎙️ Locução</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${props.catLocucao ? 'rotate-180' : ''}`} />
            </div>
            {props.catLocucao && (<>
              <SelectItem value="LOC">🎙️ LOC — Abertura de locução</SelectItem>
              <SelectItem value="LOC_END">🎙️ LOC_END — Fechamento de locução</SelectItem>
            </>)}
            <div className="px-2 py-1.5 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-secondary/50 rounded select-none" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); props.setCatStations(v => !v); }}>
              <span>📻 Emissoras</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${props.catStations ? 'rotate-180' : ''}`} />
            </div>
            {props.catStations && props.stationOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {(item.radioSource === 'LOC' || item.radioSource === 'LOC_END') ? (
          <LocucaoBadgePopover
            source={item.radioSource as 'LOC' | 'LOC_END'}
            className={`${props.getStationColor(item.radioSource)} text-[9px] px-1`}
            label={props.getSourceBadgeLabel(item.radioSource)}
          />
        ) : (
          <Badge variant="outline" className={`${props.getStationColor(item.radioSource)} text-[9px] px-1`}>{props.getSourceBadgeLabel(item.radioSource)}</Badge>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10" onClick={() => props.openComboDialog('default', item.position)} title="Combo Manual"><Edit2 className="w-3 h-3" /></Button>
        {window.electronAPI?.selectFile && (
          <Button variant="ghost" size="icon" className="h-6 w-6 text-sky-400 hover:text-sky-300 hover:bg-sky-500/10" onClick={() => props.handleSelectFile('default', item.position)} title="Selecionar arquivo local"><FolderOpen className="w-3 h-3" /></Button>
        )}
        {isFixoItem && !isEditing && (
          <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10" onClick={() => props.startEditFileName(item.position, item.customFileName || '', item.radioSource)} title="Editar nome"><Pencil className="w-3 h-3" /></Button>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => props.handleRemovePosition(item.position)} disabled={props.localSequenceLength <= 5}><Trash2 className="w-3 h-3" /></Button>
      </div>
      {isEditing && (
        <div className="mt-2 flex items-center gap-2">
          <Input value={props.editingFileName} onChange={(e) => props.setEditingFileName(e.target.value)} placeholder="NOTICIA_DA_HORA_18HORAS" className="h-7 text-xs flex-1 font-mono" />
          <Button variant="ghost" size="icon" className="h-6 w-6 text-green-500 hover:text-green-400 hover:bg-green-500/10" onClick={props.saveEditFileName}><Check className="w-3 h-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={props.cancelEditFileName}><X className="w-3 h-3" /></Button>
        </div>
      )}
      {isFixoItem && !isEditing && (
        <div className="mt-1 pl-8 flex items-center gap-2 cursor-pointer hover:bg-emerald-500/10 rounded px-2 py-1 -mx-2" onClick={() => props.startEditFileName(item.position, item.customFileName || '', item.radioSource)}>
          <span className="text-[10px] text-emerald-400 font-mono flex-1">{item.customFileName || props.getDefaultFileName(item.radioSource)}</span>
          <Pencil className="w-3 h-3 text-emerald-400/60" />
        </div>
      )}
      {item.radioSource.startsWith('file_') && (
        <div className="mt-1 pl-8 flex items-center gap-2 cursor-pointer hover:bg-sky-500/10 rounded px-2 py-1 -mx-2" onClick={() => props.handleSelectFile('default', item.position)}>
          <span className="text-[10px] text-sky-400 font-mono flex-1 truncate">{item.radioSource.replace('file_', '').split(/[/\\]/).pop()}</span>
          <FolderOpen className="w-3 h-3 text-sky-400/60" />
        </div>
      )}
    </div>
  );
}

export function SequenceView() {
  const [defaultOpen, setDefaultOpen] = useState(true);
  const [fixedOpen, setFixedOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);

  // Collapsible category states for source picker
  const [catGenres, setCatGenres] = useState(true);
  const [catDecades, setCatDecades] = useState(false);
  const [catGenreYear, setCatGenreYear] = useState(false);
  const [catPrograms, setCatPrograms] = useState(false);
  const [catSpecials, setCatSpecials] = useState(false);
  const [catStations, setCatStations] = useState(true);
  const [catLocucao, setCatLocucao] = useState(false);
  const { 
    sequence, 
    setSequence, 
    stations, 
    scheduledSequences,
    addScheduledSequence,
    updateScheduledSequence,
    removeScheduledSequence,
    fixedContent,
    programs,
    config,
    setConfig,
    resetProgramming,
  } = useRadioStore();
  const { toast } = useToast();
  const [localSequence, setLocalSequence] = useState(sequence);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const [droppedPosition, setDroppedPosition] = useState<number | null>(null);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    setLocalSequence((prev) => {
      const oldIndex = prev.findIndex(item => `seq-${item.position}` === active.id);
      const newIndex = prev.findIndex(item => `seq-${item.position}` === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const moved = arrayMove(prev, oldIndex, newIndex);
      const renumbered = moved.map((item, i) => ({ ...item, position: i + 1 }));
      // Auto-save to store after drag
      setTimeout(() => {
        setSequence(renumbered);
        toast({
          title: '✅ Sequência reordenada',
          description: 'A nova ordem foi salva automaticamente.',
        });
      }, 0);
      // Flash the dropped item
      setDroppedPosition(newIndex + 1);
      setTimeout(() => setDroppedPosition(null), 800);
      return renumbered;
    });
  }, [setSequence, toast]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduledSequence | null>(null);
  
  // State for editing custom filename
  const [editingPosition, setEditingPosition] = useState<number | null>(null);
  const [editingFileName, setEditingFileName] = useState('');
  const [editingFormPosition, setEditingFormPosition] = useState<number | null>(null);
  const [editingFormFileName, setEditingFormFileName] = useState('');

  // Custom combo manual state
  const [comboDialogOpen, setComboDialogOpen] = useState(false);
  const [comboTarget, setComboTarget] = useState<{ type: 'default' | 'form'; position: number } | null>(null);
  const [comboGenres, setComboGenres] = useState<string[]>([]);
  const [comboDecade, setComboDecade] = useState('90s');

  // Form state for new/edit scheduled sequence
  const [formName, setFormName] = useState('');
  const [formStartHour, setFormStartHour] = useState(18);
  const [formStartMinute, setFormStartMinute] = useState(0);
  const [formEndHour, setFormEndHour] = useState(22);
  const [formEndMinute, setFormEndMinute] = useState(0);
  const [formWeekDays, setFormWeekDays] = useState<WeekDay[]>([]);
  const [formPriority, setFormPriority] = useState(1);
  const [formSequence, setFormSequence] = useState<SequenceConfig[]>(sequence);

  // Build radio options with stations first, then special options, then each fixed content
  const stationOptions = stations
    .filter(s => s.enabled === true)
    .map((s) => ({ value: s.id, label: s.name }));
  
  // Create individual options for each fixed content
  const fixedContentOptions = fixedContent
    .filter(c => c.enabled)
    .map((c) => ({ 
      value: `fixo_${c.id}`, 
      label: `📌 ${c.name}`,
      isFixo: true 
    }));
  
  // Genre-based options for sequence building
  const genreOptions = [
    { value: 'genre_SERTANEJO', label: '🎸 Sertanejo', isFixo: false },
    { value: 'genre_PAGODE', label: '🥁 Pagode', isFixo: false },
    { value: 'genre_FUNK', label: '🎵 Funk', isFixo: false },
    { value: 'genre_POP', label: '🎤 Pop', isFixo: false },
    { value: 'genre_MPB', label: '🎶 MPB', isFixo: false },
    { value: 'genre_ROCK,METAL', label: '🤘 Rock & Metal', isFixo: false },
    { value: 'genre_ROMANTICO', label: '💕 Romântico', isFixo: false },
    { value: 'genre_FORRO', label: '🪗 Forró', isFixo: false },
    { value: 'genre_DANCE,ELETRONICA', label: '🎧 Dance / Eletrônica', isFixo: false },
    { value: 'genre_ELETRONICA', label: '🔊 Eletrônica', isFixo: false },
  ];

  // Year/decade-based options
  const yearOptions = [
    { value: 'year_80s', label: '📅 Anos 80 (1980-1989)', isFixo: false },
    { value: 'year_90s', label: '📅 Anos 90 (1990-1999)', isFixo: false },
    { value: 'year_2000s', label: '📅 Anos 2000 (2000-2009)', isFixo: false },
    { value: 'year_2010s', label: '📅 Anos 2010 (2010-2019)', isFixo: false },
    { value: 'year_2020s', label: '📅 Anos 2020 (2020+)', isFixo: false },
  ];

  // Combined genre + year options
  const genreYearOptions = [
    // Single genre + decade
    { value: 'genreyear_POP_80s', label: '🎤📅 Pop Anos 80', isFixo: false },
    { value: 'genreyear_POP_90s', label: '🎤📅 Pop Anos 90', isFixo: false },
    { value: 'genreyear_POP_2000s', label: '🎤📅 Pop Anos 2000', isFixo: false },
    { value: 'genreyear_ROCK,METAL_80s', label: '🤘📅 Rock Anos 80', isFixo: false },
    { value: 'genreyear_ROCK,METAL_90s', label: '🤘📅 Rock Anos 90', isFixo: false },
    { value: 'genreyear_ROCK,METAL_2000s', label: '🤘📅 Rock Anos 2000', isFixo: false },
    { value: 'genreyear_SERTANEJO_90s', label: '🎸📅 Sertanejo Anos 90', isFixo: false },
    { value: 'genreyear_SERTANEJO_2000s', label: '🎸📅 Sertanejo Anos 2000', isFixo: false },
    { value: 'genreyear_SERTANEJO_2010s', label: '🎸📅 Sertanejo Anos 2010', isFixo: false },
    { value: 'genreyear_MPB_80s', label: '🎶📅 MPB Anos 80', isFixo: false },
    { value: 'genreyear_MPB_90s', label: '🎶📅 MPB Anos 90', isFixo: false },
    { value: 'genreyear_PAGODE_90s', label: '🥁📅 Pagode Anos 90', isFixo: false },
    { value: 'genreyear_PAGODE_2000s', label: '🥁📅 Pagode Anos 2000', isFixo: false },
    { value: 'genreyear_ROMANTICO_80s', label: '💕📅 Romântico Anos 80', isFixo: false },
    { value: 'genreyear_ROMANTICO_90s', label: '💕📅 Romântico Anos 90', isFixo: false },
    { value: 'genreyear_FORRO_2000s', label: '🪗📅 Forró Anos 2000', isFixo: false },
    { value: 'genreyear_FUNK_2010s', label: '🎵📅 Funk Anos 2010', isFixo: false },
    { value: 'genreyear_FUNK_2020s', label: '🎵📅 Funk Anos 2020', isFixo: false },
    // Multi-genre combos
    { value: 'genreyear_POP,ROCK,DANCE_90s', label: '🎧📅 Pop/Rock/Dance Anos 90', isFixo: false },
    { value: 'genreyear_POP,ROCK,DANCE_2000s', label: '🎧📅 Pop/Rock/Dance Anos 2000', isFixo: false },
    { value: 'genreyear_POP,ROCK_80s', label: '🎧📅 Pop/Rock Anos 80', isFixo: false },
    { value: 'genreyear_POP,ROCK_90s', label: '🎧📅 Pop/Rock Anos 90', isFixo: false },
    { value: 'genreyear_POP,DANCE_2000s', label: '🎧📅 Pop/Dance Anos 2000', isFixo: false },
    { value: 'genreyear_POP,DANCE_2010s', label: '🎧📅 Pop/Dance Anos 2010', isFixo: false },
    { value: 'genreyear_SERTANEJO,PAGODE_90s', label: '🎸🥁📅 Sertanejo/Pagode Anos 90', isFixo: false },
    { value: 'genreyear_SERTANEJO,PAGODE_2000s', label: '🎸🥁📅 Sertanejo/Pagode Anos 2000', isFixo: false },
    { value: 'genreyear_ELETRONICA_90s', label: '🔊📅 Eletrônica Anos 90', isFixo: false },
    { value: 'genreyear_ELETRONICA_2000s', label: '🔊📅 Eletrônica Anos 2000', isFixo: false },
    { value: 'genreyear_ELETRONICA_2010s', label: '🔊📅 Eletrônica Anos 2010', isFixo: false },
    { value: 'genreyear_ELETRONICA,DANCE_90s', label: '🎧📅 Dance/Eletrônica Anos 90', isFixo: false },
    { value: 'genreyear_ELETRONICA,DANCE_2000s', label: '🎧📅 Dance/Eletrônica Anos 2000', isFixo: false },
  ];

  // Template program options for sequence building
  const programOptions = [
    // Weekday programs
    { value: 'program_sintonia_total', label: '📺 Sintonia Total (09-10:30)' },
    { value: 'program_painel_flashback', label: '📺 Painel Flashback (12-12:30)' },
    { value: 'program_top10', label: '📺 Top 10 / Papo Sério (13-13:30)' },
    { value: 'program_intensidade', label: '📺 Intensidade (17-17:30)' },
    { value: 'program_radar_noticias', label: '📺 Radar Notícias (18:00)' },
    { value: 'program_top10_mix', label: '📺 TOP10 MIX + Esporte (18:30)' },
    { value: 'program_radio_revista', label: '📺 Rádio Revista (19-19:30)' },
    { value: 'program_misturadao', label: '📺 Misturadão (20-20:30)' },
    { value: 'program_songs_of_love', label: '📺 Songs of Love (22-23:30)' },
    // Weekend programs
    { value: 'program_shake_mix', label: '📺 Shake Mix (FDS 08-09:30)' },
    { value: 'program_conexao_mix', label: '📺 Conexão Mix (FDS 10-12:30)' },
    { value: 'program_mega_mix', label: '📺 Mega Mix (FDS 13-17:30)' },
    { value: 'program_sem_parar', label: '📺 Sem Parar (FDS 18-19:30)' },
    { value: 'program_mega_funk', label: '📺 Mega Funk (FDS 20-20:30)' },
    { value: 'program_gas_total', label: '📺 Gas Total (FDS 21-22)' },
    { value: 'program_amnesia', label: '📺 Amnesia (FDS 22:30-23:30)' },
  ];

  const radioOptions = [
    ...stationOptions,
    { value: 'random_pop', label: '🎲 Aleatório (Disney/Metro)', isFixo: false },
    { value: 'top50', label: '🏆 TOP25 (Curadoria)', isFixo: false },
    ...genreOptions,
    ...yearOptions,
    ...genreYearOptions,
    ...programOptions,
    ...fixedContentOptions,
  ];

  const handleChange = (position: number, value: string) => {
    setLocalSequence((prev) =>
      prev.map((item) => (item.position === position ? { ...item, radioSource: value, customFileName: undefined } : item))
    );
  };

  const handleFormSequenceChange = (position: number, value: string) => {
    setFormSequence((prev) =>
      prev.map((item) => (item.position === position ? { ...item, radioSource: value, customFileName: undefined } : item))
    );
  };

  // Get default filename for a fixed content
  const getDefaultFileName = (source: string): string => {
    if (source.startsWith('fixo_')) {
      const contentId = source.replace('fixo_', '');
      const content = fixedContent.find(c => c.id === contentId);
      return content?.fileName || '';
    }
    return '';
  };

  // Start editing custom filename for default sequence
  const startEditFileName = (position: number, currentFileName: string, source: string) => {
    setEditingPosition(position);
    setEditingFileName(currentFileName || getDefaultFileName(source));
  };

  const saveEditFileName = () => {
    if (editingPosition !== null) {
      const newSequence = localSequence.map((item) => 
        item.position === editingPosition ? { ...item, customFileName: editingFileName } : item
      );
      setLocalSequence(newSequence);
      // Auto-save to store
      setSequence(newSequence);
      toast({
        title: 'Nome do arquivo salvo',
        description: `Posição ${editingPosition}: ${editingFileName}`,
      });
      setEditingPosition(null);
      setEditingFileName('');
    }
  };

  const cancelEditFileName = () => {
    setEditingPosition(null);
    setEditingFileName('');
  };

  // Start editing custom filename for form sequence (scheduled)
  const startEditFormFileName = (position: number, currentFileName: string, source: string) => {
    setEditingFormPosition(position);
    setEditingFormFileName(currentFileName || getDefaultFileName(source));
  };

  const saveEditFormFileName = () => {
    if (editingFormPosition !== null) {
      setFormSequence((prev) =>
        prev.map((item) => (item.position === editingFormPosition ? { ...item, customFileName: editingFormFileName } : item))
      );
      setEditingFormPosition(null);
      setEditingFormFileName('');
    }
  };

  const cancelEditFormFileName = () => {
    setEditingFormPosition(null);
    setEditingFormFileName('');
  };

  const handleSave = () => {
    setSequence(localSequence);
    toast({
      title: 'Sequência padrão salva',
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

  const handleAddPosition = () => {
    const newPosition = localSequence.length + 1;
    setLocalSequence([...localSequence, { position: newPosition, radioSource: 'bh' }]);
    toast({
      title: 'Posição adicionada',
      description: `Posição ${newPosition} foi criada.`,
    });
  };

  const handleRemoveLastPosition = () => {
    if (localSequence.length <= 5) {
      toast({
        title: 'Mínimo atingido',
        description: 'A sequência precisa ter pelo menos 5 posições.',
        variant: 'destructive',
      });
      return;
    }
    setLocalSequence(localSequence.slice(0, -1));
    toast({
      title: 'Posição removida',
      description: `Última posição foi removida.`,
    });
  };

  const handleRemovePosition = (positionToRemove: number) => {
    if (localSequence.length <= 5) {
      toast({
        title: 'Mínimo atingido',
        description: 'A sequência precisa ter pelo menos 5 posições.',
        variant: 'destructive',
      });
      return;
    }
    // Remove the position and renumber remaining positions
    const newSequence = localSequence
      .filter(item => item.position !== positionToRemove)
      .map((item, index) => ({ ...item, position: index + 1 }));
    
    setLocalSequence(newSequence);
    toast({
      title: 'Posição removida',
      description: `Posição ${positionToRemove} foi excluída.`,
    });
  };

  const handleAddFormPosition = () => {
    const newPosition = formSequence.length + 1;
    setFormSequence([...formSequence, { position: newPosition, radioSource: 'bh' }]);
  };

  const handleRemoveFormLastPosition = () => {
    if (formSequence.length <= 5) return;
    setFormSequence(formSequence.slice(0, -1));
  };

  const handleRemoveFormPosition = (positionToRemove: number) => {
    if (formSequence.length <= 5) return;
    const newSequence = formSequence
      .filter(item => item.position !== positionToRemove)
      .map((item, index) => ({ ...item, position: index + 1 }));
    setFormSequence(newSequence);
  };

  const openNewScheduleDialog = () => {
    setEditingSchedule(null);
    setFormName('Nova Sequência');
    setFormStartHour(18);
    setFormStartMinute(0);
    setFormEndHour(22);
    setFormEndMinute(0);
    setFormWeekDays([]);
    setFormPriority(1);
    setFormSequence([...sequence]);
    setIsDialogOpen(true);
  };

  const openEditScheduleDialog = (schedule: ScheduledSequence) => {
    setEditingSchedule(schedule);
    setFormName(schedule.name);
    setFormStartHour(schedule.startHour);
    setFormStartMinute(schedule.startMinute);
    setFormEndHour(schedule.endHour);
    setFormEndMinute(schedule.endMinute);
    setFormWeekDays([...schedule.weekDays]);
    setFormPriority(schedule.priority);
    setFormSequence([...schedule.sequence]);
    setIsDialogOpen(true);
  };

  const handleSaveSchedule = () => {
    const scheduleData: ScheduledSequence = {
      id: editingSchedule?.id || `sched-${Date.now()}`,
      name: formName,
      startHour: formStartHour,
      startMinute: formStartMinute,
      endHour: formEndHour,
      endMinute: formEndMinute,
      weekDays: formWeekDays,
      sequence: formSequence,
      enabled: editingSchedule?.enabled ?? true,
      priority: 1, // Always takes priority during configured time
    };

    // Log for debugging
    const daysLabel = formWeekDays.length > 0 ? formWeekDays.join(', ') : 'todos os dias';
    const seqRadios = formSequence.slice(0, 3).map(s => s.radioSource).join(' → ');
    console.log(`[SEQUENCE-SAVE] ${formName}: ${formStartHour}:${formStartMinute.toString().padStart(2, '0')}-${formEndHour}:${formEndMinute.toString().padStart(2, '0')} | Dias: ${daysLabel} | Seq: ${seqRadios}...`);

    if (editingSchedule) {
      updateScheduledSequence(editingSchedule.id, scheduleData);
      toast({
        title: 'Sequência atualizada',
        description: `"${formName}" salva para ${daysLabel}.`,
      });
    } else {
      addScheduledSequence(scheduleData);
      toast({
        title: 'Sequência criada',
        description: `"${formName}" adicionada para ${daysLabel}.`,
      });
    }

    setIsDialogOpen(false);
  };

  const handleDeleteSchedule = (id: string, name: string) => {
    removeScheduledSequence(id);
    toast({
      title: 'Sequência removida',
      description: `"${name}" foi excluída.`,
    });
  };

  const handleToggleSchedule = (id: string, enabled: boolean) => {
    updateScheduledSequence(id, { enabled });
    toast({
      title: enabled ? 'Sequência ativada' : 'Sequência desativada',
      description: `A sequência foi ${enabled ? 'ativada' : 'desativada'} com sucesso.`,
    });
  };

  const toggleWeekDay = (day: WeekDay) => {
    setFormWeekDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  // Combo manual handlers
  const AVAILABLE_GENRES = ['POP', 'ROCK', 'DANCE', 'SERTANEJO', 'PAGODE', 'FUNK', 'MPB', 'ROMANTICO', 'FORRO', 'METAL', 'ELETRONICA', 'RAP'];
  const AVAILABLE_DECADES = [
    { value: '80s', label: 'Anos 80' },
    { value: '90s', label: 'Anos 90' },
    { value: '2000s', label: 'Anos 2000' },
    { value: '2010s', label: 'Anos 2010' },
    { value: '2020s', label: 'Anos 2020' },
  ];

  const openComboDialog = (type: 'default' | 'form', position: number) => {
    setComboTarget({ type, position });
    setComboGenres([]);
    setComboDecade('90s');
    setComboDialogOpen(true);
  };

  const toggleComboGenre = (genre: string) => {
    setComboGenres(prev => prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]);
  };

  const applyCombo = () => {
    if (comboGenres.length === 0 || !comboTarget) return;
    const value = `genreyear_${comboGenres.join(',')}_${comboDecade}`;
    if (comboTarget.type === 'default') {
      handleChange(comboTarget.position, value);
    } else {
      handleFormSequenceChange(comboTarget.position, value);
    }
    setComboDialogOpen(false);
    toast({ title: 'Combo aplicado', description: `${comboGenres.join('/')} ${AVAILABLE_DECADES.find(d => d.value === comboDecade)?.label}` });
  };

  const getStationColor = (source: string) => {
    if (source.startsWith('file_')) {
      return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
    }
    if (source.startsWith('fixo_')) {
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    }
    if (source.startsWith('program_')) {
      return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
    }
    if (source.startsWith('genreyear_')) {
      return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    }
    if (source.startsWith('genre_')) {
      return 'bg-violet-500/20 text-violet-400 border-violet-500/30';
    }
    if (source.startsWith('year_')) {
      return 'bg-teal-500/20 text-teal-400 border-teal-500/30';
    }
    if (source === 'LOC' || source === 'LOC_END') {
      return 'bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30';
    }
    
    const colors: Record<string, string> = {
      bh: 'bg-primary/20 text-primary border-primary/30',
      band: 'bg-accent/20 text-accent border-accent/30',
      clube: 'bg-green-500/20 text-green-400 border-green-500/30',
      showfm: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      globo: 'bg-red-500/20 text-red-400 border-red-500/30',
      blink: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      positiva: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
      liberdade: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      mix: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      fixo: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      random_pop: 'bg-muted text-muted-foreground border-muted-foreground/30',
      top50: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    };
    return colors[source] || 'bg-secondary text-secondary-foreground';
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      news: '📰 Notícia',
      horoscope: '🔮 Horóscopo',
      sports: '⚽ Esporte',
      weather: '🌤️ Clima',
      romance: '💕 Romance',
      curiosity: '💡 Curiosidade',
      top50: '🏆 TOP25',
      vozbrasil: '🇧🇷 Voz do Brasil',
      other: '📁 Outro',
    };
    return labels[type] || type;
  };

  // Get display name for a sequence item source
  const getSourceDisplayName = (source: string): string => {
    if (source.startsWith('file_')) {
      const filePath = source.replace('file_', '');
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      return `📂 ${fileName}`;
    }
    if (source.startsWith('fixo_')) {
      const contentId = source.replace('fixo_', '');
      const content = fixedContent.find(c => c.id === contentId);
      return content?.name || 'FIXO';
    }
    if (source.startsWith('program_')) {
      const opt = programOptions.find(o => o.value === source);
      return opt ? opt.label.replace('📺 ', '') : source.replace('program_', '').replace(/_/g, ' ');
    }
    if (source.startsWith('genreyear_')) {
      const opt = genreYearOptions.find(o => o.value === source);
      if (opt) return opt.label.replace(/^[^\w]+/, '').trim();
      const parts = source.replace('genreyear_', '');
      const lastUnderscore = parts.lastIndexOf('_');
      const genre = parts.substring(0, lastUnderscore);
      const year = parts.substring(lastUnderscore + 1);
      return `${genre} ${year}`;
    }
    if (source.startsWith('genre_')) {
      const genreLabel: Record<string, string> = {
        'genre_SERTANEJO': 'Sertanejo',
        'genre_PAGODE': 'Pagode',
        'genre_FUNK': 'Funk',
        'genre_POP': 'Pop',
        'genre_MPB': 'MPB',
        'genre_ROCK,METAL': 'Rock & Metal',
        'genre_ROMANTICO': 'Romântico',
        'genre_FORRO': 'Forró',
        'genre_DANCE,ELETRONICA': 'Dance/Eletrônica',
        'genre_ELETRONICA': 'Eletrônica',
      };
      return genreLabel[source] || source.replace('genre_', '');
    }
    if (source.startsWith('year_')) {
      const yearLabel: Record<string, string> = {
        'year_80s': 'Anos 80',
        'year_90s': 'Anos 90',
        'year_2000s': 'Anos 2000',
        'year_2010s': 'Anos 2010',
        'year_2020s': 'Anos 2020',
      };
      return yearLabel[source] || source.replace('year_', '');
    }
    
    const station = stations.find(s => s.id === source);
    if (station) return station.name;
    
    if (source === 'random_pop') return 'Aleatório';
    if (source === 'top50') return 'TOP25';
    
    return source;
  };

  const getSourceBadgeLabel = (source: string): string => {
    if (source.startsWith('file_')) return '📂';
    if (source.startsWith('fixo_')) return '📌';
    if (source.startsWith('program_')) return '📺';
    if (source.startsWith('genreyear_')) return '🎵📅';
    if (source.startsWith('genre_')) return '🎵';
    if (source.startsWith('year_')) return '📅';
    if (source === 'LOC') return '🎙️ LOC';
    if (source === 'LOC_END') return '🎙️ END';
    if (source === 'random_pop') return 'ALEAT';
    if (source === 'top50') return 'TOP25';
    const station = stations.find(s => s.id === source);
    if (station) {
      const name = station.name.replace(/\s*(FM|AM)\s*[\d.]*$/i, '').trim();
      return name.length > 8 ? name.slice(0, 7) + '…' : name.toUpperCase();
    }
    return source.toUpperCase().slice(0, 4);
  };

  // File picker handler for selecting a local file
  const handleSelectFile = async (type: 'default' | 'form', position: number) => {
    if (!window.electronAPI?.selectFile) {
      toast({ title: '⚠️ Disponível apenas no Desktop', variant: 'destructive' });
      return;
    }
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: 'Áudio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'wma', 'm4a'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    });
    if (!filePath) return;
    const value = `file_${filePath}`;
    if (type === 'default') {
      handleChange(position, value);
    } else {
      handleFormSequenceChange(position, value);
    }
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    toast({ title: '📂 Arquivo selecionado', description: fileName });
  };

  const formatTime = (hour: number, minute: number) => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  // Get currently active sequence for display
  const activeSequence = getActiveSequence();
  const activeScheduled = scheduledSequences.find((s) => {
    if (!s.enabled) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = s.startHour * 60 + s.startMinute;
    const endMinutes = s.endHour * 60 + s.endMinute;
    const dayMap = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
    const currentDay = dayMap[now.getDay()];
    
    if (s.weekDays.length > 0 && !s.weekDays.includes(currentDay)) return false;
    
    if (endMinutes <= startMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  });

  const handleResetSystemProgramming = () => {
    resetProgramming();
    // Também limpa a política de Grade 24h
    clearAllOverrides();
    
    setLocalSequence(useRadioStore.getState().sequence);
    toast({
      title: 'Programação zerada',
      description: 'Programas, sequências, conteúdos fixos e a Grade 24h foram removidos.',
    });
    // Força um reload para garantir que todos os componentes vejam as mudanças no localStorage
    window.location.reload();
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground">Sequência de Montagem</h2>
          <p className="text-muted-foreground text-sm">
            Configure a ordem das rádios para montar o arquivo %dd%.txt
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 mr-2 bg-secondary/30 px-3 py-1.5 rounded-lg border border-border">
            <Label htmlFor="use-grade-24h" className="text-xs font-medium whitespace-nowrap">Grade 24h</Label>
            <Switch
              id="use-grade-24h"
              checked={config.useGrade24h !== false}
              onCheckedChange={(checked) => setConfig({ useGrade24h: checked })}
            />
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Zerar Tudo</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Zerar toda a programação?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso removerá todos os programas, sequências programadas, conteúdos fixos e resetará a sequência padrão para o modo aleatório. Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleResetSystemProgramming} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Zerar Programação
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button variant="outline" size="sm" onClick={openNewScheduleDialog}>
            <Clock className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Nova Programação</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Resetar</span>
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Salvar Padrão</span>
            <span className="sm:hidden">Salvar</span>
          </Button>
        </div>
      </div>

      {/* Active Sequence Indicator */}
      {activeScheduled && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
              <span className="text-sm">
                Sequência ativa: <strong>{activeScheduled.name}</strong>
                <span className="text-muted-foreground ml-2">
                  ({formatTime(activeScheduled.startHour, activeScheduled.startMinute)} - {formatTime(activeScheduled.endHour, activeScheduled.endMinute)})
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scheduled Sequences */}
      {scheduledSequences.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calendar className="w-5 h-5 text-primary" />
              Sequências Programadas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-3">
              {scheduledSequences.map((schedule) => (
                <div
                  key={schedule.id}
                  className={`flex items-center justify-between gap-4 p-3 rounded-lg border transition-all ${
                    schedule.enabled 
                      ? 'bg-secondary/30 border-border hover:border-primary/30' 
                      : 'bg-muted/20 border-muted opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Switch
                      checked={schedule.enabled}
                      onCheckedChange={(checked) => handleToggleSchedule(schedule.id, checked)}
                    />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{schedule.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>
                          {formatTime(schedule.startHour, schedule.startMinute)} - {formatTime(schedule.endHour, schedule.endMinute)}
                        </span>
                        {schedule.weekDays.length > 0 && (
                          <>
                            <span className="text-muted-foreground/50">|</span>
                            <span>{schedule.weekDays.join(', ')}</span>
                          </>
                        )}
                        {schedule.weekDays.length === 0 && (
                          <>
                            <span className="text-muted-foreground/50">|</span>
                            <span>Todos os dias</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      P{schedule.priority}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditScheduleDialog(schedule)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir sequência?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Tem certeza que deseja excluir "{schedule.name}"? Esta ação não pode ser desfeita.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeleteSchedule(schedule.id, schedule.name)}>
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {/* Default Sequence Configuration */}
        <Collapsible open={defaultOpen} onOpenChange={setDefaultOpen}>
        <Card className="glass-card">
          <CardHeader className="border-b border-border p-0">
            <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors cursor-pointer">
              <CardTitle className="flex items-center gap-2">
                <span>Sequência Padrão</span>
                {!activeScheduled && (
                  <Badge variant="default" className="text-xs">
                    <Power className="w-3 h-3 mr-1" />
                    Ativa
                  </Badge>
                )}
              </CardTitle>
              <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${defaultOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
          <CardContent className="p-4">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={localSequence.map(item => `seq-${item.position}`)} strategy={verticalListSortingStrategy}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(() => {
                      const half = Math.ceil(localSequence.length / 2);
                      const col1 = localSequence.slice(0, half);
                      const col2 = localSequence.slice(half);
                      const maxLen = Math.max(col1.length, col2.length);
                      const rows: React.ReactNode[] = [];
                      for (let i = 0; i < maxLen; i++) {
                        if (col1[i]) rows.push(
                          <SortableSequenceItem
                            key={`seq-${col1[i].position}`}
                            item={col1[i]}
                            isFixoItem={col1[i].radioSource.startsWith('fixo_')}
                            isEditing={editingPosition === col1[i].position}
                            editingFileName={editingFileName}
                            setEditingFileName={setEditingFileName}
                            handleChange={handleChange}
                            openComboDialog={openComboDialog}
                            handleSelectFile={handleSelectFile}
                            startEditFileName={startEditFileName}
                            saveEditFileName={saveEditFileName}
                            cancelEditFileName={cancelEditFileName}
                            handleRemovePosition={handleRemovePosition}
                            getStationColor={getStationColor}
                            getSourceBadgeLabel={getSourceBadgeLabel}
                            getDefaultFileName={getDefaultFileName}
                            localSequenceLength={localSequence.length}
                            catGenres={catGenres} setCatGenres={setCatGenres}
                            catDecades={catDecades} setCatDecades={setCatDecades}
                            catGenreYear={catGenreYear} setCatGenreYear={setCatGenreYear}
                            catPrograms={catPrograms} setCatPrograms={setCatPrograms}
                            catSpecials={catSpecials} setCatSpecials={setCatSpecials}
                            catStations={catStations} setCatStations={setCatStations}
                            catLocucao={catLocucao} setCatLocucao={setCatLocucao}
                            genreOptions={genreOptions}
                            yearOptions={yearOptions}
                            genreYearOptions={genreYearOptions}
                            programOptions={programOptions}
                            fixedContentOptions={fixedContentOptions}
                            stationOptions={stationOptions}
                            justDropped={droppedPosition === col1[i].position}
                          />
                        );
                        if (col2[i]) rows.push(
                          <SortableSequenceItem
                            key={`seq-${col2[i].position}`}
                            item={col2[i]}
                            isFixoItem={col2[i].radioSource.startsWith('fixo_')}
                            isEditing={editingPosition === col2[i].position}
                            editingFileName={editingFileName}
                            setEditingFileName={setEditingFileName}
                            handleChange={handleChange}
                            openComboDialog={openComboDialog}
                            handleSelectFile={handleSelectFile}
                            startEditFileName={startEditFileName}
                            saveEditFileName={saveEditFileName}
                            cancelEditFileName={cancelEditFileName}
                            handleRemovePosition={handleRemovePosition}
                            getStationColor={getStationColor}
                            getSourceBadgeLabel={getSourceBadgeLabel}
                            getDefaultFileName={getDefaultFileName}
                            localSequenceLength={localSequence.length}
                            catGenres={catGenres} setCatGenres={setCatGenres}
                            catDecades={catDecades} setCatDecades={setCatDecades}
                            catGenreYear={catGenreYear} setCatGenreYear={setCatGenreYear}
                            catPrograms={catPrograms} setCatPrograms={setCatPrograms}
                            catSpecials={catSpecials} setCatSpecials={setCatSpecials}
                            catStations={catStations} setCatStations={setCatStations}
                            catLocucao={catLocucao} setCatLocucao={setCatLocucao}
                            genreOptions={genreOptions}
                            yearOptions={yearOptions}
                            genreYearOptions={genreYearOptions}
                            programOptions={programOptions}
                            fixedContentOptions={fixedContentOptions}
                            stationOptions={stationOptions}
                            justDropped={droppedPosition === col2[i].position}
                          />
                        );
                      }
                      return rows;
                    })()}
                  </div>
                </SortableContext>
              </DndContext>
            <div className="flex gap-2 mt-4 pt-4 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={handleAddPosition}
              >
                <PlusCircle className="w-4 h-4 mr-2" />
                Adicionar Posição
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRemoveLastPosition}
                disabled={localSequence.length <= 5}
              >
                <MinusCircle className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const exportData = {
                    defaultSequence: localSequence,
                    scheduledSequences: scheduledSequences,
                    exportedAt: new Date().toISOString(),
                  };
                  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `sequencia_${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast({ title: '📥 Exportado', description: `Sequência padrão (${localSequence.length} posições) + ${scheduledSequences.length} programadas exportadas.` });
                }}
              >
                <Download className="w-3 h-3 mr-1" />
                Exportar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.json';
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const data = JSON.parse(text);
                      if (data.defaultSequence && Array.isArray(data.defaultSequence)) {
                        setLocalSequence(data.defaultSequence);
                        setSequence(data.defaultSequence);
                        toast({ title: '📤 Importado', description: `Sequência padrão com ${data.defaultSequence.length} posições importada.` });
                      } else {
                        toast({ title: '❌ Erro', description: 'Arquivo não contém sequência válida.', variant: 'destructive' });
                      }
                    } catch {
                      toast({ title: '❌ Erro', description: 'Arquivo JSON inválido.', variant: 'destructive' });
                    }
                  };
                  input.click();
                }}
              >
                <Upload className="w-3 h-3 mr-1" />
                Importar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {localSequence.length} posições configuradas
            </p>
          </CardContent>
          </CollapsibleContent>
        </Card>
        </Collapsible>

        {/* Grade 24h — visão completa hora a hora (com collapse próprio no header) */}
        <div className={config.useGrade24h === false ? 'opacity-40 grayscale pointer-events-none' : ''}>
          <div className="relative">
            {config.useGrade24h === false && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/20 backdrop-blur-[1px] rounded-xl">
                <Badge variant="secondary" className="bg-destructive/10 text-destructive border-destructive/20 px-4 py-2 text-sm shadow-lg">
                  Grade 24h Desativada
                </Badge>
              </div>
            )}
            <Grade24hCard
              sequence={activeScheduled ? activeSequence : localSequence}
              programs={programs}
              getStationColor={getStationColor}
              getSourceDisplayName={getSourceDisplayName}
            />
          </div>
        </div>

        {/* Fixed Content Panel - Sidebar */}
        <Collapsible open={fixedOpen} onOpenChange={setFixedOpen}>
        <Card className="glass-card border-emerald-500/30">
          <CardHeader className="border-b border-emerald-500/20 pb-0 pt-0 bg-emerald-500/5 p-0">
            <CollapsibleTrigger className="w-full flex items-center justify-between p-3 hover:bg-emerald-500/10 transition-colors cursor-pointer">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="text-lg">📌</span>
                Conteúdos Fixos
                <Badge variant="secondary" className="ml-2 text-xs bg-emerald-500/20 text-emerald-400">
                  {fixedContent.filter(c => c.enabled).length} ativos
                </Badge>
              </CardTitle>
              <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${fixedOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
          <CardContent className="p-3">
            {fixedContent.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum conteúdo fixo cadastrado.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {fixedContent.map((content) => (
                    <div
                      key={content.id}
                      className={`p-2 rounded-lg border transition-all ${
                        content.enabled
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-muted/20 border-muted opacity-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-xs truncate">{content.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{content.fileName}</p>
                        </div>
                        <Badge variant="outline" className="text-[8px] shrink-0 px-1">
                          {content.enabled ? 'ON' : 'OFF'}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                        <Badge variant="secondary" className="text-[8px] px-1 py-0">
                          {getTypeLabel(content.type)}
                        </Badge>
                        {content.position && (
                          <Badge variant="outline" className="text-[8px] px-1 py-0 bg-primary/10">
                            Pos: {content.position === 'start' ? 'Início' : content.position === 'middle' ? 'Meio' : content.position === 'end' ? 'Fim' : content.position}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[9px] text-muted-foreground mt-1 truncate">
                        {content.timeSlots.map((t) => `${t.hour.toString().padStart(2, '0')}:${t.minute.toString().padStart(2, '0')}`).slice(0, 4).join(', ')}
                        {content.timeSlots.length > 4 && ` +${content.timeSlots.length - 4}`}
                      </p>
                    </div>
                  ))}
                </div>
            )}
          </CardContent>
          </CollapsibleContent>
        </Card>
        </Collapsible>

        {/* Preview */}
        <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>

        <Card className="glass-card">
          <CardHeader className="border-b border-border p-0">
            <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors cursor-pointer">
              <CardTitle>Prévia da Sequência</CardTitle>
              <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${previewOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
          <CardContent className="p-4">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Visualização de como as músicas serão selecionadas em cada bloco:
              </p>
              
              <div className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
                {(activeScheduled ? activeSequence : localSequence).map((item) => {
                  return (
                    <div
                      key={item.position}
                      className={`aspect-square rounded-lg flex flex-col items-center justify-center ${getStationColor(item.radioSource)} border`}
                    >
                      <span className="text-2xl font-bold">{item.position}</span>
                      <span className="text-[10px] uppercase tracking-wide mt-1 text-center px-1 truncate w-full">
                        {getSourceDisplayName(item.radioSource)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 p-4 rounded-lg bg-muted/30 border border-border">
                <h4 className="font-medium text-sm mb-2">Legenda</h4>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2 text-xs">
                  {stations.slice(0, 6).map((station) => (
                    <div key={station.id} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${getStationColor(station.id)}`} />
                      <span className="text-muted-foreground truncate">{station.name}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-emerald-500/30" />
                    <span className="text-muted-foreground">FIXO</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-muted" />
                    <span className="text-muted-foreground">Aleatório</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded bg-yellow-500/30" />
                    <span className="text-muted-foreground">TOP25</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <h4 className="font-medium text-sm text-primary mb-2">ℹ️ Informação</h4>
                <p className="text-xs text-muted-foreground">
                  Sequências programadas têm prioridade absoluta nos horários configurados, substituindo a sequência padrão e todos os programas especiais (exceto Voz do Brasil).
                  <br />
                  <span className="text-emerald-400">FIXO:</span> Insere conteúdo fixo configurado na posição selecionada.
                </p>
              </div>
            </div>
          </CardContent>
          </CollapsibleContent>
        </Card>
        </Collapsible>

      </div>

      {/* Dialog for New/Edit Scheduled Sequence */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingSchedule ? 'Editar Sequência Programada' : 'Nova Sequência Programada'}
            </DialogTitle>
            <DialogDescription>
              Configure uma sequência que será ativada automaticamente no horário definido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex: Horário Nobre"
              />
            </div>

            {/* Time Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Início</Label>
                <div className="flex gap-2">
                  <Select
                    value={formStartHour.toString()}
                    onValueChange={(v) => setFormStartHour(parseInt(v))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={i.toString()}>
                          {i.toString().padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-2xl">:</span>
                  <Select
                    value={formStartMinute.toString()}
                    onValueChange={(v) => setFormStartMinute(parseInt(v))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 30].map((m) => (
                        <SelectItem key={m} value={m.toString()}>
                          {m.toString().padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Fim</Label>
                <div className="flex gap-2">
                  <Select
                    value={formEndHour.toString()}
                    onValueChange={(v) => setFormEndHour(parseInt(v))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={i.toString()}>
                          {i.toString().padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-2xl">:</span>
                  <Select
                    value={formEndMinute.toString()}
                    onValueChange={(v) => setFormEndMinute(parseInt(v))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 30].map((m) => (
                        <SelectItem key={m} value={m.toString()}>
                          {m.toString().padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Week Days */}
            <div className="space-y-2">
              <Label>Dias da Semana (vazio = todos)</Label>
              <div className="flex flex-wrap gap-2">
                {WEEK_DAYS.map((day) => (
                  <Badge
                    key={day.value}
                    variant={formWeekDays.includes(day.value) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleWeekDay(day.value)}
                  >
                    {day.label}
                  </Badge>
                ))}
              </div>
            </div>


            {/* Sequence Config */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Sequência de Emissoras</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddFormPosition}
                  >
                    <PlusCircle className="w-3 h-3 mr-1" />
                    Posição
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveFormLastPosition}
                    disabled={formSequence.length <= 5}
                  >
                    <MinusCircle className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto p-1">
                {formSequence.map((item) => {
                  const isFixoItem = item.radioSource.startsWith('fixo_');
                  const isEditing = editingFormPosition === item.position;
                  
                  return (
                    <div
                      key={item.position}
                      className={`p-2 rounded-lg bg-secondary/30 border group ${
                        isFixoItem ? 'border-emerald-500/30' : 'border-border'
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <span className="font-mono font-bold text-foreground w-5 text-xs">
                          {item.position.toString().padStart(2, '0')}
                        </span>
                        <Select
                          value={item.radioSource}
                          onValueChange={(value) => handleFormSequenceChange(item.position, value)}
                        >
                          <SelectTrigger className="flex-1 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-[320px]">
                            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Gêneros</div>
                            {genreOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                            <div className="px-2 py-1 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Décadas</div>
                            {yearOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                            <div className="px-2 py-1 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Gênero + Década</div>
                            {genreYearOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                            <div className="px-2 py-1 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">📺 Programas</div>
                            {programOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                            <div className="px-2 py-1 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Especiais</div>
                            <SelectItem value="random_pop">🎲 Aleatório (Disney/Metro)</SelectItem>
                            <SelectItem value="top50">🏆 TOP25 (Curadoria)</SelectItem>
                            {fixedContentOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                            <div className="px-2 py-1 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">🎙️ Locução</div>
                            <SelectItem value="LOC">🎙️ LOC — Abertura de locução</SelectItem>
                            <SelectItem value="LOC_END">🎙️ LOC_END — Fechamento de locução</SelectItem>
                            <div className="px-2 py-1 mt-1 border-t border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Emissoras</div>
                            {stationOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isFixoItem && !isEditing && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                            onClick={() => startEditFormFileName(item.position, item.customFileName || '', item.radioSource)}
                            title="Editar nome do arquivo"
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemoveFormPosition(item.position)}
                          disabled={formSequence.length <= 5}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      
                      {/* Editing mode for custom filename */}
                      {isEditing && (
                        <div className="mt-1 flex items-center gap-1">
                          <Input
                            value={editingFormFileName}
                            onChange={(e) => setEditingFormFileName(e.target.value)}
                            placeholder="NOTICIA_DA_HORA_18HORAS"
                            className="h-6 text-[10px] flex-1 font-mono"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                            onClick={saveEditFormFileName}
                          >
                            <Check className="w-3 h-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-foreground"
                            onClick={cancelEditFormFileName}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                      
                      {/* Show filename for FIXO items - always visible, clickable to edit */}
                      {isFixoItem && !isEditing && (
                        <div 
                          className="mt-1 pl-6 flex items-center gap-1 cursor-pointer hover:bg-emerald-500/10 rounded px-1 py-0.5 -mx-1"
                          onClick={() => startEditFormFileName(item.position, item.customFileName || '', item.radioSource)}
                        >
                          <span className="text-[9px] text-emerald-400 font-mono flex-1 truncate">
                            {item.customFileName || getDefaultFileName(item.radioSource)}
                          </span>
                          <Pencil className="w-2.5 h-2.5 text-emerald-400/60 shrink-0" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {formSequence.length} posições configuradas
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveSchedule}>
              <Save className="w-4 h-4 mr-2" />
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Combo Manual Dialog */}
      <Dialog open={comboDialogOpen} onOpenChange={setComboDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>🎧 Combo Manual — Gênero + Década</DialogTitle>
            <DialogDescription>
              Selecione os gêneros e a década para criar uma combinação personalizada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Gêneros (selecione 1 ou mais)</Label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_GENRES.map(genre => (
                  <Badge
                    key={genre}
                    variant={comboGenres.includes(genre) ? 'default' : 'outline'}
                    className={`cursor-pointer transition-colors ${
                      comboGenres.includes(genre)
                        ? 'bg-amber-500 text-amber-950 hover:bg-amber-400'
                        : 'hover:bg-amber-500/20 hover:text-amber-400'
                    }`}
                    onClick={() => toggleComboGenre(genre)}
                  >
                    {genre}
                  </Badge>
                ))}
              </div>
              {comboGenres.length > 0 && (
                <p className="text-xs text-amber-400">Selecionados: {comboGenres.join(' / ')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Década</Label>
              <Select value={comboDecade} onValueChange={setComboDecade}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_DECADES.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {comboGenres.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <p className="text-xs text-amber-400 font-mono">
                  Resultado: genreyear_{comboGenres.join(',')}_{ comboDecade}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {comboGenres.join('/')} — {AVAILABLE_DECADES.find(d => d.value === comboDecade)?.label}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComboDialogOpen(false)}>Cancelar</Button>
            <Button onClick={applyCombo} disabled={comboGenres.length === 0}>
              <Check className="w-4 h-4 mr-2" />
              Aplicar Combo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
