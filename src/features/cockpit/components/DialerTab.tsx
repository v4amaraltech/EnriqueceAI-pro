'use client';

import { useState } from 'react';

import { hangupCall } from '@/features/integrations/webphone/webphone-client';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';

import type { AutoDialView } from '../auto-dial.types';
import { useCockpitAutoDial, type UseCockpitAutoDialResult } from '../hooks/use-cockpit-auto-dial';
import type { AutoDialQueue } from '../utils/recovery-queue';

import { AutoDialOutcomeConfirm } from './AutoDialOutcomeConfirm';
import { autoDialStatusLine, CockpitAutoDialBar } from './CockpitAutoDialBar';
import type { SchedulingPreview } from './CallMeetingDialogs';
import { MotorLeadSidePanel } from './MotorLeadSidePanel';

const QUEUE_OPTIONS: Array<{ value: AutoDialQueue; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'recovery', label: 'Recuperação de perdidos' },
];

/** Fases em que o motor está com a ligação do lead atual (painel abre sozinho). */
const CALL_PHASES: ReadonlySet<string> = new Set(['dialing', 'awaiting-session', 'in-call', 'resolving', 'auto-completing', 'awaiting-sdr']);
/** Ligação no ar ou sendo conferida: Agendar/Desqualificar esperam o fim. */
const LIVE_PHASES: ReadonlySet<string> = new Set(['dialing', 'awaiting-session', 'in-call', 'resolving', 'auto-completing']);

interface DialerTabProps {
  autoDial: AutoDialView;
  /** Flag `call_lead_card_v1`: cartão completo no painel lateral; desligada = lista simples. */
  leadCardEnabled?: boolean;
  /** Fixture visual (página de preview): agenda e perda não gravam nada. */
  schedulingPreview?: SchedulingPreview;
  previewOnly?: boolean;
}

/**
 * Aba "Discador" do Cockpit, estilo 3CPlus: TELA LIMPA. Só o título, a fila, a barra do motor e um estado curto.
 * Sem cartão "Próxima ligação" e sem "Ligar agora". O motor SEMPRE nasce desligado (nada é lembrado entre
 * recarregamentos) e só inicia no clique. Ao ligar para um lead, o painel lateral com os dados dele abre sozinho
 * e fecha ao concluir. A fila vale a partir do Iniciar; para trocar, pare o motor.
 */
export function DialerTab({ autoDial, leadCardEnabled = false, schedulingPreview, previewOnly = false }: DialerTabProps) {
  const [queue, setQueue] = useState<AutoDialQueue>('normal');
  const engine = useCockpitAutoDial({ enabled: autoDial.enabled, live: autoDial.live, queue });
  return (
    <DialerTabView
      engine={engine}
      queue={queue}
      onQueueChange={setQueue}
      leadCardEnabled={leadCardEnabled}
      schedulingPreview={schedulingPreview}
      previewOnly={previewOnly}
    />
  );
}

interface DialerTabViewProps {
  engine: UseCockpitAutoDialResult;
  queue: AutoDialQueue;
  onQueueChange: (queue: AutoDialQueue) => void;
  leadCardEnabled?: boolean;
  schedulingPreview?: SchedulingPreview;
  previewOnly?: boolean;
}

/** A tela da aba (sem o hook): recebe o motor pronto. Separada para a página de visualização usar um motor falso. */
export function DialerTabView({ engine, queue, onQueueChange, leadCardEnabled = false, schedulingPreview, previewOnly = false }: DialerTabViewProps) {
  // Ligações do motor vistas nesta sessão (o hook não expõe o total do dia).
  const [seenCalls, setSeenCalls] = useState<string[]>([]);
  if (engine.callId && !seenCalls.includes(engine.callId)) setSeenCalls([...seenCalls, engine.callId]);

  const phase = engine.state.phase;
  const running = phase !== 'off';
  const inCallPhase = CALL_PHASES.has(phase);

  // Fechar à mão vale para esta ligação; ao sair da ligação o controle volta ao automático.
  const [dismissedLead, setDismissedLead] = useState<string | null>(null);
  if (!inCallPhase && dismissedLead !== null) setDismissedLead(null);
  const panelCard = engine.card;
  const panelOpen = inCallPhase && panelCard !== null && dismissedLead !== panelCard.context.leadId;

  const company = panelCard?.context.company.name;
  const shortState = !running
    ? 'Motor desligado. Escolha a fila e clique em Iniciar motor.'
    : inCallPhase && company
      ? `Em ligação com ${company}. Os dados do lead estão no painel ao lado.`
      : 'Aguardando o próximo lead';

  return (
    // Duas colunas em lg+ com o painel aberto (cartão do motor | painel do lead): o painel NUNCA cobre o desfecho.
    // Fechado, o cartão ocupa a largura toda. Abaixo de lg o painel empilha embaixo do cartão.
    <section
      className={cn('grid items-start gap-4', panelOpen && 'lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]')}
      aria-label="Discador"
      data-testid="dialer-tab"
      data-panel-open={panelOpen ? 'true' : 'false'}
    >
      <div className="min-w-0 space-y-4" data-testid="dialer-main-column">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Discador</h2>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs" id="dialer-queue-label">
              Fila
            </span>
            <Select value={queue} onValueChange={(v) => onQueueChange(v as AutoDialQueue)} disabled={running}>
              <SelectTrigger
                className="h-8 w-[220px]"
                aria-labelledby="dialer-queue-label"
                data-testid="dialer-queue"
                title={running ? 'Pare o motor para trocar de fila' : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUEUE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {running && (
          <p className="text-muted-foreground text-right text-xs" data-testid="dialer-queue-hint">
            Pare o motor para trocar de fila.
          </p>
        )}

        <div className="space-y-4 rounded-lg border border-[var(--primary)]/40 bg-[var(--card)] p-4">
          <CockpitAutoDialBar engine={engine} sessionCalls={seenCalls.length} onHangup={() => void hangupCall()} />
          <p className="text-muted-foreground text-sm" data-testid="auto-dial-clean-state">
            {shortState}
          </p>
          {inCallPhase && !panelOpen && panelCard && (
            <Button type="button" size="sm" variant="outline" onClick={() => setDismissedLead(null)} data-testid="motor-panel-reopen">
              Ver dados do lead
            </Button>
          )}
          {phase === 'awaiting-sdr' && panelCard && (
            <AutoDialOutcomeConfirm
              callId={engine.callId}
              leadId={panelCard.context.leadId}
              simulated={engine.simulated}
              onConfirm={engine.confirmOutcome}
            />
          )}
        </div>
      </div>

      {panelCard && (
        <MotorLeadSidePanel
          key={panelCard.context.leadId}
          card={panelCard}
          attemptNo={engine.attemptNo}
          extras={engine.leadCardExtras}
          leadCardEnabled={leadCardEnabled}
          open={panelOpen}
          onOpenChange={(next) => {
            if (!next) setDismissedLead(panelCard.context.leadId);
          }}
          statusLine={autoDialStatusLine(engine)}
          simulated={engine.simulated}
          actionsDisabled={LIVE_PHASES.has(phase)}
          previewOnly={previewOnly}
          schedulingPreview={schedulingPreview}
          onLeadActed={(kind) => engine.concludeExternally?.(panelCard.context.leadId, kind)}
        />
      )}
    </section>
  );
}
