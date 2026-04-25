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

  // ===================== DOMINGO / SEMANA — fallback genérico =====================
  // Bloco musical livre por padrão (estrutura comum nos templates).
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
