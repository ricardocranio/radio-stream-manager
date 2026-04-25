/**
 * Card "Grade 24h" da aba Sequência.
 *
 * Mostra TODAS as 24 horas do dia selecionado, com:
 *  - Programa fixo daquele bloco (editável)
 *  - Status da Locução (✓ aceita | ⛔ bloqueada | 📰 após NOTÍCIAS) — editável
 *  - Posições da sequência ativa NAQUELA hora (editáveis: add/remove/reorder/trocar fonte)
 *
 * Edição inline: o usuário pode bloquear/liberar LOC, renomear o programa e
 * sobrescrever a sequência inteira para uma hora específica.
 */

import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Calendar, Clock, Mic, Ban, Newspaper, Pencil, RotateCcw, Check, X,
  Plus, Trash2, ArrowUp, ArrowDown, Save,
} from 'lucide-react';
import {
  DAY_KEYS,
  DAY_LABELS,
  dayKeyFromDate,
  loadPolicy,
  savePolicy,
  isDayAllowed,
  isTimeAllowed,
  isProgramBlocked,
  overrideKey,
  type DayKey,
  type LocucaoSchedulePolicy,
  type HourOverridePosition,
} from '@/lib/locucao/locucaoSchedulePolicy';
import { getFixedScheduleForDay, type FixedSlot } from '@/lib/locucao/fixedScheduleMap';
import { useRadioStore } from '@/store/radioStore';
import type { SequenceConfig, ProgramSchedule } from '@/types/radio';
import { useToast } from '@/hooks/use-toast';

interface Grade24hCardProps {
  sequence: SequenceConfig[];
  programs: ProgramSchedule[];
  getStationColor: (source: string) => string;
  getSourceDisplayName: (source: string) => string;
}

interface HourRow {
  hour: number;
  programName: string;
  fixedSlot?: FixedSlot;
  locStatus: 'allowed' | 'after-news' | 'blocked-program' | 'blocked-time' | 'blocked-day' | 'forced-allow' | 'forced-block';
  reason: string;
  override?: { locked?: boolean; programName?: string; sequence?: HourOverridePosition[] };
  effectiveSequence: Array<{ position: number; radioSource: string; customFileName?: string }>;
  hasCustomSeq: boolean;
}

function findFixedSlotForHour(slots: FixedSlot[], hour: number): FixedSlot | undefined {
  return slots.find((slot) => {
    const [start, end] = slot.range.split('-');
    const [sh] = start.split(':').map(Number);
    if (!end) return sh === hour;
    const [eh] = end.split(':').map(Number);
    return hour >= sh && hour <= eh;
  });
}

function findScheduledProgram(programs: ProgramSchedule[], hour: number): string | undefined {
  const p = programs.find((p) => {
    const [s, e] = p.timeRange.split('-').map(Number);
    return hour >= s && hour <= e;
  });
  return p?.programName;
}

export function Grade24hCard({ sequence, programs, getStationColor, getSourceDisplayName }: Grade24hCardProps) {
  const today = useMemo(() => dayKeyFromDate(new Date()), []);
  const [selectedDay, setSelectedDay] = useState<DayKey>(today);
  const [policy, setPolicy] = useState<LocucaoSchedulePolicy>(() => loadPolicy());
  const [editingHour, setEditingHour] = useState<number | null>(null);

  // Draft buffer — só persiste no localStorage quando o usuário clica "Salvar".
  interface Draft {
    locked: boolean | null | undefined; // undefined = "auto" (sem override)
    programName: string;
    sequence: HourOverridePosition[];
    seqDirty: boolean; // true se o usuário editou explicitamente a sequência
  }
  const [draft, setDraft] = useState<Draft | null>(null);
  const { toast } = useToast();

  const { stations, fixedContent } = useRadioStore();

  const fixedSlots = useMemo(() => getFixedScheduleForDay(selectedDay), [selectedDay]);

  // Opções para o select de fonte
  const sourceOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string; group: string }> = [];
    stations.filter((s) => s.enabled).forEach((s) => opts.push({ value: s.id, label: `📻 ${s.name}`, group: 'Emissoras' }));
    fixedContent.filter((c) => c.enabled).forEach((c) => opts.push({ value: `fixo_${c.id}`, label: `📌 ${c.name}`, group: 'Conteúdo Fixo' }));
    [
      ['genre_SERTANEJO', '🎸 Sertanejo'],
      ['genre_PAGODE', '🥁 Pagode'],
      ['genre_FUNK', '🎵 Funk'],
      ['genre_POP', '🎤 Pop'],
      ['genre_ROCK,METAL', '🤘 Rock & Metal'],
      ['genre_ROMANTICO', '💕 Romântico'],
      ['genre_DANCE,ELETRONICA', '🎧 Dance'],
    ].forEach(([v, l]) => opts.push({ value: v, label: l, group: 'Gêneros' }));
    opts.push({ value: 'random_pop', label: '🎲 Aleatório', group: 'Especiais' });
    opts.push({ value: 'top50', label: '🏆 TOP25', group: 'Especiais' });
    opts.push({ value: 'LOC', label: '🎙️ LOC — Abertura', group: 'Locução' });
    opts.push({ value: 'LOC_END', label: '🎙️ LOC_END — Fechamento', group: 'Locução' });
    return opts;
  }, [stations, fixedContent]);

  const groupedSources = useMemo(() => {
    const g: Record<string, typeof sourceOptions> = {};
    sourceOptions.forEach((o) => { (g[o.group] ||= []).push(o); });
    return g;
  }, [sourceOptions]);

  const persist = (next: LocucaoSchedulePolicy) => {
    setPolicy(next);
    savePolicy(next);
  };

  const patchOverride = (hour: number, patch: Partial<{ locked: boolean | null; programName: string | null; sequence: HourOverridePosition[] | null }>) => {
    const key = overrideKey(selectedDay, hour);
    const prev = policy.hourOverrides?.[key] || {};
    const next: { locked?: boolean; programName?: string; sequence?: HourOverridePosition[] } = { ...prev };

    if ('locked' in patch) {
      if (patch.locked === null) delete next.locked;
      else if (patch.locked !== undefined) next.locked = patch.locked;
    }
    if ('programName' in patch) {
      if (patch.programName === null) delete next.programName;
      else if (patch.programName !== undefined) next.programName = patch.programName;
    }
    if ('sequence' in patch) {
      if (patch.sequence === null) delete next.sequence;
      else if (patch.sequence !== undefined) next.sequence = patch.sequence;
    }

    const overrides = { ...(policy.hourOverrides || {}) };
    if (Object.keys(next).length === 0) delete overrides[key];
    else overrides[key] = next;
    persist({ ...policy, hourOverrides: overrides });
  };

  const clearOverride = (hour: number) => {
    const key = overrideKey(selectedDay, hour);
    if (!policy.hourOverrides?.[key]) return;
    const overrides = { ...policy.hourOverrides };
    delete overrides[key];
    persist({ ...policy, hourOverrides: overrides });
    toast({ title: 'Override removido', description: `${hour.toString().padStart(2, '0')}:00 voltou ao padrão.` });
  };

  // ---------- Draft helpers (popover de edição) ----------
  const baseSeqFor = (): HourOverridePosition[] =>
    sequence.map((s) => ({ position: s.position, radioSource: s.radioSource, customFileName: s.customFileName }));

  const openEditor = (hour: number) => {
    const ovr = policy.hourOverrides?.[overrideKey(selectedDay, hour)];
    setDraft({
      locked: ovr?.locked,
      programName: ovr?.programName ?? '',
      sequence: ovr?.sequence ? [...ovr.sequence] : baseSeqFor(),
      seqDirty: !!ovr?.sequence,
    });
    setEditingHour(hour);
  };

  const closeEditor = () => {
    setEditingHour(null);
    setDraft(null);
  };

  const updateDraft = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const draftAddPos = () => {
    if (!draft) return;
    updateDraft({
      sequence: [...draft.sequence, { position: draft.sequence.length + 1, radioSource: stations[0]?.id || 'random_pop' }],
      seqDirty: true,
    });
  };
  const draftRemovePos = (idx: number) => {
    if (!draft) return;
    if (draft.sequence.length <= 1) {
      toast({ title: 'Mínimo 1 posição', variant: 'destructive' });
      return;
    }
    const next = draft.sequence.filter((_, i) => i !== idx).map((it, i) => ({ ...it, position: i + 1 }));
    updateDraft({ sequence: next, seqDirty: true });
  };
  const draftMovePos = (idx: number, dir: -1 | 1) => {
    if (!draft) return;
    const cur = [...draft.sequence];
    const target = idx + dir;
    if (target < 0 || target >= cur.length) return;
    [cur[idx], cur[target]] = [cur[target], cur[idx]];
    updateDraft({ sequence: cur.map((it, i) => ({ ...it, position: i + 1 })), seqDirty: true });
  };
  const draftChangeSource = (idx: number, value: string) => {
    if (!draft) return;
    const cur = [...draft.sequence];
    cur[idx] = { ...cur[idx], radioSource: value };
    updateDraft({ sequence: cur, seqDirty: true });
  };
  const draftResetSeq = () => {
    if (!draft) return;
    updateDraft({ sequence: baseSeqFor(), seqDirty: false });
  };

  const commitDraft = (hour: number) => {
    if (!draft) return;
    const next: { locked?: boolean; programName?: string; sequence?: HourOverridePosition[] } = {};
    if (draft.locked === true || draft.locked === false) next.locked = draft.locked;
    const trimmedName = draft.programName.trim();
    if (trimmedName) next.programName = trimmedName;
    if (draft.seqDirty) next.sequence = draft.sequence.map((it, i) => ({ ...it, position: i + 1 }));

    const key = overrideKey(selectedDay, hour);
    const overrides = { ...(policy.hourOverrides || {}) };
    if (Object.keys(next).length === 0) delete overrides[key];
    else overrides[key] = next;
    persist({ ...policy, hourOverrides: overrides });
    toast({ title: 'Salvo!', description: `Horário ${hour.toString().padStart(2, '0')}:00 atualizado.` });
    closeEditor();
  };

  const rows: HourRow[] = useMemo(() => {
    const now = new Date();
    const todayIdx = now.getDay();
    const targetIdx = DAY_KEYS.indexOf(selectedDay);
    const diff = targetIdx - todayIdx;
    const dayDate = new Date(now);
    dayDate.setDate(now.getDate() + diff);

    const dayOk = isDayAllowed(dayDate, policy);

    return Array.from({ length: 24 }, (_, hour) => {
      const slot = findFixedSlotForHour(fixedSlots, hour);
      const scheduled = findScheduledProgram(programs, hour);
      const override = policy.hourOverrides?.[overrideKey(selectedDay, hour)];
      const programName = override?.programName || slot?.program || scheduled || 'Música livre';

      let locStatus: HourRow['locStatus'] = 'allowed';
      let reason = 'Bloco aberto para LOC';

      if (override?.locked === true) {
        locStatus = 'forced-block';
        reason = 'Bloqueado manualmente pelo usuário';
      } else if (override?.locked === false) {
        locStatus = 'forced-allow';
        reason = 'Liberado manualmente pelo usuário';
      } else if (!dayOk) {
        locStatus = 'blocked-day';
        reason = `${DAY_LABELS[selectedDay]} não habilitado na política de Locução`;
      } else if (slot && !slot.locFriendly) {
        locStatus = 'blocked-program';
        reason = `Programa fixo: ${slot.program}`;
      } else if (isProgramBlocked(programName, policy)) {
        locStatus = 'blocked-program';
        reason = `Programa "${programName}" na blacklist`;
      } else {
        const hh = `${hour.toString().padStart(2, '0')}:00`;
        if (!isTimeAllowed(hh, policy)) {
          locStatus = 'blocked-time';
          reason = `Horário ${hh} fora da whitelist`;
        } else if (slot?.note?.toLowerCase().includes('noticias') || slot?.note?.toLowerCase().includes('notícias')) {
          locStatus = 'after-news';
          reason = 'LOC entra após NOTICIAS';
        }
      }

      const effectiveSequence = override?.sequence || sequence.map((s) => ({
        position: s.position, radioSource: s.radioSource, customFileName: s.customFileName,
      }));

      return {
        hour, programName, fixedSlot: slot, locStatus, reason, override,
        effectiveSequence, hasCustomSeq: !!override?.sequence,
      };
    });
  }, [selectedDay, policy, fixedSlots, programs, sequence]);

  const statusBadge = (row: HourRow) => {
    switch (row.locStatus) {
      case 'allowed':
      case 'forced-allow':
        return (
          <Badge variant="outline" className={`${row.locStatus === 'forced-allow' ? 'bg-emerald-500/30 ring-1 ring-emerald-400/50' : 'bg-emerald-500/15'} text-emerald-400 border-emerald-500/30 text-[10px] gap-1`}>
            <Mic className="w-3 h-3" /> {row.locStatus === 'forced-allow' ? 'liberado' : 'aceita LOC'}
          </Badge>
        );
      case 'after-news':
        return (
          <Badge variant="outline" className="bg-sky-500/15 text-sky-400 border-sky-500/30 text-[10px] gap-1">
            <Newspaper className="w-3 h-3" /> após NOTÍCIAS
          </Badge>
        );
      case 'blocked-program':
      case 'forced-block':
        return (
          <Badge variant="outline" className={`${row.locStatus === 'forced-block' ? 'bg-rose-500/30 ring-1 ring-rose-400/50' : 'bg-rose-500/15'} text-rose-400 border-rose-500/30 text-[10px] gap-1`}>
            <Ban className="w-3 h-3" /> {row.locStatus === 'forced-block' ? 'bloqueado' : 'programa fixo'}
          </Badge>
        );
      case 'blocked-time':
        return (
          <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px] gap-1">
            <Ban className="w-3 h-3" /> fora do horário
          </Badge>
        );
      case 'blocked-day':
        return (
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px] gap-1">
            <Ban className="w-3 h-3" /> dia bloqueado
          </Badge>
        );
    }
  };

  const counts = useMemo(() => {
    const c = { allowed: 0, news: 0, blocked: 0 };
    rows.forEach((r) => {
      if (r.locStatus === 'allowed' || r.locStatus === 'forced-allow') c.allowed++;
      else if (r.locStatus === 'after-news') c.news++;
      else c.blocked++;
    });
    return c;
  }, [rows]);

  return (
    <Card className="glass-card border-primary/20">
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="w-5 h-5 text-primary" />
            Grade 24h — {DAY_LABELS[selectedDay]}
          </CardTitle>
          <div className="flex items-center gap-1 text-xs">
            <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
              ✓ {counts.allowed}h livres
            </Badge>
            <Badge variant="outline" className="bg-sky-500/15 text-sky-400 border-sky-500/30">
              📰 {counts.news}h
            </Badge>
            <Badge variant="outline" className="bg-rose-500/15 text-rose-400 border-rose-500/30">
              ⛔ {counts.blocked}h
            </Badge>
          </div>
        </div>
        <div className="flex gap-1 mt-2 flex-wrap items-center">
          <Calendar className="w-4 h-4 text-muted-foreground mr-1" />
          {DAY_KEYS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={selectedDay === d ? 'default' : 'outline'}
              className="h-7 px-2 text-xs"
              onClick={() => setSelectedDay(d)}
            >
              {DAY_LABELS[d]}
              {d === today && <span className="ml-1 text-[9px] opacity-70">hoje</span>}
            </Button>
          ))}
          <span className="text-[10px] text-muted-foreground ml-2">
            💡 Clique no <Pencil className="w-3 h-3 inline" /> para editar posições, programa e LOC
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((row) => {
            const isLive = row.hour === new Date().getHours() && selectedDay === today;
            const hasOverride = !!row.override && (
              row.override.locked !== undefined ||
              row.override.programName !== undefined ||
              row.override.sequence !== undefined
            );
            const showSeq = row.locStatus !== 'blocked-program' && row.locStatus !== 'forced-block' && row.locStatus !== 'blocked-day' && row.locStatus !== 'blocked-time';
            return (
              <div
                key={row.hour}
                className={`grid grid-cols-[60px_1fr_auto_auto] gap-3 items-center px-4 py-2 hover:bg-secondary/30 transition-colors ${
                  isLive ? 'bg-primary/10 border-l-2 border-l-primary' : ''
                } ${hasOverride ? 'border-l-2 border-l-amber-400/60' : ''}`}
                title={row.reason}
              >
                {/* Hora */}
                <div className="flex flex-col">
                  <span className={`font-mono text-base font-bold ${isLive ? 'text-primary' : 'text-foreground'}`}>
                    {row.hour.toString().padStart(2, '0')}:00
                  </span>
                  {isLive && <span className="text-[9px] text-primary uppercase tracking-wide">agora</span>}
                  {hasOverride && !isLive && <span className="text-[9px] text-amber-400 uppercase tracking-wide">editado</span>}
                </div>

                {/* Programa + posições da sequência */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">{row.programName}</span>
                    {row.fixedSlot?.note && (
                      <span className="text-[10px] text-muted-foreground italic">({row.fixedSlot.note})</span>
                    )}
                    {row.hasCustomSeq && (
                      <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                        seq. custom ({row.effectiveSequence.length})
                      </Badge>
                    )}
                  </div>
                  {showSeq ? (
                    <div className="flex gap-0.5 mt-1 flex-wrap">
                      {row.effectiveSequence.map((it) => (
                        <span
                          key={it.position}
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${getStationColor(it.radioSource)}`}
                          title={`Posição ${it.position} — ${getSourceDisplayName(it.radioSource)}`}
                        >
                          {it.position.toString().padStart(2, '0')}·{getSourceDisplayName(it.radioSource).slice(0, 6)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground mt-1">{row.reason}</div>
                  )}
                </div>

                {/* Status LOC */}
                <div className="shrink-0">{statusBadge(row)}</div>

                {/* Botão editar */}
                <Popover
                  open={editingHour === row.hour}
                  onOpenChange={(o) => {
                    if (o) {
                      setEditingHour(row.hour);
                      setEditProgramName(row.override?.programName || '');
                    } else {
                      setEditingHour(null);
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-primary"
                      title="Editar este horário"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[420px] p-3" align="end">
                    <div className="space-y-3">
                      <div className="border-b border-border pb-2">
                        <div className="text-sm font-semibold">
                          Editar {row.hour.toString().padStart(2, '0')}:00 — {DAY_LABELS[selectedDay]}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Padrão: {row.fixedSlot?.program || 'Música livre'}
                        </div>
                      </div>

                      {/* Locução */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Locução nesta hora</Label>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant={row.override?.locked === false ? 'default' : 'outline'}
                            className="flex-1 h-7 text-[11px] gap-1"
                            onClick={() => patchOverride(row.hour, { locked: false })}
                          >
                            <Mic className="w-3 h-3" /> Liberar
                          </Button>
                          <Button
                            size="sm"
                            variant={row.override?.locked === true ? 'destructive' : 'outline'}
                            className="flex-1 h-7 text-[11px] gap-1"
                            onClick={() => patchOverride(row.hour, { locked: true })}
                          >
                            <Ban className="w-3 h-3" /> Bloquear
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => patchOverride(row.hour, { locked: null })}
                            title="Voltar ao automático"
                          >
                            Auto
                          </Button>
                        </div>
                      </div>

                      {/* Nome do programa */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Nome do programa</Label>
                        <div className="flex gap-1">
                          <Input
                            value={editProgramName}
                            onChange={(e) => setEditProgramName(e.target.value)}
                            placeholder={row.fixedSlot?.program || 'Música livre'}
                            className="h-7 text-xs"
                          />
                          <Button
                            size="icon"
                            variant="default"
                            className="h-7 w-7"
                            onClick={() => {
                              patchOverride(row.hour, { programName: editProgramName.trim() || null });
                              toast({ title: 'Programa atualizado' });
                            }}
                            title="Salvar"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Sequência de posições */}
                      <div className="space-y-1.5 border-t border-border pt-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">
                            Posições da sequência {row.hasCustomSeq && <span className="text-amber-400">(custom)</span>}
                          </Label>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px] gap-1"
                              onClick={() => addPos(row.hour)}
                            >
                              <Plus className="w-3 h-3" /> Posição
                            </Button>
                            {row.hasCustomSeq && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px] gap-1 text-amber-400"
                                onClick={() => resetSeq(row.hour)}
                                title="Voltar à sequência padrão"
                              >
                                <RotateCcw className="w-3 h-3" /> Padrão
                              </Button>
                            )}
                          </div>
                        </div>
                        <ScrollArea className="h-[200px] rounded border border-border p-1">
                          <div className="space-y-1">
                            {row.effectiveSequence.map((it, idx) => (
                              <div
                                key={`${row.hour}-${idx}`}
                                className="flex items-center gap-1 p-1 rounded bg-secondary/40 border border-border"
                              >
                                <span className="font-mono text-[10px] font-bold text-foreground w-5 text-center">
                                  {(idx + 1).toString().padStart(2, '0')}
                                </span>
                                <Select
                                  value={it.radioSource}
                                  onValueChange={(v) => {
                                    if (!row.hasCustomSeq) {
                                      // Materializa a sequência atual antes da edição
                                      patchOverride(row.hour, { sequence: row.effectiveSequence });
                                      setTimeout(() => changeSource(row.hour, idx, v), 0);
                                    } else {
                                      changeSource(row.hour, idx, v);
                                    }
                                  }}
                                >
                                  <SelectTrigger className="flex-1 h-7 text-[11px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-[280px]">
                                    {Object.entries(groupedSources).map(([group, opts]) => (
                                      <div key={group}>
                                        <div className="px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border first:border-t-0">
                                          {group}
                                        </div>
                                        {opts.map((o) => (
                                          <SelectItem key={o.value} value={o.value} className="text-xs">
                                            {o.label}
                                          </SelectItem>
                                        ))}
                                      </div>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => {
                                    if (!row.hasCustomSeq) patchOverride(row.hour, { sequence: row.effectiveSequence });
                                    setTimeout(() => movePos(row.hour, idx, -1), 0);
                                  }}
                                  disabled={idx === 0}
                                  title="Subir"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => {
                                    if (!row.hasCustomSeq) patchOverride(row.hour, { sequence: row.effectiveSequence });
                                    setTimeout(() => movePos(row.hour, idx, 1), 0);
                                  }}
                                  disabled={idx === row.effectiveSequence.length - 1}
                                  title="Descer"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive hover:bg-destructive/10"
                                  onClick={() => {
                                    if (!row.hasCustomSeq) patchOverride(row.hour, { sequence: row.effectiveSequence });
                                    setTimeout(() => removePos(row.hour, idx), 0);
                                  }}
                                  title="Remover"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                        <div className="text-[9px] text-muted-foreground italic">
                          💡 Editar uma posição cria uma sequência customizada só desta hora. Use "Padrão" para voltar à sequência global.
                        </div>
                      </div>

                      {/* Reset / Fechar */}
                      <div className="flex gap-1 pt-2 border-t border-border">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-7 text-[11px] gap-1"
                          onClick={() => clearOverride(row.hour)}
                          disabled={!hasOverride}
                          title="Remove TODOS os overrides desta hora"
                        >
                          <RotateCcw className="w-3 h-3" /> Resetar tudo
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px] gap-1"
                          onClick={() => setEditingHour(null)}
                        >
                          <X className="w-3 h-3" /> Fechar
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
