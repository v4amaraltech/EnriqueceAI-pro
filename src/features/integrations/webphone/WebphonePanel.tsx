'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { toast } from 'sonner';

import { scheduleActivity } from '@/features/activities/actions/schedule-activity';
import { CallResultModal } from '@/features/activities/components/CallResultModal';
import { classifyWebphoneCall } from '@/features/calls/actions/classify-webphone-call';
import { hangupCall as hangupProviderCall } from '@/features/calls/actions/initiate-call';
import { saveWebphoneCallAudio } from '@/features/calls/actions/save-webphone-call-audio';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils/format';
import { Button } from '@/shared/components/ui/button';
import { Textarea } from '@/shared/components/ui/textarea';

import { useApi4ComWebphone } from './useApi4ComWebphone';
import { useWebphoneCallContext } from './useWebphoneCallContext';
import { useWebphoneLeadAnswer } from './useWebphoneLeadAnswer';
import { useWebphonePanelHost } from './WebphonePanelHost';
import type { WebphoneAudioStats } from './webphone-audio-stats';
import { effectiveCallSeconds, leadConnected, type LeadAnswer } from './webphone-lead-answer';
import {
  clearWebphoneCallContext,
  contextMatchesCall,
  requestWebphoneConclude,
  setWebphoneCallNotes,
  type WebphoneCallContext,
} from './webphone-call-context';
import { answerCall, hangupCall as hangupWebphoneLeg, toggleMute } from './webphone-client';
import {
  clampPanelPosition,
  loadPanelPosition,
  movePanelPosition,
  savePanelPosition,
  type PanelPosition,
} from './webphone-panel-position';
import { callTalkSeconds, type WebphoneCall, type WebphoneState } from './webphone-state';

/**
 * Painel flutuante do webphone (story api4com-embedded-webphone, bloco 3).
 *
 * Vive no layout `(app)` e por isso continua na tela quando o SDR troca de
 * página no meio da ligação. Arrastável pelo cabeçalho (`@dnd-kit/core`), com a
 * posição lembrada em `localStorage`; sem ligação some da tela — só fica um
 * pill pequeno se o registro SIP deu erro ou o microfone está bloqueado.
 *
 * Quem iniciou a ligação (fila de atividades, Power Dialer) continua dono do
 * resultado: ao "Concluir" aqui, o painel só pede a esse discador para abrir o
 * `CallResultModal` dele, com as anotações daqui pré-preenchidas. Se o
 * discador já não está montado (ou a ligação veio do detalhe do lead, que não
 * tem modal), o painel abre o próprio `CallResultModal` e grava por
 * `classifyWebphoneCall`, como os discadores fazem. Depois disso o painel some:
 * não há mais avaliação de áudio com estrelas (decisão do Vini, 22/10/2026 —
 * clique demais para o SDR); a coleta de `audio_stats` continua, sem clique.
 *
 * "Atendida" aqui é do LEAD, não do ramal: a página atende o INVITE da API4COM
 * na hora, então o cliente SIP sempre vê a chamada como atendida. Quem diz se o
 * lead atendeu é o webhook (`useWebphoneLeadAnswer`), consultado enquanto a
 * ligação está no painel.
 */

const REGISTRATION_LABEL: Record<WebphoneState['registration'], { text: string; dot: string }> = {
  disabled: { text: 'Webphone desligado', dot: 'bg-gray-400' },
  connecting: { text: 'Conectando ao ramal…', dot: 'bg-amber-500' },
  registered: { text: 'Webphone ativo', dot: 'bg-green-500' },
  disconnected: { text: 'Webphone desconectado', dot: 'bg-gray-400' },
  error: { text: 'Webphone com erro', dot: 'bg-red-500' },
};

const DRAGGABLE_ID = 'webphone-panel';

/** Fotografia da ligação no momento em que acabou; sobrevive ao `call_cleared` do cliente. */
interface FinishedCall {
  id: string;
  remoteNumber: string;
  answered: boolean;
  talkSeconds: number;
  audioStats: WebphoneAudioStats | null;
  /** Contexto conhecido quando acabou (pode ser null: inbound sem `initiateCall`). */
  context: WebphoneCallContext | null;
}

type PanelStage =
  /** `doneCallId`: última ligação já concluída aqui — o cliente ainda a mostra como `ended` por ~2,5 s. */
  | { kind: 'idle'; doneCallId: string | null }
  | { kind: 'finished'; call: FinishedCall }
  | { kind: 'result'; call: FinishedCall };

function snapshotFinishedCall(call: WebphoneCall, context: WebphoneCallContext | null): FinishedCall {
  return {
    id: call.id,
    remoteNumber: call.remoteNumber,
    answered: call.answeredAt !== null,
    talkSeconds: callTalkSeconds(call, call.endedAt ?? Date.now()),
    audioStats: call.audioStats,
    context: contextMatchesCall(context, call) ? context : null,
  };
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function WebphonePanel() {
  const webphone = useApi4ComWebphone();
  const ctxState = useWebphoneCallContext();
  const [stage, setStage] = useState<PanelStage>({ kind: 'idle', doneCallId: null });
  const liveCall = webphone.call && webphone.call.phase !== 'ended' ? webphone.call : null;
  // Contexto que de fato pertence à ligação em andamento (um esquecido não conta).
  const liveCallContext = liveCall && contextMatchesCall(ctxState.context, liveCall) ? ctxState.context : null;
  const liveContextCallId = liveCallContext?.callId ?? null;

  // A ligação acabou de encerrar: congela a fotografia dela até o SDR concluir.
  // Ajuste durante o render (padrão do React para derivar estado de uma prop)
  // em vez de useEffect, para não pintar um frame sem o estado "finalizada".
  const endedCall = webphone.call?.phase === 'ended' ? webphone.call : null;
  const alreadyTracked = endedCall && (stage.kind === 'idle' ? stage.doneCallId === endedCall.id : stage.call.id === endedCall.id);
  if (endedCall && !alreadyTracked) {
    setStage({ kind: 'finished', call: snapshotFinishedCall(endedCall, ctxState.context) });
  }

  // Estatísticas de áudio: uma vez por ligação, assim que ela acaba.
  const statsSavedFor = useRef<string | null>(null);
  useEffect(() => {
    if (stage.kind === 'idle') return;
    const { call } = stage;
    const callId = call.context?.callId;
    if (!callId || !call.answered || !call.audioStats || statsSavedFor.current === call.id) return;
    statsSavedFor.current = call.id;
    saveWebphoneCallAudio({ callId, audioStats: call.audioStats })
      .then((r) => {
        if (!r.success) console.warn('[webphone] audio_stats not saved:', r.error);
      })
      .catch((err: unknown) => console.warn('[webphone] audio_stats not saved:', err));
  }, [stage]);

  // Contexto vivo da ligação fotografada (o dono pode ter liberado ou limpado).
  const finishedCallId = stage.kind === 'idle' ? null : stage.call.context?.callId ?? null;
  // O lead atendeu? (webhook da API4COM; "unknown" até ele chegar.)
  const leadAnswer = useWebphoneLeadAnswer(liveContextCallId ?? finishedCallId);
  const liveContext = finishedCallId && ctxState.context?.callId === finishedCallId ? ctxState.context : null;

  // O discador dono concluiu (ou fechou) o modal dele e limpou o contexto:
  // não há mais nada a fazer aqui e o painel some (ajuste durante o render).
  if (stage.kind === 'finished' && finishedCallId && !liveContext) {
    setStage({ kind: 'idle', doneCallId: stage.call.id });
  }

  const finish = useCallback((call: FinishedCall) => {
    if (call.context) clearWebphoneCallContext(call.context.callId);
    else setWebphoneCallNotes('');
    setStage({ kind: 'idle', doneCallId: call.id });
  }, []);

  function handleHangup() {
    void hangupWebphoneLeg();
    // Garantia pelo servidor (mesma chamada que o painel de atividades faz no
    // botão dele): se a perna WebRTC já caiu, a API4COM só responde que acabou.
    const providerCallId = liveCallContext?.providerCallId;
    if (providerCallId) {
      hangupProviderCall('api4com', providerCallId)
        .then((r) => {
          if (!r.success) console.warn('[webphone] hangupApi4ComCall:', r.error);
        })
        .catch((err: unknown) => console.warn('[webphone] hangupApi4ComCall failed:', err));
    }
  }

  function handleConclude() {
    if (stage.kind !== 'finished') return;
    const { call } = stage;
    if (liveContext?.ownerHandlesResult) {
      requestWebphoneConclude({
        callId: liveContext.callId,
        durationSeconds: effectiveCallSeconds(leadAnswer, call.talkSeconds),
        notes: ctxState.notes,
      });
      setStage({ kind: 'idle', doneCallId: call.id });
      return;
    }
    if (liveContext) {
      setStage({ kind: 'result', call });
      return;
    }
    // Sem linha em `calls` (inbound que não passou por initiateCall): nada a classificar.
    finish(call);
  }

  function handleOwnResult(call: FinishedCall, args: { notes: string; returnSchedule: { scheduledAt: string; channel: 'phone' | 'whatsapp' | 'email'; callProvider: 'whatsapp' | null } | null; outcome: Parameters<typeof classifyWebphoneCall>[0]['sdrOutcome'] }) {
    const ctx = call.context;
    if (!ctx) return;
    classifyWebphoneCall({
      callId: ctx.callId,
      sdrOutcome: args.outcome,
      clientDurationSeconds: effectiveCallSeconds(leadAnswer, call.talkSeconds),
      notes: args.notes || undefined,
      leadId: ctx.leadId ?? undefined,
    })
      .then((r) => {
        if (!r.success) toast.error(r.error);
      })
      .catch((err: unknown) => console.error('[webphone] classifyWebphoneCall failed:', err));
    if (args.returnSchedule && ctx.leadId) {
      scheduleActivity({
        leadId: ctx.leadId,
        channel: args.returnSchedule.channel,
        callProvider: args.returnSchedule.callProvider,
        scheduledAt: args.returnSchedule.scheduledAt,
        notes: args.notes ? `Retorno: ${args.notes}` : undefined,
      }).catch((err: unknown) => console.error('[webphone] scheduleActivity failed:', err));
    }
    clearWebphoneCallContext(ctx.callId);
    setStage({ kind: 'idle', doneCallId: call.id });
  }

  const resultCall = stage.kind === 'result' ? stage.call : null;
  // Gaveta/modal de tela cheia aberta (ex.: execução da fila de atividades):
  // o painel se desenha dentro dela, senão ficaria escondido e inacessível.
  const host = useWebphonePanelHost();

  // Sem ligação o painel some (como no CRM da matriz): só aparece quando o SDR
  // liga. O pill parado fica apenas para problema que impede ligar.
  const idle = !liveCall && stage.kind === 'idle';
  const idleProblem = webphone.registration === 'error' || webphone.mic === 'denied';

  const shell = (
    <DraggableShell compact={idle}>
      {liveCall ? (
        <LiveCallView
          call={liveCall}
          context={liveCallContext}
          leadAnswer={leadAnswer}
          notes={ctxState.notes}
          onNotesChange={setWebphoneCallNotes}
          onHangup={handleHangup}
        />
      ) : stage.kind === 'finished' ? (
        <FinishedView call={stage.call} leadAnswer={leadAnswer} notes={ctxState.notes} onNotesChange={setWebphoneCallNotes} onConclude={handleConclude} />
      ) : stage.kind === 'result' ? (
        <p className="text-xs text-[var(--muted-foreground)]">Registre o resultado da ligação…</p>
      ) : (
        <IdlePill state={webphone} />
      )}
    </DraggableShell>
  );

  return (
    <>
      {idle && !idleProblem ? null : host ? createPortal(shell, host) : shell}

      {resultCall?.context && (
        <CallResultModal
          open
          onClose={() => finish(resultCall)}
          leadName={resultCall.context.leadName ?? resultCall.remoteNumber ?? 'Lead'}
          leadId={resultCall.context.leadId ?? undefined}
          phoneLabel={resultCall.context.phone ?? resultCall.remoteNumber}
          durationSeconds={effectiveCallSeconds(leadAnswer, resultCall.talkSeconds)}
          connected={leadConnected(leadAnswer, resultCall.answered)}
          dismissible={false}
          initialNotes={ctxState.notes}
          onConclude={(args) => handleOwnResult(resultCall, args)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Casca arrastável
// ---------------------------------------------------------------------------

function DraggableShell({ compact, children }: { compact: boolean; children: React.ReactNode }) {
  const [position, setPosition] = useState<PanelPosition | null>(() =>
    typeof window === 'undefined' ? null : loadPanelPosition(window.localStorage),
  );
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Se a janela encolheu desde a última visita, o painel não pode ficar fora da tela.
  useEffect(() => {
    function clampToViewport() {
      const node = nodeRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setPosition((prev) => {
        if (!prev) return prev;
        const next = clampPanelPosition(prev, { width: rect.width, height: rect.height }, viewportSize());
        return next.x === prev.x && next.y === prev.y ? prev : next;
      });
    }
    const raf = window.requestAnimationFrame(clampToViewport);
    window.addEventListener('resize', clampToViewport);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', clampToViewport);
    };
  }, [compact]);

  function handleDragEnd(event: DragEndEvent) {
    const node = nodeRef.current;
    if (!node) return;
    // O `transform` do dnd-kit ainda está aplicado aqui: a posição base é o
    // retângulo SEM o deslocamento do arrasto.
    const rect = node.getBoundingClientRect();
    const base = position ?? { x: rect.left - event.delta.x, y: rect.top - event.delta.y };
    const next = movePanelPosition(base, event.delta, { width: rect.width, height: rect.height }, viewportSize());
    setPosition(next);
    savePanelPosition(window.localStorage, next);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <DraggableBox position={position} compact={compact} nodeRef={nodeRef}>
        {children}
      </DraggableBox>
    </DndContext>
  );
}

function DraggableBox({
  position,
  compact,
  nodeRef,
  children,
}: {
  position: PanelPosition | null;
  compact: boolean;
  nodeRef: React.MutableRefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: DRAGGABLE_ID });

  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 50,
    transform: CSS.Translate.toString(transform),
    ...(position ? { left: position.x, top: position.y } : { left: 16, bottom: 16 }),
  };

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        nodeRef.current = el;
      }}
      style={style}
      data-webphone-panel
      data-dragging={isDragging || undefined}
      role="region"
      aria-label="Webphone"
      className={cn(
        'border border-[var(--border)] bg-[var(--background)] text-sm shadow-xl',
        compact ? 'rounded-full' : 'w-80 rounded-xl',
        isDragging && 'opacity-90',
      )}
    >
      {compact ? (
        <div ref={setActivatorNodeRef} {...listeners} {...attributes} className="flex cursor-grab select-none items-center gap-2 px-3 py-2 active:cursor-grabbing">
          {children}
        </div>
      ) : (
        <>
          <div
            ref={setActivatorNodeRef}
            {...listeners}
            {...attributes}
            className="flex cursor-grab select-none items-center gap-1 rounded-t-xl border-b border-[var(--border)] bg-[var(--muted)]/60 px-2 py-1.5 text-xs text-[var(--muted-foreground)] active:cursor-grabbing"
            aria-label="Arrastar painel do webphone"
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
            <span>Webphone</span>
          </div>
          <div className="space-y-3 p-3">{children}</div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conteúdos
// ---------------------------------------------------------------------------

function IdlePill({ state }: { state: WebphoneState }) {
  const reg = REGISTRATION_LABEL[state.registration];
  return (
    <span className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]" role="status" aria-live="polite">
      <span className={cn('inline-block h-2.5 w-2.5 rounded-full', reg.dot)} aria-hidden />
      {reg.text}
      {state.mic === 'denied' && ' · microfone bloqueado'}
      {state.error && state.registration === 'error' && ` · ${state.error}`}
    </span>
  );
}

function LiveCallView({
  call,
  context,
  leadAnswer,
  notes,
  onNotesChange,
  onHangup,
}: {
  call: WebphoneCall;
  context: WebphoneCallContext | null;
  leadAnswer: LeadAnswer;
  notes: string;
  onNotesChange: (notes: string) => void;
  onHangup: () => void;
}) {
  const inCall = call.phase === 'in-call';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!inCall) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [inCall]);

  // Ramal atendido pela página ≠ lead atendeu: até o webhook confirmar, a
  // ligação integrada continua "chamando" o lead.
  const title =
    call.phase === 'in-call'
      ? call.integrated && leadAnswer !== 'answered'
        ? 'Chamando o lead…'
        : 'Em ligação'
      : call.integrated || call.direction === 'outgoing'
        ? 'Chamando…'
        : 'Chamada recebida';
  const name = context?.leadName ?? null;
  const number = context?.phone ?? call.remoteNumber ?? '';

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{title}</p>
          <p className="truncate font-medium">{name ?? (number || 'Número desconhecido')}</p>
          {name && number && <p className="truncate text-xs text-[var(--muted-foreground)]">{number}</p>}
        </div>
        <p className="shrink-0 font-mono text-lg tabular-nums" aria-label="Tempo de ligação">
          {inCall ? formatDuration(callTalkSeconds(call, now)) : '00:00'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {call.phase === 'ringing' && !call.integrated && call.direction === 'incoming' && (
          <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={answerCall}>
            <Phone className="h-4 w-4" /> Atender
          </Button>
        )}
        <Button size="sm" variant="outline" className="flex-1" onClick={toggleMute} disabled={!inCall} aria-pressed={call.muted}>
          {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {call.muted ? 'Mutado' : 'Mutar'}
        </Button>
        <Button size="sm" variant="destructive" className="flex-1" onClick={onHangup}>
          <PhoneOff className="h-4 w-4" /> Desligar
        </Button>
      </div>

      <NotesField notes={notes} onChange={onNotesChange} />
    </>
  );
}

function FinishedView({
  call,
  leadAnswer,
  notes,
  onNotesChange,
  onConclude,
}: {
  call: FinishedCall;
  leadAnswer: LeadAnswer;
  notes: string;
  onNotesChange: (notes: string) => void;
  onConclude: () => void;
}) {
  const name = call.context?.leadName ?? null;
  const number = call.context?.phone ?? call.remoteNumber;
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Ligação finalizada</p>
          <p className="truncate font-medium">{name ?? (number || 'Número desconhecido')}</p>
          {name && number && <p className="truncate text-xs text-[var(--muted-foreground)]">{number}</p>}
        </div>
        <p className="shrink-0 text-right font-mono text-lg tabular-nums">
          {leadConnected(leadAnswer, call.answered) ? formatDuration(call.talkSeconds) : <span className="text-sm text-amber-600">Não atendida</span>}
        </p>
      </div>
      <NotesField notes={notes} onChange={onNotesChange} autoFocus />
      <Button size="sm" className="w-full" onClick={onConclude}>
        Concluir
      </Button>
    </>
  );
}

function NotesField({ notes, onChange, autoFocus }: { notes: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Textarea
      value={notes}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Anotações da ligação…"
      className="min-h-[64px] max-h-40 resize-y text-sm"
      aria-label="Anotações da ligação"
      autoFocus={autoFocus}
    />
  );
}
