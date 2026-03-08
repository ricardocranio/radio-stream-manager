# 🏗️ Arquitetura do Sistema - Programador de Rádio
## Backup pré-implementação das 5 Fases

**Data:** 2026-03-08  
**Versão:** Pré-Fase 1

---

## 📐 Estrutura Geral

```
App.tsx
├── QueryClientProvider (React Query)
├── ThemeProvider (dark mode)
├── GlobalServicesProvider ← ORQUESTRADOR DE SERVIÇOS
│   ├── AppInitializer
│   │   ├── useCleanStart()
│   │   ├── useSyncStationsFromDb()
│   │   └── useDailyReset()
│   └── Index.tsx (views com lazy loading + persistent tabs)
│       ├── useInitializeFolders()
│       └── useAutoCleanup()
```

---

## 🔧 Serviços de Background (GlobalServicesContext)

| Serviço | Hook | Ciclo | Função |
|---------|------|-------|--------|
| **Grade Builder** | `useAutoGradeBuilder` | X min antes de cada bloco | Gera grade musical automática |
| **Scraping** | `useGlobalScrapingService` | 6 min (escalonado) | Captura músicas das emissoras |
| **Downloads** | `useGlobalDownloadService` | 60s polling | Fila de downloads automáticos |
| **Captured DL** | `useCapturedDownloadService` | 2 min polling | Download de músicas capturadas |
| **Voz do Brasil** | `useVozBrasilService` | Seg-Sex 20:35 | Insere bloco Voz do Brasil |
| **Manutenção** | `useBackgroundMaintenance` | 30 min | IA classify, compressão, stats |
| **Watchdog** | `useServiceWatchdog` | 2 min | Detecta serviços travados |
| **Relatório** | `useDailyReport` | 23:55 diário | Relatório de performance |
| **Cache Cleanup** | `useBackgroundCacheCleanup` | Periódico | Limpa caches antigos |

### Serviços no AppInitializer (fora do GlobalServices)

| Hook | Função |
|------|--------|
| `useCleanStart` | Limpeza inicial ao montar |
| `useSyncStationsFromDb` | Sincroniza emissoras do banco para store |
| `useDailyReset` | Reset automático às 20:00 |

### Hooks na Index.tsx

| Hook | Função |
|------|--------|
| `useInitializeFolders` | Cria pastas necessárias (Electron) |
| `useAutoCleanup` | Limpa dados >24h a cada hora |

---

## 📦 Estado Global (Zustand - radioStore)

Store principal com persist (localStorage):
- `stations`: RadioStation[] — emissoras configuradas
- `capturedSongs`: CapturedSong[] — músicas capturadas
- `config`: SystemConfig — configurações do sistema
- `deezerConfig`: DeezerConfig — config de download
- `ranking`: RankedSong[] — ranking de músicas
- `missingSongs`: MissingSong[] — músicas não encontradas
- `fixedContents`: FixedContent[] — conteúdo fixo
- `schedules`: ScheduledSequence[] — sequências agendadas
- `blockSchedules`: BlockSchedule[] — grades geradas
- `isRunning`: boolean — sistema ativo/pausado

### Stores auxiliares
- `realtimeStatsStore` — stats em tempo real
- `capturedDownloadStore` — fila de downloads capturados
- `autoDownloadStore` — fila de downloads automáticos
- `gradeLogStore` — logs do sistema
- `similarityLogStore` — logs de similaridade

---

## 🔄 Fluxo de Dados Realtime

```
Supabase (scraped_songs) 
  → RealtimeManager (canal centralizado, auto-recovery)
    → useRealtimeNotifications (subscriber estável)
      → RankingBatcher (acumula 30min, max 500)
        → radioStore.applyRankingBatch()
          → RankingDecay (5%/dia, min 0.5)
```

### Módulos de Suporte
- `realtimeManager.ts` — Gerenciador centralizado de canais Realtime (backoff exponencial, max 10 retries)
- `rankingBatcher.ts` — Batch de updates de ranking (flush a cada 30min ou 500 pendentes)
- `rankingDecay.ts` — Decaimento temporal: score = plays × decayFactor (5%/dia)
- `crossDayRepetition.ts` — Buffer de 4h em localStorage para evitar repetição entre dias
- `offlineSongCache.ts` — Cache offline 24h (max 3000 músicas) como fallback
- `downloadMutex.ts` — Mutex para downloads (evita concorrência)
- `libraryVerificationCache.ts` — Cache de verificação de biblioteca

---

## 🗄️ Banco de Dados (Lovable Cloud)

### Tabelas
| Tabela | Propósito | Limite |
|--------|-----------|--------|
| `scraped_songs` | Músicas em tempo real | 300/emissora (trigger probabilístico 10%) |
| `radio_historico` | Arquivo de capturas | 150/emissora (trigger probabilístico 10%) |
| `radio_historico_stats` | Agregados comprimidos | Sem limite |
| `radio_stations` | Emissoras cadastradas | — |
| `special_monitoring` | Monitoramento especial | — |

### Triggers de Proteção
- `prevent_duplicate_songs` — Dedup scraped_songs (5min window)
- `prevent_duplicate_historico` — Dedup historico (10min window)
- `trigger_cleanup_excess_songs` — Limpa excesso scraped (probabilístico)
- `cleanup_radio_historico` — Limpa excesso historico (probabilístico)

### Funções
- `compress_radio_historico()` — Arquiva registros >3 dias em stats agregados
- `cleanup_excess_scraped_songs()` — Limpeza manual de scraped_songs

---

## 🌐 Edge Functions

| Função | Propósito |
|--------|-----------|
| `scrape-radio` | Scraping cloud (OnlineRadioBox → Triton → ICY) |
| `auto-scrape-stations` | Scraping batch de todas emissoras |
| `classify-song` | Classificação IA (gênero/energia) |
| `manage-special-monitoring` | CRUD monitoramento especial |
| `validate-deezer-arl` | Validação de token Deezer |
| `weekly-report` | Relatório semanal de tendências |

---

## 🎨 Views (17 total)

| View | Carregamento |
|------|-------------|
| Dashboard | **Eager** (sempre montado) |
| Stations, Captured, Sequence, Schedule, GradeBuilder, BlockEditor, FixedContent, Ranking, Trends, VozBrasil, SpecialMonitoring, Logs, Export, Folders, Missing, Settings | **Lazy** (persistent tabs) |

---

## 🛡️ Mecanismos de Resiliência

1. **Cache Offline** — localStorage com 24h de músicas capturadas
2. **Cross-Day Buffer** — 4h de buffer para anti-repetição entre dias
3. **Watchdog** — Detecta serviços parados (threshold: 20min)
4. **Heartbeat** — Cada serviço reporta atividade via `reportServiceHeartbeat()`
5. **RealtimeManager** — Auto-recovery com backoff exponencial (max 30s)
6. **RankingBatcher** — Processamento em lote para evitar sobrecarga
7. **Triggers probabilísticos** — Limpeza de banco com 10% chance por insert
8. **Singleton guard** — `isGlobalServicesRunning` evita duplicação de serviços

---

## ⚠️ Pontos Críticos (NÃO ALTERAR)

1. **GlobalServicesContext** — Singleton, roda uma vez, gerencia lifecycle de todos os serviços
2. **radioStore persist** — Estado persistido em localStorage, migração cuidadosa
3. **RealtimeManager** — Canal centralizado, subscriber IDs estáveis
4. **Triggers de banco** — Dedup e cleanup são essenciais para performance
5. **Lazy loading + PersistentTabPanel** — Otimização de performance das views

---

*Este documento serve como referência para as 5 fases de melhoria. Qualquer alteração deve ser aditiva e manter compatibilidade com a arquitetura existente.*
