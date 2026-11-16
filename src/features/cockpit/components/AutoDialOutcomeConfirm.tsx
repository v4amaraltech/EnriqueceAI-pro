'use client';

import { useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import type { CallDisposition } from '@/features/calls/types';
import { DISPOSITION_OPTIONS } from '@/features/calls/disposition';

import type { CockpitCallOutcome } from '../types';

import { CallOutcomePanel } from './CallOutcomePanel';

interface AutoDialOutcomeConfirmProps {
  callId: string | null;
  leadId: string;
  /** Modo simulado: não há ligação real nem resumo da IA para consultar. */
  simulated: boolean;
  onConfirm: (input: { disposition: CallDisposition; notes?: string }) => Promise<boolean>;
}

function suggestionOf(outcome: CockpitCallOutcome): string | null {
  if (outcome.state === 'confirmed') return outcome.disposition;
  if (outcome.state === 'exception') return outcome.suggestedDisposition;
  return null;
}

/**
 * O lead atendeu: o motor está parado esperando o SDR. O SDR SEMPRE confirma com clique, mesmo antes da IA
 * terminar; só depois do clique o motor segue.
 */
export function AutoDialOutcomeConfirm({ callId, leadId, simulated, onConfirm }: AutoDialOutcomeConfirmProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const valid = (v: string | null): v is CallDisposition => DISPOSITION_OPTIONS.some((o) => o.value === v);
  const chosen = picked ?? (valid(aiSuggestion) ? aiSuggestion : null);

  async function confirm() {
    if (!valid(chosen) || saving) return;
    setSaving(true);
    try {
      await onConfirm({ disposition: chosen, notes: notes.trim() || undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-amber-500/60 p-3" data-testid="auto-dial-confirm" aria-live="polite">
      <p className="text-sm font-medium">O lead atendeu. Confirme o desfecho para o motor seguir.</p>
      {simulated ? (
        <p className="text-muted-foreground text-xs" data-testid="auto-dial-confirm-simulated">
          Simulado: não há resumo da IA e nada será gravado.
        </p>
      ) : (
        callId && <CallOutcomePanel callId={callId} leadId={leadId} hideNext onOutcome={(o) => setAiSuggestion(suggestionOf(o))} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={chosen ?? ''} onValueChange={setPicked}>
          <SelectTrigger className="h-8 w-[240px]" aria-label="Desfecho da ligação" data-testid="auto-dial-disposition">
            <SelectValue placeholder="Escolha o desfecho" />
          </SelectTrigger>
          <SelectContent>
            {DISPOSITION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observação (opcional)"
          aria-label="Observação do desfecho"
          className="border-input h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs"
        />
        <Button size="sm" onClick={() => void confirm()} disabled={!chosen || saving} data-testid="auto-dial-confirm-button">
          {saving ? 'Salvando…' : 'Confirmar desfecho'}
        </Button>
      </div>
      {aiSuggestion && !picked && <p className="text-muted-foreground text-xs">Sugestão da IA já marcada. Você pode trocar.</p>}
    </div>
  );
}
