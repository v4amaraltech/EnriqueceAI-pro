'use client';

import { Button } from '@/shared/components/ui/button';

import type { SchedulingPreview } from './CallMeetingDialogs';
import type { ScheduleCallbackFn } from './MotorCallbackDialog';
import { useMotorLeadActions } from './use-motor-lead-actions';

interface AutoDialAnsweredActionsProps {
  leadId: string;
  leadName: string;
  leadEmail: string | null;
  /** Lead perdido: "Desqualificar lead" some; Agendar e Ligar depois continuam. */
  isLost: boolean;
  simulated: boolean;
  /** Desliga as ações (o pai só monta o bloco em awaiting-sdr, então o padrão é ligado). */
  disabled?: boolean;
  previewOnly?: boolean;
  schedulingPreview?: SchedulingPreview;
  onLeadActed?: (kind: 'scheduled' | 'lost') => void;
  scheduleCallback?: ScheduleCallbackFn;
  attemptsToday?: number;
  /** "Não foi conversa": volta o lead para a fila. Ausente: o link não aparece. */
  onNotConversation?: () => void;
}

/**
 * O lead conversou: a discagem espera o SDR e só há três saídas (Agendar reunião, Ligar depois, Desqualificar lead).
 * Cada uma pede o que falta (agenda, data e hora, motivo). "Não foi conversa" é um link discreto, não um quarto botão.
 */
export function AutoDialAnsweredActions({
  leadId,
  leadName,
  leadEmail,
  isLost,
  simulated,
  disabled = false,
  previewOnly = false,
  schedulingPreview,
  onLeadActed,
  scheduleCallback,
  attemptsToday = 0,
  onNotConversation,
}: AutoDialAnsweredActionsProps) {
  const actions = useMotorLeadActions({
    leadId,
    leadName,
    leadEmail,
    simulated,
    previewOnly,
    schedulingPreview,
    onLeadActed,
    scheduleCallback,
    attemptsToday,
  });

  return (
    <div className="space-y-3 rounded-md border border-amber-500/60 p-3" data-testid="dialer-answered" aria-live="polite">
      <p className="text-sm font-medium">O lead conversou. O que você quer fazer agora?</p>
      <div className="flex flex-col gap-3">
        <div className="space-y-1">
          <Button type="button" className="h-11 w-full" disabled={disabled} data-testid="dialer-answered-schedule" onClick={actions.schedule}>
            Agendar reunião
          </Button>
          <p className="text-muted-foreground text-xs">Abre a agenda do closer.</p>
        </div>
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            disabled={disabled || actions.callbackBusy}
            data-testid="dialer-answered-callback"
            onClick={actions.callback}
          >
            {actions.callbackBusy ? 'Agendando…' : 'Ligar depois'}
          </Button>
          <p className="text-muted-foreground text-xs">Marca o próximo contato e pausa a cadência até o retorno.</p>
        </div>
        {!isLost && (
          <div className="space-y-1">
            <Button type="button" variant="outline" className="h-11 w-full" disabled={disabled} data-testid="dialer-answered-disqualify" onClick={actions.disqualify}>
              Desqualificar lead
            </Button>
            <p className="text-muted-foreground text-xs">Pede o motivo e marca o lead como perdido.</p>
          </div>
        )}
      </div>
      {onNotConversation && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          data-testid="dialer-answered-not-conversation"
          onClick={onNotConversation}
        >
          Não foi conversa
        </button>
      )}
      {actions.dialogs}
    </div>
  );
}
