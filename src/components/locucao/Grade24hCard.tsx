/**
 * Card "Grade 24h" da aba Sequência.
 *
 * Mostra TODAS as 24 horas do dia selecionado, com:
 *  - Programa fixo daquele bloco (se houver) — editável
 *  - Status da Locução (✓ aceita | ⛔ bloqueada | 📰 após NOTÍCIAS) — editável
 *  - Pré-visualização da sequência ativa (compacta) por hora
 *
 * Edição inline por hora: o usuário pode forçar bloqueio/liberação da LOC e
 * renomear o programa exibido — persistido em `policy.hourOverrides`.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar, Clock, Mic, Ban, Newspaper, Pencil, RotateCcw, Check, X } from 'lucide-react';
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
} from '@/lib/locucao/locucaoSchedulePolicy';
import { getFixedScheduleForDay, type FixedSlot } from '@/lib/locucao/fixedScheduleMap';
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
  override?: { locked?: boolean; programName?: string };
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
  const [editProgramName, setEditProgramName] = useState('');
  const { toast } = useToast();

  const fixedSlots = useMemo(() => getFixedScheduleForDay(selectedDay), [selectedDay]);

  const persist = (next: LocucaoSchedulePolicy) => {
    setPolicy(next);
    savePolicy(next);
  };

  const setOverride = (hour: number, patch: { locked?: boolean | null; programName?: string | null }) => {
    const key = overrideKey(selectedDay, hour);
    const prev = policy.hourOverrides?.[key] || {};
    const next: { locked?: boolean; programName?: string } = { ...prev };
    if (patch.locked === null) delete next.locked;
    else if (patch.locked !== undefined) next.locked = patch.locked;
    if (patch.programName === null) delete next.programName;
    else if (patch.programName !== undefined) next.programName = patch.programName;

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

      // Override manual vence
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

      return { hour, programName, fixedSlot: slot, locStatus, reason, override };
    });
  }, [selectedDay, policy, fixedSlots, programs]);

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

  const seqPreview = sequence.slice(0, 6);

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
            💡 Clique no <Pencil className="w-3 h-3 inline" /> para editar uma hora
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((row) => {
            const isLive = row.hour === new Date().getHours() && selectedDay === today;
            const hasOverride = !!row.override && (row.override.locked !== undefined || row.override.programName !== undefined);
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

                {/* Programa + sequência preview */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">{row.programName}</span>
                    {row.fixedSlot?.note && (
                      <span className="text-[10px] text-muted-foreground italic">({row.fixedSlot.note})</span>
                    )}
                  </div>
                  {row.locStatus === 'allowed' || row.locStatus === 'after-news' || row.locStatus === 'forced-allow' ? (
                    <div className="flex gap-0.5 mt-1 flex-wrap">
                      {seqPreview.map((it) => (
                        <span
                          key={it.position}
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${getStationColor(it.radioSource)}`}
                          title={getSourceDisplayName(it.radioSource)}
                        >
                          {it.position}
                        </span>
                      ))}
                      {sequence.length > 6 && (
                        <span className="text-[9px] px-1 text-muted-foreground self-center">
                          +{sequence.length - 6}
                        </span>
                      )}
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
                  <PopoverContent className="w-72" align="end">
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
                            onClick={() => setOverride(row.hour, { locked: false })}
                          >
                            <Mic className="w-3 h-3" /> Liberar
                          </Button>
                          <Button
                            size="sm"
                            variant={row.override?.locked === true ? 'destructive' : 'outline'}
                            className="flex-1 h-7 text-[11px] gap-1"
                            onClick={() => setOverride(row.hour, { locked: true })}
                          >
                            <Ban className="w-3 h-3" /> Bloquear
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setOverride(row.hour, { locked: null })}
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
                              setOverride(row.hour, { programName: editProgramName.trim() || null });
                              toast({ title: 'Programa atualizado', description: `${row.hour.toString().padStart(2, '0')}:00` });
                            }}
                            title="Salvar"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </Button>
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
                        >
                          <RotateCcw className="w-3 h-3" /> Resetar
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
