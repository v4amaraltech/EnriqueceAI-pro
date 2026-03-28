'use client';

import { useCallback } from 'react';
import { Eye } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import { formatDateTime, formatDuration } from '@/lib/utils/format';

import type { CallRow } from '../types';
import { CallStatusIcon } from './CallStatusIcon';

interface CallsTableProps {
  calls: CallRow[];
  onView: (call: CallRow) => void;
}

export function CallsTable({ calls, onView }: CallsTableProps) {
  const handleView = useCallback(
    (call: CallRow) => {
      onView(call);
    },
    [onView],
  );

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]">Status</TableHead>
            <TableHead>Origem</TableHead>
            <TableHead>Destino</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Duração</TableHead>
            <TableHead className="w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((call) => (
            <TableRow
              key={call.id}
              className="cursor-pointer"
              onClick={() => handleView(call)}
            >
              <TableCell>
                <CallStatusIcon status={call.status} />
              </TableCell>
              <TableCell className="font-medium">{call.origin}</TableCell>
              <TableCell>{call.destination}</TableCell>
              <TableCell>{formatDateTime(call.started_at)}</TableCell>
              <TableCell className="tabular-nums">
                {formatDuration(call.duration_seconds)}
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => handleView(call)}
                >
                  <Eye className="h-4 w-4" />
                  <span className="sr-only">Ver detalhes</span>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
