'use client';

import { CalendarPlus, PhoneForwarded, UserPlus, UserX } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import { leadActionsAvailability } from '../utils/lead-actions-availability';

import type { MotorLeadActions } from './use-motor-lead-actions';

interface LeadQuickActionsProps {
  /** Status do lead (`ctx.company.status`): decide quais botões existem. */
  status: string;
  /** Instância única do hook (a da tela da discagem). Os diálogos NÃO moram aqui. */
  actions: MotorLeadActions;
  simulated: boolean;
}

/**
 * Faixa fixa do painel do lead com as ações do lead, em qualquer fase da ligação (discando, tocando, caixa postal,
 * conversa). Mesmos botões e diálogos do bloco "O lead conversou" (uma instância só). Sem nenhum botão quando o lead
 * é `won`/`archived`. No modo simulado o clique só avisa que nada é gravado.
 */
export function LeadQuickActions({ status, actions, simulated }: LeadQuickActionsProps) {
  const available = leadActionsAvailability(status);
  if (!available.schedule && !available.callback && !available.disqualify) return null;
  return (
    <div className="space-y-1.5" data-testid="motor-lead-actions" role="group" aria-label="Ações do lead">
      <div className="flex flex-wrap gap-2">
        {available.schedule && (
          <Button type="button" size="sm" className="h-8 min-w-0 flex-1 basis-[45%] px-2 text-xs" data-testid="motor-action-schedule" onClick={actions.schedule}>
            <CalendarPlus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Agendar reunião</span>
          </Button>
        )}
        {available.callback && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 min-w-0 flex-1 basis-[45%] px-2 text-xs"
            disabled={actions.callbackBusy}
            data-testid="motor-action-callback"
            onClick={actions.callback}
          >
            <PhoneForwarded className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{actions.callbackBusy ? 'Agendando…' : 'Ligar depois'}</span>
          </Button>
        )}
        {available.callback && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 min-w-0 flex-1 basis-[45%] px-2 text-xs"
            disabled={actions.callbackBusy}
            data-testid="motor-action-refer"
            onClick={actions.refer}
          >
            <UserPlus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Indicou outra pessoa</span>
          </Button>
        )}
        {available.disqualify && (
          <Button type="button" size="sm" variant="outline" className="h-8 min-w-0 flex-1 basis-[45%] px-2 text-xs" data-testid="motor-action-disqualify" onClick={actions.disqualify}>
            <UserX className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{available.disqualifyLabel}</span>
          </Button>
        )}
      </div>
      {simulated && <p className="text-muted-foreground text-[11px]">Simulado: nada é registrado.</p>}
    </div>
  );
}
