'use client';

import { useState } from 'react';

import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

import { callbackWarnings, validateCallbackAt } from '../utils/callback-slots';

import { CallbackWhenPicker, formatWhen, useCallbackWhen } from './CallbackWhenPicker';

export type ScheduleCallbackFn = (input: {
  scheduledAt: Date;
  /** Observação do retorno (e da ligação, quando `callNotes` não vem). */
  notes?: string;
  /** Anotação da ligação, quando difere da observação do retorno. */
  callNotes?: string;
  /** Desfecho gravado na ligação. Padrão: `callback_requested`. */
  disposition?: 'callback_requested' | 'referred_contact';
  /** Depois de gravar, pausa a fila (botão "Pausar") e avisa o SDR para ligar para este nome. */
  pauseQueueFor?: string;
}) => Promise<{ ok: true } | { ok: false; error: string; retornoSaved?: boolean }>;

interface MotorCallbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ausente (fixture /demo): confirmar só avisa que nada é registrado e fecha. */
  scheduleCallback?: ScheduleCallbackFn;
  /** Ligações do lead hoje, contando a atual (alimenta o aviso das 3 tentativas). */
  attemptsToday: number;
  simulated: boolean;
  /** Observação já digitada (Anotações do painel ou campo do desfecho). */
  initialNotes?: string;
  leadName?: string;
}

function CallbackForm({ onOpenChange, scheduleCallback, attemptsToday, simulated, initialNotes = '', leadName }: Omit<MotorCallbackDialogProps, 'open'>) {
  const when = useCallbackWhen();
  const { openedAt, at } = when;
  const [notes, setNotes] = useState(initialNotes);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validation = at ? validateCallbackAt(at, openedAt) : null;
  const warnings = at ? callbackWarnings(at, { now: openedAt, attemptsToday }) : [];
  const canConfirm = Boolean(at && validation?.ok) && !sending;

  async function confirm() {
    if (!at || !canConfirm) return;
    const text = notes.trim() || undefined;
    if (!scheduleCallback) {
      toast.message('Fixture de teste: nada é registrado.');
      onOpenChange(false);
      return;
    }
    setSending(true);
    setServerError(null);
    try {
      const r = await scheduleCallback({ scheduledAt: at, ...(text ? { notes: text } : {}) });
      if (r.ok) onOpenChange(false);
      else setServerError(r.error);
    } catch {
      setServerError('Não consegui agendar o retorno. Tente de novo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle className="text-base font-semibold">Ligar depois</DialogTitle>
        <DialogDescription className="text-sm">
          {leadName ? `Combine o retorno com ${leadName}.` : 'Combine o retorno com o lead.'} A discagem liga de novo neste horário.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <CallbackWhenPicker when={when} testIdPrefix="motor-callback" />

        {at && (
          <p className="text-sm font-medium" data-testid="motor-callback-when">
            Retorno: {formatWhen(at)}
          </p>
        )}
        {validation && !validation.ok && (
          <p className="text-destructive text-xs" role="alert" data-testid="motor-callback-invalid">
            {validation.error}
          </p>
        )}
        {warnings.map((w) => (
          <p key={w} className="rounded-md border border-amber-500/60 px-3 py-2 text-xs text-amber-700 dark:text-amber-400" data-testid="motor-callback-warning">
            {w}
          </p>
        ))}

        <div className="space-y-1.5">
          <Label htmlFor="motor-callback-notes" className="text-muted-foreground text-xs">
            Observação (opcional)
          </Label>
          <Textarea id="motor-callback-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16 text-xs" />
        </div>

        {simulated && (
          <p className="text-muted-foreground text-xs" data-testid="motor-callback-simulated">
            Simulado: nada é registrado.
          </p>
        )}
        {serverError && (
          <p className="text-destructive text-xs" role="alert" data-testid="motor-callback-error">
            {serverError}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={sending}>
          Cancelar
        </Button>
        <Button type="button" size="sm" onClick={() => void confirm()} disabled={!canConfirm} data-testid="motor-callback-confirm">
          {sending ? 'Agendando…' : 'Confirmar'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** "Ligar depois" do motor: agenda o retorno e confirma o desfecho "Pediu para ligar depois" num único caminho (`scheduleCallback`). */
export function MotorCallbackDialog({ open, onOpenChange, ...rest }: MotorCallbackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[480px] bg-background sm:max-w-[480px]" data-testid="motor-callback-dialog">
        {/* Monta só aberto: cada abertura recalcula os atalhos e zera a escolha. */}
        {open && <CallbackForm onOpenChange={onOpenChange} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}
