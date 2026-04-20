---
name: P1 Real-time Refresh + Lock 30 min (Entrega 2)
description: Slots P1 dinâmicos são atualizados em tempo real até 30 min antes do bloco; depois disso ficam congelados.
type: feature
---
A partir da Entrega 2, slots P1 (dinâmicos) podem ser refrescados até **30 minutos antes** do bloco ir ao ar. A janela é controlada pela constante `P1_REFRESH_LOCK_MINUTES` em `src/hooks/useAutoGradeBuilder.ts`.

**Como funciona:**
1. O `runGradeTick` roda continuamente (debounce 1.5s para eventos realtime + polling 30s de segurança).
2. Quando um bloco entra na janela `≤ 30min`, ele é **adicionado ao `builtBlocksRef`** (lock) — nunca mais será reescrito naquele ciclo.
3. Programas fixos e tokens VHT/VHTN não são afetados (vinhetas são tokens literais — ver `vinheta-tokens-literal`).
4. Logs `[P1-REFRESH]` permitem auditar o ciclo de refresh/lock no console.

**Salvaguardas:**
- Idempotência via `builtBlocksRef` (já existente, agora também usado para lock 30min).
- O conteúdo só é gravado em disco se o hash mudou (`lastWrittenContentHashRef`).
- Caso o canal realtime caia, o polling fallback de 30s garante continuidade.
