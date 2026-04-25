/**
 * Constrói a linha .txt de um bloco a partir de uma `HourOverride.sequence`
 * editada pelo usuário no Grade 24h.
 *
 * Cada posição da sequência vira um item da linha, na ordem definida:
 *   - `grade_mus` / `grade_vht` / `grade_vhtn` / `grade_fun` / `grade_rom`
 *     → emite o token literal (`mus`, `vht`, `VHTN`, `fun`, `rom`).
 *   - `grade_fixed:<label>` (com `rawToken` preservando o nome real do .mp3)
 *     → emite o filename original entre aspas.
 *   - `LOC` / `LOC_END` → marcador literal.
 *   - id de estação / `genre_*` / `random_pop` → seleciona uma música via
 *     `selectSongForSlot` (mesmas regras P0-P6, anti-repetição etc.).
 *   - `customFileName` → emite o filename (com aspas) diretamente.
 *
 * O resultado segue o mesmo formato `HH:MM (ID=PROG) item1,item2,...`.
 */
import type { HourOverride } from '@/lib/locucao/locucaoSchedulePolicy';
import type { SequenceConfig } from '@/types/radio';
import type { BlockResult, BlockLogItem, GradeContext, SongEntry, BlockStats } from './types';
import { selectSongForSlot } from './songSelection';
import { sanitizeGradeLine } from './sanitize';

export interface OverrideBlockArgs {
  hour: number;
  minute: number;
  programName: string;
  override: HourOverride;
  songsByStation: Record<string, SongEntry[]>;
  ctx: GradeContext;
  filterChars: string[];
  isFullDay: boolean;
}

interface InternalSelectionContext {
  timeStr: string;
  isFullDay: boolean;
  usedInBlock: Set<string>;
  usedArtistsInBlock: Set<string>;
  songsByStation: Record<string, SongEntry[]>;
  allSongsPool: SongEntry[];
  carryOverByStation: Record<string, SongEntry[]>;
  stationSongIndex: Record<string, number>;
  logs: BlockLogItem[];
  stats: BlockStats;
}

function isGradeToken(rs: string): boolean {
  return rs === 'grade_mus' || rs === 'grade_vht' || rs === 'grade_vhtn' ||
         rs === 'grade_fun' || rs === 'grade_rom' || rs.startsWith('grade_fixed:');
}

function tokenForGrade(rs: string, rawToken?: string): string {
  // Preferir o rawToken bruto (preserva caixa exata e arquivos fixos)
  if (rawToken && rawToken.trim().length > 0) return rawToken;
  switch (rs) {
    case 'grade_mus': return 'mus';
    case 'grade_vht': return 'vht';
    case 'grade_vhtn': return 'VHTN';
    case 'grade_fun': return 'fun';
    case 'grade_rom': return 'rom';
    default: {
      if (rs.startsWith('grade_fixed:')) {
        const label = rs.slice('grade_fixed:'.length).trim();
        // Se label não terminar com .mp3, anexamos
        const fname = /\.mp3$/i.test(label) ? label : `${label}.mp3`;
        return `"${fname}"`;
      }
      return 'mus';
    }
  }
}

export async function buildBlockFromOverride(args: OverrideBlockArgs): Promise<BlockResult | null> {
  const { hour, minute, programName, override, songsByStation, ctx, filterChars, isFullDay } = args;
  const seq = override.sequence;
  if (!seq || seq.length === 0) return null;

  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const items: string[] = [];
  const blockLogs: BlockLogItem[] = [];

  // SelectionContext compartilhado para honrar anti-repetição dentro do bloco
  const usedInBlock = new Set<string>();
  const usedArtistsInBlock = new Set<string>();
  const stationSongIndex: Record<string, number> = {};
  const allSongsPool: SongEntry[] = [];
  for (const list of Object.values(songsByStation)) allSongsPool.push(...list);

  const selCtx: InternalSelectionContext = {
    timeStr, isFullDay, usedInBlock, usedArtistsInBlock,
    songsByStation, allSongsPool, carryOverByStation: {}, stationSongIndex,
    logs: blockLogs, stats: { used: 0, missing: 0, substituted: 0 } as unknown as BlockStats,
  };

  for (const pos of seq) {
    const rs = pos.radioSource;

    // 1) Tokens da Grade (mus/vht/vhtn/fun/rom/fixed)
    if (isGradeToken(rs)) {
      items.push(tokenForGrade(rs, pos.rawToken));
      continue;
    }

    // 2) Marcadores LOC
    if (rs === 'LOC' || rs === 'LOC_END') {
      items.push(rs);
      continue;
    }

    // 3) Custom filename direto (file_*)
    if (pos.customFileName && pos.customFileName.trim().length > 0) {
      const f = pos.customFileName.trim();
      const fn = /\.mp3$/i.test(f) ? f : `${f}.mp3`;
      items.push(`"${fn}"`);
      continue;
    }
    if (rs.startsWith('file_')) {
      const f = rs.slice('file_'.length);
      const fn = /\.mp3$/i.test(f) ? f : `${f}.mp3`;
      items.push(`"${fn}"`);
      continue;
    }

    // 4) Conteúdo fixo (fixo_*) — emite o nome do conteúdo como arquivo
    if (rs.startsWith('fixo')) {
      // Sem dados aqui pra resolver dia/edição — emite placeholder cru.
      items.push(rs);
      continue;
    }

    // 5) Estação / gênero / random — usa seletor padrão
    const seqEntry: SequenceConfig = { position: pos.position, radioSource: rs } as any;
    try {
      const songStr = await selectSongForSlot(seqEntry, selCtx, ctx);
      if (songStr && songStr.length > 0) {
        items.push(songStr);
      } else {
        items.push('mus'); // fallback
      }
    } catch (e) {
      console.warn(`[OVERRIDE-BLOCK] Falha ao selecionar pos ${pos.position} (${rs}):`, e);
      items.push('mus');
    }
  }

  if (items.length === 0) return null;

  const lineContent = items.join(',');
  return {
    line: sanitizeGradeLine(`${timeStr} (ID=${programName}) ${lineContent}`, filterChars),
    logs: blockLogs,
    durationMinutes: undefined,
  };
}
