'use client';

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
      <div className="flex items-center gap-3">
        <span className="text-sm text-[var(--muted-foreground)]">
          Mostrando {people.length.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')} resultados
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
              <TableHead>Localização</TableHead>
              <TableHead>Dados</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((person) => {
              const displayName = `${person.first_name ?? ''} ${person.last_name_obfuscated ?? ''}`.trim() || '\u2014';
              const locationParts = [person.city, person.state, person.country].filter(Boolean);
              const location = locationParts.length > 0 ? locationParts.join(', ') : null;

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
                  <TableCell className="max-w-[200px] truncate text-sm text-[var(--muted-foreground)]">
                    {location ?? '\u2014'}
                  </TableCell>
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
