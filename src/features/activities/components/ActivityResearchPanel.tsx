'use client';

import { useState } from 'react';

import { CheckCircle2, Loader2, Search } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

interface ActivityResearchPanelProps {
  leadName: string;
  isSending: boolean;
  onMarkDone: (notes: string) => void;
  onSkip: () => void;
}

const researchChecklist = [
  'Pesquisar empresa no Google',
  'Verificar site da empresa',
  'Identificar decisores / contatos-chave',
  'Verificar redes sociais da empresa',
  'Anotar informações relevantes',
];

export function ActivityResearchPanel({ leadName, isSending, onMarkDone, onSkip }: ActivityResearchPanelProps) {
  const [notes, setNotes] = useState('');
  const [checked, setChecked] = useState<Set<number>>(new Set());

  function toggleCheck(index: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Pesquisa — {leadName}
        </h3>
      </div>

      <div className="mt-4 space-y-4 flex-1">
        {/* Checklist */}
        <div className="space-y-2">
          <Label className="text-xs">Checklist de Pesquisa</Label>
          {researchChecklist.map((item, i) => (
            <label key={i} className="flex items-center gap-2 rounded-md p-2 hover:bg-[var(--accent)]/50">
              <input
                type="checkbox"
                checked={checked.has(i)}
                onChange={() => toggleCheck(i)}
                className="h-4 w-4 rounded border-[var(--border)]"
              />
              <span className={`text-sm ${checked.has(i) ? 'text-[var(--muted-foreground)] dark:text-[var(--foreground)] line-through' : ''}`}>
                {item}
              </span>
            </label>
          ))}
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <Label className="text-xs">Anotações da Pesquisa</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Informações encontradas sobre o lead..."
            className="min-h-[120px] resize-none"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
        <Button variant="outline" onClick={onSkip} disabled={isSending}>
          Pular
        </Button>
        <Button onClick={() => onMarkDone(notes)} disabled={isSending}>
          {isSending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Marcar como feita
        </Button>
      </div>
    </div>
  );
}
