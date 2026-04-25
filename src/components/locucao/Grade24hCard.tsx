/**
 * Card "Grade 24h" da aba Sequência.
 *
 * Mostra TODAS as 24 horas do dia selecionado, com:
 *  - Programa fixo daquele bloco (se houver)
 *  - Status da Locução (✓ aceita LOC | ⛔ bloqueada | 📰 após NOTÍCIAS)
 *  - Pré-visualização da sequência ativa (compacta) por hora
 *
 * Permite ao usuário ter total dimensão e autonomia para ajustar a grade.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, Mic, Ban, Newspaper } from 'lucide-react';
import {
  DAY_KEYS,
  DAY_LABELS,
  dayKeyFromDate,
  loadPolicy,
  isDayAllowed,
  isTimeAllowed,
  isProgramBlocked,
  type DayKey,
} from '@/lib/locucao/locucaoSchedulePolicy';
import { getFixedScheduleForDay, type FixedSlot } from '@/lib/locucao/fixedScheduleMap';
import type { SequenceConfig, ProgramSchedule } from '@/types/radio';

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
  locStatus: 'allowed' | 'after-news' | 'blocked-program' | 'blocked-time' | 'blocked-day';
  reason: string;
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

  const policy = useMemo(() => loadPolicy(), []);
  const fixedSlots = useMemo(() => getFixedScheduleForDay(selectedDay), [selectedDay]);

  const rows: HourRow[] = useMemo(() => {
    // Build a Date that falls on the selected weekday for policy checks
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
      const programName = slot?.program || scheduled || 'Música livre';

      let locStatus: HourRow['locStatus'] = 'allowed';
      let reason = 'Bloco aberto para LOC';

      if (!dayOk) {
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

      return { hour, programName, fixedSlot: slot, locStatus, reason };
    });
  }, [selectedDay, policy, fixedSlots, programs]);

  const statusBadge = (row: HourRow) => {
    switch (row.locStatus) {
      case 'allowed':
        return (
          <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] gap-1">
            <Mic className="w-3 h-3" /> aceita LOC
          </Badge>
        );
      case 'after-news':
        return (
          <Badge variant="outline" className="bg-sky-500/15 text-sky-400 border-sky-500/30 text-[10px] gap-1">
            <Newspaper className="w-3 h-3" /> após NOTÍCIAS
          </Badge>
        );
      case 'blocked-program':
        return (
          <Badge variant="outline" className="bg-rose-500/15 text-rose-400 border-rose-500/30 text-[10px] gap-1">
            <Ban className="w-3 h-3" /> programa fixo
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

  // Sequência compacta (mostra só os 6 primeiros itens como "padrão")
  const seqPreview = sequence.slice(0, 6);

  // Contadores
  const counts = useMemo(() => {
    const c = { allowed: 0, news: 0, blocked: 0 };
    rows.forEach((r) => {
      if (r.locStatus === 'allowed') c.allowed++;
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
          <div className="flex items-center gap-3 flex-wrap">
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
        </div>
        <div className="flex gap-1 mt-2 flex-wrap">
          <Calendar className="w-4 h-4 text-muted-foreground self-center mr-1" />
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
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((row) => {
            const isLive = row.hour === new Date().getHours() && selectedDay === today;
            return (
              <div
                key={row.hour}
                className={`grid grid-cols-[60px_1fr_auto] gap-3 items-center px-4 py-2 hover:bg-secondary/30 transition-colors ${
                  isLive ? 'bg-primary/10 border-l-2 border-l-primary' : ''
                }`}
                title={row.reason}
              >
                {/* Hora */}
                <div className="flex flex-col">
                  <span className={`font-mono text-base font-bold ${isLive ? 'text-primary' : 'text-foreground'}`}>
                    {row.hour.toString().padStart(2, '0')}:00
                  </span>
                  {isLive && <span className="text-[9px] text-primary uppercase tracking-wide">agora</span>}
                </div>

                {/* Programa + sequência preview */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">{row.programName}</span>
                    {row.fixedSlot?.note && (
                      <span className="text-[10px] text-muted-foreground italic">({row.fixedSlot.note})</span>
                    )}
                  </div>
                  {row.locStatus === 'allowed' || row.locStatus === 'after-news' ? (
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
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
