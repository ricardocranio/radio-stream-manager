import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useRadioStore } from '@/store/radioStore';
import { resolveTemplateLine, formatResolvedLine, resetMapasPools } from '@/lib/mapasBuilder/resolver';
import type { MapaResolvedLine, MapaCodeConfig } from '@/lib/mapasBuilder/types';
import { MapIcon, FileText, Play, Settings2, Radio, Music, Mic2, Clock, FolderOpen, Eye, Plus, RotateCcw, Trash2, GripVertical, Save } from 'lucide-react';
import { toast } from 'sonner';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

const CODE_TYPE_LABELS: Record<string, string> = {
  literal: 'Literal', vinheta: 'Vinheta', monitored: 'Monitor', genre: 'Gênero', comercial: 'Comercial',
};
const CODE_ICONS: Record<string, React.ReactNode> = {
  literal: <Clock className="w-3 h-3" />, vinheta: <Mic2 className="w-3 h-3" />,
  monitored: <Radio className="w-3 h-3" />, genre: <Music className="w-3 h-3" />,
  comercial: <FileText className="w-3 h-3" />,
};

function SortableCodeCard({ cc, stations, updateMapaCodeConfig, removeMapaCodeConfig, comercialFiles, setComercialFiles }: {
  cc: MapaCodeConfig; stations: Array<{ id: string; name: string; enabled?: boolean }>;
  updateMapaCodeConfig: (code: string, updates: Partial<MapaCodeConfig>) => void;
  removeMapaCodeConfig: (code: string) => void;
  comercialFiles: Record<string, string[]>;
  setComercialFiles: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cc.code });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="border border-border/50 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"><GripVertical className="w-4 h-4" /></button>
          {CODE_ICONS[cc.type]}
          <span className="font-mono text-sm font-bold text-primary">{cc.code}</span>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-[10px]">{CODE_TYPE_LABELS[cc.type]}</Badge>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive/60 hover:text-destructive" onClick={() => { removeMapaCodeConfig(cc.code); toast.info(`"${cc.code}" removido`); }}><Trash2 className="w-3 h-3" /></Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{cc.label}</p>
      {cc.type === 'monitored' && (
        <Select value={cc.stationSource || ''} onValueChange={(v) => updateMapaCodeConfig(cc.code, { stationSource: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Estação" /></SelectTrigger>
          <SelectContent>{stations.filter(s => s.enabled).map(s => (<SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>))}</SelectContent>
        </Select>
      )}
      {cc.type === 'genre' && <Input className="h-8 text-xs" value={cc.genreFilter?.join(', ') || ''} onChange={(e) => updateMapaCodeConfig(cc.code, { genreFilter: e.target.value.split(',').map(g => g.trim().toUpperCase()).filter(Boolean) })} placeholder="Gêneros" />}
      {cc.type === 'vinheta' && <Input className="h-8 text-xs font-mono" value={cc.vinhetaFolder || ''} onChange={(e) => updateMapaCodeConfig(cc.code, { vinhetaFolder: e.target.value })} placeholder="Pasta" />}
      {cc.type === 'comercial' && (
        <div className="space-y-2">
          <Input className="h-8 text-xs font-mono" value={cc.vinhetaFolder || ''} onChange={(e) => updateMapaCodeConfig(cc.code, { vinhetaFolder: e.target.value })} placeholder="Pasta" />
          <div className="flex gap-1 items-center">
            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={async () => {
              if (!isElectron || !window.electronAPI?.listFolderFiles || !cc.vinhetaFolder) return;
              try { const r = await window.electronAPI.listFolderFiles({ folder: cc.vinhetaFolder, extension: '.mp3' }); if (r.success && r.files) { setComercialFiles(p => ({ ...p, [cc.code]: r.files!.map(f => f.name) })); toast.success(`${r.files.length} arquivos`); } } catch { toast.error('Erro'); }
            }}><FolderOpen className="w-3 h-3 mr-1" /> Listar</Button>
            {cc.fixedFile && <span className="text-[10px] text-primary font-mono truncate flex-1">📎 {cc.fixedFile}</span>}
          </div>
          {comercialFiles[cc.code]?.length > 0 && (
            <Select value={cc.fixedFile || ''} onValueChange={(v) => updateMapaCodeConfig(cc.code, { fixedFile: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Arquivo fixo" /></SelectTrigger>
              <SelectContent className="max-h-60">{comercialFiles[cc.code].map(f => (<SelectItem key={f} value={f} className="text-xs font-mono">{f}</SelectItem>))}</SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}

/** Individual day schedule editor */
function DayScheduleEditor({ templateIdx, autoSaveToFile }: { templateIdx: number; autoSaveToFile: (idx: number) => void }) {
  const { mapasConfig, updateMapaTemplateLine, addMapaTemplateLine, removeMapaTemplateLine } = useRadioStore();
  const template = mapasConfig.templates?.[templateIdx];
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [editCodes, setEditCodes] = useState('');
  const [showAddLine, setShowAddLine] = useState(false);
  const [newLineTime, setNewLineTime] = useState('');
  const [newLineCodes, setNewLineCodes] = useState('SINAL,HC,VHTENT,mus,vht,mus');

  const stdPattern = 'SINAL,HC,VHTENT,mus,vht,mus';

  const getCodeBadgeVariant = (code: string) => {
    const cc = mapasConfig.codeConfigs.find(c => c.code.toLowerCase() === code.toLowerCase());
    if (!cc) return 'outline';
    return cc.type === 'literal' ? 'outline' : cc.type === 'monitored' ? 'default' : cc.type === 'genre' ? 'destructive' : 'secondary';
  };

  if (!template) return null;

  const saveEdit = (lineIdx: number) => {
    const codes = editCodes.split(',').map(c => c.trim()).filter(Boolean);
    if (codes.length > 0) {
      updateMapaTemplateLine(templateIdx, lineIdx, codes);
      toast.success(`${template.lines[lineIdx]?.time} salvo`, { duration: 1200 });
      autoSaveToFile(templateIdx);
    }
    setEditingLine(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-mono">{template.filename} — {template.lines.length} horários</span>
        <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setShowAddLine(!showAddLine)}><Plus className="w-3 h-3 mr-1" /> Horário</Button>
      </div>
      {showAddLine && (
        <div className="flex gap-2 items-center border border-primary/30 rounded-lg p-2 bg-primary/5">
          <Input className="h-7 text-xs font-mono w-20" placeholder="HH:MM" value={newLineTime} onChange={(e) => setNewLineTime(e.target.value)} />
          <Input className="h-7 text-xs font-mono flex-1" placeholder="SINAL,HC,VHTENT,mus,vht,mus" value={newLineCodes} onChange={(e) => setNewLineCodes(e.target.value)} />
          <Button size="sm" className="h-7 text-[10px]" disabled={!newLineTime.match(/^\d{2}:\d{2}$/)} onClick={() => {
            const codes = newLineCodes.split(',').map(c => c.trim()).filter(Boolean);
            if (!codes.length) { toast.error('Informe os códigos'); return; }
            addMapaTemplateLine(templateIdx, newLineTime, codes);
            setNewLineTime(''); setNewLineCodes('SINAL,HC,VHTENT,mus,vht,mus'); setShowAddLine(false);
            toast.success('Horário adicionado');
            autoSaveToFile(templateIdx);
          }}><Plus className="w-3 h-3" /></Button>
        </div>
      )}
      <div className="border border-border/30 rounded-lg overflow-hidden">
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background z-10">
              <tr className="border-b border-border/30">
                <th className="px-3 py-1.5 text-left w-16">Hora</th>
                <th className="px-3 py-1.5 text-left">Códigos</th>
                <th className="px-3 py-1.5 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {template.lines.map((line, i) => {
                const isStd = line.codes.join(',') === stdPattern;
                const isEditing = editingLine === i;
                return (
                  <tr key={`${line.time}-${i}`} className={`border-b border-border/10 hover:bg-muted/20 ${!isStd ? 'bg-primary/5' : ''} ${isEditing ? 'bg-accent/20' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-primary font-bold">{line.time}</td>
                    <td className="px-3 py-1.5">
                      {isEditing ? (
                        <Input className="h-7 text-xs font-mono" value={editCodes} onChange={(e) => setEditCodes(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(i); else if (e.key === 'Escape') setEditingLine(null); }}
                          onBlur={() => saveEdit(i)} autoFocus />
                      ) : (
                        <div className="flex gap-1 flex-wrap">
                          {line.codes.map((code, j) => <Badge key={j} variant={getCodeBadgeVariant(code) as any} className="text-[9px] font-mono">{code}</Badge>)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-0.5">
                        <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-primary" onClick={() => {
                          if (isEditing) { saveEdit(i); } else { setEditingLine(i); setEditCodes(line.codes.join(',')); }
                        }}>{isEditing ? <Save className="w-3 h-3" /> : <Settings2 className="w-3 h-3" />}</Button>
                        <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive/50 hover:text-destructive" onClick={() => {
                          removeMapaTemplateLine(templateIdx, i);
                          toast.info(`${line.time} removido`);
                          autoSaveToFile(templateIdx);
                        }}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function MapasView() {
  const { mapasConfig, setMapasConfig, updateMapaCodeConfig, addMapaCodeConfig, removeMapaCodeConfig, resetMapaCodeConfigs, reorderMapaCodeConfigs, resetMapaTemplates, config, stations } = useRadioStore();
  const [isBuilding, setIsBuilding] = useState(false);
  const [showNewCode, setShowNewCode] = useState(false);
  const [newCode, setNewCode] = useState({ code: '', label: '', type: 'literal' as MapaCodeConfig['type'], stationSource: '', genreFilter: '', vinhetaFolder: '', fixedFile: '' });
  const [comercialFiles, setComercialFiles] = useState<Record<string, string[]>>({});
  const autoSaveTimerRef = useRef<Record<number, NodeJS.Timeout>>({});

  const dayLabels: Record<string, string> = { weekdays: 'Seg-Sex', saturday: 'Sáb', sunday: 'Dom' };

  /** Auto-save: debounced write to disk */
  const autoSaveToFile = useCallback(async (tmplIdx: number) => {
    if (!isElectron) return;
    // Debounce 1.5s
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
    for (let i = 0; i < mapasConfig.templates.length; i++) {
      const tmpl = mapasConfig.templates[i];
      resetMapasPools(); const cache = new Map<string, string[]>(); const lines: string[] = [];
      try {
        for (const line of tmpl.lines) { const r = await resolveTemplateLine(line, mapasConfig, config.musicFolders, cache); lines.push(formatResolvedLine(r)); }
        await window.electronAPI!.saveGradeFile({ folder: mapasConfig.outputFolder, filename: tmpl.filename, content: lines.join('\n') }); built++;
      } catch { /* skip */ }
    }
    toast.success(`${built}/${mapasConfig.templates.length} mapas construídos!`); setIsBuilding(false);
  }, [mapasConfig, config.musicFolders]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapIcon className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Mapas Comerciais</h1>
            <p className="text-xs text-muted-foreground">Templates de programação — auto-save em C:\Playlist\pgm\Mapas</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { resetMapaTemplates(); toast.success('Templates restaurados'); }}><RotateCcw className="w-4 h-4 mr-1" /> Restaurar</Button>
          <Button size="sm" onClick={buildAll} disabled={isBuilding}><Play className="w-4 h-4 mr-1" /> Construir Todos</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Códigos - coluna esquerda (vermelho) */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><Settings2 className="w-4 h-4" /> Códigos <Badge variant="secondary" className="text-[10px]">{mapasConfig.codeConfigs.length}</Badge></CardTitle>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowNewCode(!showNewCode)}><Plus className="w-3.5 h-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { resetMapaCodeConfigs(); toast.success('Códigos restaurados'); }}><RotateCcw className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 max-h-[calc(100vh-220px)] overflow-y-auto">
            {showNewCode && (
              <div className="border border-primary/30 rounded-lg p-3 space-y-2 bg-primary/5">
                <p className="text-xs font-semibold text-primary">Novo Código</p>
                <Input className="h-8 text-xs font-mono" placeholder="Código (ex: jov)" value={newCode.code} onChange={(e) => setNewCode(p => ({ ...p, code: e.target.value }))} />
                <Input className="h-8 text-xs" placeholder="Descrição" value={newCode.label} onChange={(e) => setNewCode(p => ({ ...p, label: e.target.value }))} />
                <Select value={newCode.type} onValueChange={(v: any) => setNewCode(p => ({ ...p, type: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="literal">Literal</SelectItem><SelectItem value="vinheta">Vinheta</SelectItem>
                    <SelectItem value="monitored">Monitoramento</SelectItem><SelectItem value="genre">Gênero ID3</SelectItem>
                    <SelectItem value="comercial">Comercial</SelectItem>
                  </SelectContent>
                </Select>
                {newCode.type === 'monitored' && <Select value={newCode.stationSource} onValueChange={(v) => setNewCode(p => ({ ...p, stationSource: v }))}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Estação" /></SelectTrigger><SelectContent>{stations.filter(s => s.enabled).map(s => (<SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>))}</SelectContent></Select>}
                {newCode.type === 'genre' && <Input className="h-8 text-xs" placeholder="Gêneros (POP, DANCE)" value={newCode.genreFilter} onChange={(e) => setNewCode(p => ({ ...p, genreFilter: e.target.value }))} />}
                {(newCode.type === 'vinheta' || newCode.type === 'comercial') && <Input className="h-8 text-xs font-mono" placeholder="Pasta" value={newCode.vinhetaFolder} onChange={(e) => setNewCode(p => ({ ...p, vinhetaFolder: e.target.value }))} />}
                <div className="flex gap-2">
                  <Button size="sm" className="text-xs flex-1" disabled={!newCode.code.trim() || !newCode.label.trim()} onClick={() => {
                    if (mapasConfig.codeConfigs.some(c => c.code.toLowerCase() === newCode.code.toLowerCase())) { toast.error('Já existe'); return; }
                    addMapaCodeConfig({ code: newCode.code.trim(), label: newCode.label.trim(), type: newCode.type,
                      ...(newCode.type === 'monitored' ? { stationSource: newCode.stationSource } : {}),
                      ...(newCode.type === 'genre' ? { genreFilter: newCode.genreFilter.split(',').map(g => g.trim().toUpperCase()).filter(Boolean) } : {}),
                      ...((newCode.type === 'vinheta' || newCode.type === 'comercial') ? { vinhetaFolder: newCode.vinhetaFolder } : {}),
                      ...(newCode.type === 'comercial' ? { fixedFile: newCode.fixedFile } : {}),
                    });
                    setNewCode({ code: '', label: '', type: 'literal', stationSource: '', genreFilter: '', vinhetaFolder: '', fixedFile: '' });
                    setShowNewCode(false); toast.success('Adicionado!');
                  }}><Plus className="w-3 h-3 mr-1" /> Adicionar</Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowNewCode(false)}>Cancelar</Button>
                </div>
              </div>
            )}
            <DndContext sensors={useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))} collisionDetection={closestCenter}
              onDragEnd={(event: DragEndEvent) => { const { active, over } = event; if (!over || active.id === over.id) return; const o = mapasConfig.codeConfigs.findIndex(c => c.code === active.id); const n = mapasConfig.codeConfigs.findIndex(c => c.code === over.id); if (o >= 0 && n >= 0) reorderMapaCodeConfigs(o, n); }}>
              <SortableContext items={mapasConfig.codeConfigs.map(c => c.code)} strategy={verticalListSortingStrategy}>
                {mapasConfig.codeConfigs.map(cc => <SortableCodeCard key={cc.code} cc={cc} stations={stations} updateMapaCodeConfig={updateMapaCodeConfig} removeMapaCodeConfig={removeMapaCodeConfig} comercialFiles={comercialFiles} setComercialFiles={setComercialFiles} />)}
              </SortableContext>
            </DndContext>
            <div className="pt-2 border-t border-border/30 space-y-2">
              <label className="text-xs text-muted-foreground">Pasta destino</label>
              <Input className="h-8 text-xs font-mono" value={mapasConfig.outputFolder} onChange={(e) => setMapasConfig({ outputFolder: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        {/* Montagem por dia - coluna direita (verde) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" /> Montagem por Dia <Badge variant="outline" className="text-[9px]">auto-save</Badge></CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="0" className="w-full">
              <TabsList className="w-full justify-start mb-3">
                {(mapasConfig.templates || []).map((t, i) => (
                  <TabsTrigger key={t.filename} value={String(i)} className="text-xs gap-1.5">
                    <FileText className="w-3 h-3" />
                    {dayLabels[t.dayMapping] || t.filename}
                    <Badge variant="secondary" className="text-[9px] ml-1">{t.lines.length}</Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
              {(mapasConfig.templates || []).map((t, i) => (
                <TabsContent key={t.filename} value={String(i)}>
                  <DayScheduleEditor templateIdx={i} autoSaveToFile={autoSaveToFile} />
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default MapasView;
