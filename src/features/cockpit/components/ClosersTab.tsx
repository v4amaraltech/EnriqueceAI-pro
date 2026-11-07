'use client';

import { useMemo, useState, useTransition } from 'react';

import { Search, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Input } from '@/shared/components/ui/input';
import { Switch } from '@/shared/components/ui/switch';

import { setCloserSchedulingEnabled } from '@/features/settings-prospecting/actions/closers-crud';

import type { CockpitClosersData } from '../services/cockpit-closers.service';
import { pctOf } from '../utils/closer-stats';
import { MonthNav } from './MonthNav';

interface ClosersTabProps {
  data: CockpitClosersData;
  maxMonth: string;
  canToggle: boolean;
}

export function ClosersTab({ data, maxMonth, canToggle }: ClosersTabProps) {
  const [search, setSearch] = useState('');
  const [enabled, setEnabled] = useState(() => new Map(data.closers.map((c) => [c.closerId, c.schedulingEnabled])));
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const enabledCount = [...enabled.values()].filter(Boolean).length;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? data.closers.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q)) : data.closers;
  }, [data.closers, search]);

  function toggle(closerId: string, next: boolean) {
    setEnabled((prev) => new Map(prev).set(closerId, next));
    setPendingId(closerId);
    startTransition(async () => {
      const result = await setCloserSchedulingEnabled(closerId, next);
      setPendingId(null);
      if (!result.success) {
        setEnabled((prev) => new Map(prev).set(closerId, !next));
        toast.error(result.error);
      } else {
        toast.success(next ? 'Closer habilitado para agendamento' : 'Closer desabilitado para agendamento');
      }
    });
  }

  const toggleDisabled = !canToggle || !data.toggleAvailable;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/5 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border">
          <Users className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">
            {enabledCount} de {data.closers.length} pessoas habilitadas para agendamento
          </p>
          <p className="text-muted-foreground text-xs">
            Só quem está habilitado aparece na agenda quando você marca uma reunião. Quem sai do time é removido da lista.
            {!canToggle && ' Só o gestor muda quem está habilitado.'}
            {!data.toggleAvailable && ' (Habilitação indisponível até a atualização do banco.)'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          Closers <span className="rounded border px-1.5 text-xs font-normal tabular-nums">{data.closers.length}</span>
        </h2>
        <div className="flex gap-2">
          <MonthNav month={data.month} maxMonth={maxMonth} />
          <div className="relative w-full md:w-72">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por pessoa"
              className="pl-8"
              aria-label="Buscar closer"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-[var(--card)]">
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-medium">
            <tr className="border-b">
              <th className="px-4 py-3">Closer</th>
              <th className="px-4 py-3">Reuniões no mês</th>
              <th className="px-4 py-3">Agendadas</th>
              <th className="px-4 py-3">No-show</th>
              <th className="px-4 py-3">Realizadas</th>
              <th className="px-4 py-3">Canceladas</th>
              <th className="px-4 py-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted-foreground px-4 py-10 text-center">
                  Nenhum closer encontrado.
                </td>
              </tr>
            )}
            {rows.map((c) => {
              const initials = c.name
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase() ?? '')
                .join('');
              return (
                <tr key={c.closerId} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold">
                        {initials}
                      </span>
                      <div className="min-w-0">
                        <div className="max-w-[240px] truncate text-xs font-medium">{c.name}</div>
                        <div className="text-muted-foreground max-w-[240px] truncate text-[11px]">{c.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold tabular-nums">{c.total}</td>
                  <Metric dot="bg-emerald-500" value={c.scheduled} total={c.total} />
                  <Metric dot="bg-amber-500" value={c.noShow} total={c.total} />
                  <Metric dot="bg-sky-500" value={c.held} total={c.total} />
                  <Metric dot="bg-zinc-400" value={c.cancelled} total={c.total} />
                  <td className="px-4 py-3 text-right">
                    <Switch
                      checked={enabled.get(c.closerId) ?? true}
                      disabled={toggleDisabled || pendingId === c.closerId}
                      onCheckedChange={(next) => toggle(c.closerId, next)}
                      aria-label={`Habilitar ${c.name} para agendamento`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ dot, value, total }: { dot: string; value: number; total: number }) {
  return (
    <td className="px-4 py-3 text-xs tabular-nums">
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-sm ${dot}`} />
        <span className="font-semibold">{value}</span>
        <span className="text-muted-foreground">{pctOf(value, total)}%</span>
      </span>
    </td>
  );
}
