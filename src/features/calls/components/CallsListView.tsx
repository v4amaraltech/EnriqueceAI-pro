'use client';

import { Suspense, useCallback, useState, useTransition } from 'react';
import { Download, Phone, SearchX } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { EmptyState } from '@/shared/components/EmptyState';

import type { CallDetail, CallRow } from '../types';
import type { CallListResult } from '../actions/get-calls';
import { getCallDetail } from '../actions/get-call-detail';
import { exportCallsCsv } from '../actions/export-calls-csv';
import { CallsFilters } from './CallsFilters';
import { CallsPagination } from './CallsPagination';
import { CallsTable } from './CallsTable';
import { CallDetailModal } from './CallDetailModal';

interface CallsListViewProps {
  result: CallListResult;
  hasFilters: boolean;
  currentFilters: Record<string, unknown>;
}

export function CallsListView({ result, hasFilters, currentFilters }: CallsListViewProps) {
  const { data: calls, total, page, per_page } = result;
  const [selectedCall, setSelectedCall] = useState<CallDetail | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleView = useCallback(
    (call: CallRow) => {
      startTransition(async () => {
        const detail = await getCallDetail(call.id);
        if (detail.success) {
          setSelectedCall(detail.data);
          setModalOpen(true);
        } else {
          toast.error(detail.error);
        }
      });
    },
    [],
  );

  const handleExport = useCallback(() => {
    startTransition(async () => {
      const result = await exportCallsCsv(currentFilters);
      if (result.success) {
        const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.data.filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('CSV exportado');
      } else {
        toast.error(result.error);
      }
    });
  }, [currentFilters]);

  // Empty state: no calls at all
  if (calls.length === 0 && !hasFilters) {
    return (
      <EmptyState
        icon={Phone}
        title="Nenhuma ligação ainda"
        description="Conecte a API4Com nas integrações para começar a registrar ligações automaticamente."
        action={{ label: 'Configurar integrações', href: '/settings/integrations' }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ligações</h1>
          <p className="text-sm text-muted-foreground">
            {total} ligaç{total !== 1 ? 'ões' : 'ão'} encontrada{total !== 1 ? 's' : ''}
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={isPending || total === 0}>
          <Download className="mr-2 h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Filters */}
      <Suspense>
        <CallsFilters />
      </Suspense>

      {/* Table or filtered empty */}
      {calls.length === 0 && hasFilters ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 rounded-full bg-[var(--muted)] p-4">
            <SearchX className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="mb-2 text-lg font-semibold">Nenhuma ligação encontrada</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Tente ajustar os filtros para encontrar o que procura.
          </p>
        </div>
      ) : (
        <CallsTable calls={calls} onView={handleView} />
      )}

      {/* Pagination */}
      <Suspense>
        <CallsPagination total={total} page={page} perPage={per_page} />
      </Suspense>

      {/* Detail Modal */}
      <CallDetailModal
        call={selectedCall}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
