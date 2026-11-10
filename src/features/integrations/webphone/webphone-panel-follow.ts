import { CONTEXT_MATCH_WINDOW_MS, type WebphoneCallContext } from './webphone-call-context';

/**
 * O POST /calls pode responder pouco depois de a perna SIP cair (ligação curta).
 * Nesse intervalo o contexto ainda é desta chamada, não da próxima.
 */
export const FINISHED_CONTEXT_GRACE_MS = CONTEXT_MATCH_WINDOW_MS;

export interface FinishedCallIdentity {
  startedAt: number;
  endedAt: number;
  context: { callId: string } | null;
}

/**
 * O contexto publicado ainda é o desta ligação já encerrada?
 * Com `callId` no snapshot, a identidade é o id. Sem ele (o HTTP chegou depois
 * do fim), vale a janela de tempo. Um contexto mais novo não pertence.
 */
export function contextBelongsToFinished(context: WebphoneCallContext, finished: FinishedCallIdentity): boolean {
  if (finished.context) return finished.context.callId === context.callId;
  return (
    context.startedAt >= finished.startedAt - CONTEXT_MATCH_WINDOW_MS &&
    context.startedAt <= finished.endedAt + FINISHED_CONTEXT_GRACE_MS
  );
}

/**
 * A tela deve acompanhar o contexto novo em vez da ligação SIP já encerrada.
 * Sessão SIP ainda em curso continua mandando na tela: o discador não publica
 * outro contexto enquanto `dialingBlockReason` vê chamada ativa.
 */
export function shouldFollowNewContext(
  context: WebphoneCallContext | null,
  stage: { kind: 'idle'; doneContextId: string | null } | { kind: 'finished' | 'result'; call: FinishedCallIdentity },
  liveCall: { startedAt: number } | null,
): boolean {
  if (!context || liveCall) return false;
  // Contexto que o dono acabou de concluir não é uma discagem nova.
  if (stage.kind === 'idle') return context.callId !== stage.doneContextId;
  return !contextBelongsToFinished(context, stage.call);
}
