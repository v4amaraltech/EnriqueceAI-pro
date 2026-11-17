'use client';

import { useState } from 'react';

import { hangupCall } from '@/features/integrations/webphone/webphone-client';
import { Button } from '@/shared/components/ui/button';

import type { AutoDialView } from '../auto-dial.types';
import { useCockpitAutoDial } from '../hooks/use-cockpit-auto-dial';
import type { NextCallCardData } from '../types';

import { AutoDialOutcomeConfirm } from './AutoDialOutcomeConfirm';
import { autoDialStatusLine, CockpitAutoDialBar } from './CockpitAutoDialBar';
import type { SchedulingPreview } from './CallMeetingDialogs';
import { MotorLeadSidePanel } from './MotorLeadSidePanel';
import { NextCallCardBody } from './NextCallCard';

interface Props {
  card: NextCallCardData | null;
  dialerProvider: 'api4com' | null;
  autoDial: AutoDialView;
  /** Flag `call_lead_card_v1`: cartão completo no painel lateral; desligada = lista simples. */
  leadCardEnabled?: boolean;
  /** Fixture visual (página de preview): agenda e perda não gravam nada. */
  schedulingPreview?: SchedulingPreview;
  previewOnly?: boolean;
}

/** Fases em que o motor está com a ligação do lead atual (painel abre sozinho). */
const CALL_PHASES: ReadonlySet<string> = new Set(['dialing', 'awaiting-session', 'in-call', 'resolving', 'auto-completing', 'awaiting-sdr']);
/** Ligação no ar ou sendo conferida: Agendar/Desqualificar esperam o fim (igual ao painel da aba Tarefas). */
const LIVE_PHASES: ReadonlySet<string> = new Set(['dialing', 'awaiting-session', 'in-call', 'resolving', 'auto-completing']);
/** Motor parado de verdade: o cartão completo e o "Ligar agora" voltam como hoje. */
const IDLE_PHASES: ReadonlySet<string> = new Set(['off', 'paused', 'blocked']);

const SHELL = 'space-y-4 rounded-lg border border-[var(--primary)]/40 bg-[var(--card)] p-4';

/**
 * Cartão com o motor automático (só montado com as flags ligadas). O motor nasce DESLIGADO e só inicia no clique.
 *  - Desligado/pausado/bloqueado: o cartão "Próxima ligação" de sempre, com a barra no topo.
 *  - Rodando: TELA LIMPA (só a barra e um estado curto). Quando o motor liga para um lead, o painel lateral com os
 *    dados dele abre sozinho; fecha ao concluir o desfecho, ao seguir para o próximo lead ou ao parar.
 */
export function NextCallCardWithEngine({ card: serverCard, dialerProvider, autoDial, leadCardEnabled = false, schedulingPreview, previewOnly = false }: Props) {
  const engine = useCockpitAutoDial({ enabled: autoDial.enabled, live: autoDial.live });

  // Ligações do motor vistas nesta sessão (o hook não expõe o total do dia).
  const [seenCalls, setSeenCalls] = useState<string[]>([]);
  if (engine.callId && !seenCalls.includes(engine.callId)) setSeenCalls([...seenCalls, engine.callId]);

  const card = engine.card ?? serverCard;
  const phase = engine.state.phase;
  const running = !IDLE_PHASES.has(phase);
  const inCallPhase = CALL_PHASES.has(phase);

  // Fechar à mão vale para esta ligação; ao sair da ligação (próximo lead, parar) o controle volta ao automático.
  const [dismissedLead, setDismissedLead] = useState<string | null>(null);
  if (!inCallPhase && dismissedLead !== null) setDismissedLead(null);
  const leadId = engine.card?.context.leadId ?? null;
  const panelOpen = inCallPhase && leadId !== null && dismissedLead !== leadId;

  const bar = <CockpitAutoDialBar engine={engine} sessionCalls={seenCalls.length} onHangup={() => void hangupCall()} />;
  const panelCard = engine.card;

  const panel = panelCard ? (
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
  ) : null;

  // ---- Motor rodando: tela limpa -------------------------------------------------------------
  if (running) {
    const company = engine.card?.context.company.name;
    const shortState =
      inCallPhase && company ? `Em ligação com ${company}. Os dados do lead estão no painel ao lado.` : 'Aguardando o próximo lead';
    return (
      <>
        {panel}
        <section className={SHELL} aria-label="Discagem automática" data-testid="next-call-card" data-clean="true">
          {bar}
          <p className="text-muted-foreground text-sm" data-testid="auto-dial-clean-state">
            {shortState}
          </p>
          {inCallPhase && !panelOpen && (
            <Button type="button" size="sm" variant="outline" onClick={() => setDismissedLead(null)} data-testid="motor-panel-reopen">
              Ver dados do lead
            </Button>
          )}
          {phase === 'awaiting-sdr' && engine.card && (
            <AutoDialOutcomeConfirm
              callId={engine.callId}
              leadId={engine.card.context.leadId}
              simulated={engine.simulated}
              onConfirm={engine.confirmOutcome}
            />
          )}
        </section>
      </>
    );
  }

  // ---- Motor desligado, pausado ou bloqueado: cartão de sempre --------------------------------
  if (!card) {
    return (
      <section className={SHELL} aria-label="Próxima ligação" data-testid="next-call-card">
        <p className="text-muted-foreground text-xs font-medium">Próxima ligação</p>
        {bar}
        <p className="text-muted-foreground text-xs">Nenhum lead disponível para ligar agora.</p>
      </section>
    );
  }

  return (
    <NextCallCardBody
      key={card.context.leadId}
      card={card}
      dialerProvider={dialerProvider}
      outcomesEnabled
      slots={{ top: bar }}
    />
  );
}
