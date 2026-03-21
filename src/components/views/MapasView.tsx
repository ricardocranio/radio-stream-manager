import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { resolveTemplateLine, formatResolvedLine, resetMapasPools } from '@/lib/mapasBuilder/resolver';
import type { MapaResolvedLine, MapaCodeConfig, MapaTemplateLine } from '@/lib/mapasBuilder/types';
import { MapIcon, FileText, Play, Settings2, Radio, Music, Mic2, Clock, FolderOpen, Plus, RotateCcw, Trash2, GripVertical, Save, ChevronDown, ChevronRight, Zap, X } from 'lucide-react';
import { toast } from 'sonner';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// Mock file contents for preview when Electron is not available
const MOCK_FILES: Record<string, string> = {
  'MAPA.txt': `00:55 SINAL,SINAL,HC,VHTENT,mus,vht,mus
01:55 SINAL,HC,VHTENT,mus,vht,mus
02:55 SINAL,HC,VHTENT,mus,vht,mus
03:55 SINAL,HC,VHTENT,mus,vht,mus
04:55 SINAL,HC,VHTENT,mus,vht,mus
05:55 RESTART,SINAL,HC,VHTENT
06:55 SINAL,HC,VHTENT,mus,vht,mus
07:27 SINAL,HC,VHTENT,mus,vht,mus
07:55 SINAL,HC,VHTENT,mus,vht,mus
08:27 SINAL,HC,NOT,VHTENT,mus,vht,mus
08:55 SINAL,HC,VHTENT,mus,vht,mus
09:27 SINAL,HC,NOT,VHTENT,mus,vht,mus
09:55 SINAL,HC,VHTENT,mus,vht,mus
10:27 SINAL,HC,NOT,VHTENT,mus,vht,mus
10:55 SINAL,HC,VHTENT,mus,vht,mus
11:27 SINAL,HC,NOT,VHTENT,mus,vht,mus
11:55 SINAL,HC,VHTENT,mus,vht,mus
12:27 SINAL,HC,NOT,VHTENT,mus,vht,mus
12:55 SINAL,HC,VHTENT,mus,vht,mus
13:27 SINAL,HC,NOT,VHTENT,mus,vht,mus
13:55 SINAL,HC,VHTENT,mus,vht,mus
14:27 SINAL,HC,NOT,VHTENT,mus,vht,mus
14:55 SINAL,HC,VHTENT,mus,vht,mus
15:27 SINAL,HC,NOT,VHTENT,mus,vht,mus
15:55 SINAL,HC,VHTENT,mus,vht,mus
16:27 SINAL,HC,NOT,VHTENT,mus,vht,mus
16:55 SINAL,HC,VHTENT,mus,vht,mus
17:27 SINAL,HC,NOT,VHTENT,mus,vht,mus
17:55 SINAL,HC,VHTENT,mus,vht,mus
18:27 SINAL,HC,VHTENT,mus,vht,mus
18:55 SINAL,HC,VHTENT,mus,vht,mus
19:27 SINAL,HC,VHTENT,mus,vht,mus
19:55 SINAL,HC,VHTENT,mus,vht,mus
20:59 VHTENT
22:00 SINAL,HC,VHTENT,
22:27 SINAL,HC,VHTENT,rom,vht
22:55 SINAL,HC,VHTENT,rom,vht
23:27 SINAL,HC,VHTENT,rom,vht
23:55 SINAL,HC,VHTENT,rom,vht`,
  'S_B.txt': `00:55 SINAL,SINAL,HC,VHTENT,mus,vht,mus
01:55 SINAL,HC,VHTENT,mus,vht,mus
02:55 SINAL,HC,VHTENT,mus,vht,mus
03:55 SINAL,HC,VHTENT,mus,vht,mus
04:55 SINAL,HC,VHTENT,mus,vht,mus
05:55 RESTART,SINAL,HC,VHTENT
06:55 SINAL,HC,VHTENT,mus,vht,mus
07:27 SINAL,HC,VHTENT,mus,vht,mus
07:55 SINAL,HC,VHTENT,mus,vht,mus
08:27 SINAL,HC,VHTENT,mus,vht,mus
08:55 SINAL,HC,VHTENT,mus,vht,mus
09:27 SINAL,HC,VHTENT,mus,vht,mus
09:55 SINAL,HC,VHTENT,mus,vht,mus
10:27 SINAL,HC,VHTENT,mus,vht,mus
10:55 SINAL,HC,VHTENT,mus,vht,mus
11:27 SINAL,HC,VHTENT,mus,vht,mus
11:55 SINAL,HC,VHTENT,mus,vht,mus
12:27 SINAL,HC,VHTENT,mus,vht,mus
12:55 SINAL,HC,VHTENT,mus,vht,mus
13:27 SINAL,HC,VHTENT,mus,vht,mus
13:55 SINAL,HC,VHTENT,mus,vht,mus
14:27 SINAL,HC,VHTENT,mus,vht,mus
14:55 SINAL,HC,VHTENT,mus,vht,mus
15:27 SINAL,HC,VHTENT,mus,vht,mus
15:55 SINAL,HC,VHTENT,mus,vht,mus
16:27 SINAL,HC,VHTENT,mus,vht,mus
16:55 SINAL,HC,VHTENT,mus,vht,mus
17:27 SINAL,HC,VHTENT,mus,vht,mus
17:55 SINAL,HC,VHTENT,fun,vht,fun
18:27 SINAL,HC,VHTENT,fun,vht,fun
18:55 SINAL,HC,VHTENT,mus,vht,mus
19:27 SINAL,HC,VHTENT,mus,vht,mus
19:55 SINAL,HC,VHTENT,mus,vht,mus
20:27 SINAL,HC,VHTENT,mus,vht,mus
20:59 SINAL,HC,VHTENT,mus,vht,mus
22:00 SINAL,HC,VHTENT,mus,vht,mus
22:27 SINAL,HC,VHTENT,mus,vht,mus
22:55 SINAL,HC,VHTENT,mus,vht,mus
23:27 SINAL,HC,VHTENT,mus,vht,mus
23:55 SINAL,HC,VHTENT,mus,vht,mus`,
  'DOM-4.txt': `00:55 SINAL,SINAL,HC,VHTENT,mus,vht,mus
01:55 SINAL,HC,VHTENT,mus,vht,mus
02:55 SINAL,HC,VHTENT,mus,vht,mus
03:55 SINAL,HC,VHTENT,mus,vht,mus
04:55 SINAL,HC,VHTENT,mus,vht,mus
05:55 RESTART,SINAL,HC,VHTENT
06:55 SINAL,HC,VHTENT,mus,vht,mus
07:27 SINAL,HC,VHTENT,mus,vht,mus
07:55 SINAL,HC,VHTENT,mus,vht,mus
08:27 SINAL,HC,VHTENT,mus,vht,mus
08:55 SINAL,HC,VHTENT,mus,vht,mus
09:27 SINAL,HC,VHTENT,mus,vht,mus
09:55 SINAL,HC,VHTENT,mus,vht,mus
10:27 SINAL,HC,VHTENT,mus,vht,mus
10:55 SINAL,HC,VHTENT,mus,vht,mus
11:27 SINAL,HC,VHTENT,mus,vht,mus
11:55 SINAL,HC,VHTENT,mus,vht,mus
12:27 SINAL,HC,VHTENT,mus,vht,mus
12:55 SINAL,HC,VHTENT,mus,vht,mus
13:27 SINAL,HC,VHTENT,mus,vht,mus
13:55 SINAL,HC,VHTENT,mus,vht,mus
14:27 SINAL,HC,VHTENT,mus,vht,mus
14:55 SINAL,HC,VHTENT,mus,vht,mus
15:27 SINAL,HC,VHTENT,mus,vht,mus
15:55 SINAL,HC,VHTENT,mus,vht,mus
16:27 SINAL,HC,VHTENT,mus,vht,mus
16:55 SINAL,HC,VHTENT,mus,vht,mus
17:27 SINAL,HC,VHTENT,mus,vht,mus
17:55 SINAL,HC,VHTENT,mus,vht,mus
18:27 SINAL,HC,VHTENT,mus,vht,mus
18:55 SINAL,HC,VHTENT,mus,vht,mus
19:27 SINAL,HC,VHTENT,mus,vht,mus
19:55 SINAL,HC,VHTENT,mus,vht,mus
20:27 SINAL,HC,VHTENT,mus,vht,mus
20:59 SINAL,HC,VHTENT,mus,vht,mus
22:00 SINAL,HC,VHTENT,mus,vht,mus
22:27 SINAL,HC,VHTENT,mus,vht,mus
22:55 SINAL,HC,VHTENT,mus,vht,mus
23:27 SINAL,HC,VHTENT,mus,vht,mus
23:55 SINAL,HC,VHTENT,mus,vht,mus`,
};

// ─── Color System for Code Types ───
const CODE_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  literal:   { bg: 'bg-slate-500/10', border: 'border-slate-500/30', text: 'text-slate-300', glow: '' },
  vinheta:   { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-400', glow: 'shadow-[0_0_8px_rgba(139,92,246,0.15)]' },
  monitored: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400', glow: 'shadow-[0_0_8px_rgba(6,182,212,0.15)]' },
  genre:     { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', glow: 'shadow-[0_0_8px_rgba(245,158,11,0.15)]' },
  comercial: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', glow: 'shadow-[0_0_8px_rgba(16,185,129,0.15)]' },
};

const CODE_ICONS: Record<string, React.ReactNode> = {
  literal: <Clock className="w-3.5 h-3.5" />, vinheta: <Mic2 className="w-3.5 h-3.5" />,
  monitored: <Radio className="w-3.5 h-3.5" />, genre: <Music className="w-3.5 h-3.5" />,
  comercial: <FileText className="w-3.5 h-3.5" />,
};

const CODE_TYPE_LABELS: Record<string, string> = {
  literal: 'Literal', vinheta: 'Vinheta', monitored: 'Monitor', genre: 'Gênero', comercial: 'Comercial',
};

// ─── Sortable Code Pill (left panel) ───
function SortableCodePill({ cc, stations, updateMapaCodeConfig, removeMapaCodeConfig, comercialFiles, setComercialFiles }: {
  cc: MapaCodeConfig; stations: Array<{ id: string; name: string; enabled?: boolean }>;
  updateMapaCodeConfig: (code: string, updates: Partial<MapaCodeConfig>) => void;
  removeMapaCodeConfig: (code: string) => void;
  comercialFiles: Record<string, string[]>;
  setComercialFiles: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cc.code });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const colors = CODE_COLORS[cc.type] || CODE_COLORS.literal;
  const [expanded, setExpanded] = useState(false);

  return (
    <div ref={setNodeRef} style={style} className={`rounded-xl ${colors.bg} ${colors.border} border ${colors.glow} transition-all duration-200`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground touch-none">
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <span className={`${colors.text}`}>{CODE_ICONS[cc.type]}</span>
        <span className={`font-mono text-sm font-bold ${colors.text}`}>{cc.code}</span>
        <span className="text-[10px] text-muted-foreground/70 flex-1 truncate">{cc.label}</span>
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground/50 hover:text-muted-foreground">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => { removeMapaCodeConfig(cc.code); toast.info(`"${cc.code}" removido`); }} className="text-destructive/40 hover:text-destructive">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Expanded config */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/10">
          {cc.type === 'monitored' && (
            <Select value={cc.stationSource || ''} onValueChange={(v) => updateMapaCodeConfig(cc.code, { stationSource: v })}>
              <SelectTrigger className="h-7 text-[11px] bg-background/50"><SelectValue placeholder="Estação" /></SelectTrigger>
              <SelectContent>{stations.filter(s => s.enabled).map(s => (<SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>))}</SelectContent>
            </Select>
          )}
          {cc.type === 'genre' && <Input className="h-7 text-[11px] bg-background/50 font-mono" value={cc.genreFilter?.join(', ') || ''} onChange={(e) => updateMapaCodeConfig(cc.code, { genreFilter: e.target.value.split(',').map(g => g.trim().toUpperCase()).filter(Boolean) })} placeholder="FUNK, MPB, ROCK..." />}
          {cc.type === 'vinheta' && <Input className="h-7 text-[11px] bg-background/50 font-mono" value={cc.vinhetaFolder || ''} onChange={(e) => updateMapaCodeConfig(cc.code, { vinhetaFolder: e.target.value })} placeholder="C:\Playlist\..." />}
          {cc.type === 'comercial' && (
            <div className="space-y-1.5">
              <Input className="h-7 text-[11px] bg-background/50 font-mono" value={cc.vinhetaFolder || ''} onChange={(e) => updateMapaCodeConfig(cc.code, { vinhetaFolder: e.target.value })} placeholder="C:\Playlist\Comerciais" />
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={async () => {
                  if (!isElectron || !window.electronAPI?.listFolderFiles || !cc.vinhetaFolder) return;
                  try { const r = await window.electronAPI.listFolderFiles({ folder: cc.vinhetaFolder, extension: '.mp3' }); if (r.success && r.files) { setComercialFiles(p => ({ ...p, [cc.code]: r.files!.map(f => f.name) })); toast.success(`${r.files.length} arquivos`); } } catch { toast.error('Erro'); }
                }}><FolderOpen className="w-3 h-3 mr-1" /> Listar</Button>
                {cc.fixedFile && <span className="text-[9px] text-emerald-400 font-mono truncate flex-1">📎 {cc.fixedFile}</span>}
              </div>
              {comercialFiles[cc.code]?.length > 0 && (
                <Select value={cc.fixedFile || ''} onValueChange={(v) => updateMapaCodeConfig(cc.code, { fixedFile: v })}>
                  <SelectTrigger className="h-7 text-[11px] bg-background/50"><SelectValue placeholder="Arquivo fixo" /></SelectTrigger>
                  <SelectContent className="max-h-60">{comercialFiles[cc.code].map(f => (<SelectItem key={f} value={f} className="text-[11px] font-mono">{f}</SelectItem>))}</SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Timeline Block (single time slot) ───
function TimelineBlock({ line, lineIdx, templateIdx, codeConfigs, autoSaveToFile }: {
  line: MapaTemplateLine; lineIdx: number; templateIdx: number;
  codeConfigs: MapaCodeConfig[]; autoSaveToFile: (idx: number) => void;
}) {
  const { updateMapaTemplateLine, removeMapaTemplateLine } = useRadioStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const stdPattern = 'SINAL,HC,VHTENT,mus,vht,mus';
  const isStandard = line.codes.join(',') === stdPattern;

  const getCodeColor = (code: string) => {
    const cc = codeConfigs.find(c => c.code.toLowerCase() === code.toLowerCase());
    if (!cc) return CODE_COLORS.literal;
    return CODE_COLORS[cc.type] || CODE_COLORS.literal;
  };

  const saveEdit = () => {
    const codes = editValue.split(',').map(c => c.trim()).filter(Boolean);
    if (codes.length > 0) {
      updateMapaTemplateLine(templateIdx, lineIdx, codes);
      toast.success(`${line.time} salvo`, { duration: 1200 });
      autoSaveToFile(templateIdx);
    }
    setIsEditing(false);
  };

  return (
    <div className={`group relative flex items-stretch rounded-lg border transition-all duration-200 hover:scale-[1.005] ${
      isStandard 
        ? 'border-border/20 bg-card/30' 
        : 'border-primary/20 bg-primary/[0.03] shadow-[0_0_12px_rgba(6,182,212,0.05)]'
    } ${isEditing ? 'ring-1 ring-primary/40 bg-primary/[0.06]' : ''}`}>
      {/* Time indicator */}
      <div className={`flex items-center justify-center px-3 min-w-[68px] border-r ${
        isStandard ? 'border-border/20' : 'border-primary/20'
      }`}>
        <span className="font-mono text-sm font-bold text-primary tracking-wider">{line.time}</span>
      </div>
      
      {/* Content */}
      <div className="flex-1 px-3 py-2 min-h-[40px] flex items-center">
        {isEditing ? (
          <Input 
            className="h-7 text-xs font-mono bg-background/60 border-primary/30" 
            value={editValue} 
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); else if (e.key === 'Escape') setIsEditing(false); }}
            onBlur={saveEdit} 
            autoFocus 
          />
        ) : (
          <div className="flex gap-1.5 flex-wrap">
            {line.codes.map((code, j) => {
              const colors = getCodeColor(code);
              return (
                <span key={j} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-medium ${colors.bg} ${colors.border} border ${colors.text}`}>
                  {code}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={() => { if (isEditing) saveEdit(); else { setIsEditing(true); setEditValue(line.codes.join(',')); } }}
          className="p-1 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-primary transition-colors"
        >
          {isEditing ? <Save className="w-3.5 h-3.5" /> : <Settings2 className="w-3.5 h-3.5" />}
        </button>
        <button 
          onClick={() => { removeMapaTemplateLine(templateIdx, lineIdx); toast.info(`${line.time} removido`); autoSaveToFile(templateIdx); }}
          className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Left accent bar for non-standard */}
      {!isStandard && <div className="absolute left-0 top-1/4 bottom-1/4 w-0.5 rounded-full bg-primary/60" />}
    </div>
  );
}

// ─── Day Column ───
function DayColumn({ templateIdx, dayLabel, autoSaveToFile }: {
  templateIdx: number; dayLabel: string; autoSaveToFile: (idx: number) => void;
}) {
  const { mapasConfig, addMapaTemplateLine } = useRadioStore();
  const template = mapasConfig.templates?.[templateIdx];
  const [showAdd, setShowAdd] = useState(false);
  const [newTime, setNewTime] = useState('');
  const [newCodes, setNewCodes] = useState('SINAL,HC,VHTENT,mus,vht,mus');
  const [filePreview, setFilePreview] = useState<string[] | null>(null);

  if (!template) return null;

  const dayColors: Record<string, string> = {
    'Seg-Sex': 'from-cyan-500/20 to-cyan-500/5',
    'Sáb': 'from-amber-500/20 to-amber-500/5',
    'Dom': 'from-violet-500/20 to-violet-500/5',
  };
  const dayAccent: Record<string, string> = {
    'Seg-Sex': 'text-cyan-400 border-cyan-500/30',
    'Sáb': 'text-amber-400 border-amber-500/30',
    'Dom': 'text-violet-400 border-violet-500/30',
  };

  return (
    <div className="flex flex-col h-full">
      {/* Day header */}
      <div className={`rounded-t-xl bg-gradient-to-b ${dayColors[dayLabel] || dayColors['Seg-Sex']} border border-b-0 ${(dayAccent[dayLabel] || '').split(' ')[1]} px-4 py-3`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className={`w-4 h-4 ${(dayAccent[dayLabel] || 'text-primary').split(' ')[0]}`} />
            <h3 className={`font-bold text-sm ${(dayAccent[dayLabel] || 'text-primary').split(' ')[0]}`}>{dayLabel}</h3>
            <span className="text-[10px] text-muted-foreground font-mono">{template.filename}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[9px] border-border/30">{template.lines.length} slots</Badge>
            <div className="flex gap-1">
              <button onClick={async () => {
                if (isElectron && window.electronAPI?.readGradeFile) {
                  try {
                    const r = await window.electronAPI.readGradeFile({ folder: mapasConfig.outputFolder, filename: template.filename });
                    if (r.success && r.content) { setFilePreview(r.content.split('\n').filter(Boolean)); toast.success(`📂 ${template.filename} carregado`); }
                    else { toast.error('Arquivo não encontrado'); setFilePreview(null); }
                  } catch { toast.error('Erro ao ler'); }
                } else {
                  // Mock fallback for preview
                  const mock = MOCK_FILES[template.filename];
                  if (mock) { setFilePreview(mock.split('\n').filter(Boolean)); toast.success(`📂 ${template.filename} (preview)`); }
                  else { toast.error('Mock não disponível'); }
                }
              }} className="p-1.5 rounded-lg hover:bg-background/30 text-muted-foreground hover:text-foreground transition-colors" title="Carregar do disco">
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setShowAdd(!showAdd)} className="p-1.5 rounded-lg hover:bg-background/30 text-muted-foreground hover:text-foreground transition-colors" title="Adicionar horário">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 rounded-b-xl border border-t-0 ${(dayAccent[dayLabel] || '').split(' ')[1]} bg-card/20 backdrop-blur-sm`}>
        {/* File preview */}
        {filePreview && (
          <div className="mx-3 mt-3 rounded-lg border border-accent/20 bg-accent/5 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-accent-foreground">📂 Arquivo no disco</span>
              <button onClick={() => setFilePreview(null)} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
            </div>
            <ScrollArea className="max-h-[200px]">
              <div className="space-y-0.5">
                {filePreview.map((l, i) => <div key={i} className="font-mono text-[9px] text-muted-foreground/80 leading-relaxed">{l}</div>)}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Add new slot */}
        {showAdd && (
          <div className="mx-3 mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 flex gap-2 items-center">
            <Input className="h-7 text-[11px] font-mono w-[70px] bg-background/50" placeholder="HH:MM" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
            <Input className="h-7 text-[11px] font-mono flex-1 bg-background/50" placeholder="SINAL,HC,VHTENT,mus,vht,mus" value={newCodes} onChange={(e) => setNewCodes(e.target.value)} />
            <Button size="sm" className="h-7 px-2" disabled={!newTime.match(/^\d{2}:\d{2}$/)} onClick={() => {
              const codes = newCodes.split(',').map(c => c.trim()).filter(Boolean);
              if (!codes.length) { toast.error('Informe os códigos'); return; }
              addMapaTemplateLine(templateIdx, newTime, codes);
              setNewTime(''); setNewCodes('SINAL,HC,VHTENT,mus,vht,mus'); setShowAdd(false);
              toast.success('Horário adicionado'); autoSaveToFile(templateIdx);
            }}><Plus className="w-3 h-3" /></Button>
          </div>
        )}

        {/* Timeline */}
        <ScrollArea className="h-[calc(100vh-320px)]">
          <div className="p-3 space-y-1.5">
            {template.lines.map((line, i) => (
              <TimelineBlock
                key={`${line.time}-${i}`}
                line={line}
                lineIdx={i}
                templateIdx={templateIdx}
                codeConfigs={mapasConfig.codeConfigs}
                autoSaveToFile={autoSaveToFile}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// ─── Main View ───
export function MapasView() {
  const { mapasConfig, setMapasConfig, updateMapaCodeConfig, addMapaCodeConfig, removeMapaCodeConfig, resetMapaCodeConfigs, reorderMapaCodeConfigs, resetMapaTemplates, config, stations } = useRadioStore();
  const [isBuilding, setIsBuilding] = useState(false);
  const [showNewCode, setShowNewCode] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [newCode, setNewCode] = useState({ code: '', label: '', type: 'literal' as MapaCodeConfig['type'], stationSource: '', genreFilter: '', vinhetaFolder: '', fixedFile: '' });
  const [comercialFiles, setComercialFiles] = useState<Record<string, string[]>>({});
  const autoSaveTimerRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dayLabels: Record<string, string> = { weekdays: 'Seg-Sex', saturday: 'Sáb', sunday: 'Dom' };

  const autoSaveToFile = useCallback(async (tmplIdx: number) => {
    if (!isElectron) return;
    if (autoSaveTimerRef.current[tmplIdx]) clearTimeout(autoSaveTimerRef.current[tmplIdx]);
    autoSaveTimerRef.current[tmplIdx] = setTimeout(async () => {
      const store = useRadioStore.getState();
      const tmpl = store.mapasConfig.templates[tmplIdx];
      if (!tmpl) return;
      resetMapasPools();
      const cache = new Map<string, string[]>();
      const lines: string[] = [];
      try {
        for (const line of tmpl.lines) {
          const r = await resolveTemplateLine(line, store.mapasConfig, store.config.musicFolders, cache);
          lines.push(formatResolvedLine(r));
        }
        const result = await window.electronAPI!.saveGradeFile({ folder: store.mapasConfig.outputFolder, filename: tmpl.filename, content: lines.join('\n') });
        if (result.success) toast.success(`💾 ${tmpl.filename} salvo`, { duration: 1500 });
      } catch { /* silent */ }
    }, 1500);
  }, []);

  const buildAll = useCallback(async () => {
    if (!isElectron || !mapasConfig.templates?.length) return;
    setIsBuilding(true); let built = 0;
    for (const tmpl of mapasConfig.templates) {
      resetMapasPools(); const cache = new Map<string, string[]>(); const lines: string[] = [];
      try {
        for (const line of tmpl.lines) { const r = await resolveTemplateLine(line, mapasConfig, config.musicFolders, cache); lines.push(formatResolvedLine(r)); }
        await window.electronAPI!.saveGradeFile({ folder: mapasConfig.outputFolder, filename: tmpl.filename, content: lines.join('\n') }); built++;
      } catch { /* skip */ }
    }
    toast.success(`${built}/${mapasConfig.templates.length} mapas construídos!`); setIsBuilding(false);
  }, [mapasConfig, config.musicFolders]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  return (
    <div className="h-full flex flex-col">
      {/* ─── Header ─── */}
      <div className="px-5 py-4 border-b border-border/20 bg-gradient-to-r from-background via-card/50 to-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
              <MapIcon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">Mapas Comerciais</h1>
              <p className="text-[11px] text-muted-foreground/70 font-mono">auto-save → C:\Playlist\pgm\Mapas</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs border-border/30 hover:border-border/50" onClick={() => { resetMapaTemplates(); toast.success('Templates restaurados'); }}>
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Restaurar
            </Button>
            <Button size="sm" className="h-8 text-xs shadow-[0_0_12px_rgba(6,182,212,0.2)]" onClick={buildAll} disabled={isBuilding}>
              <Zap className="w-3.5 h-3.5 mr-1.5" /> Construir Todos
            </Button>
          </div>
        </div>
      </div>

      {/* ─── Body ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ─── Left: Codes Panel ─── */}
        <div className="w-[280px] border-r border-border/20 flex flex-col bg-card/10">
          <div className="px-4 py-3 border-b border-border/15 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">Códigos</span>
              <Badge variant="secondary" className="text-[9px] h-4">{mapasConfig.codeConfigs.length}</Badge>
            </div>
            <div className="flex gap-0.5">
              <button onClick={() => setShowNewCode(!showNewCode)} className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { resetMapaCodeConfigs(); toast.success('Códigos restaurados'); }} className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1.5">
              {/* New code form */}
              {showNewCode && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2 mb-2">
                  <p className="text-[10px] font-bold text-primary uppercase tracking-wider">Novo Código</p>
                  <Input className="h-7 text-[11px] font-mono bg-background/50" placeholder="ex: jov" value={newCode.code} onChange={(e) => setNewCode(p => ({ ...p, code: e.target.value }))} />
                  <Input className="h-7 text-[11px] bg-background/50" placeholder="Descrição" value={newCode.label} onChange={(e) => setNewCode(p => ({ ...p, label: e.target.value }))} />
                  <Select value={newCode.type} onValueChange={(v: any) => setNewCode(p => ({ ...p, type: v }))}>
                    <SelectTrigger className="h-7 text-[11px] bg-background/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="literal">Literal</SelectItem><SelectItem value="vinheta">Vinheta</SelectItem>
                      <SelectItem value="monitored">Monitoramento</SelectItem><SelectItem value="genre">Gênero ID3</SelectItem>
                      <SelectItem value="comercial">Comercial</SelectItem>
                    </SelectContent>
                  </Select>
                  {newCode.type === 'monitored' && <Select value={newCode.stationSource} onValueChange={(v) => setNewCode(p => ({ ...p, stationSource: v }))}><SelectTrigger className="h-7 text-[11px] bg-background/50"><SelectValue placeholder="Estação" /></SelectTrigger><SelectContent>{stations.filter(s => s.enabled).map(s => (<SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>))}</SelectContent></Select>}
                  {newCode.type === 'genre' && <Input className="h-7 text-[11px] bg-background/50 font-mono" placeholder="FUNK, MPB..." value={newCode.genreFilter} onChange={(e) => setNewCode(p => ({ ...p, genreFilter: e.target.value }))} />}
                  {(newCode.type === 'vinheta' || newCode.type === 'comercial') && <Input className="h-7 text-[11px] bg-background/50 font-mono" placeholder="C:\Playlist\..." value={newCode.vinhetaFolder} onChange={(e) => setNewCode(p => ({ ...p, vinhetaFolder: e.target.value }))} />}
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7 text-[10px] flex-1" disabled={!newCode.code.trim() || !newCode.label.trim()} onClick={() => {
                      if (mapasConfig.codeConfigs.some(c => c.code.toLowerCase() === newCode.code.toLowerCase())) { toast.error('Já existe'); return; }
                      addMapaCodeConfig({ code: newCode.code.trim(), label: newCode.label.trim(), type: newCode.type,
                        ...(newCode.type === 'monitored' ? { stationSource: newCode.stationSource } : {}),
                        ...(newCode.type === 'genre' ? { genreFilter: newCode.genreFilter.split(',').map(g => g.trim().toUpperCase()).filter(Boolean) } : {}),
                        ...((newCode.type === 'vinheta' || newCode.type === 'comercial') ? { vinhetaFolder: newCode.vinhetaFolder } : {}),
                        ...(newCode.type === 'comercial' ? { fixedFile: newCode.fixedFile } : {}),
                      });
                      setNewCode({ code: '', label: '', type: 'literal', stationSource: '', genreFilter: '', vinhetaFolder: '', fixedFile: '' });
                      setShowNewCode(false); toast.success('Adicionado!');
                    }}><Plus className="w-3 h-3 mr-1" /> Add</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setShowNewCode(false)}>×</Button>
                  </div>
                </div>
              )}

              {/* Code pills */}
              <DndContext sensors={sensors} collisionDetection={closestCenter}
                onDragEnd={(event: DragEndEvent) => { const { active, over } = event; if (!over || active.id === over.id) return; const o = mapasConfig.codeConfigs.findIndex(c => c.code === active.id); const n = mapasConfig.codeConfigs.findIndex(c => c.code === over.id); if (o >= 0 && n >= 0) reorderMapaCodeConfigs(o, n); }}>
                <SortableContext items={mapasConfig.codeConfigs.map(c => c.code)} strategy={verticalListSortingStrategy}>
                  {mapasConfig.codeConfigs.map(cc => <SortableCodePill key={cc.code} cc={cc} stations={stations} updateMapaCodeConfig={updateMapaCodeConfig} removeMapaCodeConfig={removeMapaCodeConfig} comercialFiles={comercialFiles} setComercialFiles={setComercialFiles} />)}
                </SortableContext>
              </DndContext>
            </div>

            {/* Output folder */}
            <div className="p-3 pt-0">
              <div className="rounded-lg border border-border/15 p-3 space-y-1.5">
                <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">Pasta destino</label>
                <Input className="h-7 text-[11px] font-mono bg-background/30" value={mapasConfig.outputFolder} onChange={(e) => setMapasConfig({ outputFolder: e.target.value })} />
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* ─── Right: Day Tabs + Timeline ─── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Day tabs */}
          <div className="px-4 py-2 border-b border-border/15 flex gap-1.5 bg-card/5">
            {(mapasConfig.templates || []).map((t, i) => {
              const label = dayLabels[t.dayMapping] || t.filename;
              const isActive = activeDay === i;
              const tabColors: Record<number, string> = {
                0: isActive ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.1)]' : 'border-border/20 text-muted-foreground hover:text-foreground hover:border-border/40',
                1: isActive ? 'bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.1)]' : 'border-border/20 text-muted-foreground hover:text-foreground hover:border-border/40',
                2: isActive ? 'bg-violet-500/15 border-violet-500/40 text-violet-400 shadow-[0_0_10px_rgba(139,92,246,0.1)]' : 'border-border/20 text-muted-foreground hover:text-foreground hover:border-border/40',
              };
              return (
                <button key={t.filename} onClick={() => setActiveDay(i)}
                  className={`px-4 py-2 rounded-lg border text-xs font-semibold transition-all duration-200 ${tabColors[i] || tabColors[0]}`}>
                  {label}
                  <span className="ml-1.5 text-[9px] opacity-60">{t.lines.length}</span>
                </button>
              );
            })}
            <div className="flex-1" />
            <Button size="sm" variant="outline" className="h-8 text-[10px] border-border/20" onClick={() => {
              const tmpl = mapasConfig.templates[activeDay];
              if (!tmpl || !isElectron) return;
              setIsBuilding(true);
              (async () => {
                resetMapasPools(); const cache = new Map<string, string[]>(); const lines: string[] = [];
                try {
                  for (const line of tmpl.lines) { const r = await resolveTemplateLine(line, mapasConfig, config.musicFolders, cache); lines.push(formatResolvedLine(r)); }
                  const result = await window.electronAPI!.saveGradeFile({ folder: mapasConfig.outputFolder, filename: tmpl.filename, content: lines.join('\n') });
                  result.success ? toast.success(`${tmpl.filename} construído!`) : toast.error('Erro');
                } catch (err: any) { toast.error(err.message); }
                setIsBuilding(false);
              })();
            }} disabled={isBuilding}>
              <Play className="w-3 h-3 mr-1" /> Construir
            </Button>
          </div>

          {/* Active day timeline */}
          <div className="flex-1 overflow-hidden p-4">
            <DayColumn
              templateIdx={activeDay}
              dayLabel={dayLabels[mapasConfig.templates?.[activeDay]?.dayMapping] || ''}
              autoSaveToFile={autoSaveToFile}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default MapasView;
