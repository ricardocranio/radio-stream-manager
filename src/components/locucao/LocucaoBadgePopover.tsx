import { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { resolveLocucao, resolveLocucaoAsync, type ResolvedLocucao } from '@/lib/locucao/locucaoResolver';

interface Props {
  source: 'LOC' | 'LOC_END';
  className?: string;
  label: string;
}

/**
 * Hover-preview badge for LOC / LOC_END tokens in the sequence editor.
 * Mostra o texto resolvido + a voz/preset ativa + as variáveis aplicadas
 * (musica1/artista1/musica2/artista2/hora/...). Usa o MESMO pipeline da
 * geração real, lendo o próximo bloco da grade do dia quando disponível.
 */
export function LocucaoBadgePopover({ source, className, label }: Props) {
  const [open, setOpen] = useState(false);
  // Render imediato com último cache; em paralelo busca dados frescos.
  const [info, setInfo] = useState<ResolvedLocucao | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInfo(resolveLocucao(source));
    setRefreshing(true);
    resolveLocucaoAsync(source)
      .then(setInfo)
      .finally(() => setRefreshing(false));
  }, [open, source]);

  const kindLabel = source === 'LOC' ? '🎙️ Abertura (LOC)' : '🎙️ Fechamento (LOC_END)';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge
          variant="outline"
          className={`${className} cursor-help`}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {label}
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-[28rem] text-xs space-y-2"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="flex items-center justify-between">
          <div className="font-semibold text-fuchsia-400">{kindLabel}</div>
          {refreshing && (
            <span className="text-[10px] text-muted-foreground italic">atualizando…</span>
          )}
        </div>

        {info && (
          <>
            {(info.blockTime || info.blockProgram) && (
              <div className="text-[10px] text-muted-foreground">
                Bloco fonte: <span className="text-foreground font-medium">{info.blockTime || '—'}</span>
                {info.blockProgram && <> · <span>{info.blockProgram}</span></>}
              </div>
            )}

            {info.policyStatus && (
              <div className={`text-[10px] rounded p-1.5 border ${info.policyStatus.allowed ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-red-500/40 bg-red-500/10 text-red-300'}`}>
                {info.policyStatus.allowed ? (
                  info.policyStatus.autoOpenPosFromNews
                    ? <>✓ Bloco permitido · LOC auto entra <strong>após NOTÍCIAS</strong> (posição {info.policyStatus.autoOpenPosFromNews}).</>
                    : <>✓ Bloco permitido pela política de agendamento.</>
                ) : (
                  <>⛔ {info.policyStatus.reason || 'Bloco bloqueado pela política.'}</>
                )}
              </div>
            )}

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Texto que será falado
              </div>
              <div className="bg-muted/40 rounded p-2 text-foreground leading-relaxed whitespace-pre-wrap">
                {info.text}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Variáveis aplicadas
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 bg-muted/20 rounded p-2 font-mono text-[10.5px]">
                {Object.entries(info.vars).map(([k, v]) => (
                  <div key={k} className="flex gap-1 truncate" title={`${k} = ${v}`}>
                    <span className="text-fuchsia-400">{`{${k}}`}</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="text-foreground truncate">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Voz ativa</div>
                <div className="font-medium">{info.voiceLabel}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Origem</div>
                <div className="font-medium capitalize">
                  {info.origin === 'dia' ? '📅 Voz por dia' : info.origin === 'período' ? '🕐 Voz por período' : '🌐 Voz global'}
                </div>
                <div className="text-[10px] text-muted-foreground">{info.presetLabel}</div>
              </div>
            </div>

            <div className="pt-1 border-t border-border text-[10px] text-muted-foreground italic">
              Edite texto/variáveis em <span className="text-fuchsia-400">Locução IA → Editor LOC</span>.
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
