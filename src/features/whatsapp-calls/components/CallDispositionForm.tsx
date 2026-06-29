'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import type { CallStatus } from '@/features/calls/types';

import { applyCallDisposition, type DispositionResult } from '../actions/apply-call-disposition';
import { DISPOSITION_OPTIONS, mapDispositionToAction } from '../disposition';

function toLocalInputValue(date: Date): string {
  // datetime-local espera "YYYY-MM-DDTHH:mm" no fuso local.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Seletor de disposition pós-chamada da Ligação via WhatsApp (story 7.6).
 * Componente reusável — a story 7.5 (painel WebRTC) o monta ao desligar.
 * Quando a disposition reagenda (ocupado/não atendeu), mostra o picker de
 * "ligar de novo às…".
 */
export function CallDispositionForm({
  enrollmentId,
  stepId,
  onPersist,
  onDone,
}: {
  enrollmentId: string;
  stepId: string;
  // Persistência best-effort da call (story 7.7) com a disposition escolhida.
  // Retorna true se gravou. Falha aqui NÃO bloqueia o avanço da cadência.
  onPersist?: (disposition: CallStatus) => Promise<boolean>;
  onDone?: (result: DispositionResult) => void;
}) {
  const [selected, setSelected] = useState<CallStatus | null>(null);
  const [callbackAt, setCallbackAt] = useState<string>(() =>
    toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  );
  const [isPending, startTransition] = useTransition();

  const needsCallback = selected ? mapDispositionToAction(selected) === 'reschedule' : false;

  function handleConfirm() {
    if (!selected) return;
    const callbackIso =
      needsCallback && callbackAt ? new Date(callbackAt).toISOString() : undefined;

    startTransition(async () => {
      // Persiste a call primeiro (best-effort) — não bloqueia a cadência.
      if (onPersist) {
        const persisted = await onPersist(selected);
        if (!persisted) toast.error('Não foi possível registrar a ligação no histórico.');
      }

      const result = await applyCallDisposition({
        enrollmentId,
        stepId,
        disposition: selected,
        callbackAt: callbackIso,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const msg =
        result.data.action === 'advanced'
          ? 'Cadência avançada'
          : result.data.action === 'rescheduled'
            ? 'Retorno reagendado'
            : 'Atividade mantida na fila';
      toast.success(msg);
      onDone?.(result.data);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-semibold">Resultado da ligação</Label>
        <div className="mt-2 grid gap-1.5">
          {DISPOSITION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSelected(opt.value)}
              className={cn(
                'flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
                selected === opt.value
                  ? 'border-[var(--ring)] bg-[var(--accent)]'
                  : 'hover:bg-[var(--accent)]/50',
              )}
            >
              <span>{opt.label}</span>
              <span className="text-xs text-muted-foreground">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {needsCallback && (
        <div className="space-y-1.5">
          <Label htmlFor="callback-at" className="text-sm font-semibold">
            Ligar de novo em:
          </Label>
          <Input
            id="callback-at"
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
          />
        </div>
      )}

      <Button onClick={handleConfirm} disabled={!selected || isPending} className="w-full">
        {isPending ? 'Salvando…' : 'Confirmar resultado'}
      </Button>
    </div>
  );
}
