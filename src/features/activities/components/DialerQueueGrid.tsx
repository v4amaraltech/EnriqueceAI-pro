'use client';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import { DialerLeadCard } from './DialerLeadCard';

interface DialerQueueGridProps {
  items: DialerQueueItem[];
  totalCount: number;
  onViewLead?: (leadId: string) => void;
  onSkip?: (enrollmentId: string) => void;
}

export function DialerQueueGrid({ items, totalCount, onViewLead, onSkip }: DialerQueueGridProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] py-12">
        <p className="text-sm text-[var(--muted-foreground)]">Nenhum lead encontrado com os filtros atuais</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--muted-foreground)]">
          Proximas ligacoes ({items.length} de {totalCount})
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((item) => (
          <DialerLeadCard
            key={item.enrollmentId}
            item={item}
            onViewLead={onViewLead}
            onSkip={onSkip}
          />
        ))}
      </div>
    </div>
  );
}
