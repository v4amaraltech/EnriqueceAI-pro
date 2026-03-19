'use client';

import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { Skeleton } from '@/shared/components/ui/skeleton';

import type { DrilldownState } from './drilldown.types';

const PAGE_SIZE = 25;

interface DrilldownDrawerProps extends DrilldownState {}

export function DrilldownDrawer({
  isOpen,
  close,
  title,
  columns,
  data,
  total,
  page,
  isLoading,
  goToPage,
}: DrilldownDrawerProps) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="sm:max-w-2xl w-full flex flex-col">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription asChild>
            <span className="text-muted-foreground text-sm">
              {isLoading ? (
                <Skeleton className="inline-block h-4 w-32" />
              ) : (
                `${total} resultado${total !== 1 ? 's' : ''}`
              )}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto px-4">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : data.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-[var(--muted-foreground)]">
              Nenhum resultado encontrado.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={`pb-2 pr-3 font-medium ${col.align === 'right' ? 'text-right' : ''}`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      {columns.map((col) => {
                        const value = row[col.key];
                        const isName = col.key === 'razaoSocial' && row.leadId;
                        return (
                          <td
                            key={col.key}
                            className={`py-2 pr-3 ${col.align === 'right' ? 'text-right' : ''}`}
                          >
                            {isName ? (
                              <Link
                                href={`/leads/${row.leadId}`}
                                className="text-[var(--primary)] hover:underline"
                              >
                                {String(value ?? '—')}
                              </Link>
                            ) : (
                              String(value ?? '—')
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!isLoading && data.length > 0 && (
          <SheetFooter className="flex-row items-center justify-between border-t border-[var(--border)] pt-3">
            <span className="text-sm text-[var(--muted-foreground)]">
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Próximo
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
