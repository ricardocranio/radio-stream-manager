import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useRadioStore } from '@/store/radioStore';
import { parseTemplateText, detectDayMapping, getTemplateForDay } from '@/lib/mapasBuilder/parser';
import { resolveTemplateLine, formatResolvedLine, resetMapasPools } from '@/lib/mapasBuilder/resolver';
import type { MapaTemplate, MapaResolvedLine, MapaCodeConfig } from '@/lib/mapasBuilder/types';
import { DEFAULT_CODE_CONFIGS } from '@/lib/mapasBuilder/types';
import { MapIcon, FileText, Play, Settings2, Radio, Music, Mic2, Clock, RefreshCw, FolderOpen, Eye, Plus, RotateCcw, Trash2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

const CODE_TYPE_LABELS: Record<string, string> = {
  literal: 'Literal (comando)',
  vinheta: 'Vinheta (arquivo)',
  monitored: 'Monitoramento',
  genre: 'Gênero ID3',
  comercial: 'Comercial',
};

const CODE_ICONS: Record<string, React.ReactNode> = {
  literal: <Clock className="w-3 h-3" />,
  vinheta: <Mic2 className="w-3 h-3" />,
  monitored: <Radio className="w-3 h-3" />,
  genre: <Music className="w-3 h-3" />,
  comercial: <FileText className="w-3 h-3" />,
};

export function MapasView() {
  const { mapasConfig, setMapasConfig, updateMapaCodeConfig, addMapaCodeConfig, removeMapaCodeConfig, resetMapaCodeConfigs, config, stations } = useRadioStore();
  const [templates, setTemplates] = useState<MapaTemplate[]>([]);
  const [preview, setPreview] = useState<MapaResolvedLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [showNewCode, setShowNewCode] = useState(false);
  const [newCode, setNewCode] = useState({ code: '', label: '', type: 'literal' as MapaCodeConfig['type'], stationSource: '', genreFilter: '', vinhetaFolder: '', fixedFile: '' });
  // Cache of folder files for comercial file picker
  const [comercialFiles, setComercialFiles] = useState<Record<string, string[]>>({});

  // Load templates from folder
  const loadTemplates = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.listFolderFiles) {
      toast.error('Disponível apenas no Electron');
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.electronAPI.listFolderFiles({
        folder: mapasConfig.mapasFolder,
        extension: '.txt',
      });

      if (!result.success || !result.files?.length) {
        toast.error('Nenhum template encontrado em ' + mapasConfig.mapasFolder);
        setTemplates([]);
        setIsLoading(false);
        return;
      }

      const loaded: MapaTemplate[] = [];
      for (const file of result.files) {
        try {
          const readResult = await window.electronAPI!.readGradeFile({
            folder: mapasConfig.mapasFolder,
            filename: file.name,
          });
          if (readResult.success && readResult.content) {
            loaded.push({
              filename: file.name,
              dayMapping: detectDayMapping(file.name),
              lines: parseTemplateText(readResult.content),
            });
          }
        } catch { /* skip */ }
      }

      setTemplates(loaded);
      toast.success(`${loaded.length} templates carregados`);
      if (loaded.length > 0 && !selectedTemplate) {
        setSelectedTemplate(loaded[0].filename);
      }
    } catch (err: any) {
      toast.error('Erro ao carregar templates: ' + err.message);
    }
    setIsLoading(false);
  }, [mapasConfig.mapasFolder, selectedTemplate]);

  // Preview a template (resolve codes to filenames)
  const previewTemplate = useCallback(async () => {
    const tmpl = templates.find(t => t.filename === selectedTemplate);
    if (!tmpl) return;

    setIsBuilding(true);
    resetMapasPools();
    const cache = new Map<string, string[]>();
    const resolved: MapaResolvedLine[] = [];

    try {
      for (const line of tmpl.lines) {
        const r = await resolveTemplateLine(line, mapasConfig, config.musicFolders, cache);
        resolved.push(r);
      }
      setPreview(resolved);
      toast.success(`Preview gerado: ${resolved.length} linhas`);
    } catch (err: any) {
      toast.error('Erro na preview: ' + err.message);
    }
    setIsBuilding(false);
  }, [templates, selectedTemplate, mapasConfig, config.musicFolders]);

  // Build and save the resolved mapa
  const buildAndSave = useCallback(async () => {
    const tmpl = templates.find(t => t.filename === selectedTemplate);
    if (!tmpl || !isElectron) return;

    setIsBuilding(true);
    resetMapasPools();
    const cache = new Map<string, string[]>();
    const lines: string[] = [];

    try {
      for (const line of tmpl.lines) {
        const r = await resolveTemplateLine(line, mapasConfig, config.musicFolders, cache);
        lines.push(formatResolvedLine(r));
      }

      const outputFilename = tmpl.filename;
      const result = await window.electronAPI!.saveGradeFile({
        folder: mapasConfig.outputFolder,
        filename: outputFilename,
        content: lines.join('\n'),
      });

      if (result.success) {
        toast.success(`Mapa salvo: ${outputFilename}`);
      } else {
        toast.error('Erro ao salvar: ' + result.error);
      }
    } catch (err: any) {
      toast.error('Erro ao construir mapa: ' + err.message);
    }
    setIsBuilding(false);
  }, [templates, selectedTemplate, mapasConfig, config.musicFolders]);

  // Build ALL templates
  const buildAll = useCallback(async () => {
    if (!isElectron || templates.length === 0) return;

    setIsBuilding(true);
    let built = 0;

    for (const tmpl of templates) {
      resetMapasPools();
      const cache = new Map<string, string[]>();
      const lines: string[] = [];

      try {
        for (const line of tmpl.lines) {
          const r = await resolveTemplateLine(line, mapasConfig, config.musicFolders, cache);
          lines.push(formatResolvedLine(r));
        }

        await window.electronAPI!.saveGradeFile({
          folder: mapasConfig.outputFolder,
          filename: tmpl.filename,
          content: lines.join('\n'),
        });
        built++;
      } catch { /* skip */ }
    }

    toast.success(`${built}/${templates.length} mapas construídos!`);
    setIsBuilding(false);
  }, [templates, mapasConfig, config.musicFolders]);

  const currentTemplate = templates.find(t => t.filename === selectedTemplate);

  const dayLabels: Record<string, string> = {
    weekdays: 'Seg-Sex',
    saturday: 'Sáb',
    sunday: 'Dom',
    monday: 'Seg',
    tuesday: 'Ter',
    wednesday: 'Qua',
    thursday: 'Qui',
    friday: 'Sex',
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapIcon className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Mapas Comerciais</h1>
            <p className="text-xs text-muted-foreground">Templates de programação comercial/institucional</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={loadTemplates} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Carregar
          </Button>
          <Button size="sm" onClick={buildAll} disabled={isBuilding || templates.length === 0}>
            <Play className="w-4 h-4 mr-1" />
            Construir Todos
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Config dos Códigos */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                Códigos
                <Badge variant="secondary" className="text-[10px]">{mapasConfig.codeConfigs.length}</Badge>
              </CardTitle>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowNewCode(!showNewCode)} title="Novo código">
                  <Plus className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { resetMapaCodeConfigs(); toast.success('Códigos restaurados ao padrão'); }} title="Restaurar padrão">
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* New code form */}
            {showNewCode && (
              <div className="border border-primary/30 rounded-lg p-3 space-y-2 bg-primary/5">
                <p className="text-xs font-semibold text-primary">Novo Código</p>
                <Input className="h-8 text-xs font-mono" placeholder="Código (ex: jov)" value={newCode.code} onChange={(e) => setNewCode(p => ({ ...p, code: e.target.value }))} />
                <Input className="h-8 text-xs" placeholder="Descrição (ex: Jovem/Pop)" value={newCode.label} onChange={(e) => setNewCode(p => ({ ...p, label: e.target.value }))} />
                <Select value={newCode.type} onValueChange={(v: any) => setNewCode(p => ({ ...p, type: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="literal">Literal (comando)</SelectItem>
                    <SelectItem value="vinheta">Vinheta (arquivo)</SelectItem>
                    <SelectItem value="monitored">Monitoramento</SelectItem>
                    <SelectItem value="genre">Gênero ID3</SelectItem>
                    <SelectItem value="comercial">Comercial</SelectItem>
                  </SelectContent>
                </Select>
                {newCode.type === 'monitored' && (
                  <Select value={newCode.stationSource} onValueChange={(v) => setNewCode(p => ({ ...p, stationSource: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Estação fonte" /></SelectTrigger>
                    <SelectContent>
                      {stations.filter(s => s.enabled).map(s => (
                        <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {newCode.type === 'genre' && (
                  <Input className="h-8 text-xs" placeholder="Gêneros (ex: POP, DANCE)" value={newCode.genreFilter} onChange={(e) => setNewCode(p => ({ ...p, genreFilter: e.target.value }))} />
                )}
                {(newCode.type === 'vinheta' || newCode.type === 'comercial') && (
                  <Input className="h-8 text-xs font-mono" placeholder="Pasta (ex: C:\Playlist\Comerciais)" value={newCode.vinhetaFolder} onChange={(e) => setNewCode(p => ({ ...p, vinhetaFolder: e.target.value }))} />
                )}
                <div className="flex gap-2">
                  <Button size="sm" className="text-xs flex-1" disabled={!newCode.code.trim() || !newCode.label.trim()} onClick={() => {
                    if (mapasConfig.codeConfigs.some(c => c.code.toLowerCase() === newCode.code.toLowerCase())) {
                      toast.error('Código já existe'); return;
                    }
                    addMapaCodeConfig({
                      code: newCode.code.trim(),
                      label: newCode.label.trim(),
                      type: newCode.type,
                      ...(newCode.type === 'monitored' ? { stationSource: newCode.stationSource } : {}),
                      ...(newCode.type === 'genre' ? { genreFilter: newCode.genreFilter.split(',').map(g => g.trim().toUpperCase()).filter(Boolean) } : {}),
                      ...((newCode.type === 'vinheta' || newCode.type === 'comercial') ? { vinhetaFolder: newCode.vinhetaFolder } : {}),
                      ...(newCode.type === 'comercial' ? { fixedFile: newCode.fixedFile } : {}),
                    });
                    setNewCode({ code: '', label: '', type: 'literal', stationSource: '', genreFilter: '', vinhetaFolder: '', fixedFile: '' });
                    setShowNewCode(false);
                    toast.success('Código adicionado!');
                  }}>
                    <Plus className="w-3 h-3 mr-1" /> Adicionar
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowNewCode(false)}>Cancelar</Button>
                </div>
              </div>
            )}

            {mapasConfig.codeConfigs.map((cc) => (
              <div key={cc.code} className="border border-border/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {CODE_ICONS[cc.type]}
                    <span className="font-mono text-sm font-bold text-primary">{cc.code}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {CODE_TYPE_LABELS[cc.type]}
                    </Badge>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive/60 hover:text-destructive" onClick={() => { removeMapaCodeConfig(cc.code); toast.info(`Código "${cc.code}" removido`); }}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{cc.label}</p>

                {cc.type === 'monitored' && (
                  <Select
                    value={cc.stationSource || ''}
                    onValueChange={(v) => updateMapaCodeConfig(cc.code, { stationSource: v })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Estação fonte" />
                    </SelectTrigger>
                    <SelectContent>
                      {stations.filter(s => s.enabled).map(s => (
                        <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {cc.type === 'genre' && (
                  <Input
                    className="h-8 text-xs"
                    value={cc.genreFilter?.join(', ') || ''}
                    onChange={(e) => updateMapaCodeConfig(cc.code, {
                      genreFilter: e.target.value.split(',').map(g => g.trim().toUpperCase()).filter(Boolean),
                    })}
                    placeholder="Gêneros separados por vírgula"
                  />
                )}

                {cc.type === 'vinheta' && (
                  <Input
                    className="h-8 text-xs font-mono"
                    value={cc.vinhetaFolder || ''}
                    onChange={(e) => updateMapaCodeConfig(cc.code, { vinhetaFolder: e.target.value })}
                    placeholder="Pasta das vinhetas"
                  />
                )}

                {cc.type === 'comercial' && (
                  <div className="space-y-2">
                    <Input
                      className="h-8 text-xs font-mono"
                      value={cc.vinhetaFolder || ''}
                      onChange={(e) => updateMapaCodeConfig(cc.code, { vinhetaFolder: e.target.value })}
                      placeholder="Pasta dos comerciais"
                    />
                    <div className="flex gap-1 items-center">
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={async () => {
                        if (!isElectron || !window.electronAPI?.listFolderFiles || !cc.vinhetaFolder) return;
                        try {
                          const result = await window.electronAPI.listFolderFiles({ folder: cc.vinhetaFolder, extension: '.mp3' });
                          if (result.success && result.files) {
                            setComercialFiles(prev => ({ ...prev, [cc.code]: result.files!.map(f => f.name) }));
                            toast.success(`${result.files.length} arquivos encontrados`);
                          }
                        } catch { toast.error('Erro ao listar pasta'); }
                      }}>
                        <FolderOpen className="w-3 h-3 mr-1" /> Listar
                      </Button>
                      {cc.fixedFile && (
                        <span className="text-[10px] text-primary font-mono truncate flex-1">📎 {cc.fixedFile}</span>
                      )}
                    </div>
                    {comercialFiles[cc.code]?.length > 0 && (
                      <Select value={cc.fixedFile || ''} onValueChange={(v) => updateMapaCodeConfig(cc.code, { fixedFile: v })}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione o arquivo fixo" />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          {comercialFiles[cc.code].map(f => (
                            <SelectItem key={f} value={f} className="text-xs font-mono">{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Pasta config */}
            <div className="pt-2 border-t border-border/30 space-y-2">
              <label className="text-xs text-muted-foreground">Pasta dos Mapas</label>
              <Input
                className="h-8 text-xs font-mono"
                value={mapasConfig.mapasFolder}
                onChange={(e) => setMapasConfig({ mapasFolder: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Templates carregados + Preview */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Templates
                {templates.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">{templates.length}</Badge>
                )}
              </CardTitle>
              {currentTemplate && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={previewTemplate} disabled={isBuilding}>
                    <Eye className="w-3 h-3 mr-1" />
                    Preview
                  </Button>
                  <Button size="sm" onClick={buildAndSave} disabled={isBuilding}>
                    <Play className="w-3 h-3 mr-1" />
                    Construir
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {templates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MapIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Clique "Carregar" para ler os templates</p>
                <p className="text-xs mt-1">Pasta: {mapasConfig.mapasFolder}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Template tabs */}
                <div className="flex gap-2 flex-wrap">
                  {templates.map(t => (
                    <Button
                      key={t.filename}
                      size="sm"
                      variant={selectedTemplate === t.filename ? 'default' : 'outline'}
                      onClick={() => { setSelectedTemplate(t.filename); setPreview([]); }}
                      className="text-xs"
                    >
                      <FileText className="w-3 h-3 mr-1" />
                      {t.filename}
                      <Badge variant="secondary" className="ml-1 text-[9px]">
                        {dayLabels[t.dayMapping] || t.dayMapping}
                      </Badge>
                    </Button>
                  ))}
                </div>

                {/* Template content */}
                {currentTemplate && (
                  <div className="border border-border/30 rounded-lg overflow-hidden">
                    <div className="bg-muted/30 px-3 py-2 flex items-center justify-between">
                      <span className="text-xs font-mono">{currentTemplate.filename}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {currentTemplate.lines.length} linhas · {dayLabels[currentTemplate.dayMapping]}
                      </span>
                    </div>
                    <div className="max-h-[500px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-background">
                          <tr className="border-b border-border/30">
                            <th className="px-3 py-1.5 text-left w-16">Hora</th>
                            <th className="px-3 py-1.5 text-left">Códigos</th>
                            {preview.length > 0 && (
                              <th className="px-3 py-1.5 text-left">Resolvido</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {currentTemplate.lines.map((line, i) => (
                            <tr key={i} className="border-b border-border/10 hover:bg-muted/20">
                              <td className="px-3 py-1.5 font-mono text-primary">{line.time}</td>
                              <td className="px-3 py-1.5">
                                <div className="flex gap-1 flex-wrap">
                                  {line.codes.map((code, j) => {
                                    const cc = mapasConfig.codeConfigs.find(
                                      c => c.code.toLowerCase() === code.toLowerCase()
                                    );
                                    const variant = cc?.type === 'literal' ? 'outline' :
                                      cc?.type === 'vinheta' ? 'secondary' :
                                      cc?.type === 'monitored' ? 'default' : 'destructive';
                                    return (
                                      <Badge key={j} variant={variant as any} className="text-[9px] font-mono">
                                        {code}
                                      </Badge>
                                    );
                                  })}
                                </div>
                              </td>
                              {preview.length > 0 && preview[i] && (
                                <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground max-w-[300px] truncate">
                                  {preview[i].items.join(', ')}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default MapasView;
