/**
 * Retorna as POSIÇÕES REAIS do template da grade (.txt) para um par dia/hora.
 *
 * Espelha 1:1 a lógica de `useAutoGradeBuilder.ts`:
 *   - Sábado: blocos FDS (SHAKE_MIX, CONEXAO_MIX, MEGA_MIX, SEM_PARAR,
 *     MEGA_FUNK, GAS, AMNESIA) + blocos musicais 00-07
 *   - Demais dias: futuramente expandir conforme necessidade. Por ora caímos
 *     pra um template musical genérico (mus + vht).
 *
 * Cada posição é um TOKEN do template: pode ser `mus`, `vht`, `VHTN`, `fun`,
 * ou um arquivo fixo entre aspas. É o mesmo conjunto de itens que aparece
 * no .txt final que o player de automação consome.
 */

import type { DayKey } from './locucaoSchedulePolicy';

export interface GradePosition {
  position: number;
  /** Token bruto do template (ex: 'mus', 'vht', 'VHTN', '"SHAKE_MIX_BLOCO01_FINAL_DE_SEMANA.MP3"'). */
  token: string;
  /** Tipo derivado pra estilização e legenda. */
  kind: 'mus' | 'vht' | 'vhtn' | 'fun' | 'fixed';
  /** Nome amigável pra exibição (ex: "SHAKE_MIX 01" ou "música"). */
  label: string;
}

interface BuildArgs {
  day: DayKey;
  hour: number;
  /** Minuto do bloco (0 ou 30). Padrão 0. */
  minute?: number;
}

/** Remove aspas pra exibição. */
function unquote(s: string): string {
  return s.replace(/^"|"$/g, '');
}

function classifyToken(token: string): { kind: GradePosition['kind']; label: string } {
  const t = token.trim();
  const lower = t.toLowerCase();
  if (lower === 'mus') return { kind: 'mus', label: 'música' };
  if (lower === 'vht') return { kind: 'vht', label: 'vinheta' };
  if (lower === 'vhtn') return { kind: 'vhtn', label: 'vinheta N' };
  if (lower === 'fun') return { kind: 'fun', label: 'funk' };
  // Arquivo fixo
  const clean = unquote(t).replace(/\.MP3$/i, '');
  // Encurta nome bonito
  let label = clean
    .replace(/_FINAL_DE_SEMANA/i, '')
    .replace(/_/g, ' ')
    .trim();
  if (label.length > 22) label = label.slice(0, 20) + '…';
  return { kind: 'fixed', label };
}

function tokenize(rawSequence: string): string[] {
  // Suporta tokens entre aspas com vírgulas e tokens simples
  const out: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (const ch of rawSequence) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      buf += ch;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Constrói a string da sequência (mesmas regras do useAutoGradeBuilder). */
function buildRawSequence({ day, hour, minute = 0 }: BuildArgs): string | null {
  const ts = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  // ===================== SÁBADO =====================
  if (day === 'sab') {
    // 00:00–07:30 — Bloco musical com tamanhos variáveis
    if (hour <= 7) {
      const longBlocks = new Set([
        '00:00', '01:00', '02:30', '03:30', '04:30', '06:00', '07:00',
      ]);
      const musShort =
        'mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus';
      const musLong =
        'mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,VHT,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus';
      return longBlocks.has(ts) ? musLong : musShort;
    }
    // 08:00–09:30 — SHAKE MIX
    if (hour === 8 || (hour === 9 && minute <= 30)) {
      const map: Record<string, number> = { '08:00': 1, '08:30': 2, '09:00': 3, '09:30': 4 };
      const ed = (map[ts] || 1).toString().padStart(2, '0');
      return `"SHAKE_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3",vht,mus,vht,mus`;
    }
    // 10:00–12:30 — CONEXÃO MIX
    if (hour === 10 || hour === 11 || (hour === 12 && minute <= 30)) {
      const map: Record<string, number> = {
        '10:00': 1, '10:30': 2, '11:00': 3, '11:30': 4, '12:00': 5, '12:30': 8,
      };
      const ed = (map[ts] || 1).toString().padStart(2, '0');
      const vhtPre = ts === '10:30' ? 'MUS' : 'VHTN';
      return `VHTN,"CONEXAO_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3",${vhtPre},mus,vht,mus`;
    }
    // 13:00–17:30 — MEGA MIX
    if (hour >= 13 && hour <= 17) {
      const map: Record<string, number> = {
        '13:00': 1, '13:30': 2, '14:00': 3, '15:30': 4,
        '16:00': 5, '16:30': 6, '17:00': 7, '17:30': 8,
      };
      const blk = map[ts];
      if (blk) {
        const ed = blk.toString().padStart(2, '0');
        return `"MEGA_MIX_BLOCO${ed}_FINAL_DE_SEMANA.MP3",VHTN,mus,vht,mus`;
      }
      return 'mus,vht,mus,vht,mus,vht,mus,vht,mus';
    }
    // 18:00–19:30 — SEM PARAR
    if (hour === 18 || hour === 19) {
      const map: Record<string, number> = { '18:00': 1, '18:30': 2, '19:00': 3, '19:30': 4 };
      const blk = map[ts] || 1;
      const ed = blk.toString().padStart(2, '0');
      const vhtPost = blk === 4 ? '' : ',VHTN';
      return `VHTN,"SEM_PARAR_BLOCO${ed}_FINAL_DE_SEMANA.MP3"${vhtPost},mus,vht,mus`;
    }
    // 20:00–20:30 — MEGA FUNK
    if (hour === 20) {
      if (minute === 0) {
        return 'VHTN,"MEGA_FUNK_BLOCO01_FINAL_DE_SEMANA.MP3",VHTN,"MEGA_FUNK_BLOCO02_FINAL_DE_SEMANA.MP3",fun,vhtn,fun,vhtn';
      }
      return 'VHTN,"MEGA_FUNK_BLOCO03_FINAL_DE_SEMANA.MP3",VHTN,"MEGA_FUNK_BLOCO04_FINAL_DE_SEMANA.MP3",fun,vhtn,fun,vhtn';
    }
    // 21:00–22:00 — GAS TOTAL
    if (hour === 21 || (hour === 22 && minute === 0)) {
      const map: Record<string, number> = { '21:00': 1, '21:30': 2, '22:00': 3 };
      const pair = map[ts] || 1;
      const b1 = ((pair - 1) * 2 + 1).toString().padStart(2, '0');
      const b2 = ((pair - 1) * 2 + 2).toString().padStart(2, '0');
      return `vht,"Gas Total _ bloco ${b1}.mp3",vht,"Gas Total _ bloco ${b2}.mp3"`;
    }
    // 22:30–23:30 — AMNESIA
    if ((hour === 22 && minute === 30) || hour === 23) {
      const map: Record<string, number> = { '22:30': 1, '23:00': 2, '23:30': 3 };
      const pair = map[ts] || 1;
      const b1 = ((pair - 1) * 2 + 1).toString().padStart(2, '0');
      const b2 = ((pair - 1) * 2 + 2).toString().padStart(2, '0');
      return `vht,"Amnesia _ bloco ${b1}.mp3",vht,"Amnesia _ bloco ${b2}.mp3"`;
    }
    return null;
  }

  // ===================== SEMANA (SEG–SEX) =====================
  const isWeekday = day === 'seg' || day === 'ter' || day === 'qua' || day === 'qui' || day === 'sex';
  if (isWeekday) {
    const dayName = day === 'seg' ? 'SEGUNDA'
      : day === 'ter' ? 'TERCA'
      : day === 'qua' ? 'QUARTA'
      : day === 'qui' ? 'QUINTA'
      : 'SEXTA';

    // 09:00 — Sintonia Total bloco 01
    if (hour === 9 && minute === 0) {
      return `vht,"NOTICIA_DA_HORA_09HORAS_${dayName}.mp3","Sintonia Total _ bloco 01.mp3","HOROSCOPO_DO_DIA_EDICAO01_${dayName}.mp3",vht,"Sintonia Total _ bloco 02.mp3",vht,mus,vht,mus,vht`;
    }
    if (hour === 9 && minute === 30) {
      return `vht,"FIQUE_SABENDO_EDICAO01_${dayName}.mp3","Sintonia Total _ bloco 03.mp3","HOROSCOPO_DO_DIA_EDICAO02_${dayName}.mp3",vht,"Sintonia Total _ bloco 04.mp3",vht,mus,vht,mus,vht`;
    }
    if (hour === 10 && minute === 0) {
      return `vht,"NOTICIA_DA_HORA_10HORAS_${dayName}.mp3","Sintonia Total _ bloco 05.mp3","HOROSCOPO_DO_DIA_EDICAO03_${dayName}.mp3",vht,"Sintonia Total _ bloco 06.mp3",vht,mus,vht,mus,vht`;
    }
    if (hour === 10 && minute === 30) {
      return `vht,"FIQUE_SABENDO_EDICAO02_${dayName}.mp3","Sintonia Total _ bloco 07.mp3","HOROSCOPO_DO_DIA_EDICAO04_${dayName}.mp3",vht,"Sintonia Total _ bloco 08.mp3",vht,mus,vht,mus,vht`;
    }

    // 12:00–12:30 — Painel Flashback
    if (hour === 12 && minute === 0) {
      return `vht,"NOTICIA_DA_HORA_12HORAS_${dayName}.mp3","painel flashback _ bloco 01.mp3",vht,"AS_ULTIMAS_DO_ESPORTE_EDICAO01_${dayName}.mp3","painel flashback _ bloco 02.mp3",vht`;
    }
    if (hour === 12 && minute === 30) {
      return `vht,"AS_ULTIMAS_DO_ESPORTE_EDICAO02_${dayName}.mp3","painel flashback _ bloco 03.mp3",vht,"FATOS_E_BOATOS_EDICAO01_${dayName}.mp3",vht,"painel flashback _ bloco 04.mp3",vht`;
    }

    // 13:00–13:30 — Top 10 / Papo Sério
    if (hour === 13 && minute === 0) {
      return `vht,"NOTICIA_DA_HORA_13HORAS_${dayName}.mp3","Top 10 _ bloco 01.mp3",vht,"PAPO_SERIO_${dayName}.mp3","Top 10 _ bloco 02.mp3"`;
    }
    if (hour === 13 && minute === 30) {
      return `vht,"Top 10 _ bloco 03.mp3",vht,"CURIOSIDADES_${dayName}.mp3",mus,vht,mus,vht`;
    }

    // 17:00–17:30 — Intensidade / Notícia em Foco
    if (hour === 17 && minute === 0) {
      return `vht,"NOTICIA_DA_HORA_17HORAS_${dayName}.mp3","intensidade _ bloco 01.mp3","noticia em foco _ bloco 01.mp3",vht,"intensidade _ bloco 02.mp3",vht,"noticia em foco _ bloco 02.mp3"`;
    }
    if (hour === 17 && minute === 30) {
      return `vht,"noticia em foco _ bloco 03.mp3",vht,"intensidade _ bloco 03.mp3",vht,"noticia em foco _ bloco 04.mp3"`;
    }

    // 18:00 — Radar de Notícias
    if (hour === 18 && minute === 0) {
      return `vht,"Radar De Noticias _ bloco 01.mp3",mus,vht,"Radar De Noticias _ bloco 02.mp3",mus,vht,"Radar De Noticias _ bloco 03.mp3",vht,mus,vht,"Radar De Noticias _ bloco 04.mp3",vht,mus`;
    }
    // 18:30 — TOP 10 MIX + Esporte
    if (hour === 18 && minute === 30) {
      return `vht,"NOTICIA_DA_HORA_18HORAS_${dayName}.mp3","TOP_10_MIX_BLOCO01_${dayName}.mp3",vht,"AS_ULTIMAS_DO_ESPORTE_EDICAO01_${dayName}.mp3",vht,"TOP_10_MIX_BLOCO02_${dayName}.mp3","AS_ULTIMAS_DO_ESPORTE_EDICAO02_${dayName}.mp3"`;
    }

    // 19:00–19:30 — Rádio Revista
    if (hour === 19 && minute === 0) {
      return `vht,"NOTICIA_DA_HORA_16HORAS_${dayName}.mp3","radio revista _ bloco 01.mp3","radio revista _ bloco 02.mp3"`;
    }
    if (hour === 19 && minute === 30) {
      return `vht,"radio revista _ bloco 03.mp3","radio revista _ bloco 04.mp3"`;
    }

    // 20:00–20:30 — Misturadão V2
    if (hour === 20 && minute === 0) {
      return `vht,"NOTICIA_DA_HORA_15HORAS_${dayName}.mp3",vht,"MISTURADAO_BLOCO01_${dayName}.mp3","FIQUE_SABENDO_EDICAO01_${dayName}.mp3",vht,"MISTURADAO_BLOCO02_${dayName}.mp3"`;
    }
    if (hour === 20 && minute === 30) {
      return `vht,"MISTURADAO_BLOCO03_${dayName}.mp3","FIQUE_SABENDO_EDICAO02_${dayName}.mp3","MISTURADAO_BLOCO04_${dayName}.mp3",mus,vht,mus`;
    }

    // 21:00 — Voz do Brasil (60 min, ocupa 21:30 também)
    if (hour === 21 && minute === 0) {
      return `vht,"vozbrasil.mp3"`;
    }
    if (hour === 21 && minute === 30) {
      // Bloco absorvido pela Voz do Brasil — sem conteúdo próprio
      return null;
    }

    // 22:00–23:30 — Songs of Love
    if (hour === 22 && minute === 0) {
      return `vht,"songs of love _ bloco 01.mp3",rom,vht,rom`;
    }
    if (hour === 22 && minute === 30) {
      return `vht,"songs of love _ bloco 02.mp3",rom,vht,rom`;
    }
    if (hour === 23 && minute === 0) {
      return `vht,"songs of love _ bloco 03.mp3",vht,"songs of love _ bloco 04.mp3",rom`;
    }
    if (hour === 23 && minute === 30) {
      return `vht,"songs of love _ bloco 05.mp3",vht,"songs of love _ bloco 06.mp3",rom`;
    }

    // Demais horários — bloco musical livre
    return 'mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus';
  }

  // ===================== DOMINGO — fallback genérico =====================
  return 'mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus,vht,mus';
}

/**
 * Resolve as posições da grade real para um (dia, hora). Retorna [] se nada
 * estiver definido (caller pode então cair pra sequência configurada).
 */
export function getRealGradePositions(args: BuildArgs): GradePosition[] {
  const raw = buildRawSequence(args);
  if (!raw) return [];
  const tokens = tokenize(raw);
  return tokens.map((token, i) => {
    const c = classifyToken(token);
    return { position: i + 1, token, kind: c.kind, label: c.label };
  });
}

/** ID sintético no formato `radioSource` para reaproveitar a UI existente. */
export function gradePosToRadioSource(p: GradePosition): string {
  // Prefixos ajudam a colorir/diferenciar no UI:
  //   grade_mus / grade_vht / grade_vhtn / grade_fun / grade_fixed:NOME
  if (p.kind === 'fixed') return `grade_fixed:${p.label}`;
  return `grade_${p.kind}`;
}
