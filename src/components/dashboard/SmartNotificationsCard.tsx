/**
 * Phase 1: Smart Notifications Card
 * Shows viral hits and repertoire shifts on the dashboard
 */

import { Bell, BellOff, Flame, TrendingUp, RefreshCw, X, ChevronDown, ChevronUp, Loader2, Shuffle } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useViralHitDetection, SmartNotification, ViralHit, RepertoireShift } from '@/hooks/useViralHitDetection';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function SmartNotificationsCard() {
  const { notifications, viralHits, isChecking, lastCheck, dismissNotification, dismissAll, refresh } = useViralHitDetection();
  const [expanded, setExpanded] = useState(true);

  const activeCount = notifications.length;

  return (
    <Card className="glass-card border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-transparent">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Bell className="w-4 h-4 text-amber-500" />
            </div>
            Notificações Inteligentes
            {activeCount > 0 && (
              <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 text-[10px]">
                {activeCount} {activeCount === 1 ? 'alerta' : 'alertas'}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            {lastCheck && (
              <span className="text-[10px] text-muted-foreground mr-2">
                Última: {format(lastCheck, 'HH:mm', { locale: ptBR })}
              </span>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh} disabled={isChecking}>
              {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
            {activeCount > 0 && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={dismissAll} title="Dispensar todos">
                <BellOff className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      {expanded && (
        <CardContent className="pt-0">
          {activeCount === 0 && viralHits.length === 0 ? (
            <div className="text-center py-4">
              <Bell className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">Nenhum alerta no momento</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Hits virais e mudanças de repertório aparecerão aqui
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Viral Hits Summary */}
              {viralHits.length > 0 && (
                <div className="p-2 rounded-lg bg-muted/30 border border-border">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    🔥 Hits Virais — Últimas 24h
                  </p>
                  <ScrollArea className="max-h-40">
                    <div className="space-y-1.5">
                      {viralHits.slice(0, 10).map((hit, i) => (
                        <ViralHitRow key={i} hit={hit} rank={i + 1} />
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Active Notifications */}
              {notifications.length > 0 && (
                <div className="space-y-1.5">
                  {notifications.slice(0, 5).map(notif => (
                    <NotificationRow key={notif.id} notification={notif} onDismiss={dismissNotification} />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function ViralHitRow({ hit, rank }: { hit: ViralHit; rank: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono text-[10px] text-muted-foreground w-4 text-right">{rank}.</span>
      {hit.trend === 'exploding' ? (
        <Flame className="w-3.5 h-3.5 text-red-500 shrink-0" />
      ) : (
        <TrendingUp className="w-3.5 h-3.5 text-amber-500 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <span className="text-foreground font-medium truncate block">
          {hit.artist} — {hit.title}
        </span>
      </div>
      <Badge variant="outline" className={`text-[9px] shrink-0 ${
        hit.trend === 'exploding' ? 'border-red-500/40 text-red-400' : 'border-amber-500/40 text-amber-400'
      }`}>
        {hit.stationCount} rádios
      </Badge>
    </div>
  );
}

function NotificationRow({ notification, onDismiss }: { notification: SmartNotification; onDismiss: (id: string) => void }) {
  const isShift = notification.type === 'repertoire_shift';
  const shiftData = notification.data as RepertoireShift | undefined;

  return (
    <div className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${
      notification.severity === 'critical'
        ? 'bg-red-500/5 border-red-500/20'
        : notification.severity === 'warning'
        ? 'bg-amber-500/5 border-amber-500/20'
        : 'bg-blue-500/5 border-blue-500/20'
    }`}>
      {isShift ? (
        <Shuffle className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
      ) : (
        <Flame className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{notification.title}</p>
        <p className="text-muted-foreground">{notification.description}</p>
        {isShift && shiftData && shiftData.newArtists && (
          <div className="flex flex-wrap gap-1 mt-1">
            {shiftData.newArtists.map((a, i) => (
              <Badge key={i} variant="outline" className="text-[9px] border-blue-500/30 text-blue-400">
                {a}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => onDismiss(notification.id)}>
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
}
