'use client';

import { Mail, Phone } from 'lucide-react';

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
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
}

export function ApolloResultsTable({
  people,
  total,
  selectedIds,
  onToggle,
  onToggleAll,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: ApolloResultsTableProps) {
  const allSelected = people.length > 0 && people.every((p) => selectedIds.has(p.id));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Badge variant="secondary">{total.toLocaleString('pt-BR')} resultados encontrados</Badge>
        {selectedIds.size > 0 && (
          <Badge variant="default">{selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}</Badge>
        )}
      </div>

      <div className="rounded-md border">
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
              <TableHead className="w-20 text-center">Dados</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((person) => {
              const displayName = `${person.first_name ?? ''} ${person.last_name_obfuscated ?? ''}`.trim() || '—';
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
                    {person.title ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">{person.organization?.name ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1.5">
                      {person.has_email && (
                        <Mail className="h-3.5 w-3.5 text-green-500" />
                      )}
                      {person.has_direct_phone === 'Yes' && (
                        <Phone className="h-3.5 w-3.5 text-blue-500" />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={onLoadMore} disabled={isLoadingMore}>
            {isLoadingMore ? 'Carregando...' : 'Carregar mais resultados'}
          </Button>
        </div>
      )}
    </div>
  );
}
