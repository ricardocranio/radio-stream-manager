import { useState, useCallback, useRef } from 'react';
import { useDeferredRender } from '@/hooks/useDeferredRender';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore } from '@/store/radioStore';
import { resolveTemplateLine, formatResolvedLine, resetMapasPools } from '@/lib/mapasBuilder/resolver';
import type { MapaResolvedLine, MapaCodeConfig, MapaTemplateLine } from '@/lib/mapasBuilder/types';
import { MapIcon, FileText, Play, Settings2, Radio, Music, Mic2, Clock, FolderOpen, Plus, RotateCcw, Trash2, GripVertical, Save, ChevronDown, ChevronRight, Zap, X, Pencil, Eye, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const isElectron = typeof window !== 'undefined' && (window.electronAPI?.isElectron ?? false);

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

// ─── Color System ───
const CODE_COLORS: Record<string, { bg: string; border: string; text: string; glow: string; pill: string }> = {
  literal:   { bg: 'bg-slate-500/10', border: 'border-slate-500/30', text: 'text-slate-300', glow: '', pill: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
  vinheta:   { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-400', glow: 'shadow-[0_0_8px_rgba(139,92,246,0.15)]', pill: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
  monitored: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400', glow: 'shadow-[0_0_8px_rgba(6,182,212,0.15)]', pill: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  genre:     { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', glow: 'shadow-[0_0_8px_rgba(245,158,11,0.15)]', pill: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  comercial: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', glow: 'shadow-[0_0_8px_rgba(16,185,129,0.15)]', pill: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
};

const MAPAS_AVAILABLE_GENRES = ['POP', 'ROCK', 'DANCE', 'SERTANEJO', 'PAGODE', 'FUNK', 'MPB', 'ROMANTICO', 'ROMANTICA', 'BOSSA NOVA', 'FORRO', 'METAL', 'ELETRONICA', 'RAP'];
const MAPAS_AVAILABLE_DECADES = [
  { value: '80s', label: 'Anos 80' },
  { value: '90s', label: 'Anos 90' },
  { value: '2000s', label: 'Anos 2000' },
  { value: '2010s', label: 'Anos 2010' },
  { value: '2020s', label: 'Anos 2020' },
];

const CODE_ICONS: Record<string, React.ReactNode> = {
  literal: <Clock className="w-3 h-3" />, vinheta: <Mic2 className="w-3 h-3" />,
  monitored: <Radio className="w-3 h-3" />, genre: <Music className="w-3 h-3" />,
  comercial: <FileText className="w-3 h-3" />,
};

// ─── Sortable Code Pill ───
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
    <div ref={setNodeRef} style={style} className={`rounded-lg ${colors.bg} ${colors.border} border ${colors.glow} transition-all duration-200`}>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground touch-none">
          <GripVertical className="w-3 h-3" />
        </button>
        <span className={colors.text}>{CODE_ICONS[cc.type]}</span>
        <span className={`font-mono text-xs font-bold ${colors.text}`}>{cc.code}</span>
        <span className="text-[9px] text-muted-foreground/60 flex-1 truncate">{cc.label}</span>
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground/40 hover:text-muted-foreground">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <button onClick={() => { removeMapaCodeConfig(cc.code); toast.info(`"${cc.code}" removido`); }} className="text-destructive/40 hover:text-destructive">
          <X className="w-3 h-3" />
        </button>
      </div>
      {expanded && (
        <div className="px-2.5 pb-2 pt-1 space-y-1.5 border-t border-border/10">
          {/* Station source (monitored + genre) */}
          {(cc.type === 'monitored' || cc.type === 'genre') && (
            <div className="space-y-1">
              <label className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Fonte (Estação)</label>
              <Select value={cc.stationSource || ''} onValueChange={(v) => updateMapaCodeConfig(cc.code, { stationSource: v === '__none__' ? undefined : v })}>
                <SelectTrigger className="h-6 text-[10px] bg-background/50"><SelectValue placeholder="Todas / Automático" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Todas / Automático</SelectItem>
                  {stations.filter(s => s.enabled).map(s => (<SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* Genre filter (genre type) - clickable badges like SequenceView */}
          {cc.type === 'genre' && (
            <div className="space-y-1.5">
              <label className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Gêneros (clique para selecionar)</label>
              <div className="flex gap-1 flex-wrap">
                {MAPAS_AVAILABLE_GENRES.map(genre => {
                  const isActive = cc.genreFilter?.includes(genre);
                  return (
                    <button key={genre} onClick={() => {
                      const current = cc.genreFilter || [];
                      const updated = isActive ? current.filter(g => g !== genre) : [...current, genre];
                      updateMapaCodeConfig(cc.code, { genreFilter: updated });
                    }}
                      className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-medium border transition-all ${
                        isActive
                          ? 'bg-amber-500/25 text-amber-300 border-amber-500/40 shadow-[0_0_6px_rgba(245,158,11,0.2)]'
                          : 'bg-background/30 text-muted-foreground/60 border-border/20 hover:border-amber-500/30 hover:text-amber-400'
                      }`}>
                      {genre}
                    </button>
                  );
                })}
              </div>
              {(cc.genreFilter?.length || 0) > 0 && (
                <p className="text-[8px] text-amber-400/80">✓ {cc.genreFilter!.join(' / ')}</p>
              )}
              {/* Decade selector */}
              <label className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Década</label>
              <div className="flex gap-1 flex-wrap">
                {MAPAS_AVAILABLE_DECADES.map(d => {
                  const isActive = cc.decadeFilter === d.value;
                  return (
                    <button key={d.value} onClick={() => updateMapaCodeConfig(cc.code, { decadeFilter: isActive ? undefined : d.value })}
                      className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-medium border transition-all ${
                        isActive
                          ? 'bg-violet-500/25 text-violet-300 border-violet-500/40 shadow-[0_0_6px_rgba(139,92,246,0.2)]'
                          : 'bg-background/30 text-muted-foreground/60 border-border/20 hover:border-violet-500/30 hover:text-violet-400'
                      }`}>
                      📅 {d.label}
                    </button>
                  );
                })}
              </div>
              {cc.decadeFilter && (
                <p className="text-[8px] text-violet-400/80">✓ {MAPAS_AVAILABLE_DECADES.find(d => d.value === cc.decadeFilter)?.label || cc.decadeFilter}</p>
              )}
            </div>
          )}
          {/* Vinheta folder */}
          {cc.type === 'vinheta' && (
            <div className="space-y-1">
              <label className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Pasta</label>
              <Input className="h-6 text-[10px] bg-background/50 font-mono" value={cc.vinhetaFolder || ''} onChange={(e) => updateMapaCodeConfig(cc.code, { vinhetaFolder: e.target.value })} placeholder="C:\Playlist\..." />
            </div>
          )}
          {/* Conteúdo fixo / year / style info */}
          {(cc.type === 'monitored' || cc.type === 'genre') && (
            <div className="space-y-1 pt-1 border-t border-border/10">
              <label className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Opções avançadas</label>
              <div className="grid grid-cols-2 gap-1">
                <div className="rounded bg-background/30 px-1.5 py-1">
                  <span className="text-[7px] text-muted-foreground/40 block">Conteúdo fixo</span>
                  <span className="text-[9px] text-foreground/70 font-mono">{cc.fixedFile || '—'}</span>
                </div>
                <div className="rounded bg-background/30 px-1.5 py-1">
                  <span className="text-[7px] text-muted-foreground/40 block">Estilo</span>
                  <span className="text-[9px] text-foreground/70 font-mono">{cc.genreFilter?.join(', ') || cc.stationSource || 'Auto'}</span>
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5" onClick={async () => {
                  const folder = cc.type === 'genre' ? (cc.vinhetaFolder || 'C:\\Playlist\\Músicas') : '';
                  if (!isElectron || !window.electronAPI?.listFolderFiles || !folder) return;
                  try { const r = await window.electronAPI.listFolderFiles({ folder, extension: '.mp3' }); if (r.success && r.files) { setComercialFiles(p => ({ ...p, [cc.code]: r.files!.map(f => f.name) })); toast.success(`${r.files.length} arquivos`); } } catch { toast.error('Erro ao listar'); }
                }}><FolderOpen className="w-2.5 h-2.5 mr-0.5" /> Listar</Button>
                {cc.fixedFile && <span className="text-[8px] text-emerald-400 font-mono truncate flex-1">📎 {cc.fixedFile}</span>}
              </div>
              {comercialFiles[cc.code]?.length > 0 && (
                <Select value={cc.fixedFile || ''} onValueChange={(v) => updateMapaCodeConfig(cc.code, { fixedFile: v === '__none__' ? undefined : v })}>
                  <SelectTrigger className="h-6 text-[10px] bg-background/50"><SelectValue placeholder="Arquivo fixo (opcional)" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="__none__">Nenhum (aleatório)</SelectItem>
                    {comercialFiles[cc.code].map(f => (<SelectItem key={f} value={f} className="text-[10px] font-mono">{f}</SelectItem>))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          {/* Comercial */}
          {cc.type === 'comercial' && (
            <div className="space-y-1">
              <label className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Pasta</label>
              <Input className="h-6 text-[10px] bg-background/50 font-mono" value={cc.vinhetaFolder || ''} onChange={(e) => updateMapaCodeConfig(cc.code, { vinhetaFolder: e.target.value })} placeholder="C:\Playlist\Comerciais" />
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5" onClick={async () => {
                  if (!isElectron || !window.electronAPI?.listFolderFiles || !cc.vinhetaFolder) return;
                  try { const r = await window.electronAPI.listFolderFiles({ folder: cc.vinhetaFolder, extension: '.mp3' }); if (r.success && r.files) { setComercialFiles(p => ({ ...p, [cc.code]: r.files!.map(f => f.name) })); toast.success(`${r.files.length} arquivos`); } } catch { toast.error('Erro'); }
                }}><FolderOpen className="w-2.5 h-2.5 mr-0.5" /> Listar</Button>
                {cc.fixedFile && <span className="text-[8px] text-emerald-400 font-mono truncate flex-1">📎 {cc.fixedFile}</span>}
              </div>
              {comercialFiles[cc.code]?.length > 0 && (
                <Select value={cc.fixedFile || ''} onValueChange={(v) => updateMapaCodeConfig(cc.code, { fixedFile: v })}>
                  <SelectTrigger className="h-6 text-[10px] bg-background/50"><SelectValue placeholder="Arquivo fixo" /></SelectTrigger>
                  <SelectContent className="max-h-60">{comercialFiles[cc.code].map(f => (<SelectItem key={f} value={f} className="text-[10px] font-mono">{f}</SelectItem>))}</SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main View ───
export function MapasView() {
  const { mapasConfig, setMapasConfig, updateMapaCodeConfig, addMapaCodeConfig, removeMapaCodeConfig, resetMapaCodeConfigs, reorderMapaCodeConfigs, resetMapaTemplates, updateMapaTemplateLine, removeMapaTemplateLine, addMapaTemplateLine, config, stations } = useRadioStore();
  const [isBuilding, setIsBuilding] = useState(false);
  const [activeDay, setActiveDay] = useState(() => { const d = new Date().getDay(); return [0,1,2,3,4,5,6][d]; }); // 0=dom,1=seg...6=sab
  const [editingSlot, setEditingSlot] = useState<number | null>(null);

  const isReady = useDeferredRender();
  const [editValue, setEditValue] = useState('');
  const [editTime, setEditTime] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newTime, setNewTime] = useState('');
  const [newCodes, setNewCodes] = useState('SINAL,HC,VHTENT,mus,vht,mus');
  const [leftPanel, setLeftPanel] = useState<'timeline' | 'codes'>('timeline');
  const [showNewCode, setShowNewCode] = useState(false);
  const [newCode, setNewCode] = useState({ code: '', label: '', type: 'literal' as MapaCodeConfig['type'], stationSource: '', genreFilter: '', vinhetaFolder: '', fixedFile: '' });
  const [comercialFiles, setComercialFiles] = useState<Record<string, string[]>>({});
  const autoSaveTimerRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const safeTemplates = Array.isArray(mapasConfig?.templates) ? mapasConfig.templates : [];
  const safeCodeConfigs = Array.isArray(mapasConfig?.codeConfigs) ? mapasConfig.codeConfigs : [];
  const safeOutputFolder = mapasConfig?.outputFolder || 'C:\\Playlist\\pgm\\Mapas';
  const dayLabels: Record<string, string> = { dom: 'Dom', seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', 'sáb': 'Sáb', weekdays: 'Seg-Sex', saturday: 'Sáb', sunday: 'Dom' };
  const template = safeTemplates[activeDay];
  const stdPattern = 'SINAL,HC,VHTENT,mus,vht,mus';

  const getCodeColor = (code: string) => {
    const cc = safeCodeConfigs.find(c => c.code.toLowerCase() === code.toLowerCase());
    if (!cc) return CODE_COLORS.literal;
    return CODE_COLORS[cc.type] || CODE_COLORS.literal;
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const autoSaveToFile = useCallback(async (tmplIdx: number) => {
    if (!isElectron) return;
    if (autoSaveTimerRef.current[tmplIdx]) clearTimeout(autoSaveTimerRef.current[tmplIdx]);
    autoSaveTimerRef.current[tmplIdx] = setTimeout(async () => {
      const store = useRadioStore.getState();
      const tmpl = store.mapasConfig.templates?.[tmplIdx];
      if (!tmpl) return;
      resetMapasPools();
      const cache = new Map<string, string[]>();
      const lines: string[] = [];
      try {
        for (const line of tmpl.lines) { const r = await resolveTemplateLine(line, store.mapasConfig, store.config.musicFolders, cache); lines.push(formatResolvedLine(r)); }
        const result = await window.electronAPI!.saveGradeFile({ folder: store.mapasConfig.outputFolder || safeOutputFolder, filename: tmpl.filename, content: lines.join('\n') });
        if (result.success) toast.success(`💾 ${tmpl.filename} salvo`, { duration: 1200 });
      } catch { /* silent */ }
    }, 1500);
  }, []);

  // Each template now maps directly to its own file
  const buildAll = useCallback(async () => {
    if (!isElectron || !safeTemplates.length) return;
    setIsBuilding(true); let built = 0;
    for (const tmpl of safeTemplates) {
      resetMapasPools(); const cache = new Map<string, string[]>(); const lines: string[] = [];
      try {
        for (const line of tmpl.lines) { const r = await resolveTemplateLine(line, mapasConfig, config.musicFolders, cache); lines.push(formatResolvedLine(r)); }
        await window.electronAPI!.saveGradeFile({ folder: safeOutputFolder, filename: tmpl.filename, content: lines.join('\n') }); built++;
      } catch { /* skip */ }
    }
    toast.success(`${built} mapas construídos!`); setIsBuilding(false);
  }, [safeTemplates, mapasConfig, config.musicFolders, safeOutputFolder]);

  const saveSlotEdit = (lineIdx: number) => {
    const codes = editValue.split(',').map(c => c.trim()).filter(Boolean);
    if (codes.length > 0) {
      updateMapaTemplateLine(activeDay, lineIdx, codes);
      toast.success(`${editTime} atualizado`, { duration: 1200 });
      autoSaveToFile(activeDay);
    }
    setEditingSlot(null);
  };

  const dayColors: Record<string, { tab: string; activeTab: string; accent: string; headerBg: string }> = {
    'Seg': { tab: 'border-border/20 text-muted-foreground hover:text-cyan-400', activeTab: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.15)]', accent: 'text-cyan-400', headerBg: 'from-cyan-500/10 to-transparent' },
    'Ter': { tab: 'border-border/20 text-muted-foreground hover:text-cyan-400', activeTab: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.15)]', accent: 'text-cyan-400', headerBg: 'from-cyan-500/10 to-transparent' },
    'Qua': { tab: 'border-border/20 text-muted-foreground hover:text-teal-400', activeTab: 'bg-teal-500/15 border-teal-500/40 text-teal-400 shadow-[0_0_10px_rgba(20,184,166,0.15)]', accent: 'text-teal-400', headerBg: 'from-teal-500/10 to-transparent' },
    'Qui': { tab: 'border-border/20 text-muted-foreground hover:text-teal-400', activeTab: 'bg-teal-500/15 border-teal-500/40 text-teal-400 shadow-[0_0_10px_rgba(20,184,166,0.15)]', accent: 'text-teal-400', headerBg: 'from-teal-500/10 to-transparent' },
    'Sex': { tab: 'border-border/20 text-muted-foreground hover:text-sky-400', activeTab: 'bg-sky-500/15 border-sky-500/40 text-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.15)]', accent: 'text-sky-400', headerBg: 'from-sky-500/10 to-transparent' },
    'Sáb': { tab: 'border-border/20 text-muted-foreground hover:text-amber-400', activeTab: 'bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.15)]', accent: 'text-amber-400', headerBg: 'from-amber-500/10 to-transparent' },
    'Dom': { tab: 'border-border/20 text-muted-foreground hover:text-violet-400', activeTab: 'bg-violet-500/15 border-violet-500/40 text-violet-400 shadow-[0_0_10px_rgba(139,92,246,0.15)]', accent: 'text-violet-400', headerBg: 'from-violet-500/10 to-transparent' },
  };

  const currentDayLabel = template ? (dayLabels[template.dayMapping] || template.filename) : 'Seg';
  const currentColors = dayColors[currentDayLabel] || dayColors['Seg'];

  if (!isReady) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center animate-pulse">
            <MapIcon className="w-6 h-6 text-primary/50" />
          </div>
          <p className="text-sm text-muted-foreground/60">Carregando Mapas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* ─── Header ─── */}
      <div className="px-5 py-3 border-b border-border/20 bg-gradient-to-r from-background via-card/50 to-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
              <MapIcon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">Mapas Comerciais</h1>
              <p className="text-[10px] text-muted-foreground/60 font-mono">C:\Playlist\pgm\Mapas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Day tabs */}
            {(mapasConfig.templates || []).map((t, i) => {
              const label = dayLabels[t.dayMapping] || t.filename;
              const isActive = activeDay === i;
              const dc = dayColors[label] || dayColors['Seg-Sex'];
              return (
                <button key={t.filename} onClick={() => { setActiveDay(i); setEditingSlot(null); }}
                  className={`px-4 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-200 ${isActive ? dc.activeTab : dc.tab}`}>
                  {label}
                  <span className="ml-1.5 text-[9px] opacity-60">{t.lines.length}</span>
                </button>
              );
            })}
            <div className="w-px h-6 bg-border/20 mx-1" />
            <Button size="sm" variant="outline" className="h-7 text-[10px] border-border/30" onClick={() => { resetMapaTemplates(); toast.success('Templates restaurados'); }}>
              <RotateCcw className="w-3 h-3 mr-1" /> Reset
            </Button>
            <Button size="sm" className="h-7 text-[10px] shadow-[0_0_12px_rgba(6,182,212,0.2)]" onClick={buildAll} disabled={isBuilding}>
              <Zap className="w-3 h-3 mr-1" /> Construir
            </Button>
          </div>
        </div>
      </div>

      {/* ─── Body ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ─── Left Panel ─── */}
        <div className="w-[340px] border-r border-border/20 flex flex-col bg-card/5">
          {/* Panel toggle */}
          <div className="px-3 py-2 border-b border-border/15 flex items-center gap-1">
            <button onClick={() => setLeftPanel('timeline')}
              className={`px-3 py-1 rounded-md text-[10px] font-semibold transition-all ${leftPanel === 'timeline' ? 'bg-primary/15 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground'}`}>
              <Eye className="w-3 h-3 inline mr-1" />Timeline
            </button>
            <button onClick={() => setLeftPanel('codes')}
              className={`px-3 py-1 rounded-md text-[10px] font-semibold transition-all ${leftPanel === 'codes' ? 'bg-primary/15 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground'}`}>
              <Settings2 className="w-3 h-3 inline mr-1" />Códigos
              <Badge variant="secondary" className="text-[8px] h-3.5 ml-1">{mapasConfig.codeConfigs.length}</Badge>
            </button>
            <div className="flex-1" />
            {leftPanel === 'timeline' && (
              <button onClick={() => setShowAdd(!showAdd)} className="p-1 rounded-md hover:bg-muted/30 text-muted-foreground hover:text-foreground">
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
            {leftPanel === 'codes' && (
              <div className="flex gap-0.5">
                <button onClick={() => setShowNewCode(!showNewCode)} className="p-1 rounded-md hover:bg-muted/30 text-muted-foreground hover:text-foreground"><Plus className="w-3.5 h-3.5" /></button>
                <button onClick={() => { resetMapaCodeConfigs(); toast.success('Códigos restaurados'); }} className="p-1 rounded-md hover:bg-muted/30 text-muted-foreground hover:text-foreground"><RotateCcw className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>

          <ScrollArea className="flex-1">
            {leftPanel === 'timeline' ? (
              <div className="p-2 space-y-0.5">
                {/* Add new slot */}
                {showAdd && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 flex gap-1.5 items-center mb-2">
                    <Input className="h-6 text-[10px] font-mono w-[58px] bg-background/50" placeholder="HH:MM" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                    <Input className="h-6 text-[10px] font-mono flex-1 bg-background/50" placeholder="SINAL,HC,VHTENT,mus,vht,mus" value={newCodes} onChange={(e) => setNewCodes(e.target.value)} />
                    <Button size="sm" className="h-6 w-6 p-0" disabled={!newTime.match(/^\d{2}:\d{2}$/)} onClick={() => {
                      const codes = newCodes.split(',').map(c => c.trim()).filter(Boolean);
                      if (!codes.length) return;
                      addMapaTemplateLine(activeDay, newTime, codes);
                      setNewTime(''); setNewCodes('SINAL,HC,VHTENT,mus,vht,mus'); setShowAdd(false);
                      toast.success('Horário adicionado'); autoSaveToFile(activeDay);
                    }}><Plus className="w-3 h-3" /></Button>
                  </div>
                )}

                {/* Timeline slots */}
                {template?.lines.map((line, i) => {
                  const isStd = line.codes.join(',') === stdPattern;
                  const isSelected = editingSlot === i;
                  return (
                    <button key={`${line.time}-${i}`}
                      onClick={() => { setEditingSlot(i); setEditValue(line.codes.join(',')); setEditTime(line.time); }}
                      className={`w-full text-left rounded-lg px-2.5 py-2 flex items-center gap-2 transition-all duration-150 group ${
                        isSelected
                          ? 'bg-primary/10 border border-primary/30 shadow-[0_0_12px_rgba(6,182,212,0.1)]'
                          : isStd
                            ? 'hover:bg-card/40 border border-transparent'
                            : 'hover:bg-card/40 border border-transparent'
                      }`}>
                      {/* Time */}
                      <span className={`font-mono text-[11px] font-bold min-w-[42px] ${isSelected ? 'text-primary' : currentColors.accent}`}>
                        {line.time}
                      </span>
                      {/* Code badges */}
                      <div className="flex gap-1 flex-wrap flex-1">
                        {line.codes.map((code, j) => {
                          const colors = getCodeColor(code);
                          return (
                            <span key={j} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-medium border ${colors.pill}`}>
                              {code}
                            </span>
                          );
                        })}
                      </div>
                      {/* Indicator for non-standard */}
                      {!isStd && <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Codes panel */
              <div className="p-2 space-y-1">
                {showNewCode && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-1.5 mb-2">
                    <p className="text-[9px] font-bold text-primary uppercase tracking-wider">Novo Código</p>
                    <Input className="h-6 text-[10px] font-mono bg-background/50" placeholder="ex: jov" value={newCode.code} onChange={(e) => setNewCode(p => ({ ...p, code: e.target.value }))} />
                    <Input className="h-6 text-[10px] bg-background/50" placeholder="Descrição" value={newCode.label} onChange={(e) => setNewCode(p => ({ ...p, label: e.target.value }))} />
                    <Select value={newCode.type} onValueChange={(v: any) => setNewCode(p => ({ ...p, type: v }))}>
                      <SelectTrigger className="h-6 text-[10px] bg-background/50"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="literal">Literal</SelectItem><SelectItem value="vinheta">Vinheta</SelectItem>
                        <SelectItem value="monitored">Monitoramento</SelectItem><SelectItem value="genre">Gênero ID3</SelectItem>
                        <SelectItem value="comercial">Comercial</SelectItem>
                      </SelectContent>
                    </Select>
                    {newCode.type === 'monitored' && <Select value={newCode.stationSource} onValueChange={(v) => setNewCode(p => ({ ...p, stationSource: v }))}><SelectTrigger className="h-6 text-[10px] bg-background/50"><SelectValue placeholder="Estação" /></SelectTrigger><SelectContent>{stations.filter(s => s.enabled).map(s => (<SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>))}</SelectContent></Select>}
                    {newCode.type === 'genre' && (
                      <div className="space-y-1">
                        <label className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Gêneros</label>
                        <div className="flex gap-1 flex-wrap">
                          {MAPAS_AVAILABLE_GENRES.map(genre => {
                            const selected = newCode.genreFilter.split(',').map(g => g.trim()).filter(Boolean);
                            const isActive = selected.includes(genre);
                            return (
                              <button key={genre} onClick={() => {
                                const updated = isActive ? selected.filter(g => g !== genre) : [...selected, genre];
                                setNewCode(p => ({ ...p, genreFilter: updated.join(',') }));
                              }}
                                className={`px-1.5 py-0.5 rounded text-[8px] font-mono border transition-all ${
                                  isActive ? 'bg-amber-500/25 text-amber-300 border-amber-500/40' : 'bg-background/30 text-muted-foreground/60 border-border/20 hover:text-amber-400'
                                }`}>
                                {genre}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {(newCode.type === 'vinheta' || newCode.type === 'comercial') && <Input className="h-6 text-[10px] bg-background/50 font-mono" placeholder="C:\Playlist\..." value={newCode.vinhetaFolder} onChange={(e) => setNewCode(p => ({ ...p, vinhetaFolder: e.target.value }))} />}
                    <div className="flex gap-1">
                      <Button size="sm" className="h-6 text-[9px] flex-1" disabled={!newCode.code.trim() || !newCode.label.trim()} onClick={() => {
                        if (mapasConfig.codeConfigs.some(c => c.code.toLowerCase() === newCode.code.toLowerCase())) { toast.error('Já existe'); return; }
                        addMapaCodeConfig({ code: newCode.code.trim(), label: newCode.label.trim(), type: newCode.type,
                          ...(newCode.type === 'monitored' ? { stationSource: newCode.stationSource } : {}),
                          ...(newCode.type === 'genre' ? { genreFilter: newCode.genreFilter.split(',').map(g => g.trim().toUpperCase()).filter(Boolean) } : {}),
                          ...((newCode.type === 'vinheta' || newCode.type === 'comercial') ? { vinhetaFolder: newCode.vinhetaFolder } : {}),
                        });
                        setNewCode({ code: '', label: '', type: 'literal', stationSource: '', genreFilter: '', vinhetaFolder: '', fixedFile: '' });
                        setShowNewCode(false); toast.success('Adicionado!');
                      }}><Plus className="w-3 h-3 mr-0.5" /> Add</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[9px]" onClick={() => setShowNewCode(false)}>×</Button>
                    </div>
                  </div>
                )}
                <DndContext sensors={sensors} collisionDetection={closestCenter}
                  onDragEnd={(event: DragEndEvent) => { const { active, over } = event; if (!over || active.id === over.id) return; const o = mapasConfig.codeConfigs.findIndex(c => c.code === active.id); const n = mapasConfig.codeConfigs.findIndex(c => c.code === over.id); if (o >= 0 && n >= 0) reorderMapaCodeConfigs(o, n); }}>
                  <SortableContext items={mapasConfig.codeConfigs.map(c => c.code)} strategy={verticalListSortingStrategy}>
                    {mapasConfig.codeConfigs.map(cc => <SortableCodePill key={cc.code} cc={cc} stations={stations} updateMapaCodeConfig={updateMapaCodeConfig} removeMapaCodeConfig={removeMapaCodeConfig} comercialFiles={comercialFiles} setComercialFiles={setComercialFiles} />)}
                  </SortableContext>
                </DndContext>
                {/* Output folder */}
                <div className="pt-2">
                  <div className="rounded-lg border border-border/15 p-2 space-y-1">
                    <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wider font-medium">Pasta destino</label>
                    <Input className="h-6 text-[10px] font-mono bg-background/30" value={mapasConfig.outputFolder} onChange={(e) => setMapasConfig({ outputFolder: e.target.value })} />
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>

        {/* ─── Right: Editor Panel ─── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-b from-card/10 to-background">
          {editingSlot !== null && template?.lines[editingSlot] ? (
            (() => {
              const line = template.lines[editingSlot];
              const isStd = line.codes.join(',') === stdPattern;
              return (
                <div className="flex-1 flex flex-col p-5">
                  {/* Slot header */}
                  <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => setEditingSlot(null)} className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div className={`text-3xl font-mono font-black ${currentColors.accent} tracking-tight`}>{line.time}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px]">{currentDayLabel}</Badge>
                      <Badge variant={isStd ? 'secondary' : 'default'} className="text-[9px]">{isStd ? 'Padrão' : 'Customizado'}</Badge>
                    </div>
                    <div className="flex-1" />
                    <Button size="sm" variant="outline" className="h-7 text-[10px] text-destructive border-destructive/20 hover:bg-destructive/10" onClick={() => {
                      removeMapaTemplateLine(activeDay, editingSlot);
                      setEditingSlot(null);
                      toast.info(`${line.time} removido`);
                      autoSaveToFile(activeDay);
                    }}>
                      <Trash2 className="w-3 h-3 mr-1" /> Remover
                    </Button>
                  </div>

                  {/* Visual code blocks */}
                  <div className="mb-6">
                    <label className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium mb-3 block">Sequência de Códigos</label>
                    <div className="flex gap-2 flex-wrap">
                      {line.codes.map((code, j) => {
                        const colors = getCodeColor(code);
                        const ccfg = mapasConfig.codeConfigs.find(c => c.code.toLowerCase() === code.toLowerCase());
                        return (
                          <div key={j} className={`rounded-xl border-2 ${colors.border} ${colors.bg} ${colors.glow} px-4 py-3 flex flex-col items-center gap-1 min-w-[80px] transition-all hover:scale-105`}>
                            <span className={colors.text}>{CODE_ICONS[ccfg?.type || 'literal'] || CODE_ICONS.literal}</span>
                            <span className={`font-mono text-sm font-black ${colors.text}`}>{code}</span>
                            <span className="text-[8px] text-muted-foreground/50">{ccfg?.label || code}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Edit field */}
                  <div className="rounded-xl border border-border/20 bg-card/30 backdrop-blur-sm p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Pencil className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-semibold text-foreground">Editar Códigos</span>
                    </div>
                    <Input
                      className="h-9 text-sm font-mono bg-background/50 border-primary/20 focus:border-primary/50"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveSlotEdit(editingSlot); }}
                      placeholder="SINAL,HC,VHTENT,mus,vht,mus"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-8 text-xs" onClick={() => saveSlotEdit(editingSlot)}>
                        <Save className="w-3 h-3 mr-1.5" /> Salvar
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setEditValue(stdPattern); }}>
                        <RotateCcw className="w-3 h-3 mr-1.5" /> Padrão
                      </Button>
                    </div>
                    <p className="text-[9px] text-muted-foreground/40">Separe os códigos por vírgula. Pressione Enter para salvar.</p>
                  </div>

                  {/* Quick code insert */}
                  <div className="mt-4 rounded-xl border border-border/15 bg-card/20 p-4">
                    <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-medium mb-2 block">Inserir código rápido</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {mapasConfig.codeConfigs.map(cc => {
                        const colors = CODE_COLORS[cc.type] || CODE_COLORS.literal;
                        return (
                          <button key={cc.code} onClick={() => setEditValue(prev => prev ? `${prev},${cc.code}` : cc.code)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[10px] font-mono font-medium transition-all hover:scale-105 ${colors.pill}`}>
                            {CODE_ICONS[cc.type]}{cc.code}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            /* No slot selected - show overview */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3 max-w-xs">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center">
                  <Pencil className="w-7 h-7 text-primary/30" />
                </div>
                <p className="text-sm text-muted-foreground/60">Selecione um horário na timeline para editar</p>
                <p className="text-[10px] text-muted-foreground/40">Clique em qualquer slot à esquerda para visualizar e modificar os códigos</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MapasView;
