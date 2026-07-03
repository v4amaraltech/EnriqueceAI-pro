'use client';

import { useCallback } from 'react';
import { Eye } from 'lucide-react';

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

import { formatDateTime, formatDuration } from '@/lib/utils/format';

import { WhatsAppGlyph } from '@/features/whatsapp-calls/components/WhatsAppGlyph';

import type { CallRow } from '../types';
import { CallStatusIcon } from './CallStatusIcon';

/** Ligações via WhatsApp gravam `origin: 'whatsapp'` + `metadata.provider`;
 *  mostramos um selo verde em vez do texto cru. Ver whatsapp-calls/persist-call. */
function isWhatsAppCall(call: CallRow): boolean {
  return call.origin === 'whatsapp' || call.metadata?.provider === 'whatsapp';
}

function OriginCell({ call }: { call: CallRow }) {
  if (isWhatsAppCall(call)) {
    return (
      <Badge className="gap-1 border-transparent bg-[#25D366] text-white hover:bg-[#25D366]">
        <WhatsAppGlyph className="size-3" />
        WhatsApp
      </Badge>
    );
  }
  return <span>{call.origin}</span>;
}

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
              <TableCell className="font-medium">
                <OriginCell call={call} />
              </TableCell>
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
