'use client';

import Link from 'next/link';
import { ArrowLeft, FileUp, Globe, Plus } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { EmptyState } from '@/shared/components/EmptyState';

import type { LeadSourceOption } from '../actions/get-lead-source-options';
import type { ImportListResult } from '../actions/fetch-imports';
import { LEAD_SOURCE_OPTIONS } from '../schemas/lead.schemas';
import type { ImportStatus } from '../types';

interface ImportListViewProps {
  result: ImportListResult;
  leadSourceOptions?: LeadSourceOption[];
}

const statusConfig: Record<ImportStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  processing: { label: 'Processando', variant: 'secondary' },
  completed: { label: 'Concluído', variant: 'default' },
  failed: { label: 'Falhou', variant: 'destructive' },
};

function getSourceLabel(value: string | null, options: LeadSourceOption[]): string {
  if (!value) return '—';
  const opt = options.find((o) => o.value === value);
  return opt?.label ?? value;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ImportListView({ result, leadSourceOptions }: ImportListViewProps) {
  const sourceOptions = leadSourceOptions ?? LEAD_SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  const { data: imports, total } = result;

  if (imports.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/leads">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Listas de Importação</h1>
        </div>
        <EmptyState
          icon={FileUp}
          title="Nenhuma importação realizada"
          description="Importe seu primeiro arquivo CSV para começar a prospectar."
          action={{ label: 'Nova Importação', href: '/leads/import' }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/leads">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Listas de Importação</h1>
            <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              {total} importaç{total !== 1 ? 'ões' : 'ão'} realizada{total !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild className="bg-[#FFCA28] text-black hover:bg-[#FFB300]">
            <Link href="/leads/import/apollo">
              <Globe className="mr-2 h-4 w-4" />
              Importar do Apollo
            </Link>
          </Button>
          <Button asChild>
            <Link href="/leads/import">
              <Plus className="mr-2 h-4 w-4" />
              Nova Importação
            </Link>
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Arquivo</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Importados</TableHead>
              <TableHead className="text-right">Erros</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Importado por</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {imports.map((row) => {
              const config = statusConfig[row.status];
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileUp className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
                      <span className="truncate max-w-[200px]" title={row.file_name}>
                        {row.file_name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(row.created_at)}</TableCell>
                  <TableCell className="text-right">{row.total_rows}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                      {row.success_count}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {row.error_count > 0 ? (
                      <Badge variant="destructive">{row.error_count}</Badge>
                    ) : (
                      <span className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={config.variant}>{config.label}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    {getSourceLabel(row.lead_source, sourceOptions)}
                  </TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                    {row.created_by_name}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
