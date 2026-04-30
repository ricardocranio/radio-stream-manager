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

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Calendar, Clock, Mic, Ban, Newspaper, Pencil, RotateCcw, X,
  Plus, Trash2, ArrowUp, ArrowDown, Save, ChevronDown, Eraser,
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
import { getRealGradePositions, gradePosToRadioSource, type GradePosition } from '@/lib/locucao/realGradeTemplate';
import { executeFullSystemReset } from '@/lib/systemReset';
import { useRadioStore } from '@/store/radioStore';
import type { SequenceConfig, ProgramSchedule } from '@/types/radio';
import { useToast } from '@/hooks/use-toast';

interface Grade24hCardProps {
  sequence: SequenceConfig[];
  programs: ProgramSchedule[];
  getStationColor: (source: string) => string;
  getSourceDisplayName: (source: string) => string;
}

interface BlockRow {
  hour: number;
  minute: number; // 0 ou 30
  programName: string;
  fixedSlot?: FixedSlot;
  locStatus: 'allowed' | 'after-news' | 'blocked-program' | 'blocked-time' | 'blocked-day' | 'forced-allow' | 'forced-block';
  reason: string;
  override?: { locked?: boolean; programName?: string; sequence?: HourOverridePosition[] };
  /** Posições EXATAS que vão pra grade .txt (mus/vht/VHTN/fun/fixed). */
  effectiveSequence: Array<{ position: number; radioSource: string; customFileName?: string; gradeKind?: GradePosition['kind']; gradeLabel?: string }>;
  hasCustomSeq: boolean;
  /** True quando a base vem de uma ScheduledSequence (não da sequência global). */
  fromScheduled?: boolean;
  /** Bloco absorvido por programa de 60min (ex: Voz do Brasil ocupa 21:30). */
  absorbed?: boolean;
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

/**
 * Resolve a sequência base que será efetivamente usada por aquele
 * dia/hora — replica a lógica de `getActiveSequence` da store, mas
 * para um par (DayKey, hour) arbitrário, considerando:
 *   1. ScheduledSequences habilitadas que cubram a hora no dia (maior prioridade vence)
 *   2. Fallback: sequência global (`sequence`)
 * Assim o que é mostrado na Grade24h é IDÊNTICO ao que vai pra grade .txt.
 */
function resolveSequenceForHour(
  day: DayKey,
  hour: number,
  scheduledSequences: Array<{
    enabled: boolean;
    weekDays: string[];
    startHour: number; startMinute: number;
    endHour: number; endMinute: number;
    priority: number;
    sequence: SequenceConfig[];
  }>,
  defaultSequence: SequenceConfig[],
): SequenceConfig[] {
  const targetMinutes = hour * 60; // checa o início da hora (HH:00)
  const active = scheduledSequences
    .filter((s) => s.enabled)
    .filter((s) => s.weekDays.length === 0 || s.weekDays.includes(day))
    .filter((s) => {
      const start = s.startHour * 60 + s.startMinute;
      const end = s.endHour * 60 + s.endMinute;
      if (end <= start) return targetMinutes >= start || targetMinutes < end;
      return targetMinutes >= start && targetMinutes < end;
    })
    .sort((a, b) => b.priority - a.priority);
  if (active.length > 0) return active[0].sequence;
  return defaultSequence;
}

export function Grade24hCard({ sequence, programs, getStationColor, getSourceDisplayName }: Grade24hCardProps) {
  const today = useMemo(() => dayKeyFromDate(new Date()), []);
  const [selectedDay, setSelectedDay] = useState<DayKey>(today);
  const { stations, fixedContent, scheduledSequences, config, setConfig, programs: storePrograms, setPrograms, policy, setPolicy } = useRadioStore();
  const [editingBlock, setEditingBlock] = useState<{ hour: number; minute: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [previewTemplateMode, setPreviewTemplateMode] = useState(false);
  const [selectedBlocksForReset, setSelectedBlocksForReset] = useState<Set<string>>(new Set());

  // Draft buffer — só persiste no localStorage quando o usuário clica "Salvar".
  interface Draft {
    locked: boolean | null | undefined; // undefined = "auto" (sem override)
    programName: string;
    sequence: HourOverridePosition[];
    seqDirty: boolean; // true se o usuário editou explicitamente a sequência
  }
  const [draft, setDraft] = useState<Draft | null>(null);
  const { toast } = useToast();

  const fixedSlots = useMemo(() => {
    if (config.useDefaultFixedSchedules === false) return [];
    return getFixedScheduleForDay(selectedDay);
  }, [selectedDay, config.useDefaultFixedSchedules]);

  // Opções para o select de fonte
  const sourceOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string; group: string }> = [];
    // Tokens REAIS da grade (mesmos que vão pro .txt)
    opts.push({ value: 'grade_mus', label: '🎵 Música (mus)', group: 'Tokens da Grade' });
    opts.push({ value: 'grade_vht', label: '🔔 Vinheta (vht)', group: 'Tokens da Grade' });
    opts.push({ value: 'grade_vhtn', label: '📰 Vinheta Notícia (VHTN)', group: 'Tokens da Grade' });
    opts.push({ value: 'grade_fun', label: '🎛️ Funk (fun)', group: 'Tokens da Grade' });
    opts.push({ value: 'grade_rom', label: '💕 Romântica (rom)', group: 'Tokens da Grade' });
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

  /**
   * Constrói as opções do select para UMA posição específica, garantindo que
   * o valor atual (ex: `grade_fixed:SHAKE_MIX_BLOCO01`) sempre apareça como
   * opção — caso contrário o Select ficaria visualmente vazio.
   */
  const getOptionsForValue = (currentValue: string) => {
    const base = sourceOptions;
    if (currentValue?.startsWith('grade_fixed:')) {
      const label = currentValue.slice('grade_fixed:'.length);
      return [
        { value: currentValue, label: `📦 ${label} (arquivo fixo)`, group: 'Arquivo Fixo da Grade' },
        ...base,
      ];
    }
    if (currentValue && !base.find((o) => o.value === currentValue)) {
      return [
        { value: currentValue, label: `❓ ${currentValue}`, group: 'Atual' },
        ...base,
      ];
    }
    return base;
  };

  const groupOptions = (opts: Array<{ value: string; label: string; group: string }>) => {
    const g: Record<string, typeof opts> = {};
    opts.forEach((o) => { (g[o.group] ||= []).push(o); });
    return g;
  };

  const persist = (next: LocucaoSchedulePolicy) => {
    setPolicy(next);
  };

  const patchOverride = (hour: number, minute: number, patch: Partial<{ locked: boolean | null; programName: string | null; sequence: HourOverridePosition[] | null }>) => {
    const key = overrideKey(selectedDay, hour, minute);
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

  const clearOverride = (hour: number, minute: number) => {
    const key = overrideKey(selectedDay, hour, minute);
    if (!policy.hourOverrides?.[key]) return;
    const overrides = { ...policy.hourOverrides };
    delete overrides[key];
    persist({ ...policy, hourOverrides: overrides });
    toast({ title: 'Override removido', description: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} voltou ao padrão.` });
  };

  /** Remove TODOS os overrides do dia atualmente selecionado. */
  const resetSelectedDay = () => {
    const overrides = { ...(policy.hourOverrides || {}) };
    const prefix = `${selectedDay}-`;
    
    // Se estiver no modo preview e houver blocos selecionados, limpa apenas eles.
    // Caso contrário, limpa o dia inteiro como antes.
    const keysToRemove = previewTemplateMode && selectedBlocksForReset.size > 0
      ? Array.from(selectedBlocksForReset)
      : Object.keys(overrides).filter(k => k.startsWith(prefix));

    keysToRemove.forEach(k => delete overrides[k]);
    
    persist({ ...policy, hourOverrides: overrides });
    
    toast({
      title: keysToRemove.length > 0 ? `Grade subscrita` : `Nada para alterar`,
      description: `${keysToRemove.length} bloco(s) agora seguem a Sequência Padrão.`,
    });
    
    if (previewTemplateMode) {
      setPreviewTemplateMode(false);
      setSelectedBlocksForReset(new Set());
    }
  };

  const toggleBlockSelection = (key: string) => {
    const next = new Set(selectedBlocksForReset);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedBlocksForReset(next);
  };

  const selectAllBlocks = (allKeys: string[]) => {
    setSelectedBlocksForReset(new Set(allKeys));
  };

  /** Remove TODOS os overrides de TODOS os dias da semana, limpa programas agendados e o pool de músicas. */
  const resetAllDays = async () => {
    // 1. Limpa overrides manuais da grade 24h
    persist({ ...policy, hourOverrides: {} });
    
    // 2. Limpa os programas agendados (programas fixos customizados)
    setPrograms([]);
    
    // 3. Desativa os horários fixos padronizados (Nossa Madrugada, etc)
    setConfig({ useDefaultFixedSchedules: false });

    // 4. Executa o reset do pool, mas PRESERVA a SEQUÊNCIA PADRÃO do usuário
    await executeFullSystemReset({
      clearSupabase: true,
      clearSchedules: false,
      resetStations: false,
      clearUserSequence: false
    });

    toast({
      title: 'Sistema Formatado',
      description: 'Programas fixos e customizações foram removidos. A grade agora é 100% baseada na sua Sequência Padrão.',
    });
  };

  // ---------- Draft helpers (popover de edição) ----------
  /**
   * Sequência base "como vai pra grade .txt" para um bloco específico
   * (hora + minuto): usa as posições REAIS do template do dia.
   */
  const baseSeqFor = (hour: number, minute: number): HourOverridePosition[] => {
    const real = getRealGradePositions({ day: selectedDay, hour, minute });
    if (real.length > 0) {
      // Posições `mus` viram as rádios da SEQUÊNCIA PADRÃO (cyclando), garantindo
      // frescor das emissoras escolhidas pelo usuário. Demais tokens (vht/vhtn/
      // fun/rom/fixos) permanecem como estão para preservar o template real.
      const userStations = (sequence || [])
        .map((s) => s.radioSource)
        .filter((rs) => !!rs && rs !== 'LOC' && rs !== 'LOC_END');
      let cycle = 0;
      return real.map((p) => {
        if (p.kind === 'mus' && userStations.length > 0) {
          const radioSource = userStations[cycle % userStations.length];
          cycle++;
          return { position: p.position, radioSource, rawToken: undefined };
        }
        return {
          position: p.position,
          radioSource: gradePosToRadioSource(p),
          rawToken: p.token,
        };
      });
    }
    // Sem template real para este bloco — usa direto a sequência padrão (com frescor).
    const userStations = (sequence || [])
      .map((s) => s.radioSource)
      .filter((rs) => !!rs);
    if (userStations.length > 0) {
      return userStations.map((rs, i) => ({ position: i + 1, radioSource: rs }));
    }
    // Se não houver sequência definida pelo usuário, retorna vazio (liberdade para montar do zero)
    return [];
  };

  const openEditor = (hour: number, minute: number) => {
    const ovr = policy.hourOverrides?.[overrideKey(selectedDay, hour, minute)];
    setDraft({
      locked: ovr?.locked,
      programName: ovr?.programName ?? '',
      sequence: ovr?.sequence ? [...ovr.sequence] : baseSeqFor(hour, minute),
      seqDirty: !!ovr?.sequence,
    });
    setEditingBlock({ hour, minute });
  };

  const closeEditor = () => {
    setEditingBlock(null);
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
    // Mantém rawToken só se o novo radioSource ainda for um token "grade_*"
    // que case com o token original (ex: trocar grade_mus por outra coisa invalida o rawToken).
    const prev = cur[idx];
    const keepRaw = !!prev.rawToken && value.startsWith('grade_') && (
      (value === 'grade_mus' && prev.rawToken.toLowerCase() === 'mus') ||
      (value === 'grade_vht' && prev.rawToken.toLowerCase() === 'vht') ||
      (value === 'grade_vhtn' && prev.rawToken.toLowerCase() === 'vhtn') ||
      (value === 'grade_fun' && prev.rawToken.toLowerCase() === 'fun') ||
      (value === 'grade_rom' && prev.rawToken.toLowerCase() === 'rom') ||
      (value.startsWith('grade_fixed:'))
    );
    cur[idx] = { ...prev, radioSource: value, rawToken: keepRaw ? prev.rawToken : undefined };
    updateDraft({ sequence: cur, seqDirty: true });
  };
  const draftResetSeq = () => {
    if (!draft || !editingBlock) return;
    updateDraft({ sequence: baseSeqFor(editingBlock.hour, editingBlock.minute), seqDirty: false });
  };

  const commitDraft = (hour: number, minute: number) => {
    if (!draft) return;
    const next: { locked?: boolean; programName?: string; sequence?: HourOverridePosition[] } = {};
    if (draft.locked === true || draft.locked === false) next.locked = draft.locked;
    const trimmedName = draft.programName.trim();
    if (trimmedName) next.programName = trimmedName;
    if (draft.seqDirty) next.sequence = draft.sequence.map((it, i) => ({ ...it, position: i + 1 }));

    const key = overrideKey(selectedDay, hour, minute);
    const overrides = { ...(policy.hourOverrides || {}) };
    if (Object.keys(next).length === 0) delete overrides[key];
    else overrides[key] = next;
    persist({ ...policy, hourOverrides: overrides });
    toast({ title: 'Salvo!', description: `Bloco ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} atualizado.` });
    closeEditor();
  };

  const rows: BlockRow[] = useMemo(() => {
    const now = new Date();
    const todayIdx = now.getDay();
    const targetIdx = DAY_KEYS.indexOf(selectedDay);
    const diff = targetIdx - todayIdx;
    const dayDate = new Date(now);
    dayDate.setDate(now.getDate() + diff);

    const dayOk = isDayAllowed(dayDate, policy);

    // Gera 48 blocos: 24 horas × 2 (HH:00 e HH:30)
    const out: BlockRow[] = [];
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 30] as const) {
        const slot = findFixedSlotForHour(fixedSlots, hour);
        const scheduled = findScheduledProgram(programs, hour);
        const override = policy.hourOverrides?.[overrideKey(selectedDay, hour, minute)];
        const programName = override?.programName || slot?.program || scheduled || 'Música livre';

        let locStatus: BlockRow['locStatus'] = 'allowed';
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
          const hh = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          if (!isTimeAllowed(hh, policy)) {
            locStatus = 'blocked-time';
            reason = `Horário ${hh} fora da whitelist`;
          } else if (slot?.note?.toLowerCase().includes('noticias') || slot?.note?.toLowerCase().includes('notícias')) {
            locStatus = 'after-news';
            reason = 'LOC entra após NOTICIAS';
          }
        }

        const realPositions = getRealGradePositions({ day: selectedDay, hour, minute });
        const resolvedBase = resolveSequenceForHour(selectedDay, hour, scheduledSequences as any, sequence);
        const fromScheduled = resolvedBase !== sequence;

        // Bloco absorvido: o template retornou vazio explicitamente
        // (ex.: 21:30 seg-sex absorvido pela Voz do Brasil das 21:00).
        // Detectamos via raw: se realPositions é vazio E o template do dia
        // cobre outros blocos próximos (heurística: hora 21:30 dia útil).
        const isWeekday = ['seg','ter','qua','qui','sex'].includes(selectedDay);
        const absorbed = isWeekday && hour === 21 && minute === 30 && realPositions.length === 0;

        // Posições EXATAS do .txt — prioridade: override custom > template real do dia > sequência configurada
        const effectiveSequence = absorbed
          ? []
          : override?.sequence
            ? override.sequence.map((s) => ({ position: s.position, radioSource: s.radioSource, customFileName: s.customFileName }))
            : realPositions.length > 0
              ? (() => {
                  const userStations = resolvedBase
                    .map((s) => s.radioSource)
                    .filter((rs) => !!rs && rs !== 'LOC' && rs !== 'LOC_END');
                  let cycle = 0;
                  return realPositions.map((p) => {
                    const kind = p.kind;
                    if (kind === 'mus' && userStations.length > 0) {
                      const radioSource = userStations[cycle % userStations.length];
                      cycle++;
                      return {
                        position: p.position,
                        radioSource,
                        gradeKind: kind,
                        gradeLabel: p.label,
                      };
                    }
                    return {
                      position: p.position,
                      radioSource: gradePosToRadioSource(p),
                      gradeKind: kind,
                      gradeLabel: p.label,
                    };
                  });
                })()
              : resolvedBase.map((s) => ({ position: s.position, radioSource: s.radioSource, customFileName: s.customFileName }));

        out.push({
          hour, minute, programName, fixedSlot: slot, locStatus, reason, override,
          effectiveSequence, hasCustomSeq: !!override?.sequence, fromScheduled, absorbed,
        });
      }
    }
    return out;
  }, [selectedDay, policy, fixedSlots, programs, sequence, scheduledSequences]);

  const statusBadge = (row: BlockRow) => {
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
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-2 text-lg font-semibold hover:text-primary transition-colors"
            title={collapsed ? 'Expandir' : 'Encolher'}
          >
            <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
            <Clock className="w-5 h-5 text-primary" />
            Grade 24h — {DAY_LABELS[selectedDay]}
          </button>
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
        {!collapsed && (
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

            <div className="ml-auto flex items-center gap-1">
              {/* Botão de Modo Preview / Subscrição Seletiva */}
              <Button
                size="sm"
                variant={previewTemplateMode ? "default" : "outline"}
                className={`h-7 px-2 text-xs gap-1 ${previewTemplateMode ? 'bg-amber-600 hover:bg-amber-700' : 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'}`}
                onClick={() => {
                  setPreviewTemplateMode(!previewTemplateMode);
                  setSelectedBlocksForReset(new Set());
                }}
                title="Ativar modo visual para formatar blocos específicos"
              >
                <RotateCcw className={`w-3 h-3 ${previewTemplateMode ? 'animate-spin-slow' : ''}`} />
                <span className="hidden sm:inline">{previewTemplateMode ? 'Sair do Modo Formatar' : 'Formatar Seleção'}</span>
              </Button>

              {previewTemplateMode ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => selectAllBlocks(rows.filter(r => !!r.override).map(r => overrideKey(selectedDay, r.hour, r.minute)))}
                  >
                    Selecionar Todos Editados
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 px-2 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-900/20"
                        disabled={selectedBlocksForReset.size === 0}
                      >
                        <Save className="w-3 h-3" />
                        Aplicar Formatação ({selectedBlocksForReset.size})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-slate-900 border-border text-slate-100">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-emerald-400 flex items-center gap-2">
                          <Save className="w-5 h-5" />
                          Confirmar Formatação?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-300">
                          Os {selectedBlocksForReset.size} blocos selecionados serão <strong className="text-white">subscritos</strong> conforme a sua <strong className="text-amber-400">Sequência Padrão</strong>. 
                          <br /><br />
                          ⚠️ <span className="text-amber-400 font-bold uppercase">Aviso:</span> Após aceitar, esta alteração será gravada permanentemente e <strong className="text-rose-400 underline">não poderá ser desfeita</strong>.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="bg-slate-800 text-slate-300 border-slate-700">Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={resetSelectedDay} className="bg-emerald-600 hover:bg-emerald-700 text-white border-none">
                          Confirmar e Formatar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                      title={`Zerar e formatar grade de ${DAY_LABELS[selectedDay]}`}
                    >
                      <Eraser className="w-3 h-3" />
                      <span className="hidden sm:inline text-amber-400">Zerar Dia</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-slate-900 border-border text-slate-100">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-amber-400">Zerar grade de {DAY_LABELS[selectedDay]}?</AlertDialogTitle>
                      <AlertDialogDescription className="text-slate-300">
                        Atenção: Todos os horários deste dia serão <strong className="text-white">reescritos</strong> seguindo estritamente a sua <strong className="text-amber-400">Sequência Padrão</strong>. 
                        <br /><br />
                        Isso removerá qualquer edição manual feita nos horários. 
                        <br /><br />
                        ⚠️ <span className="text-amber-400 font-bold uppercase">Aviso:</span> Após aceitar, esta alteração <strong className="text-rose-400 underline">não poderá ser desfeita</strong>.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-slate-800 text-slate-300 border-slate-700">Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={resetSelectedDay} className="bg-amber-600 hover:bg-amber-700 text-white border-none">
                        Zerar e Formatar Dia
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              {/* Zerar TODA a grade 24h (todos os dias) */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs gap-1 border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                    title="FORMATAR TUDO: Limpa a grade de todos os dias e reseta o sistema"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span className="hidden sm:inline">Formatar Tudo</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-slate-950 border-rose-500/30 text-slate-100">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-rose-500 flex items-center gap-2">
                      <Trash2 className="w-5 h-5" />
                      Formatar Total do Sistema?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-300">
                      Esta é uma <strong className="text-rose-400">formatação completa</strong>. 
                      <br /><br />
                      1. <strong className="text-white">Grade 24h:</strong> Todos os dias serão subscritos pela Sequência Padrão.
                      <br />
                      2. <strong className="text-white">Sistema:</strong> O pool de músicas e históricos serão limpos.
                      <br /><br />
                      Sua <strong className="text-amber-400">Sequência Padrão</strong> será preservada como o novo modelo para todo o sistema.
                      <br /><br />
                      ⚠️ <span className="text-rose-400 font-bold uppercase underline">Aviso Crítico:</span> Esta operação é irreversível e <strong className="text-rose-500">não poderá ser desfeita</strong>.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-slate-800 text-slate-300 border-slate-700">Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={resetAllDays} className="bg-rose-600 hover:bg-rose-700 text-white border-none">
                      Executar Formatação Total
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </CardHeader>
      {!collapsed && (
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((row) => {
            const nowDate = new Date();
            const isLive = selectedDay === today
              && row.hour === nowDate.getHours()
              && ((row.minute === 0 && nowDate.getMinutes() < 30) || (row.minute === 30 && nowDate.getMinutes() >= 30));
            const hasOverride = !!row.override && (
              row.override.locked !== undefined ||
              row.override.programName !== undefined ||
              row.override.sequence !== undefined
            );
            
            const key = overrideKey(selectedDay, row.hour, row.minute);
            const isSelectedForReset = selectedBlocksForReset.has(key);
            
            const showSeq = !row.absorbed && row.locStatus !== 'blocked-program' && row.locStatus !== 'forced-block' && row.locStatus !== 'blocked-day' && row.locStatus !== 'blocked-time';
            const isHourStart = row.minute === 0;

            const displaySequence = (previewTemplateMode && isSelectedForReset) 
              ? baseSeqFor(row.hour, row.minute)
              : row.effectiveSequence;

            return (
              <div
                key={`${row.hour}-${row.minute}`}
                onClick={() => previewTemplateMode && row.override && toggleBlockSelection(key)}
                className={`grid grid-cols-[60px_1fr_auto_auto] gap-3 items-center px-4 py-2 transition-all duration-200 ${
                  previewTemplateMode && row.override ? 'cursor-pointer' : ''
                } ${
                  isLive ? 'bg-primary/10 border-l-2 border-l-primary' : ''
                } ${
                  isSelectedForReset 
                    ? 'bg-emerald-500/10 border-l-4 border-l-emerald-500 scale-[0.99]' 
                    : hasOverride 
                      ? (previewTemplateMode ? 'opacity-60 grayscale-[0.3] border-l-2 border-l-amber-400/30' : 'border-l-2 border-l-amber-400/60') 
                      : ''
                } ${
                  isHourStart ? 'border-t border-t-border/40' : 'bg-secondary/5'
                } ${row.absorbed ? 'opacity-60' : ''} ${
                  previewTemplateMode && row.override && !isSelectedForReset ? 'hover:bg-amber-500/5' : ''
                }`}
                title={row.reason}
              >
                {/* Hora:Minuto */}
                <div className="flex flex-col">
                  <span className={`font-mono text-base font-bold ${isLive ? 'text-primary' : isHourStart ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {row.hour.toString().padStart(2, '0')}:{row.minute.toString().padStart(2, '0')}
                  </span>
                  {isLive && <span className="text-[9px] text-primary uppercase tracking-wide">agora</span>}
                  {hasOverride && !isLive && !isSelectedForReset && !previewTemplateMode && <span className="text-[9px] text-amber-400 uppercase tracking-wide">editado</span>}
                  {isSelectedForReset && <span className="text-[9px] text-emerald-400 uppercase font-bold tracking-wide animate-pulse">reescrever</span>}
                  {previewTemplateMode && hasOverride && !isSelectedForReset && <span className="text-[9px] text-amber-400/50 uppercase tracking-wide">clique p/ formatar</span>}
                </div>

                {/* Programa + posições da sequência */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium truncate ${isSelectedForReset ? 'text-emerald-400 font-bold' : 'text-foreground'}`}>
                      {isSelectedForReset ? (findScheduledProgram(programs, row.hour) || 'Música livre') : row.programName}
                    </span>
                    {row.fixedSlot?.note && (
                      <span className="text-[10px] text-muted-foreground italic">({row.fixedSlot.note})</span>
                    )}
                    {row.absorbed && (
                      <Badge variant="outline" className="text-[9px] bg-muted text-muted-foreground border-border">
                        absorvido (60min)
                      </Badge>
                    )}
                    {isSelectedForReset && (
                      <Badge variant="outline" className="text-[9px] bg-emerald-500/20 text-emerald-400 border-emerald-500/40 animate-pulse">
                        FORMATAR → PADRÃO
                      </Badge>
                    )}
                    {row.hasCustomSeq && !isSelectedForReset && (
                      <Badge variant="outline" className={`text-[9px] ${previewTemplateMode ? 'bg-amber-500/5 text-amber-400/50 border-amber-500/10' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
                        seq. custom ({row.effectiveSequence.length})
                      </Badge>
                    )}
                    {!row.hasCustomSeq && row.fromScheduled && !row.absorbed && !isSelectedForReset && (
                      <Badge variant="outline" className="text-[9px] bg-violet-500/10 text-violet-400 border-violet-500/30">
                        seq. agendada
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-0.5 mt-1 flex-wrap">
                    {row.absorbed && (
                      <span className="text-[10px] text-muted-foreground italic">⏱️ Bloco ocupado pelo programa anterior (60min)</span>
                    )}
                    {!row.absorbed && displaySequence.map((it: any) => {
                      const kind = it.gradeKind || (it as any).rawToken;
                      const cls = isSelectedForReset
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 font-bold'
                        : kind === 'mus' || kind === 'MUS'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                          : kind === 'vht' || kind === 'VHT'
                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                            : kind === 'vhtn' || kind === 'VHTN'
                              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                              : kind === 'fun' || kind === 'FUN'
                                ? 'bg-pink-500/15 text-pink-300 border-pink-500/40'
                                : kind === 'rom' || kind === 'ROM'
                                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                                  : kind === 'fixed'
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                    : getStationColor(it.radioSource);
                      
                      const display = it.gradeLabel || getSourceDisplayName(it.radioSource);
                      return (
                        <span
                          key={it.position}
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${cls} ${
                            showSeq || isSelectedForReset ? '' : 'opacity-40 line-through decoration-rose-400/60'
                          }`}
                        >
                          {it.position}. {display.toUpperCase().slice(0, 10)}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Status LOC */}
                <div className="flex flex-col items-end gap-1">
                  {statusBadge(row)}
                  {!row.absorbed && hasOverride && row.override?.locked !== undefined && (
                    <Badge variant="outline" className="text-[8px] border-amber-500/30 text-amber-400/80 bg-amber-500/5">
                      LOC manual
                    </Badge>
                  )}
                </div>

                {/* Ações: Editar */}
                <div className="flex gap-1">
                  {!row.absorbed && !previewTemplateMode && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 hover:bg-primary/20 hover:text-primary transition-colors"
                      onClick={() => openEditor(row.hour, row.minute)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {previewTemplateMode && row.override && (
                    <div className={`h-8 w-8 flex items-center justify-center rounded-full border-2 transition-all ${
                      isSelectedForReset 
                        ? 'bg-emerald-500 border-emerald-400 text-white' 
                        : 'border-slate-700 bg-slate-800 text-slate-500'
                    }`}>
                      {isSelectedForReset ? <Save className="w-4 h-4" /> : <div className="w-2 h-2 rounded-full bg-slate-600" />}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
      )}

      {/* ===== Dialog de edição (janela grande) ===== */}
      <Dialog
        open={editingBlock !== null}
        onOpenChange={(o) => { if (!o) closeEditor(); }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          {(() => {
            if (!editingBlock || !draft) return null;
            const row = rows.find((r) => r.hour === editingBlock.hour && r.minute === editingBlock.minute);
            if (!row) return null;
            const hasOverride = !!row.override && (
              row.override.locked !== undefined ||
              row.override.programName !== undefined ||
              row.override.sequence !== undefined
            );
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center justify-between gap-2">
                    <span>
                      Editar bloco {row.hour.toString().padStart(2, '0')}:{row.minute.toString().padStart(2, '0')} — {DAY_LABELS[selectedDay]}
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                      rascunho
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    Programa padrão: <b>{row.fixedSlot?.program || 'Música livre'}</b>
                    {row.fromScheduled && (
                      <span className="ml-1 text-violet-400">• base: sequência agendada</span>
                    )}
                  </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-hidden">
                  {/* Coluna esquerda: Locução + Nome */}
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Locução nesta hora</Label>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant={draft.locked === false ? 'default' : 'outline'}
                          className="flex-1 h-9 text-xs gap-1"
                          onClick={() => updateDraft({ locked: false })}
                        >
                          <Mic className="w-3.5 h-3.5" /> Liberar
                        </Button>
                        <Button
                          size="sm"
                          variant={draft.locked === true ? 'destructive' : 'outline'}
                          className="flex-1 h-9 text-xs gap-1"
                          onClick={() => updateDraft({ locked: true })}
                        >
                          <Ban className="w-3.5 h-3.5" /> Bloquear
                        </Button>
                        <Button
                          size="sm"
                          variant={draft.locked === undefined ? 'secondary' : 'ghost'}
                          className="h-9 px-3 text-xs"
                          onClick={() => updateDraft({ locked: undefined })}
                          title="Voltar ao automático"
                        >
                          Auto
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Nome do programa</Label>
                      <Input
                        value={draft.programName}
                        onChange={(e) => updateDraft({ programName: e.target.value })}
                        placeholder={row.fixedSlot?.program || 'Música livre'}
                        className="h-9 text-sm"
                      />
                    </div>

                    <div className="rounded-lg border border-border bg-secondary/30 p-3 text-[11px] text-muted-foreground space-y-1">
                      <div className="font-semibold text-foreground text-xs mb-1">💡 Dicas</div>
                      <div>• Cada posição vira uma linha no .txt da grade.</div>
                      <div>• <b>mus/vht/VHTN/fun</b> = tokens da automação.</div>
                      <div>• Arquivos fixos (📦) tocam exatamente como nomeados.</div>
                      <div>• Use ↑ ↓ para reordenar, 🗑️ para remover.</div>
                    </div>
                  </div>

                  {/* Coluna direita: Sequência */}
                  <div className="flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs">
                        Posições da sequência{' '}
                        <span className="text-muted-foreground">({draft.sequence.length})</span>
                        {draft.seqDirty && <span className="text-amber-400 ml-1">(custom)</span>}
                      </Label>
                      {draft.seqDirty && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px] gap-1 text-amber-400"
                          onClick={draftResetSeq}
                          title="Voltar à sequência padrão"
                        >
                          <RotateCcw className="w-3 h-3" /> Padrão
                        </Button>
                      )}
                    </div>
                    <ScrollArea className="flex-1 h-[400px] rounded border border-border p-2">
                      <div className="space-y-1.5">
                        {draft.sequence.map((it, idx) => {
                          const optsForThis = getOptionsForValue(it.radioSource);
                          const grouped = groupOptions(optsForThis);
                          return (
                            <div
                              key={`${row.hour}-${idx}`}
                              className="flex items-center gap-1.5 p-1.5 rounded bg-secondary/40 border border-border hover:border-primary/40 transition-colors"
                            >
                              <span className="font-mono text-xs font-bold text-foreground w-7 text-center bg-background/60 rounded py-1">
                                {(idx + 1).toString().padStart(2, '0')}
                              </span>
                              <Select
                                value={it.radioSource}
                                onValueChange={(v) => draftChangeSource(idx, v)}
                              >
                                <SelectTrigger className="flex-1 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="max-h-[300px]">
                                  {Object.entries(grouped).map(([group, opts]) => (
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
                                variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => draftMovePos(idx, -1)}
                                disabled={idx === 0} title="Subir"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => draftMovePos(idx, 1)}
                                disabled={idx === draft.sequence.length - 1} title="Descer"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                onClick={() => draftRemovePos(idx)}
                                title="Remover"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>

                    {/* Botão GRANDE para adicionar posições */}
                    <Button
                      variant="outline"
                      className="mt-2 w-full h-10 gap-2 border-dashed border-primary/40 text-primary hover:bg-primary/10 hover:border-primary"
                      onClick={draftAddPos}
                    >
                      <Plus className="w-4 h-4" /> Adicionar nova posição
                    </Button>
                  </div>
                </div>

                {/* Footer: Salvar / Cancelar / Resetar */}
                <div className="flex gap-2 pt-3 border-t border-border">
                  <Button
                    variant="outline"
                    className="gap-1"
                    onClick={() => { clearOverride(row.hour, row.minute); closeEditor(); }}
                    disabled={!hasOverride}
                    title="Remove TODOS os overrides deste bloco"
                  >
                    <RotateCcw className="w-4 h-4" /> Resetar
                  </Button>
                  <Button
                    variant="ghost"
                    className="gap-1"
                    onClick={closeEditor}
                  >
                    <X className="w-4 h-4" /> Cancelar
                  </Button>
                  <Button
                    variant="default"
                    className="flex-1 gap-1 bg-primary hover:bg-primary/90"
                    onClick={() => commitDraft(row.hour, row.minute)}
                  >
                    <Save className="w-4 h-4" /> Salvar alterações
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
