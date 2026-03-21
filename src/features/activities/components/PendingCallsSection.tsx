'use client';

import { useState } from 'react';

import { PhoneCall } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import type { PendingCallLead } from '../actions/fetch-pending-calls';

import { PendingCallLeadCard } from './PendingCallLeadCard';

interface PendingCallsSectionProps {
  leads: PendingCallLead[];
}

export function PendingCallsSection({ leads }: PendingCallsSectionProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (leads.length === 0) return null;

  function handleToggle(enrollmentId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(enrollmentId)) {
        next.delete(enrollmentId);
      } else {
        next.add(enrollmentId);
      }
      return next;
    });
  }

  function handleSelectAll() {
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((l) => l.enrollmentId)));
    }
  }

  const allSelected = selected.size === leads.length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          <h3 className="text-sm font-semibold">
            Leads Aguardando Primeira Ligação ({leads.length})
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={handleSelectAll}>
          {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
        </Button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {leads.map((lead) => (
          <PendingCallLeadCard
            key={lead.enrollmentId}
            lead={lead}
            selected={selected.has(lead.enrollmentId)}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}
