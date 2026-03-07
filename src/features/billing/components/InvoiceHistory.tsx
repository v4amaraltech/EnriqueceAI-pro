'use client';

import { ExternalLink, FileText, Receipt } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

import { formatCents } from '../services/feature-flags';
import type { InvoiceItem } from '../actions/fetch-invoices';

interface InvoiceHistoryProps {
  invoices: InvoiceItem[];
}

function statusBadge(status: InvoiceItem['status']): { label: string; variant: 'default' | 'secondary' | 'destructive' } {
  switch (status) {
    case 'paid':
      return { label: 'Pago', variant: 'default' };
    case 'open':
      return { label: 'Pendente', variant: 'secondary' };
    case 'void':
      return { label: 'Cancelada', variant: 'secondary' };
    case 'uncollectible':
      return { label: 'Falhou', variant: 'destructive' };
    default:
      return { label: status, variant: 'secondary' };
  }
}

export function InvoiceHistory({ invoices }: InvoiceHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="size-4" />
          Histórico de Faturas
        </CardTitle>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <FileText className="size-8 text-[var(--muted-foreground)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              Nenhuma fatura ainda. As faturas aparecerão aqui após o primeiro pagamento.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => {
              const badge = statusBadge(inv.status);
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-lg border p-3 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">
                        {new Date(inv.date).toLocaleDateString('pt-BR')}
                      </p>
                      <p className="text-[var(--muted-foreground)]">
                        {formatCents(inv.amountCents)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {inv.pdfUrl && (
                      <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
                        <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="size-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
