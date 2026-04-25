import { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { resolveLocucao, type ResolvedLocucao } from '@/lib/locucao/locucaoResolver';

interface Props {
  source: 'LOC' | 'LOC_END';
  className?: string;
  label: string;
}

/**
 * Hover-preview badge for LOC / LOC_END tokens in the sequence editor.
 * Shows the resolved text + the voice/preset that will be used right now.
 */
export function LocucaoBadgePopover({ source, className, label }: Props) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<ResolvedLocucao | null>(null);

  // Recompute on each open so it always reflects the latest config + time.
  useEffect(() => {
    if (open) setInfo(resolveLocucao(source));
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
        className="w-96 text-xs space-y-2"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="font-semibold text-fuchsia-400">{kindLabel}</div>
        {info && (
          <>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Texto que será falado</div>
              <div className="bg-muted/40 rounded p-2 text-foreground leading-relaxed">{info.text}</div>
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
              Edite o texto/variáveis em <span className="text-fuchsia-400">Locução IA → Editor LOC</span>.
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
