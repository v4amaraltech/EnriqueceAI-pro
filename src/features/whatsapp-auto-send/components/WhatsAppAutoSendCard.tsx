'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { CirclePause, CirclePlay, MessageCircle, Plug, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Progress } from '@/shared/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table';

import { setAutoSendPaused } from '../actions/set-auto-send-paused';
import { queueReasonLabel, type CockpitData, type CockpitNumber } from '../utils/cockpit-summary';

const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Na fila', variant: 'outline' },
  sending: { label: 'Enviando', variant: 'secondary' },
  sent: { label: 'Enviada', variant: 'default' },
  failed: { label: 'Falhou', variant: 'destructive' },
  skipped: { label: 'Pulada', variant: 'secondary' },
  canceled: { label: 'Cancelada', variant: 'secondary' },
};

/**
 * Card do WhatsApp automático na aba "Tarefas do dia" do Cockpit: o número do
 * SDR exibido (limite, fila, pausa) e, sob demanda, a fila de hoje.
 * `data` já vem filtrado para o SDR exibido.
 */
export function WhatsAppAutoSendCard({ data, isOwn }: { data: CockpitData; isOwn: boolean }) {
  const { numbers, queue } = data;
  const [showQueue, setShowQueue] = useState(false);
  const number = numbers[0];

  if (!number) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full flex-col items-start justify-center gap-3 py-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Plug className="h-4 w-4" />
            {isOwn ? 'Você não tem WhatsApp próprio conectado' : 'Este SDR não tem WhatsApp próprio conectado'}
          </div>
          <p className="text-muted-foreground text-xs">
            O envio automático usa só o número do SDR dono do lead. Sem número próprio, os passos automáticos voltam
            para a fila manual.
          </p>
          {isOwn && (
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/integrations">Conectar WhatsApp</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <NumberCard number={number} showOwner={!isOwn} />
      {queue.length > 0 && (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowQueue((v) => !v)}>
          {showQueue ? 'Esconder' : 'Ver'} fila do WhatsApp de hoje ({queue.length})
        </Button>
      )}
      {showQueue && <WhatsAppQueueTable queue={queue} />}
    </div>
  );
}

function WhatsAppQueueTable({ queue }: { queue: CockpitData['queue'] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Fila do WhatsApp de hoje</CardTitle>
        <CardDescription>Primeiro o que ainda vai sair, na ordem; depois o que já aconteceu hoje.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Cadência</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Quando</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.map((row) => {
              const st = STATUS_LABEL[row.status] ?? { label: row.status, variant: 'outline' as const };
              const reason = queueReasonLabel(row.status, row.reason);
              return (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[200px] truncate font-medium">
                    <Link href={`/leads/${row.leadId}`} className="hover:underline">
                      {row.leadName}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate">{row.cadenceName}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <Badge variant={st.variant} className="w-fit">
                        {st.label}
                      </Badge>
                      {reason && <span className="text-muted-foreground text-xs">{reason}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {dateTimeFmt.format(new Date(row.at))}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function NumberCard({ number: n, showOwner }: { number: CockpitNumber; showOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const paused = !!n.pausedAt;
  const used = Math.min(n.sentTodayCounted, n.dailyLimit);
  const pct = n.dailyLimit > 0 ? Math.round((used / n.dailyLimit) * 100) : 0;

  function toggle() {
    startTransition(async () => {
      const result = await setAutoSendPaused({ instanceId: n.instanceId, paused: !paused });
      if (result.success) {
        toast.success(result.data.paused ? 'Envio automático pausado' : 'Envio automático retomado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card data-testid="cockpit-number">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 truncate text-base">
              <MessageCircle className="h-4 w-4 shrink-0 text-green-600" />
              {showOwner ? n.userName : 'Meu WhatsApp'}
            </CardTitle>
            <CardDescription className="truncate">{n.phone ?? 'número não informado'}</CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {n.connected ? (
              <Badge variant="outline" className="gap-1">
                <Wifi className="h-3 w-3" /> Conectado
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <WifiOff className="h-3 w-3" /> Desconectado
              </Badge>
            )}
            {paused && <Badge variant="secondary">Pausado</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Contatos novos hoje</span>
            <span className="font-medium">
              {n.sentTodayCounted} / {n.dailyLimit}
            </span>
          </div>
          <Progress value={pct} aria-label="Uso do limite diário" />
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Na fila" value={n.pending} />
          <Stat label="Enviadas" value={n.sentTodayTotal} />
          <Stat label="Falhas" value={n.failedToday} />
        </div>

        {paused ? (
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Pausado {n.pausedAt ? `às ${timeFmt.format(new Date(n.pausedAt))}` : ''}
            {n.pauseReason ? ` — ${n.pauseReason}` : ''}. Nada sai por este número até retomar.
          </p>
        ) : (
          n.nextAt && (
            <p className="text-muted-foreground text-xs">Próximo envio a partir das {timeFmt.format(new Date(n.nextAt))}</p>
          )
        )}

        <Button variant={paused ? 'default' : 'outline'} size="sm" className="w-full" onClick={toggle} disabled={pending}>
          {paused ? <CirclePlay className="mr-1.5 h-4 w-4" /> : <CirclePause className="mr-1.5 h-4 w-4" />}
          {paused ? 'Retomar envio automático' : 'Pausar envio automático'}
        </Button>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-2 py-1.5">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}
