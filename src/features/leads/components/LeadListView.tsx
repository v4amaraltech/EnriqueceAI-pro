'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { FileUp, Plus, Users } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { EmptyState } from '@/shared/components/EmptyState';

import type { LeadListResult } from '../leads.contract';
import type { LeadCadenceInfo } from '../types';
import { CreateLeadDialog } from './CreateLeadDialog';
import { LeadFilters } from './LeadFilters';
import { LeadPagination } from './LeadPagination';
import { LeadTable } from './LeadTable';

interface LeadListViewProps {
  result: LeadListResult;
  hasFilters: boolean;
  cadenceInfo: Record<string, LeadCadenceInfo>;
  userMap: Record<string, string>;
  currentUserId: string;
}

export function LeadListView({ result, hasFilters, cadenceInfo, userMap, currentUserId }: LeadListViewProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const { data: leads, total, page, per_page } = result;

  // Empty state: no leads at all
  if (leads.length === 0 && !hasFilters) {
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

      {/* Filters */}
      <Suspense>
        <LeadFilters />
      </Suspense>

      {/* Table or filtered empty */}
      {leads.length === 0 && hasFilters ? (
        <div className="py-12 text-center text-[var(--muted-foreground)]">
          Nenhum lead encontrado com os filtros aplicados.
        </div>
      ) : (
        <LeadTable leads={leads} cadenceInfo={cadenceInfo} userMap={userMap} />
      )}

      {/* Pagination */}
      <Suspense>
        <LeadPagination total={total} page={page} perPage={per_page} />
      </Suspense>

      <CreateLeadDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} currentUserId={currentUserId} />
    </div>
  );
}
