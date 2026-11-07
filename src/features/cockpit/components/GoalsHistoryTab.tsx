'use client';

import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';
import { CalendarCheck, Info, Plus, Search, Trophy } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import { GoalsModal } from '@/features/dashboard/components/GoalsModal';

import type { CockpitGoalsData } from '../services/cockpit-goals.service';
import { formatMonthLabel, monthEndBrt } from '../utils/month';
import { MonthNav } from './MonthNav';

const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

interface GoalsHistoryTabProps {
  data: CockpitGoalsData;
  maxMonth: string;
  canEditGoals: boolean;
}

export function GoalsHistoryTab({ data, maxMonth, canEditGoals }: GoalsHistoryTabProps) {
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const pct = data.heldTarget > 0 ? Math.round((data.held / data.heldTarget) * 100) : 0;
  const noShowRate = data.scheduled > 0 ? Math.round((data.noShows / data.scheduled) * 100) : 0;
  const isCurrent = data.month === maxMonth;

  const meetings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.meetings;
    return data.meetings.filter((m) => `${m.company} ${m.closerName ?? ''}`.toLowerCase().includes(q));
  }, [data.meetings, search]);

  const rawMonth = formatMonthLabel(data.month).split(' ')[0] ?? '';
  const monthName = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Histórico de metas</h2>
        <MonthNav month={data.month} maxMonth={maxMonth} />
      </div>

      <section className="space-y-5 rounded-lg border bg-[var(--card)] p-5">
        <div className="flex items-start justify-between gap-4">
          <p className="flex items-center gap-1.5 text-sm">
            Meta de {monthName}
            <span title="Meta individual de reuniões realizadas do mês (definida pelo gestor).">
              <Info className="text-muted-foreground h-3.5 w-3.5" />
            </span>
          </p>
          {isCurrent && <Countdown until={monthEndBrt(data.month)} />}
        </div>

        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border">
            <Trophy className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold tabular-nums">
                {data.held}/{data.heldTarget}
              </span>
              {canEditGoals && (
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => setGoalsOpen(true)}>
                  <Plus className="mr-1 h-3 w-3" /> Meta
                </Button>
              )}
            </div>
            <div className="text-muted-foreground text-xs">Reuniões realizadas</div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--muted)]">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div className="text-muted-foreground flex justify-between text-[11px] tabular-nums">
            <span>0</span>
            <span>{data.heldTarget}</span>
          </div>
        </div>

        <div className="text-muted-foreground flex flex-wrap justify-center gap-x-6 gap-y-1 border-t pt-4 text-xs">
          <Legend dot="bg-emerald-500" value={data.held} label="Reuniões realizadas" />
          <Legend dot="bg-emerald-500" value={`${pct}%`} label="Meta alcançada" />
          <Legend value={data.scheduled} label="Agendadas" />
          <Legend value={`${noShowRate}%`} label={`Taxa de no-show (${data.noShows})`} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            Reuniões realizadas <span className="rounded border px-1.5 text-xs font-normal tabular-nums">{data.meetings.length}</span>
          </h3>
          <div className="relative w-full md:w-80">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por lead ou closer"
              className="pl-8"
              aria-label="Buscar reunião"
            />
          </div>
        </div>

        <div className="rounded-lg border bg-[var(--card)]">
          {meetings.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-md border">
                <CalendarCheck className="h-4 w-4" />
              </span>
              <p className="text-sm font-semibold">Nenhuma reunião realizada</p>
              <p className="text-muted-foreground text-xs">
                {data.meetings.length === 0 ? 'Ainda não há reuniões realizadas neste mês.' : 'Nada encontrado com essa busca.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-medium">
                <tr className="border-b">
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Closer</th>
                  <th className="px-4 py-3">Data da reunião</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.leadId} className="border-b last:border-b-0 hover:bg-[var(--accent)]/40">
                    <td className="px-4 py-2.5 text-xs font-medium">
                      <Link href={`/leads/${m.leadId}`} className="hover:underline">
                        {m.company}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs">{m.closerName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{dateTimeFmt.format(new Date(m.meetingAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {canEditGoals && <GoalsModal open={goalsOpen} onOpenChange={setGoalsOpen} month={data.month} />}
    </div>
  );
}

function Legend({ dot, value, label }: { dot?: string; value: number | string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
      <span className="font-semibold text-[var(--foreground)] tabular-nums">{value}</span> {label}
    </span>
  );
}

/** Cronômetro até o fim do mês (BRT). Só aparece depois de montar, para não divergir do servidor. */
function Countdown({ until }: { until: Date }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  if (now === null) return null;
  const left = Math.max(0, until.getTime() - now);
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);

  return (
    <div className="flex gap-1" aria-label="Tempo até o fim do mês">
      {[
        [d, 'D'],
        [h, 'H'],
        [m, 'M'],
        [s, 'S'],
      ].map(([v, u]) => (
        <span key={u} className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500 tabular-nums">
          {v}
          {u}
        </span>
      ))}
    </div>
  );
}
