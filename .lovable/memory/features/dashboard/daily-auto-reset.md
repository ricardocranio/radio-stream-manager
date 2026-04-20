---
name: Daily Auto Reset 01:00
description: Reset automático diário às 01:00 reusando o handler "Zerar Sistema" — idempotente, com catch-up no boot e preservação de configurações.
type: feature
---

O sistema executa o reset completo automaticamente todo dia às **01:00** via `useDailyAutoReset` (registrado em `GlobalServicesContext`). Reusa `executeFullSystemReset` (extraída para `src/lib/systemReset.ts`) — mesma função do botão manual.

**Comportamento:**
- Verifica a cada 1 minuto; só dispara se `hour === 1` e ainda não rodou hoje (guard via `pgmr_daily_auto_reset_last_run` em localStorage).
- **Catch-up no boot**: se o app abrir após 01:00 e o reset não foi executado naquele dia, dispara 30s após o boot.
- **Defaults seguros automáticos**: `clearSupabase: true`, `clearSchedules: false`, `resetStations: false` (preserva monitoramentos e mantém emissoras ativas).
- Preserva: config, deezerConfig, songAliases, stations, fixedContent, sequence, scheduledSequences, programs, mapasConfig, autoScrapeEnabled.
- Reporta heartbeat ao watchdog (`daily-auto-reset`) e exibe toast informativo.
