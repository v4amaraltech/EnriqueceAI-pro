'use client';

import { useState } from 'react';

import { PhoneForwarded } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import { leadActionsAvailability } from '../utils/lead-actions-availability';

import type { SchedulingPreview } from './CallMeetingDialogs';
import type { ScheduleCallbackFn } from './MotorCallbackDialog';
import { useMotorLeadActions, type MotorLeadActions } from './use-motor-lead-actions';

interface AnsweredBlockProps {
  /** Sem `status`: lead perdido esconde "Desqualificar lead". Com `status`, vale `leadActionsAvailability` (perdido = "Mudar motivo de perda"). */
  isLost: boolean;
  /** Status do lead: quando vem, manda no que aparece (mesma regra do painel); sem ele vale só `isLost`. */
  status?: string;
  /** Desliga as ações (o pai só monta o bloco em awaiting-sdr, então o padrão é ligado). */
  disabled?: boolean;
  /** "Não foi conversa": volta o lead para a fila. Ausente: o link não aparece. */
  onNotConversation?: () => void;
  /** "Ligar de novo" (a ligação caiu). Ausente: o botão não aparece. */
  onRedial?: () => void;
  /** Por que a última religação não levou a uma conversa. */
  redialMessage?: string | null;
}

interface AutoDialAnsweredActionsProps extends AnsweredBlockProps {
  leadId: string;
  leadName: string;
  leadEmail: string | null;
  simulated: boolean;
  previewOnly?: boolean;
  schedulingPreview?: SchedulingPreview;
  onLeadActed?: (kind: 'scheduled' | 'lost') => void;
  scheduleCallback?: ScheduleCallbackFn;
  attemptsToday?: number;
}

/**
 * O lead conversou: a discagem espera o SDR e as saídas são Agendar reunião, Ligar depois, Indicou outra pessoa e Desqualificar lead.
 * Cada uma pede o que falta (agenda, data e hora, motivo). "Não foi conversa" é um link discreto, não mais um botão.
 * Versão AUTÔNOMA: cria a própria instância do hook e seus diálogos. A tela da discagem usa `AutoDialAnsweredBlock`
 * sobre a instância ÚNICA que ela compartilha com o painel do lead.
 */
export function AutoDialAnsweredActions({
  leadId,
  leadName,
  leadEmail,
  simulated,
  previewOnly = false,
  schedulingPreview,
  onLeadActed,
  scheduleCallback,
  attemptsToday = 0,
  status,
  ...block
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
    alreadyLost: status === 'unqualified',
  });
  return (
    <>
      <AutoDialAnsweredBlock {...block} status={status} actions={actions} />
      {actions.dialogs}
    </>
  );
}

function RedialControl({ onRedial, message, disabled }: { onRedial?: () => void; message?: string | null; disabled?: boolean }) {
  if (!onRedial) return null;
  return (
    <div className="space-y-1">
      {message && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-400" data-testid="dialer-redial-message">
          {message}
        </p>
      )}
      <Button type="button" variant="outline" className="h-11 w-full" disabled={disabled} data-testid="dialer-redial" onClick={onRedial}>
        <PhoneForwarded className="mr-1.5 h-4 w-4" />
        Ligar de novo
      </Button>
      <p className="text-muted-foreground text-xs">A ligação caiu? Liga agora para o mesmo número e volta para esta tela.</p>
    </div>
  );
}

/** O bloco em si, sobre uma instância do hook que vem de fora. Não renderiza diálogos: quem criou a instância os monta. */
export function AutoDialAnsweredBlock({
  isLost,
  status,
  disabled = false,
  onNotConversation,
  onRedial,
  redialMessage,
  actions,
}: AnsweredBlockProps & { actions: MotorLeadActions }) {
  const available = status ? leadActionsAvailability(status) : null;
  const showDisqualify = available ? available.disqualify : !isLost;
  return (
    <div className="space-y-3 rounded-md border border-amber-500/60 p-3" data-testid="dialer-answered" aria-live="polite">
      <p className="text-sm font-medium">O lead conversou. O que você quer fazer agora?</p>
      <RedialControl onRedial={onRedial} message={redialMessage} disabled={disabled || actions.callbackBusy} />
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
        {(!available || available.callback) && (
          <div className="space-y-1">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={disabled || actions.callbackBusy}
              data-testid="dialer-answered-refer"
              onClick={actions.refer}
            >
              Indicou outra pessoa
            </Button>
            <p className="text-muted-foreground text-xs">Cadastra o contato indicado e pausa a cadência até o retorno.</p>
          </div>
        )}
        {showDisqualify && (
          <div className="space-y-1">
            <Button type="button" variant="outline" className="h-11 w-full" disabled={disabled} data-testid="dialer-answered-disqualify" onClick={actions.disqualify}>
              {available?.disqualifyLongLabel ?? 'Desqualificar lead'}
            </Button>
            <p className="text-muted-foreground text-xs">{available?.disqualifyHint ?? 'Pede o motivo e marca o lead como perdido.'}</p>
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
    </div>
  );
}

/**
 * Prazo estourou sem o resultado da operadora (`awaiting-sdr` com reason 'timeout'): NÃO se sabe se o lead atendeu, então o
 * bloco é neutro. "Não atendeu" segue como não atendida; "Atendeu e conversou" abre as três ações (o bloco de conversa).
 */
export function AutoDialUnknownResultBlock({
  actions,
  onNotConversation,
  ...block
}: AnsweredBlockProps & { actions: MotorLeadActions }) {
  const [answered, setAnswered] = useState(false);
  if (answered) return <AutoDialAnsweredBlock {...block} actions={actions} onNotConversation={onNotConversation} />;
  return (
    <div className="space-y-3 rounded-md border border-amber-500/60 p-3" data-testid="dialer-unknown-result" aria-live="polite">
      <p className="text-sm font-medium">Não recebemos o resultado da operadora. O lead atendeu?</p>
      <RedialControl onRedial={block.onRedial} message={block.redialMessage} disabled={block.disabled} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={block.disabled} data-testid="dialer-unknown-not-answered" onClick={onNotConversation}>
          Não atendeu
        </Button>
        <Button type="button" className="h-11 flex-1" disabled={block.disabled} data-testid="dialer-unknown-answered" onClick={() => setAnswered(true)}>
          Atendeu e conversou
        </Button>
      </div>
    </div>
  );
}
