'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import type { ApolloSearchPerson } from '../services/apollo.service';


interface ApolloResultsTableProps {
  people: ApolloSearchPerson[];
  total: number;
  currentPage: number;
  perPage: number;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onGoToPage: (page: number) => void;
  isLoading: boolean;
}

export function ApolloResultsTable({
  people,
  total,
  currentPage,
  perPage,
  selectedIds,
  onToggle,
  onToggleAll,
  onGoToPage,
  isLoading,
}: ApolloResultsTableProps) {
  const allSelected = people.length > 0 && people.every((p) => selectedIds.has(p.id));
  const totalPages = Math.ceil(total / perPage);
  const from = (currentPage - 1) * perPage + 1;
  const to = Math.min(currentPage * perPage, total);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-[var(--muted-foreground)]">
          Mostrando {from.toLocaleString('pt-BR')}-{to.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')} resultados
        </span>
        {selectedIds.size > 0 && (
          <Badge variant="default">{selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}</Badge>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onToggleAll}
                  aria-label="Selecionar todos"
                />
              </TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Dados</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((person) => {
              const displayName = `${person.first_name ?? ''} ${person.last_name_obfuscated ?? ''}`.trim() || '\u2014';

              return (
                <TableRow key={person.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(person.id)}
                      onCheckedChange={() => onToggle(person.id)}
                      aria-label={`Selecionar ${displayName}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{displayName}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm text-[var(--muted-foreground)]">
                    {person.title ?? '\u2014'}
                  </TableCell>
                  <TableCell className="text-sm">{person.organization?.name ?? '\u2014'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {person.has_email && (
                        <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
                          Email
                        </Badge>
                      )}
                      {person.has_direct_phone === 'Yes' && (
                        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400">
                          Tel
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted-foreground)]">
            Página {currentPage} de {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onGoToPage(currentPage - 1)}
              disabled={currentPage <= 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            {generatePageNumbers(currentPage, totalPages).map((page, i) =>
              page === '...' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-sm text-[var(--muted-foreground)]">
                  ...
                </span>
              ) : (
                <Button
                  key={page}
                  variant={page === currentPage ? 'default' : 'outline'}
                  size="sm"
                  className="min-w-[36px]"
                  onClick={() => onGoToPage(page as number)}
                  disabled={isLoading}
                >
                  {page}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onGoToPage(currentPage + 1)}
              disabled={currentPage >= totalPages || isLoading}
            >
              Próximo
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function generatePageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | '...')[] = [1];

  if (current > 3) pages.push('...');

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) pages.push('...');

  pages.push(total);

  return pages;
}
