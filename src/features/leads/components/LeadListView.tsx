'use client';

import { Suspense, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileUp, Globe, Plus, SearchX, Users } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { EmptyState } from '@/shared/components/EmptyState';

import type { LeadSourceOption } from '../actions/get-lead-source-options';
import type { LeadStatusCounts } from '../actions/fetch-leads';
import type { LeadListResult } from '../leads.contract';
import type { LeadCadenceInfo } from '../types';
import { CreateLeadDialog } from './CreateLeadDialog';
import { LeadFilters } from './LeadFilters';
import { LeadPagination } from './LeadPagination';
import { LeadTable } from './LeadTable';

const STATUS_TABS: Array<{ key: string; label: string; countKey: keyof LeadStatusCounts }> = [
  { key: '', label: 'Todos', countKey: 'all' },
  { key: 'new', label: 'Novo', countKey: 'new' },
  { key: 'contacted', label: 'Contatado', countKey: 'contacted' },
  { key: 'qualified', label: 'Qualificado', countKey: 'qualified' },
  { key: 'unqualified', label: 'Não Qualificado', countKey: 'unqualified' },
  { key: 'archived', label: 'Arquivado', countKey: 'archived' },
];

interface LeadListViewProps {
  result: LeadListResult;
  hasFilters: boolean;
  cadenceInfo: Record<string, LeadCadenceInfo>;
  userMap: Record<string, string>;
  currentUserId: string;
  members?: { userId: string; name: string }[];
  statusCounts?: LeadStatusCounts;
  cadences?: { id: string; name: string }[];
  cnaes?: string[];
  leadSourceOptions?: LeadSourceOption[];
  canalOptions?: string[];
}

export function LeadListView({ result, hasFilters, cadenceInfo, userMap, currentUserId, members, statusCounts, cadences, cnaes, leadSourceOptions, canalOptions }: LeadListViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [isTabPending, startTabTransition] = useTransition();
  const { data: leads, total, page, per_page } = result;

  const urlStatusTab = searchParams.get('status') ?? '';
  const [optimisticTab, setOptimisticTab] = useState(urlStatusTab);

  // Sync optimistic state when URL actually updates
  useEffect(() => {
    setOptimisticTab(urlStatusTab);
  }, [urlStatusTab]);

  const handleStatusTab = (key: string) => {
    setOptimisticTab(key);
    const params = new URLSearchParams(searchParams.toString());
    if (key) {
      params.set('status', key);
    } else {
      params.delete('status');
    }
    params.delete('page');
    startTabTransition(() => {
      router.push(`/leads?${params.toString()}`);
    });
  };

  // Empty state: only when org has zero leads total (not just filtered view empty)
  const orgTotalLeads = statusCounts?.all ?? total;
  if (orgTotalLeads === 0 && leads.length === 0 && !hasFilters) {
    return (
      <EmptyState
        icon={Users}
        title="Nenhum lead ainda"
        description="Importe seu primeiro arquivo CSV para começar a prospectar."
        action={{ label: 'Importar CSV', href: '/leads/import' }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            {total} lead{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild className="bg-amber-400 text-black hover:bg-amber-500">
            <Link href="/leads/import/apollo">
              <Globe className="mr-2 h-4 w-4" />
              Importar do Apollo
            </Link>
          </Button>
          <Button asChild>
            <Link href="/leads/imports">
              <FileUp className="mr-2 h-4 w-4" />
              Listas de importação
            </Link>
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      {statusCounts && (
        <div className="flex gap-1 border-b">
          {STATUS_TABS.map((tab) => {
            const count = statusCounts[tab.countKey];
            const isActive = optimisticTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleStatusTab(tab.key)}
                className={`relative px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-[var(--foreground)]'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  isActive ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                }`}>
                  {count}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)]" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <Suspense>
        <LeadFilters members={members} cadences={cadences} cnaes={cnaes} leadSourceOptions={leadSourceOptions} canalOptions={canalOptions} currentUserId={currentUserId} />
      </Suspense>

      {/* Table or filtered empty */}
      <div className={isTabPending ? 'pointer-events-none opacity-50 transition-opacity' : ''}>
      {leads.length === 0 && hasFilters ? (
        <EmptyState
          icon={SearchX}
          title="Nenhum lead encontrado"
          description="Nenhum lead corresponde aos filtros aplicados. Limpe os filtros ou importe novos leads."
          action={{ label: 'Limpar filtros', href: '/leads' }}
          secondaryAction={{ label: 'Importar leads', href: '/leads/import' }}
        />
      ) : (
        <LeadTable leads={leads} total={total} cadenceInfo={cadenceInfo} userMap={userMap} />
      )}
      </div>

      {/* Pagination */}
      <Suspense>
        <LeadPagination total={total} page={page} perPage={per_page} />
      </Suspense>

      <CreateLeadDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} currentUserId={currentUserId} leadSourceOptions={leadSourceOptions} />
    </div>
  );
}
