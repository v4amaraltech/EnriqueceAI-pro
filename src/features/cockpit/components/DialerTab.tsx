'use client';

import { useState } from 'react';

import { hangupCall } from '@/features/integrations/webphone/webphone-client';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';

import type { AutoDialView } from '../auto-dial.types';
import { useAutoDialDayStats } from '../hooks/use-auto-dial-day-stats';
import { useCockpitAutoDial, type UseCockpitAutoDialResult } from '../hooks/use-cockpit-auto-dial';
import { useMotorCallNoteSaver } from '../hooks/use-motor-call-note-saver';
import { useMotorPanelNote } from '../hooks/use-motor-panel-note';
import { useMotorWebphoneNotes } from '../hooks/use-motor-webphone-notes';
import type { AutoDialQueue } from '../utils/recovery-queue';

import { AutoDialAnsweredBlock, AutoDialUnknownResultBlock } from './AutoDialAnsweredActions';
import { CockpitAutoDialBar } from './CockpitAutoDialBar';
import type { SchedulingPreview } from './CallMeetingDialogs';
import { DialerDaySummary } from './DialerDaySummary';
import { MotorLeadSidePanel } from './MotorLeadSidePanel';
import { RecoveryTag, showsRecoveryTag } from './RecoveryTag';
import { useMotorLeadActions } from './use-motor-lead-actions';

const QUEUE_OPTIONS: Array<{ value: AutoDialQueue; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'recovery', label: 'Recuperação de perdidos' },
];

/** Fases em que o motor está com a ligação do lead atual (painel abre sozinho). */
const CALL_PHASES: ReadonlySet<string> = new Set(['dialing', 'awaiting-session', 'in-call', 'resolving', 'auto-completing', 'awaiting-sdr']);

/** `notConversation` chega com o PR-B no hook; até lá o tipo é declarado aqui (opcional). */
type EngineWithNotConversation = UseCockpitAutoDialResult & { notConversation?: () => void };

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
  // Resumo do dia: relê no início (nova ligação) e no fim (sai da fase de ligação) de cada ligação. Simulado não grava.
  const dayStats = useAutoDialDayStats({
    enabled: !engine.simulated && !previewOnly,
    refreshKey: `${seenCalls.length}:${inCallPhase ? 'call' : 'idle'}`,
  });
  // "Concluir" do webphone grava a nota da ligação do motor (antes ninguém no Cockpit escutava).
  const noteSaver = useMotorCallNoteSaver();
  useMotorWebphoneNotes({ live: !engine.simulated, callId: engine.callId, saver: noteSaver });

  // Fechar à mão vale para esta ligação; ao sair da ligação o controle volta ao automático.
  const [dismissedLead, setDismissedLead] = useState<string | null>(null);
  const panelCard = engine.card;
  // Pausa por sessão que não entrou (`session_missing`): a ligação ainda pode aparecer no webphone, então o painel do lead
  // continua aberto. Critério mínimo: discagem pausada E o motor marcou ESTE lead como "ligação sem sessão" (`callLostLeadId`).
  const sessionLostOpen = phase === 'paused' && panelCard !== null && engine.callLostLeadId === panelCard.context.leadId;
  const panelPhase = inCallPhase || sessionLostOpen;
  if (!panelPhase && dismissedLead !== null) setDismissedLead(null);
  const panelOpen = panelPhase && panelCard !== null && dismissedLead !== panelCard.context.leadId;

  // Anotação do painel: grava na ligação do lead (blur, antes de ação final, ao trocar de lead, ao parar).
  const panelNote = useMotorPanelNote({
    live: !engine.simulated,
    leadId: panelCard?.context.leadId ?? null,
    leadName: panelCard?.context.company.name ?? '',
    engineCallId: engine.callId,
    dialing: phase === 'dialing',
    active: panelPhase,
    saver: noteSaver,
  });

  // UMA instância das ações do lead para o painel e para o bloco "O lead conversou": um só conjunto de diálogos.
  const rawLeadActions = useMotorLeadActions({
    leadId: panelCard?.context.leadId ?? '',
    leadName: panelCard?.context.company.name ?? '',
    leadEmail: panelCard?.context.decisionMaker.email ?? null,
    simulated: engine.simulated,
    previewOnly,
    schedulingPreview,
    onLeadActed: (kind) => {
      if (panelCard) engine.concludeExternally?.(panelCard.context.leadId, kind);
    },
    scheduleCallback: engine.scheduleCallback,
    attemptsToday: engine.attemptNo ?? 0,
    alreadyLost: panelCard?.context.company.status === 'unqualified',
    getNotes: panelNote.getValue,
    appendNote: panelNote.append,
  });

  // A anotação digitada NUNCA se perde: antes de qualquer ação final ela já foi mandada gravar.
  const leadActions = {
    ...rawLeadActions,
    schedule: () => {
      panelNote.flush();
      rawLeadActions.schedule();
    },
    callback: () => {
      panelNote.flush();
      rawLeadActions.callback();
    },
    refer: () => {
      panelNote.flush();
      rawLeadActions.refer();
    },
    disqualify: () => {
      panelNote.flush();
      rawLeadActions.disqualify();
    },
  };

  const company = panelCard?.context.company.name;
  const shortState = !running
    ? 'Discagem desligada. Escolha a fila e clique em Iniciar discagem.'
    : sessionLostOpen && company
      ? `Discagem pausada. Os dados de ${company} continuam no painel ao lado.`
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
                title={running ? 'Pare a discagem para trocar de fila' : undefined}
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
            Pare a discagem para trocar de fila.
          </p>
        )}

        {dayStats && <DialerDaySummary {...dayStats} />}

        <div className="space-y-4 rounded-lg border border-[var(--primary)]/40 bg-[var(--card)] p-4">
          <CockpitAutoDialBar engine={engine} sessionCalls={seenCalls.length} onHangup={() => void hangupCall()} />
          <p className="text-muted-foreground text-sm" data-testid="auto-dial-clean-state">
            {shortState}
          </p>
          {panelPhase && panelCard && showsRecoveryTag({ queue, status: panelCard.context.company.status }) && (
            <RecoveryTag reason={engine.leadCardExtras?.lossReasonName} />
          )}
          {panelPhase && !panelOpen && panelCard && (
            <Button type="button" size="sm" variant="outline" onClick={() => setDismissedLead(null)} data-testid="motor-panel-reopen">
              Ver dados do lead
            </Button>
          )}
          {phase === 'awaiting-sdr' && panelCard && (
            <AwaitingSdrBlock
              key={panelCard.context.leadId}
              reason={engine.state.phase === 'awaiting-sdr' ? engine.state.reason : 'answered'}
              isLost={panelCard.context.company.status === 'unqualified'}
              status={panelCard.context.company.status}
              actions={leadActions}
              onNotConversation={(engine as EngineWithNotConversation).notConversation}
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
          simulated={engine.simulated}
          actions={leadActions}
          queue={queue}
          note={panelNote}
        />
      )}
      {panelCard && leadActions.dialogs}
    </section>
  );
}

/** Só `answered` (o servidor confirmou que o lead atendeu) mostra "O lead conversou"; `timeout` pergunta primeiro. */
function AwaitingSdrBlock({ reason, ...props }: { reason: 'answered' | 'timeout' } & Parameters<typeof AutoDialAnsweredBlock>[0]) {
  return reason === 'answered' ? <AutoDialAnsweredBlock {...props} /> : <AutoDialUnknownResultBlock {...props} />;
}
