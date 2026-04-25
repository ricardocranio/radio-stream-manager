/**
 * Mapa documentado dos programas FIXOS por dia da semana, baseado nos templates
 * reais em `useAutoGradeBuilder.ts`, `weekdayTemplates.ts` e `specialPrograms.ts`.
 *
 * Usado pelo guia visual da aba "Agendamento" da Locução IA para o usuário ver
 * exatamente em que blocos a locução pode/não pode entrar.
 */

import type { DayKey } from './locucaoSchedulePolicy';

export interface FixedSlot {
  /** Faixa em formato "HH:MM-HH:MM" (incluindo o último bloco). */
  range: string;
  program: string;
  /** Pode receber LOC? (true = música/abertura; false = bloco fechado). */
  locFriendly: boolean;
  /** Observação curta (ex.: "obrigatório legal"). */
  note?: string;
}

/** Programação seg-sex (mesma estrutura para SEG/TER/QUA/QUI/SEX). */
export const WEEKDAY_FIXED: FixedSlot[] = [
  { range: '00:00-04:30', program: 'Madrugada (música livre)', locFriendly: true },
  { range: '05:00-08:30', program: 'Música livre + Notícias da Hora', locFriendly: true, note: 'LOC entra após NOTICIAS' },
  { range: '09:00-10:30', program: 'Sintonia Total', locFriendly: false, note: 'Bloco fixo (4 blocos)' },
  { range: '11:00-11:30', program: 'Música livre', locFriendly: true },
  { range: '12:00-12:30', program: 'Painel Flashback', locFriendly: false },
  { range: '13:00-16:30', program: 'Música livre + Top 10/Papo Sério', locFriendly: true },
  { range: '17:00-17:30', program: 'Intensidade / Notícia em Foco', locFriendly: true, note: 'após NOTICIAS' },
  { range: '18:00', program: 'Radar de Notícias', locFriendly: false },
  { range: '18:30', program: 'TOP 10 MIX + Esporte', locFriendly: false },
  { range: '19:00-19:30', program: 'Rádio Revista', locFriendly: false },
  { range: '20:00-20:30', program: 'Misturadão', locFriendly: false },
  { range: '21:00', program: 'Voz do Brasil', locFriendly: false, note: 'Obrigatório legal' },
  { range: '22:00-23:30', program: 'Songs of Love', locFriendly: false },
];

/** Programação de SÁBADO — fixa o dia inteiro. */
export const SATURDAY_FIXED: FixedSlot[] = [
  { range: '00:00-07:30', program: 'Música livre FDS', locFriendly: true, note: 'Único intervalo livre' },
  { range: '08:00-09:30', program: 'Shake Mix (4 blocos)', locFriendly: false },
  { range: '10:00-12:30', program: 'Conexão Mix (6 blocos)', locFriendly: false },
  { range: '13:00-17:30', program: 'Mega Mix (8 blocos)', locFriendly: false },
  { range: '18:00-19:30', program: 'Sem Parar (4 blocos)', locFriendly: false },
  { range: '20:00-20:30', program: 'Mega Funk (2 blocos)', locFriendly: false },
  { range: '21:00-22:00', program: 'Gas Total (6 blocos)', locFriendly: false },
  { range: '22:30-23:30', program: 'Amnesia (6 blocos)', locFriendly: false },
];

/** Domingo — sem programa fixo nesta grade, livre o dia inteiro. */
export const SUNDAY_FIXED: FixedSlot[] = [
  { range: '00:00-23:30', program: 'Música livre — domingo aberto', locFriendly: true, note: 'Sem programa fixo' },
];

export function getFixedScheduleForDay(day: DayKey): FixedSlot[] {
  if (day === 'sab') return SATURDAY_FIXED;
  if (day === 'dom') return SUNDAY_FIXED;
  return WEEKDAY_FIXED;
}
