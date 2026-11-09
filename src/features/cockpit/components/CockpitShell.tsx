'use client';

import type { ReactNode } from 'react';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, Clock3, Filter, ListChecks, Phone, UserCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';

import type { CockpitTab, CockpitViewer } from '../types';

const TABS: Array<{ key: CockpitTab; label: string; icon: typeof ListChecks }> = [
  { key: 'tarefas', label: 'Tarefas do dia', icon: ListChecks },
  { key: 'leads', label: 'Meus Leads', icon: Filter },
  { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'metas', label: 'Histórico de Metas', icon: Clock3 },
  { key: 'closers', label: 'Closers', icon: UserCheck },
];

interface CockpitShellProps {
  viewer: CockpitViewer;
  tab: CockpitTab;
  children: ReactNode;
  /** Cartão da próxima ligação (flag `call_cockpit_v1`). Ausente = tela como antes. */
  callCard?: ReactNode;
}

/** Cabeçalho do Cockpit: saudação, seletor de SDR (gestor) e abas. */
export function CockpitShell({ viewer, tab, children, callCard }: CockpitShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function hrefFor(next: Partial<{ tab: CockpitTab; sdr: string }>) {
    const params = new URLSearchParams();
    params.set('tab', next.tab ?? tab);
    if (viewer.isManager) params.set('sdr', next.sdr ?? viewer.targetUserId);
    const month = searchParams.get('month');
    if (month && (next.tab ?? tab) === tab) params.set('month', month);
    return `${pathname}?${params.toString()}`;
  }

  const firstName = viewer.targetName.split(' ')[0] ?? viewer.targetName;
  const isOwn = viewer.targetUserId === viewer.viewerId;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{isOwn ? `Olá, ${firstName}` : `Cockpit de ${viewer.targetName}`}</h1>
          {viewer.isManager && viewer.sdrOptions.length > 0 && (
            <Select value={viewer.targetUserId} onValueChange={(sdr) => router.push(hrefFor({ sdr }))}>
              <SelectTrigger className="h-8 w-[240px]" aria-label="SDR exibido">
                <SelectValue placeholder="Escolha um SDR" />
              </SelectTrigger>
              <SelectContent>
                {viewer.sdrOptions.map((o) => (
                  <SelectItem key={o.userId} value={o.userId}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <nav className="flex flex-wrap gap-1 rounded-lg border bg-[var(--card)] p-1" aria-label="Abas do Cockpit">
          {TABS.map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              href={hrefFor({ tab: key })}
              aria-current={key === tab ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                key === tab
                  ? 'bg-[var(--accent)] text-[var(--foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          ))}
          <Link
            href="/atividades?tab=dialer"
            className="text-[var(--muted-foreground)] flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium hover:text-[var(--foreground)]"
          >
            <Phone className="h-3.5 w-3.5" />
            Discador
          </Link>
        </nav>
      </div>

      {callCard}

      {children}
    </div>
  );
}
