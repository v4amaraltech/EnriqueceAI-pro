'use client';

import { Suspense, useCallback, useEffect, useState, useTransition } from 'react';
import { Download, Loader2, Phone, SearchX } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { EmptyState } from '@/shared/components/EmptyState';

import type { CallDetail, CallRow } from '../types';
import type { CallListResult } from '../actions/get-calls';
import { getCalls } from '../actions/get-calls';
import { getCallDetail } from '../actions/get-call-detail';
import { exportCallsCsv } from '../actions/export-calls-csv';
import { CallsFilters } from './CallsFilters';
import { CallsPagination } from './CallsPagination';
import { CallsTable } from './CallsTable';
import { CallDetailModal } from './CallDetailModal';

interface CallsListViewProps {
  initialFilters: Record<string, unknown>;
}

function TableSkeleton() {
  return (
    <div className="rounded-lg border">
      <div className="border-b p-4">
        <div className="grid grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="border-b p-4">
          <div className="grid grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, j) => (
              <Skeleton key={j} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CallsListView({ initialFilters }: CallsListViewProps) {
  const [result, setResult] = useState<CallListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState<CallDetail | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasFilters = !!(initialFilters.status || initialFilters.period || initialFilters.search || initialFilters.important_only === 'true');
  const filtersKey = JSON.stringify(initialFilters);

  // Fetch calls asynchronously on mount and when filters change
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    getCalls(initialFilters).then((res) => {
      if (cancelled) return;
      if (res.success) {
        setResult(res.data);
      } else {
        toast.error(res.error);
      }
      setIsLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

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
      const res = await exportCallsCsv(initialFilters);
      if (res.success) {
        const blob = new Blob([res.data.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.data.filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('CSV exportado');
      } else {
        toast.error(res.error);
      }
    });
  }, [initialFilters]);

  const handleUpdated = useCallback(() => {
    // Refresh list after status change or feedback
    getCalls(initialFilters).then((res) => {
      if (res.success) setResult(res.data);
    });
  }, [initialFilters]);

  const calls = result?.data ?? [];
  const total = result?.total ?? 0;
  const page = result?.page ?? 1;
  const per_page = result?.per_page ?? 20;

  // Initial empty state (no calls at all, not loading)
  if (!isLoading && calls.length === 0 && !hasFilters) {
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
            {isLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Carregando...
              </span>
            ) : (
              `${total} ligaç${total !== 1 ? 'ões' : 'ão'} encontrada${total !== 1 ? 's' : ''}`
            )}
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={isPending || isLoading || total === 0}>
          <Download className="mr-2 h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Filters */}
      <Suspense>
        <CallsFilters />
      </Suspense>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton />
      ) : calls.length === 0 && hasFilters ? (
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
      {!isLoading && (
        <Suspense>
          <CallsPagination total={total} page={page} perPage={per_page} />
        </Suspense>
      )}

      {/* Detail Modal */}
      <CallDetailModal
        call={selectedCall}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onUpdated={handleUpdated}
      />
    </div>
  );
}
