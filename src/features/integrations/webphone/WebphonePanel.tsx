'use client';

import { useEffect, useRef, useState } from 'react';
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
import { useWebphoneCallOutcome } from './useWebphoneLeadAnswer';
import { useWebphonePanelHost } from './WebphonePanelHost';
import type { WebphoneAudioStats } from './webphone-audio-stats';
import { effectiveCallSeconds, hangupReasonLabel, leadConnected, type LeadAnswer } from './webphone-lead-answer';
import {
  ackHeldWebphoneNotes,
  clearWebphoneCallContext,
  contextMatchesCall,
  requestWebphoneConclude,
  setWebphoneCallNotes,
  type WebphoneCallContext,
} from './webphone-call-context';
import { contextBelongsToFinished, shouldFollowNewContext } from './webphone-panel-follow';
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
  startedAt: number;
  endedAt: number;
  /** Contexto conhecido quando acabou (pode ser null: inbound sem `initiateCall`). */
  context: WebphoneCallContext | null;
}

type PanelStage =
  /** `doneCallId`: última ligação já concluída aqui — o cliente ainda a mostra como `ended` por ~2,5 s. */
  | { kind: 'idle'; doneCallId: string | null; doneContextId: string | null }
  | { kind: 'finished'; call: FinishedCall }
  | { kind: 'result'; call: FinishedCall };

function snapshotFinishedCall(call: WebphoneCall, context: WebphoneCallContext | null): FinishedCall {
  const endedAt = call.endedAt ?? Date.now();
  const draft: FinishedCall = {
    id: call.id,
    remoteNumber: call.remoteNumber,
    answered: call.answeredAt !== null,
    talkSeconds: callTalkSeconds(call, endedAt),
    audioStats: call.audioStats,
    startedAt: call.startedAt,
    endedAt,
    context: null,
  };
  return { ...draft, context: context && contextBelongsToFinished(context, draft) ? context : null };
}

function finishedFromContext(context: WebphoneCallContext, answered: boolean, talkSeconds: number): FinishedCall {
  const seconds = answered ? Math.max(0, talkSeconds) : 0;
  return {
    id: `server-${context.callId}`,
    remoteNumber: (context.phone ?? '').replace(/\D/g, ''),
    answered,
    talkSeconds: seconds,
    audioStats: null,
    startedAt: context.startedAt,
    endedAt: context.startedAt + seconds * 1000,
    context,
  };
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function WebphonePanel() {
  const webphone = useApi4ComWebphone();
  const ctxState = useWebphoneCallContext();
  const [stage, setStage] = useState<PanelStage>({ kind: 'idle', doneCallId: null, doneContextId: null });
  const liveCall = webphone.call && webphone.call.phase !== 'ended' ? webphone.call : null;
  // Contexto que de fato pertence à ligação em andamento (um esquecido não conta).
  const liveCallContext = liveCall && contextMatchesCall(ctxState.context, liveCall) ? ctxState.context : null;
  const liveContextCallId = liveCallContext?.callId ?? null;

  const context = ctxState.context;
  const followNew = shouldFollowNewContext(
    context,
    stage.kind === 'idle' ? { kind: 'idle', doneContextId: stage.doneContextId } : { kind: stage.kind, call: stage.call },
    liveCall,
  );
  const finishedCallId = stage.kind === 'idle' ? null : stage.call.context?.callId ?? null;
  // O lead atendeu? (webhook da API4COM; "unknown" até ele chegar.) Na ligação
  // que o painel acompanha sem SIP, a consulta segue até o desligamento.
  const outcome = useWebphoneCallOutcome(followNew && context ? context.callId : (liveContextCallId ?? finishedCallId), followNew);
  const { leadAnswer, hangupCause } = outcome;
  const durationSeconds = outcome.durationSeconds ?? 0;

  // A ligação acabou de encerrar: congela a fotografia dela até o SDR concluir.
  // Ajuste durante o render (padrão do React para derivar estado de uma prop)
  // em vez de useEffect, para não pintar um frame sem o estado "finalizada".
  // Um SIP encerrado antigo não pode reocupar a tela se o contexto já é outra ligação.
  const endedCall = webphone.call?.phase === 'ended' ? webphone.call : null;
  const alreadyTracked = endedCall && (stage.kind === 'idle' ? stage.doneCallId === endedCall.id : stage.call.id === endedCall.id);
  if (endedCall && !alreadyTracked) {
    const snap = snapshotFinishedCall(endedCall, context);
    const stageAlreadyFollowsContext =
      stage.kind !== 'idle' &&
      Boolean(context?.callId) &&
      stage.call.context?.callId === context?.callId &&
      stage.call.id !== endedCall.id;
    if (!stageAlreadyFollowsContext && (!context || contextBelongsToFinished(context, snap))) {
      setStage({ kind: 'finished', call: snap });
    }
  }

  // HTTP do POST /calls chegou depois do fim: gruda o contexto nesta finalizada,
  // em vez de tratar a resposta atrasada como uma ligação nova.
  if (stage.kind === 'finished' && !stage.call.context && context && contextBelongsToFinished(context, stage.call)) {
    setStage({ kind: 'finished', call: { ...stage.call, context } });
  }

  // Sem sessão SIP, o fim vem da linha de calls. Aí a tela vira o resultado
  // desta ligação, não da anterior.
  if (followNew && context && hangupCause) {
    setStage({
      kind: 'finished',
      call: finishedFromContext(context, leadAnswer === 'answered', durationSeconds),
    });
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

  // Notas que saíram da tela com a ligação seguinte. Grava na chamada antiga,
  // sem desfecho e sem concluir atividade. Falha avisa e mantém o texto na aba.
  const heldNotes = ctxState.heldNotes;
  useEffect(() => {
    if (heldNotes.length === 0) return;
    let cancelled = false;
    for (const item of heldNotes) {
      void classifyWebphoneCall({
        callId: item.callId,
        clientDurationSeconds: 0,
        notes: item.notes,
        leadId: item.leadId ?? undefined,
      })
        .then((r) => {
          if (cancelled) return;
          if (r.success) ackHeldWebphoneNotes(item.callId);
          else toast.error('Não consegui guardar a anotação da ligação anterior. Ela continua nesta aba.');
        })
        .catch(() => {
          if (!cancelled) toast.error('Não consegui guardar a anotação da ligação anterior. Ela continua nesta aba.');
        });
    }
    return () => {
      cancelled = true;
    };
  }, [heldNotes]);

  // Contexto vivo da ligação fotografada (o dono pode ter liberado ou limpado).
  const liveContext = finishedCallId && context?.callId === finishedCallId ? context : null;

  // O discador dono concluiu (ou fechou) o modal dele e limpou o contexto:
  // não há mais nada a fazer aqui e o painel some (ajuste durante o render).
  // Não some se o contexto atual é uma ligação nova: essa passa a ocupar a tela.
  if (stage.kind === 'finished' && finishedCallId && !liveContext && !followNew) {
    setStage({ kind: 'idle', doneCallId: endedCall?.id ?? stage.call.id, doneContextId: stage.call.context?.callId ?? null });
  }

  function finish(call: FinishedCall) {
    if (call.context) clearWebphoneCallContext(call.context.callId);
    else setWebphoneCallNotes('');
    setStage({ kind: 'idle', doneCallId: endedCall?.id ?? call.id, doneContextId: call.context?.callId ?? null });
  }

  function handleHangup() {
    void hangupWebphoneLeg();
    // Garantia pelo servidor (mesma chamada que o painel de atividades faz no
    // botão dele): se a perna WebRTC já caiu, a API4COM só responde que acabou.
    const providerCallId = liveCallContext?.providerCallId ?? (followNew ? context?.providerCallId : null);
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
      setStage({ kind: 'idle', doneCallId: endedCall?.id ?? call.id, doneContextId: liveContext.callId });
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
    setStage({ kind: 'idle', doneCallId: endedCall?.id ?? call.id, doneContextId: ctx.callId });
  }

  const resultCall = stage.kind === 'result' ? stage.call : null;
  // Gaveta/modal de tela cheia aberta (ex.: execução da fila de atividades):
  // o painel se desenha dentro dela, senão ficaria escondido e inacessível.
  const host = useWebphonePanelHost();

  // Sem ligação o painel some (como no CRM da matriz): só aparece quando o SDR
  // liga. O pill parado fica apenas para problema que impede ligar.
  const showingDialing = Boolean(followNew && context);
  const idle = !liveCall && !showingDialing && stage.kind === 'idle';
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
      ) : showingDialing && context ? (
        <DialingView
          context={context}
          leadAnswer={leadAnswer}
          notes={ctxState.notes}
          onNotesChange={setWebphoneCallNotes}
          onHangup={handleHangup}
        />
      ) : stage.kind === 'finished' ? (
        <FinishedView call={stage.call} leadAnswer={leadAnswer} hangupCause={hangupCause} notes={ctxState.notes} onNotesChange={setWebphoneCallNotes} onConclude={handleConclude} />
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

      {!showingDialing && resultCall?.context && (
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
          returnReadyMessage="A atividade de retorno é criada."
          onNotesChange={setWebphoneCallNotes}
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

function DialingView({
  context,
  leadAnswer,
  notes,
  onNotesChange,
  onHangup,
}: {
  context: WebphoneCallContext;
  leadAnswer: LeadAnswer;
  notes: string;
  onNotesChange: (notes: string) => void;
  onHangup: () => void;
}) {
  const inTalk = leadAnswer === 'answered';
  const [now, setNow] = useState(() => Date.now());
  const [anchor, setAnchor] = useState<number | null>(() => (inTalk ? Date.now() : null));
  const [trackedTalk, setTrackedTalk] = useState(inTalk);
  if (inTalk !== trackedTalk) {
    setTrackedTalk(inTalk);
    setAnchor(inTalk ? now : null);
  }
  useEffect(() => {
    if (!inTalk) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [inTalk]);
  const number = context.phone ?? '';
  const name = context.leadName;
  const seconds = inTalk && anchor !== null ? Math.max(0, Math.floor((now - anchor) / 1000)) : 0;
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            {inTalk ? 'Em ligação' : 'Chamando…'}
          </p>
          <p className="truncate font-medium">{name ?? (number || 'Número desconhecido')}</p>
          {name && number && <p className="truncate text-xs text-[var(--muted-foreground)]">{number}</p>}
        </div>
        <p className="shrink-0 font-mono text-lg tabular-nums" aria-label="Tempo de ligação">
          {formatDuration(seconds)}
        </p>
      </div>
      <div className="flex items-center gap-2">
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
  hangupCause,
  notes,
  onNotesChange,
  onConclude,
}: {
  call: FinishedCall;
  leadAnswer: LeadAnswer;
  hangupCause: string | null;
  notes: string;
  onNotesChange: (notes: string) => void;
  onConclude: () => void;
}) {
  const name = call.context?.leadName ?? null;
  const number = call.context?.phone ?? call.remoteNumber;
  const reason = leadAnswer === 'not_answered' ? hangupReasonLabel(hangupCause) : null;
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
      {reason && (
        <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400" role="status" data-testid="webphone-hangup-reason">
          {reason}
        </p>
      )}
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
