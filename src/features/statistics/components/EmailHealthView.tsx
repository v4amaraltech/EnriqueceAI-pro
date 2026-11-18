import { AlertTriangle, CheckCircle2, Clock, Send, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import type {
  BounceLevel,
  EmailHealthData,
  MailboxHealthRow,
  MailboxStatus,
  WorkerHealth,
} from '../types/email-health.types';

const fmt = (n: number) => n.toLocaleString('pt-BR');

function formatBrt(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function sinceLabel(iso: string | null, now: Date): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

const BOUNCE_STYLE: Record<BounceLevel, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  small_sample: 'text-[var(--muted-foreground)] dark:text-[var(--foreground)]',
  no_data: 'text-[var(--muted-foreground)] dark:text-[var(--foreground)]',
};

const STATUS_LABEL: Record<MailboxStatus, string> = {
  connected: 'Conectada',
  reconnect: 'Precisa reconectar',
  paused: 'Pausada',
  unknown: '—',
};

const STATUS_STYLE: Record<MailboxStatus, string> = {
  connected: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  reconnect: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  paused: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300',
  unknown: 'text-[var(--muted-foreground)] dark:text-[var(--foreground)]',
};

function BounceCell({ row }: { row: MailboxHealthRow }) {
  if (row.bounceLevel === 'no_data') return <span className={BOUNCE_STYLE.no_data}>—</span>;
  return (
    <span
      className={cn('rounded px-1.5 py-0.5 font-medium', BOUNCE_STYLE[row.bounceLevel])}
      title={row.bounceLevel === 'small_sample' ? 'Amostra pequena: menos de 30 leads no período' : undefined}
    >
      {row.bounceRate}% · {fmt(row.bouncedLeads)}
      {row.bounceLevel === 'small_sample' && ' (amostra pequena)'}
    </span>
  );
}

function WorkerLine({ worker, now }: { worker: WorkerHealth; now: Date }) {
  const Icon = worker.stale ? XCircle : CheckCircle2;
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          worker.stale ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400',
        )}
      />
      <div>
        <p className="font-medium">{worker.label}</p>
        <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          {worker.stale
            ? `Parado — último sucesso ${worker.lastSuccessAt ? `${formatBrt(worker.lastSuccessAt)} (${sinceLabel(worker.lastSuccessAt, now)})` : 'nunca registrado'}`
            : worker.expectedNow
              ? `Rodando — último sucesso ${formatBrt(worker.lastSuccessAt)}`
              : `Fora do horário — último sucesso ${formatBrt(worker.lastSuccessAt)}`}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'warn' }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{label}</p>
      <p
        className={cn(
          'text-xl font-bold',
          tone === 'bad' && 'text-red-600 dark:text-red-400',
          tone === 'warn' && 'text-amber-700 dark:text-amber-300',
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function EmailHealthView({ data, now = new Date() }: { data: EmailHealthData; now?: Date }) {
  const { engine } = data;
  const overdueTone = engine.overdueCount > 0 ? (engine.inSendingHours ? 'bad' : 'warn') : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Saúde do e-mail</h1>
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Se os e-mails automáticos das cadências estão saindo, falhando ou dando bounce, por caixa. Conta só e-mails de
          cadência enviados pelo Gmail; bounce e resposta contam 1 por lead.
        </p>
      </div>

      {/* Motor agora */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-1 text-lg font-semibold">Motor agora</h2>
        <p className="mb-4 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Situação de hoje, sem os filtros da barra lateral.
        </p>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            {engine.workers.map((w) => (
              <WorkerLine key={w.jobName} worker={w} now={now} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Enviados hoje" value={fmt(engine.sentToday)} />
            <Stat label="Falhas hoje" value={fmt(engine.failedToday)} tone={engine.failedToday > 0 ? 'warn' : undefined} />
            <Stat label="Automáticos vencidos" value={fmt(engine.overdueCount)} tone={overdueTone} />
          </div>
        </div>
        {engine.overdueCount > 0 && (
          <p
            className={cn(
              'mt-4 flex items-center gap-2 text-sm',
              engine.inSendingHours ? 'text-red-600 dark:text-red-400' : 'text-[var(--muted-foreground)] dark:text-[var(--foreground)]',
            )}
          >
            {engine.inSendingHours ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            {engine.inSendingHours
              ? `${fmt(engine.overdueCount)} e-mail(s) automático(s) vencido(s) há mais de 30 min e ainda não enviado(s) — o mais antigo venceu ${sinceLabel(engine.oldestOverdueAt, now)}.`
              : `${fmt(engine.overdueCount)} e-mail(s) automático(s) aguardando o próximo horário de envio (seg–sex, 8h–18h).`}
          </p>
        )}
      </section>

      {/* Por caixa */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-1 text-lg font-semibold">Por caixa</h2>
        <p className="mb-4 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Bounce = leads com bounce ÷ leads que receberam e-mail da caixa no período. Amarelo acima de 3%, vermelho acima
          de 5% (com pelo menos 30 leads).
        </p>
        {data.mailboxes.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Nenhuma caixa encontrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caixa</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Hoje / limite</TableHead>
                  <TableHead className="text-right">Enviados</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Bounce</TableHead>
                  <TableHead className="text-right">Responderam</TableHead>
                  <TableHead className="text-right">Falhas</TableHead>
                  <TableHead>Último envio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.mailboxes.map((m) => (
                  <TableRow key={m.key}>
                    <TableCell>
                      <p className="font-medium">{m.email}</p>
                      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{m.ownerName}</p>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[m.status])}
                        title={m.pausedReason ?? undefined}
                      >
                        {STATUS_LABEL[m.status]}
                      </span>
                      {m.status === 'paused' && m.pausedReason && (
                        <p className="mt-1 max-w-56 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                          {m.pausedReason}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(m.sentToday)} / {m.dailyCap === null ? 'sem limite' : fmt(m.dailyCap)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(m.sent)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(m.emailedLeads)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <BounceCell row={m} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(m.repliedLeads)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', m.failed > 0 && 'font-medium text-amber-700 dark:text-amber-300')}>
                      {fmt(m.failed)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatBrt(m.lastSentAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Tendência */}
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-1 text-lg font-semibold">Últimos 14 dias úteis</h2>
          <p className="mb-4 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Todas as caixas (respeita os filtros de SDR e cadência). Bounce e resposta pelo primeiro registro do lead.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dia</TableHead>
                <TableHead className="text-right">
                  <Send className="mr-1 inline h-3 w-3" />
                  Enviados
                </TableHead>
                <TableHead className="text-right">Falhas</TableHead>
                <TableHead className="text-right">Bounces</TableHead>
                <TableHead className="text-right">Respostas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.trend.map((d) => (
                <TableRow key={d.date}>
                  <TableCell>{d.label}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', d.sent === 0 && 'text-[var(--muted-foreground)]')}>
                    {fmt(d.sent)}
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums', d.failed > 0 && 'text-amber-700 dark:text-amber-300')}>
                    {fmt(d.failed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(d.bounced)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(d.replied)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        {/* Falhas */}
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-1 text-lg font-semibold">Falhas por motivo</h2>
          <p className="mb-4 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">No período selecionado.</p>
          {data.failureReasons.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Nenhuma falha no período.</p>
          ) : (
            <ul className="space-y-2">
              {data.failureReasons.map((f) => (
                <li key={f.reason} className="flex items-center justify-between gap-4 text-sm">
                  <span>{f.reason}</span>
                  <span className="font-semibold tabular-nums">{fmt(f.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
