'use client';

import type { ParsedRow } from '../utils/csv-parser';

import { formatCnpj } from '../utils/cnpj';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

interface CsvPreviewProps {
  rows: ParsedRow[];
  errorCount: number;
  totalRows: number;
}

export function CsvPreview({ rows, errorCount, totalRows }: CsvPreviewProps) {
  const previewRows = rows.slice(0, 10);
  const withoutCnpj = rows.filter((r) => !r.cnpj).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted-foreground">
          Total: <strong>{totalRows}</strong> linhas
        </span>
        <span className="text-green-600 dark:text-green-400">
          Válidos: <strong>{rows.length}</strong>
        </span>
        {errorCount > 0 && (
          <span className="text-red-600 dark:text-red-400">
            Erros: <strong>{errorCount}</strong>
          </span>
        )}
      </div>

      {withoutCnpj > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <strong>{withoutCnpj}</strong> {withoutCnpj === 1 ? 'lead' : 'leads'} sem CNPJ. Vão ser importados normalmente, mas sem enriquecimento automático (Lemit). Dedup nesses casos usa e-mail e razão social + telefone.
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Razão Social</TableHead>
              <TableHead>Nome Fantasia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {previewRows.map((row) => (
              <TableRow key={row.rowNumber}>
                <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
                <TableCell className="font-mono text-sm">{row.cnpj ? formatCnpj(row.cnpj) : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{row.razao_social ?? '-'}</TableCell>
                <TableCell>{row.nome_fantasia ?? '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {rows.length > 10 && (
        <p className="text-center text-xs text-muted-foreground">
          Mostrando 10 de {rows.length} linhas válidas
        </p>
      )}
    </div>
  );
}
