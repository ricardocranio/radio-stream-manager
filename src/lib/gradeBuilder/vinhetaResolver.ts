/**
 * Vinheta Resolver — STUB (Entrega 2)
 *
 * Decisão arquitetural: o software de automação da rádio reconhece e resolve
 * os tokens `vht` e `VHTN` em runtime. Manter os tokens literais nos arquivos
 * `.txt` da grade traz vantagens enormes:
 *
 *   1. Refresh real-time de slots P1 não corre risco de embaralhar a sequência
 *      de vinhetas (ela nunca foi resolvida pelo Lovable).
 *   2. Elimina dependência da pasta `C:\Playlist\Vinhetas` no app.
 *   3. Elimina o scan BPM (economiza I/O e memória).
 *   4. Reduz I/O de disco (arquivos `.txt` mais enxutos e idempotentes).
 *
 * Esta versão mantém a mesma assinatura pública para preservar todas as
 * chamadas existentes (no-op): retorna a linha exatamente como recebida.
 *
 * Para reverter ao comportamento antigo, restaure este arquivo a partir do git
 * (commit anterior à Entrega 2).
 */

/** No-op: mantém `vht` / `VHTN` literais na linha. */
export async function resolveVinhetasInLine(
  line: string,
  _vinhetaFolder: string = 'C:\\Playlist\\Vinhetas',
): Promise<string> {
  return line;
}

/** No-op: mantém todas as linhas como vieram. */
export async function resolveVinhetasInGrade(
  lines: string[],
  _vinhetaFolder: string = 'C:\\Playlist\\Vinhetas',
): Promise<string[]> {
  return lines;
}

/** No-op: nada a resetar (sem pool/cache interno). */
export function resetVinhetaPool(): void {
  // intentionally empty
}
