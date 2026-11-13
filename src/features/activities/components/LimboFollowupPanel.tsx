'use client';

import { useState } from 'react';

import { CheckCircle2, Compass, Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

interface LimboFollowupPanelProps {
  leadName: string;
  /** Nota gravada pelo robô: motivo + cadências envolvidas. */
  reason: string | null;
  isSending: boolean;
  onMarkDone: (notes: string) => void;
}

/**
 * Tarefa "Definir destino": o lead está parado (cadência pausada sem data de
 * volta, e-mail que voltou ou resposta) e sem próxima atividade. Não é
 * pesquisa — o SDR só precisa decidir o que fazer com o lead.
 */
export function LimboFollowupPanel({
  leadName,
  reason,
  isSending,
  onMarkDone,
}: LimboFollowupPanelProps) {
  const [notes, setNotes] = useState('');
  const reasonText = reason?.replace(/^Definir destino:\s*/, '') ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2">
        <Compass className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Definir destino — {leadName}
        </h3>
      </div>

      <div className="mt-4 flex-1 space-y-4">
        {reasonText && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-sm">
            {reasonText}
          </div>
        )}
        <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Escolha o que fazer com o lead: retomar ou trocar a cadência, agendar um retorno, ou
          marcar como Ganho/Perdido. Depois, marque esta tarefa como feita.
        </p>
        <div className="space-y-1">
          <Label className="text-xs">O que foi decidido (opcional)</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: retomei a cadência; lead pediu contato em dezembro..."
            className="min-h-[120px] resize-y text-sm"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
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
