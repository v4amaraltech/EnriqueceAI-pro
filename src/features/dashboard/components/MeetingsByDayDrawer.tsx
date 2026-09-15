'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { Skeleton } from '@/shared/components/ui/skeleton';

import type { ActionResult } from '@/lib/actions/action-result';

import { getMeetingsByDayLeads, type GetMeetingsByDayLeadsInput } from '../actions/get-meetings-by-day-leads';
import type { DashboardFilters, MeetingDayLead, MeetingDaySeries, MeetingsByDayLeads } from '../types';
import { RM_COLOR, RR_COLOR } from './MeetingsByDayChart';

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function brtParts(iso: string): { day: string; month: string; time: string } {
  const d = new Date(new Date(iso).getTime() - BRT_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    day: pad(d.getUTCDate()),
    month: pad(d.getUTCMonth() + 1),
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** RM: só a hora (o dia é o da barra). RR: data e hora da reunião. */
export function formatMeetingAt(iso: string, series: MeetingDaySeries): string {
  const p = brtParts(iso);
  return series === 'scheduled' ? p.time : `${p.day}/${p.month} ${p.time}`;
}

export interface MeetingsByDayDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dia do mês clicado; `null` = nada selecionado. */
  day: number | null;
  /** Série clicada — define qual seção vem primeiro. */
  series: MeetingDaySeries;
  /** Mês YYYY-MM do gráfico (título). */
  month: string;
  /** Mesmos filtros da página — o painel cai no mesmo universo dos cards. */
  filters: DashboardFilters;
  /** userId → nome, vindo dos rankings (todo lead das listas tem SDR no ranking). */
  sdrNames: Map<string, string>;
  /** Fonte dos dados — só pra vitrine/teste; em produção é a server action. */
  load?: (input: GetMeetingsByDayLeadsInput) => Promise<ActionResult<MeetingsByDayLeads>>;
}

const SECTION_META: Record<MeetingDaySeries, { title: string; color: string; empty: string; timeLabel: string }> = {
  scheduled: {
    title: 'Marcadas (RM)',
    color: RM_COLOR,
    empty: 'Nenhuma reunião marcada neste dia',
    timeLabel: 'Marcou às',
  },
  held: {
    title: 'Realizadas (RR)',
    color: RR_COLOR,
    empty: 'Nenhuma reunião realizada neste dia',
    timeLabel: 'Reunião em',
  },
};

function LeadRows({
  leads,
  series,
  sdrNames,
}: {
  leads: MeetingDayLead[];
  series: MeetingDaySeries;
  sdrNames: Map<string, string>;
}) {
  const meta = SECTION_META[series];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          <th className="pb-2 pr-3 font-medium">Empresa</th>
          <th className="pb-2 pr-3 font-medium">SDR</th>
          <th className="pb-2 text-right font-medium">{meta.timeLabel}</th>
        </tr>
      </thead>
      <tbody>
        {leads.map((lead) => (
          <tr key={lead.leadId} className="border-b border-[var(--border)] last:border-0">
            <td className="py-2 pr-3">
              {/* Nome da empresa = nome fantasia, com razão social de reserva —
                  mesma regra do painel do lead (LeadInfoPanel.companyName). Em
                  prod ~90% dos leads com reunião só têm nome fantasia. */}
              <Link href={`/leads/${lead.leadId}`} className="text-[var(--primary)] hover:underline">
                {lead.nomeFantasia ?? lead.razaoSocial ?? '—'}
              </Link>
              {lead.nomeFantasia && lead.razaoSocial && lead.nomeFantasia !== lead.razaoSocial && (
                <p className="text-xs text-[var(--muted-foreground)]">{lead.razaoSocial}</p>
              )}
            </td>
            <td className="py-2 pr-3">
              {lead.sdrId ? (sdrNames.get(lead.sdrId) ?? lead.sdrId.slice(0, 8)) : '—'}
            </td>
            <td className="py-2 text-right tabular-nums">{formatMeetingAt(lead.at, series)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({
  series,
  leads,
  sdrNames,
}: {
  series: MeetingDaySeries;
  leads: MeetingDayLead[];
  sdrNames: Map<string, string>;
}) {
  const meta = SECTION_META[series];
  return (
    <section data-slot={`meetings-day-section-${series}`} className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: meta.color }} />
        {meta.title}
        <span className="text-xs font-normal text-[var(--muted-foreground)]">({leads.length})</span>
      </h4>
      {leads.length === 0 ? (
        <p className="py-3 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{meta.empty}</p>
      ) : (
        <LeadRows leads={leads} series={series} sdrNames={sdrNames} />
      )}
    </section>
  );
}

export function MeetingsByDayDrawer({
  open,
  onOpenChange,
  day,
  series,
  month,
  filters,
  sdrNames,
  load = getMeetingsByDayLeads,
}: MeetingsByDayDrawerProps) {
  const [result, setResult] = useState<MeetingsByDayLeads | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || day === null) return;
    setResult(null);
    setError(null);
    startTransition(async () => {
      const res = await load({ filters, day });
      if (res.success) {
        setResult(res.data);
      } else {
        setError(res.error);
      }
    });
    // `filters` é recriado a cada render da página; o que muda de verdade entre
    // aberturas é o dia + os valores dos filtros (já embutidos na URL/render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day, month, filters.month, filters.dateFrom, filters.dateTo, filters.cadenceIds.join(','), filters.userIds.join(',')]);

  const label = day !== null ? `${String(day).padStart(2, '0')}/${month.slice(5, 7)}` : '';
  const order: MeetingDaySeries[] = series === 'held' ? ['held', 'scheduled'] : ['scheduled', 'held'];
  const loading = isPending || (open && day !== null && result === null && error === null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl w-full flex flex-col" data-slot="meetings-by-day-drawer">
        <SheetHeader>
          <SheetTitle>Reuniões de {label}</SheetTitle>
          <SheetDescription asChild>
            <span className="text-sm text-muted-foreground">
              {loading ? (
                <Skeleton className="inline-block h-4 w-40" />
              ) : result ? (
                `${result.scheduled.length} ${result.scheduled.length === 1 ? 'marcada' : 'marcadas'} · ${result.held.length} ${result.held.length === 1 ? 'realizada' : 'realizadas'}`
              ) : (
                'Leads por trás das barras deste dia'
              )}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-auto px-4 pb-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="py-6 text-center text-sm text-[var(--destructive)]">{error}</p>
          ) : result ? (
            order.map((s) => <Section key={s} series={s} leads={result[s]} sdrNames={sdrNames} />)
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
