/**
 * Editor da política de agendamento da Locução IA:
 *   • Dias da semana permitidos (sábado fica fora por padrão — grade fixa o dia inteiro)
 *   • Whitelist de horários permitidos (HH:MM)
 *   • Blacklist de programas fixos
 *   • Tokens de "Notícias da hora" → LOC entra logo APÓS
 *   • Guia visual: programação fixa por dia da semana
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Plus, RotateCcw, Clock, Ban, Newspaper, CalendarDays, ListChecks } from 'lucide-react';
import {
  DEFAULT_POLICY, loadPolicy, savePolicy,
  DAY_KEYS, DAY_LABELS, type DayKey, type LocucaoSchedulePolicy,
} from '@/lib/locucao/locucaoSchedulePolicy';
import { getFixedScheduleForDay } from '@/lib/locucao/fixedScheduleMap';
import { toast } from 'sonner';

const HOUR_PRESETS = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '22:00', '23:00'];

export function LocucaoSchedulePolicyEditor() {
  const [policy, setPolicy] = useState<LocucaoSchedulePolicy>(() => loadPolicy());
  const [newTime, setNewTime] = useState('');
  const [newProgram, setNewProgram] = useState('');
  const [newToken, setNewToken] = useState('');
  const [guideDay, setGuideDay] = useState<DayKey>('seg');

  useEffect(() => { savePolicy(policy); }, [policy]);

  const toggleDay = (d: DayKey) => {
    setPolicy(p => {
      const has = p.allowedDays.includes(d);
      const next = has ? p.allowedDays.filter(x => x !== d) : [...p.allowedDays, d];
      return { ...p, allowedDays: DAY_KEYS.filter(k => next.includes(k)) };
    });
  };

  const addTime = (raw: string) => {
    const t = raw.trim();
    if (!/^\d{2}:\d{2}$/.test(t)) {
      toast.error('Formato inválido. Use HH:MM (ex.: 14:00).');
      return;
    }
    if (policy.allowedTimes.includes(t)) return;
    setPolicy(p => ({ ...p, allowedTimes: [...p.allowedTimes, t].sort() }));
    setNewTime('');
  };

  const removeTime = (t: string) => setPolicy(p => ({ ...p, allowedTimes: p.allowedTimes.filter(x => x !== t) }));

  const addProgram = () => {
    const v = newProgram.trim();
    if (!v) return;
    if (policy.blockedPrograms.some(x => x.toLowerCase() === v.toLowerCase())) return;
    setPolicy(p => ({ ...p, blockedPrograms: [...p.blockedPrograms, v] }));
    setNewProgram('');
  };

  const removeProgram = (v: string) => setPolicy(p => ({ ...p, blockedPrograms: p.blockedPrograms.filter(x => x !== v) }));

  const addToken = () => {
    const v = newToken.trim().toUpperCase();
    if (!v) return;
    if (policy.newsTokens.includes(v)) return;
    setPolicy(p => ({ ...p, newsTokens: [...p.newsTokens, v] }));
    setNewToken('');
  };

  const removeToken = (v: string) => setPolicy(p => ({ ...p, newsTokens: p.newsTokens.filter(x => x !== v) }));

  const guideSlots = getFixedScheduleForDay(guideDay);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            🎯 Política de Agendamento da Locução
          </CardTitle>
          <CardDescription>
            Define ONDE e QUANDO o LOC/LOC_END pode ser inserido automaticamente nos blocos da grade.
            Posição manual (openPos/closePos) sempre vence; estas regras só atuam quando você não fixa posição.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-3 bg-muted/20">
            <div className="space-y-0.5 pr-4">
              <Label className="text-sm font-medium">Política ativa</Label>
              <p className="text-xs text-muted-foreground">
                Desligado = qualquer bloco aceita LOC, sem restrição.
              </p>
            </div>
            <Switch checked={policy.enabled} onCheckedChange={v => setPolicy(p => ({ ...p, enabled: v }))} />
          </div>
        </CardContent>
      </Card>

      {/* DIAS PERMITIDOS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-400" />
            Dias da semana permitidos
          </CardTitle>
          <CardDescription className="text-xs">
            Apenas blocos que caírem nestes dias receberão LOC. <strong>Sábado fica fora por padrão</strong> porque a grade
            é tomada por programas fixos o dia inteiro (Shake Mix → Mega Mix → Sem Parar → ... → Amnesia).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {DAY_KEYS.map(d => {
              const active = policy.allowedDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`px-2 py-2 rounded-md text-xs font-semibold border transition-all ${
                    active
                      ? 'bg-blue-500/20 border-blue-500/60 text-blue-200'
                      : 'bg-muted/20 border-border/40 text-muted-foreground hover:border-red-500/40'
                  }`}
                >
                  <div className="text-[10px] uppercase opacity-70">{d}</div>
                  <div className="text-sm">{DAY_LABELS[d]}</div>
                  <div className="text-[10px] mt-0.5">{active ? '✓ permite' : '⛔ bloqueia'}</div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* GUIA VISUAL DA GRADE */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-fuchsia-400" />
            Guia: programação fixa por dia
          </CardTitle>
          <CardDescription className="text-xs">
            Visão dos blocos reais gerados pelo construtor de grade. <span className="text-emerald-400">Verde</span> = LOC pode entrar;
            <span className="text-red-400"> vermelho</span> = bloco fixo (não recomendado).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {DAY_KEYS.map(d => (
              <button
                key={d}
                onClick={() => setGuideDay(d)}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  guideDay === d
                    ? 'bg-fuchsia-500/25 border-fuchsia-500/60 text-fuchsia-200'
                    : 'bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {DAY_LABELS[d]}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-border/40 bg-muted/10 divide-y divide-border/30">
            {guideSlots.map((slot, i) => (
              <div key={i} className="flex items-start gap-3 p-2">
                <div className="font-mono text-[11px] w-28 shrink-0 text-foreground">{slot.range}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{slot.program}</div>
                  {slot.note && <div className="text-[10px] text-muted-foreground italic">{slot.note}</div>}
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] ${
                    slot.locFriendly
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-red-500/40 bg-red-500/10 text-red-300'
                  }`}
                >
                  {slot.locFriendly ? '✓ aceita LOC' : '⛔ fixo'}
                </Badge>
              </div>
            ))}
          </div>

          {guideDay === 'sab' && (
            <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2">
              💡 Sábado tem programação fixa o dia inteiro (exceto 00:00–07:30). Por isso o padrão é deixar
              sábado fora dos dias permitidos. Se quiser locuções de madrugada, ative o sábado e adicione
              só os horários 00:00–07:30 na whitelist abaixo.
            </div>
          )}
          {guideDay === 'dom' && (
            <div className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded p-2">
              💡 Domingo está livre o dia inteiro nesta grade — locução pode entrar em qualquer bloco musical.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Whitelist horários */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-400" />
            Horários permitidos (whitelist)
          </CardTitle>
          <CardDescription className="text-xs">
            Apenas blocos cujo horário esteja nesta lista receberão LOC. <strong>Vazio = todos os horários permitidos.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="time"
              value={newTime}
              onChange={e => setNewTime(e.target.value)}
              className="w-36"
              placeholder="HH:MM"
            />
            <Button size="sm" onClick={() => addTime(newTime)} disabled={!newTime}>
              <Plus className="w-3 h-3 mr-1" /> Adicionar
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Atalhos</Label>
            <div className="flex flex-wrap gap-1">
              {HOUR_PRESETS.map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => addTime(h)}
                  disabled={policy.allowedTimes.includes(h)}
                  className="px-2 py-0.5 rounded text-[11px] font-mono border border-border bg-muted/30 hover:bg-emerald-500/15 hover:border-emerald-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Permitidos ({policy.allowedTimes.length || 'todos'})
            </Label>
            <div className="flex flex-wrap gap-1.5 min-h-[32px] rounded-md border border-border/40 bg-muted/10 p-2">
              {policy.allowedTimes.length === 0 ? (
                <span className="text-[11px] italic text-muted-foreground">Sem restrição de horário.</span>
              ) : policy.allowedTimes.map(t => (
                <Badge key={t} variant="outline" className="gap-1 border-emerald-500/40 text-emerald-300 bg-emerald-500/10">
                  {t}
                  <button onClick={() => removeTime(t)} className="hover:text-red-400" aria-label={`Remover ${t}`}>
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Blacklist programas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Ban className="w-4 h-4 text-red-400" />
            Programas fixos bloqueados (blacklist)
          </CardTitle>
          <CardDescription className="text-xs">
            Blocos cujo nome do programa contenha qualquer um destes termos NÃO receberão LOC. Match parcial e case-insensitive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newProgram}
              onChange={e => setNewProgram(e.target.value)}
              placeholder="Ex.: Sintonia Total"
              onKeyDown={e => { if (e.key === 'Enter') addProgram(); }}
            />
            <Button size="sm" onClick={addProgram} disabled={!newProgram.trim()}>
              <Plus className="w-3 h-3 mr-1" /> Adicionar
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 min-h-[32px] rounded-md border border-border/40 bg-muted/10 p-2">
            {policy.blockedPrograms.length === 0 ? (
              <span className="text-[11px] italic text-muted-foreground">Nenhum programa bloqueado.</span>
            ) : policy.blockedPrograms.map(p => (
              <Badge key={p} variant="outline" className="gap-1 border-red-500/40 text-red-300 bg-red-500/10">
                {p}
                <button onClick={() => removeProgram(p)} className="hover:text-red-400" aria-label={`Remover ${p}`}>
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tokens notícias */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-amber-400" />
            Tokens de "Notícias da hora"
          </CardTitle>
          <CardDescription className="text-xs">
            Quando você não fixa posição manual, o LOC entra <strong>imediatamente APÓS</strong> o último destes tokens
            encontrado no bloco. Use exatamente como aparecem na grade (UPPERCASE).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newToken}
              onChange={e => setNewToken(e.target.value.toUpperCase())}
              placeholder="Ex.: NOTICIAS"
              className="font-mono uppercase"
              onKeyDown={e => { if (e.key === 'Enter') addToken(); }}
            />
            <Button size="sm" onClick={addToken} disabled={!newToken.trim()}>
              <Plus className="w-3 h-3 mr-1" /> Adicionar
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 min-h-[32px] rounded-md border border-border/40 bg-muted/10 p-2">
            {policy.newsTokens.length === 0 ? (
              <span className="text-[11px] italic text-muted-foreground">Nenhum token configurado — LOC usa posição 1 por padrão.</span>
            ) : policy.newsTokens.map(t => (
              <Badge key={t} variant="outline" className="gap-1 border-amber-500/40 text-amber-300 bg-amber-500/10 font-mono">
                {t}
                <button onClick={() => removeToken(t)} className="hover:text-red-400" aria-label={`Remover ${t}`}>
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setPolicy(DEFAULT_POLICY); toast.info('Política restaurada para os padrões.'); }}
        >
          <RotateCcw className="w-3 h-3 mr-1" /> Restaurar padrões
        </Button>
      </div>
    </div>
  );
}
