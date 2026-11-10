'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Eye,
  LogIn,
  PhoneCall,
  PhoneOutgoing,
  Search,
  UserX,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

import type { CockpitLeadsData } from '../services/cockpit-leads.service';
import { LEAD_STAGES, leadStageLabel, type LeadStageKey, type LeadTemperature } from '../utils/lead-insights';
import { type PortfolioFilters, type PortfolioPeriod } from '../utils/portfolio-period';

const STAGE_ICON: Record<LeadStageKey, typeof Building2> = {
  desqualificado: UserX,
  entrada: LogIn,
  tentativa: PhoneOutgoing,
  conexao: PhoneCall,
  sql: CalendarClock,
  no_show: CalendarX,
  sal: CalendarCheck,
};

const STAGE_BADGE: Record<LeadStageKey, string> = {
  desqualificado: 'border-zinc-500/40 text-zinc-400',
  entrada: 'border-sky-500/40 text-sky-500',
  tentativa: 'border-amber-500/40 text-amber-500',
  conexao: 'border-orange-500/40 text-orange-400',
  sql: 'border-emerald-500/40 text-emerald-500',
  no_show: 'border-red-500/40 text-red-500',
  sal: 'border-violet-500/40 text-violet-400',
};

const TEMPERATURE: Record<LeadTemperature, { label: string; className: string }> = {
  quente: { label: 'Quente', className: 'border-red-500/50 text-red-500' },
  morno: { label: 'Morno', className: 'border-amber-500/50 text-amber-500' },
  frio: { label: 'Frio', className: 'border-sky-500/50 text-sky-500' },
};

const PERIOD_OPTIONS: Array<{ key: PortfolioPeriod | null; label: string }> = [
  { key: null, label: 'Tudo' },
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'month', label: 'Este mês' },
  { key: 'custom', label: 'Personalizado' },
];

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

export function LeadsTab({ data, search, filters }: { data: CockpitLeadsData; search: string; filters: PortfolioFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(search);

  function hrefWith(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    return `${pathname}?${params.toString()}`;
  }

  // Busca no servidor com atraso curto (cada busca volta para a página 1).
  useEffect(() => {
    if (query.trim() === search) return;
    const timer = setTimeout(() => router.replace(hrefWith({ q: query.trim() || null, page: null })), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.perPage));
  const firstRow = data.total === 0 ? 0 : (data.page - 1) * data.perPage + 1;
  const lastRow = Math.min(data.page * data.perPage, data.total);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-base font-semibold">Carteira</h2>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Período da carteira">
            {PERIOD_OPTIONS.map(({ key, label }) => {
              const active = filters.period === key;
              return (
                <Link
                  key={label}
                  href={hrefWith(key === 'custom'
                    ? { period: 'custom', page: null }
                    : key
                      ? { period: key, from: null, to: null, page: null }
                      : { period: null, from: null, to: null, page: null })}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs',
                    active ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
        {filters.period === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5">
              De
              <input
                type="date"
                value={filters.from ?? ''}
                aria-label="De"
                onChange={(event) => router.replace(hrefWith({ period: 'custom', from: event.target.value || null, page: null }))}
                className="border-input h-8 rounded-md border bg-transparent px-2"
              />
            </label>
            <label className="flex items-center gap-1.5">
              Até
              <input
                type="date"
                value={filters.to ?? ''}
                aria-label="Até"
                onChange={(event) => router.replace(hrefWith({ period: 'custom', to: event.target.value || null, page: null }))}
                className="border-input h-8 rounded-md border bg-transparent px-2"
              />
            </label>
          </div>
        )}
        {data.stageCounts && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            {LEAD_STAGES.map(({ key, label }) => {
              const Icon = STAGE_ICON[key];
              const active = filters.stage === key;
              return (
                <Link
                  key={key}
                  href={hrefWith({ stage: active ? null : key, page: null })}
                  aria-current={active ? 'true' : undefined}
                  data-testid={`stage-${key}`}
                  className={cn(
                    'rounded-lg border bg-[var(--card)] p-4 text-left',
                    active && 'ring-2 ring-[var(--foreground)]',
                  )}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md border">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="mt-3 text-2xl font-semibold tabular-nums">{data.stageCounts?.[key] ?? 0}</div>
                  <div className="text-muted-foreground text-xs">{label}</div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          Meus Leads <span className="rounded border px-1.5 text-xs font-normal tabular-nums">{data.total}</span>
          {filters.stage && (
            <Button asChild variant="outline" size="sm" className="h-7">
              <Link href={hrefWith({ stage: null, page: null })}>Limpar</Link>
            </Button>
          )}
        </h2>
        <div className="relative w-full md:w-80">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por lead, CNPJ ou telefone"
            className="pl-8"
            aria-label="Buscar lead"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-[var(--card)]">
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-medium">
            <tr className="border-b">
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Segmento</th>
              <th className="px-4 py-3">Temperatura</th>
              <th className="px-4 py-3">Última atualização</th>
              <th className="px-4 py-3 text-right">Ver</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-muted-foreground px-4 py-10 text-center">
                  Nenhum lead encontrado.
                </td>
              </tr>
            )}
            {data.rows.map((l) => {
              const temp = TEMPERATURE[l.temperature];
              const updated = new Date(l.updatedAt);
              return (
                <tr key={l.id} className="border-b last:border-b-0 hover:bg-[var(--accent)]/40">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Building2 className="text-muted-foreground h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="max-w-[240px] truncate text-xs font-medium">{l.company}</div>
                        {l.contact && <div className="text-muted-foreground max-w-[240px] truncate text-[11px]">{l.contact}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {l.stage ? (
                      <span className={cn('rounded border px-2 py-0.5 text-[11px] whitespace-nowrap', STAGE_BADGE[l.stage])}>
                        {leadStageLabel(l.stage)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{l.isInbound ? 'INBOUND' : 'OUTBOUND'}</td>
                  <td className="px-4 py-2.5">
                    <div className="text-xs">{l.leadSource ?? '—'}</div>
                    {l.canal && <div className="text-muted-foreground text-[11px]">{l.canal}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{l.tier ?? '—'}</td>
                  <td className="max-w-[160px] truncate px-4 py-2.5 text-xs">{l.segmento ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn('rounded border px-2 py-0.5 text-[11px]', temp.className)}>{temp.label}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs tabular-nums">
                    <div>{dateFmt.format(updated)}</div>
                    <div className="text-muted-foreground text-[11px]">{timeFmt.format(updated)}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button asChild size="icon" variant="outline" className="h-7 w-7">
                      <Link href={`/leads/${l.id}`} aria-label={`Ver ${l.company}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Mostrando {firstRow} a {lastRow} de {data.total} resultados
        </span>
        <div className="flex items-center gap-2">
          <Button asChild={data.page > 1} variant="ghost" size="sm" disabled={data.page <= 1}>
            {data.page > 1 ? <Link href={hrefWith({ page: String(data.page - 1) })}>Anterior</Link> : <span>Anterior</span>}
          </Button>
          <span className="tabular-nums">
            {data.page} / {totalPages}
          </span>
          <Button asChild={data.page < totalPages} variant="ghost" size="sm" disabled={data.page >= totalPages}>
            {data.page < totalPages ? (
              <Link href={hrefWith({ page: String(data.page + 1) })}>Próximo</Link>
            ) : (
              <span>Próximo</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
