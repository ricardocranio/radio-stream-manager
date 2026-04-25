import { BookOpen, Radio, FileCode, Music, Download, Clock, Database, Layers, TrendingUp, Mic, Settings, Terminal, Swords, MapIcon, Calendar, BarChart3, AlertTriangle, FolderOpen, Newspaper, ListMusic, Monitor, Wifi } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';

const sections = [
  {
    id: 'overview',
    icon: BookOpen,
    title: 'Visão Geral do Sistema',
    content: `O **Programador Rádio (PGMR)** é um sistema completo de automação para emissoras FM, desenvolvido por Ricardo Amaral / AudioSolutions.

**Principais capacidades:**
- Monitoramento 24/7 de emissoras concorrentes via scraping
- Download automático de músicas captadas (integração Deezer/deemix)
- Geração automática de grades de programação (.TXT)
- Ranking dinâmico TOP 25 com decaimento temporal
- Detecção de tendências e análise competitiva
- Monitor Python para captura contínua em segundo plano
- Acesso remoto via LAN/VPN (porta 8088)

**Arquitetura:** Electron (desktop) + React (interface) + Supabase (banco de dados na nuvem) + Python (monitor de rádio).`,
  },
  {
    id: 'dashboard',
    icon: Monitor,
    title: 'Dashboard',
    content: `O painel principal exibe em tempo real:

- **Saúde dos Serviços** — Status do scraping, downloads, monitor Python e grade builder
- **Capturas por Hora** — Gráfico de barras com volume de capturas nas últimas 24h
- **Alertas Offline** — Emissoras que pararam de responder
- **Duplicatas** — Detector automático de arquivos duplicados na biblioteca
- **Notificações Inteligentes** — Avisos sobre ARL expirado, qualidade inferior, etc.
- **Relatório Semanal** — Resumo automatizado da semana
- **Preview da Grade** — Visualização rápida da grade do dia atual`,
  },
  {
    id: 'stations',
    icon: Radio,
    title: 'Emissoras (Monitoramento)',
    content: `Gerencie as emissoras monitoradas:

- **Adicionar/Editar** emissoras com nome, URL de scraping e estilos musicais
- **Horário de monitoramento** — Defina início/fim e dias da semana para cada emissora
- **Ativar/Desativar** emissoras individualmente
- **Stream URL** — URL opcional para monitoramento por stream (monitor Python)

As emissoras são sincronizadas automaticamente com o banco de dados na nuvem.`,
  },
  {
    id: 'specialmonitoring',
    icon: Calendar,
    title: 'Monitoramento Especial',
    content: `Crie janelas de monitoramento específicas:

- Monitore programas especiais em horários definidos (ex: "Top 10 das 20h às 21h")
- Defina dias da semana específicos
- Cada entrada tem sua própria URL de scraping
- Útil para capturar programas temáticos de emissoras concorrentes`,
  },
  {
    id: 'captured',
    icon: Database,
    title: 'Músicas Capturadas',
    content: `Visualize todas as músicas capturadas pelo monitoramento:

- **Lista completa** com artista, título, emissora e horário
- **Filtros** por emissora, período e status
- **Gráficos** de capturas por emissora e por hora
- **Top Artistas** — Ranking dos artistas mais tocados
- **Estatísticas** — Total de capturas, músicas únicas, emissoras ativas

As capturas são armazenadas no banco de dados com deduplicação automática.`,
  },
  {
    id: 'trends',
    icon: BarChart3,
    title: 'Tendências',
    content: `Análise de tendências musicais:

- **Músicas em alta** — Detecta músicas com crescimento acelerado de execuções
- **Viral Hit Detection** — Identifica possíveis hits virais antes de explodirem
- **Gráficos temporais** — Evolução de execuções ao longo dos dias
- **Comparativo entre emissoras** — Quais músicas estão em mais emissoras simultaneamente`,
  },
  {
    id: 'analytics',
    icon: BarChart3,
    title: 'Analytics',
    content: `Painel analítico avançado:

- **Distribuição por emissora** — Proporção de capturas por emissora
- **Horários de pico** — Quando cada emissora mais toca músicas novas
- **Diversidade musical** — Índice de repetição vs variedade
- **Timeline** — Visualização cronológica das capturas`,
  },
  {
    id: 'competitor',
    icon: Swords,
    title: 'Análise Competitiva',
    content: `Compare sua programação com concorrentes:

- **Músicas exclusivas** — O que cada emissora toca que as outras não tocam
- **Músicas compartilhadas** — Repertório em comum entre emissoras
- **Gaps** — Músicas populares que você ainda não tem
- **Índice de competitividade** — Score comparativo entre emissoras`,
  },
  {
    id: 'sequence',
    icon: ListMusic,
    title: 'Sequência Musical',
    content: `Visualize e edite a sequência musical da programação:

- Ordem das músicas em cada bloco horário
- Intercalação automática entre músicas e vinhetas
- Preview da sequência antes de exportar
- Drag-and-drop para reordenação manual`,
  },
  {
    id: 'schedule',
    icon: Clock,
    title: 'Programação',
    content: `Visão geral da grade de programação:

- **Grade diária** com todos os blocos horários (00:00 a 23:30)
- **Programas especiais** — Shake Mix, Conexão Mix, Mega Mix, Sem Parar, Mega Funk, Gas Total, Amnesia
- **Templates por dia** — Grades diferentes para Segunda-Sexta, Sábado e Domingo
- **Horários de monitoramento** por emissora integrados à grade`,
  },
  {
    id: 'gradebuilder',
    icon: FileCode,
    title: 'Montagem de Grade (Grade Builder)',
    content: `O coração do sistema — geração automática de grades:

**Como funciona:**
1. O sistema consulta as músicas capturadas e a biblioteca local
2. Seleciona músicas baseando-se em: ranking, rotatividade, estilo e BPM
3. Intercala vinhetas (VHT, VHTN) entre as músicas
4. Gera arquivos .TXT (SEG.txt, TER.txt... SÁB.txt, DOM.txt)

**Regras inteligentes:**
- **Cross-day repetition** — Evita repetir músicas do dia anterior
- **BPM-aware** — Transições suaves entre músicas de BPM similar
- **Bloqueio automático** — Músicas na blocklist são excluídas
- **Prioridade P1** — Lançamentos recentes têm prioridade máxima
- **Programas temáticos** — Blocos pré-gravados são inseridos nos horários corretos

**Execução automática:** A grade é reconstruída periodicamente (configurável).`,
  },
  {
    id: 'blockeditor',
    icon: Layers,
    title: 'Editor de Blocos',
    content: `Edite blocos de programação pré-gravados:

- Gerencie blocos como "SHAKE_MIX_BLOCO01_FINAL_DE_SEMANA.MP3"
- Associe blocos a programas específicos
- Configure a rotação de blocos por horário
- Preview de cada bloco antes de incluir na grade`,
  },
  {
    id: 'fixedcontent',
    icon: Newspaper,
    title: 'Conteúdos Fixos',
    content: `Gerencie conteúdos que são baixados automaticamente:

- **Voz do Brasil** — Download automático diário
- **Radioagência Nacional** — Download de boletins da EBC
- **Limpeza automática** — Arquivos antigos são removidos após X dias
- Cada conteúdo tem sua pasta dedicada e rotina de atualização`,
  },
  {
    id: 'mapas',
    icon: MapIcon,
    title: 'Mapas Comerciais',
    content: `Geração de mapas comerciais:

- Parse automático de mapas em formato texto
- Resolução de arquivos de áudio (spots, vinhetas comerciais)
- Integração com a grade de programação
- Exportação em formato compatível com sistemas de automação`,
  },
  {
    id: 'ranking',
    icon: TrendingUp,
    title: 'Ranking TOP 25',
    content: `Sistema de ranking automático:

- **Score dinâmico** — Baseado em frequência de execução nas emissoras monitoradas
- **Decaimento temporal** — Músicas antigas perdem pontos gradualmente
- **Batching** — Atualizações em lote para performance
- **Prioridade P1** — As 25 mais tocadas recebem prioridade máxima na grade
- **Histórico** — Acompanhe a evolução de posição ao longo do tempo`,
  },
  {
    id: 'vozbrasil',
    icon: Mic,
    title: 'A Voz do Brasil',
    content: `Download automático do programa "A Voz do Brasil":

- Scraping automático do site oficial para encontrar o link do dia
- Download com barra de progresso
- Renomeação automática (formato: VOZ_DO_BRASIL_DDMMAAAA.mp3)
- Limpeza de arquivos antigos (configurável)
- Recuperação de arquivos temporários em caso de falha`,
  },
  {
    id: 'locucaoia',
    icon: Sparkles,
    title: 'Locuções IA (NOVO)',
    content: `Geração de anúncios e desanúncios com voz de inteligência artificial (ElevenLabs).

**Como usar:**
1. Acesse a aba **Locuções IA** no menu lateral (grupo Biblioteca).
2. Em **Gerar Locuções**, preencha as 2 músicas, artistas, rádio e (opcional) hora.
3. Clique em **Gerar Anúncio** ou **Gerar Desanúncio** — o áudio aparece com player embutido.
4. Use **Salvar em disco** para gravar manualmente um MP3 na pasta configurada.

**Templates personalizáveis:**
Na aba **Templates**, edite os textos usando variáveis: \`{musica1}\`, \`{artista1}\`, \`{musica2}\`, \`{artista2}\`, \`{radio}\`, \`{hora}\`. As alterações ficam salvas no navegador.

**Voz & Configurações:**
- 14 vozes PT-BR pré-selecionadas (masculinas graves recomendadas para FM).
- Sliders de **Estabilidade**, **Similaridade**, **Estilo** e **Velocidade**.
- Pasta de destino configurável (padrão: \`C:\\Playlist\\Locucoes\`).

**🆕 Auto-save no disco:**
Há um interruptor **"Salvar automaticamente no disco"** (aba Voz & Configurações), **ativado por padrão**.
Quando ligado, cada locução gerada é gravada imediatamente como MP3 na pasta configurada, com nome padrão:
\`ANUNCIO_<rádio>_<data-hora>.mp3\` ou \`DESANUNCIO_<rádio>_<data-hora>.mp3\`.
Você ainda pode regravar manualmente via botão "Salvar em disco". Para desativar (e salvar só sob demanda), desligue o interruptor — a preferência fica memorizada.

**Quando usar:**
- Anúncio: entrada do bloco — apresenta as 2 próximas músicas.
- Desanúncio: saída do bloco — recapitula as 2 músicas que acabaram de tocar.
- Use sob demanda antes de montar a grade ou gerar pacotes especiais.`,
  },
  {
    id: 'missing',
    icon: AlertTriangle,
    title: 'Músicas Faltando',
    content: `Lista de músicas capturadas que não existem na biblioteca local:

- **Detecção automática** — Compara capturas com a biblioteca usando similaridade fuzzy
- **Download automático** — Envia para fila de download do Deezer
- **Threshold configurável** — Ajuste a sensibilidade da correspondência (0.5 a 0.95)
- **Guarda de download** — Previne downloads duplicados e limita taxa

Músicas faltando são o motor principal do download automático.`,
  },
  {
    id: 'folders',
    icon: FolderOpen,
    title: 'Pastas',
    content: `Gerenciamento de pastas do sistema:

- **Pasta de músicas** — Onde ficam os MP3s da biblioteca
- **Pasta de grades** — Onde os arquivos .TXT são salvos
- **Pasta de downloads** — Destino dos downloads do Deezer
- **Subpastas por emissora** — Organização automática por origem
- **Banco Musical** — Estatísticas da biblioteca (total de arquivos, pastas)

Estrutura padrão: C:\\Playlist\\ com subpastas para cada tipo de conteúdo.`,
  },
  {
    id: 'logs',
    icon: Terminal,
    title: 'Logs',
    content: `Central de logs do sistema:

- **Logs do Monitor Python** — Saída em tempo real do processo de captura
- **Status do monitor** — Running, uptime, capturas realizadas
- **Controles** — Iniciar, parar e reiniciar o monitor
- **Auto-restart** — O sistema reinicia o monitor automaticamente em caso de falha`,
  },
  {
    id: 'export',
    icon: Download,
    title: 'Exportar',
    content: `Ferramentas de exportação de dados:

- Exportar capturas em formato CSV/JSON
- Exportar grades geradas
- Exportar ranking atual
- Exportar configurações de emissoras`,
  },
  {
    id: 'settings',
    icon: Settings,
    title: 'Configurações',
    content: `Configurações gerais do sistema:

- **ARL do Deezer** — Token de autenticação para downloads
- **Qualidade de download** — MP3_128, MP3_320 ou FLAC
- **Pastas padrão** — Configurar caminhos de música, grades e downloads
- **Intervalos de scraping** — Frequência do monitoramento
- **Blocklist** — Palavras e músicas bloqueadas
- **Aliases** — Correção automática de nomes de artistas
- **Deemix** — Status, instalação e teste do deemix CLI`,
  },
  {
    id: 'lan',
    icon: Wifi,
    title: 'Acesso Remoto (LAN/VPN)',
    content: `O sistema inclui um servidor HTTP integrado para acesso remoto:

- **Porta 8088** — Acesse de qualquer dispositivo na rede local
- **Paridade total** — Todas as funcionalidades disponíveis remotamente
- **API REST** — Endpoints HTTP mapeados 1:1 com os canais IPC do Electron
- **SPA fallback** — Interface React completa servida remotamente
- **Path traversal protection** — Segurança contra acesso a arquivos fora do dist

Acesse via: http://<IP-DO-DESKTOP>:8088`,
  },
  {
    id: 'architecture',
    icon: Monitor,
    title: 'Arquitetura Técnica',
    content: `**Componentes do sistema:**

| Componente | Tecnologia | Função |
|---|---|---|
| Interface | React 18 + Tailwind | UI responsiva |
| Desktop | Electron | Acesso a disco, notificações, tray |
| Banco de dados | Supabase (PostgreSQL) | Armazenamento na nuvem |
| Monitor | Python | Captura contínua de rádios |
| Downloads | deemix CLI | Downloads do Deezer |
| Edge Functions | Deno (Supabase) | Scraping server-side, classificação IA |

**Fluxo principal:**
1. Monitor Python captura músicas → salva no Supabase
2. App React detecta novas capturas via Realtime
3. Grade Builder seleciona músicas para a programação
4. Músicas faltando entram na fila de download automático
5. Grades .TXT são geradas e salvas na pasta configurada`,
  },
];

export function ManualView() {
  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
          <BookOpen className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground">Manual do Sistema</h2>
          <p className="text-sm text-muted-foreground">Guia completo do Programador Rádio — AudioSolutions</p>
        </div>
        <Badge variant="outline" className="ml-auto text-xs border-primary/30 text-primary">
          v11.0
        </Badge>
      </div>

      <Card className="border-primary/20 bg-card/50">
        <CardContent className="pt-5 pb-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Este manual descreve todas as funcionalidades do <strong className="text-foreground">PGMR — Programador Rádio</strong>.
            Clique em cada seção abaixo para expandir os detalhes.
          </p>
        </CardContent>
      </Card>

      <Accordion type="multiple" className="space-y-2">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <AccordionItem
              key={section.id}
              value={section.id}
              className="border border-border/50 rounded-lg overflow-hidden bg-card/30 hover:bg-card/50 transition-colors"
            >
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-sm font-semibold text-foreground">{section.title}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="prose prose-sm prose-invert max-w-none">
                  {section.content.split('\n\n').map((paragraph, i) => {
                    if (paragraph.startsWith('|')) {
                      const rows = paragraph.split('\n').filter(r => r.trim());
                      const headers = rows[0].split('|').filter(c => c.trim()).map(c => c.trim());
                      const dataRows = rows.slice(2);
                      return (
                        <div key={i} className="overflow-x-auto my-3">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr>
                                {headers.map((h, hi) => (
                                  <th key={hi} className="text-left px-3 py-2 border-b border-border/50 text-primary font-semibold">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {dataRows.map((row, ri) => {
                                const cells = row.split('|').filter(c => c.trim()).map(c => c.trim());
                                return (
                                  <tr key={ri} className="border-b border-border/20">
                                    {cells.map((cell, ci) => (
                                      <td key={ci} className="px-3 py-1.5 text-muted-foreground">{cell}</td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      );
                    }
                    return (
                      <p key={i} className="text-sm text-muted-foreground leading-relaxed my-2 whitespace-pre-line">
                        {paragraph.split(/(\*\*[^*]+\*\*)/).map((part, pi) => {
                          if (part.startsWith('**') && part.endsWith('**')) {
                            return <strong key={pi} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>;
                          }
                          return <span key={pi}>{part}</span>;
                        })}
                      </p>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
