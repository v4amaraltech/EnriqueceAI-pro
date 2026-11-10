import type { WebphoneCallContext } from './webphone-call-context';

export interface FinishedCallIdentity {
  startedAt: number;
  endedAt: number;
  /** Token gravado na perna SIP quando o INVITE foi desta discagem. */
  dialToken: string | null;
  context: { callId: string } | null;
}

/**
 * O contexto publicado ainda é esta ligação já encerrada?
 * Vale o `callId` do snapshot ou o token da mesma discagem. Horário e telefone,
 * sozinhos, não bastam: outra ligação pode começar 1s depois, no mesmo número.
 */
export function contextBelongsToFinished(context: WebphoneCallContext, finished: FinishedCallIdentity): boolean {
  if (finished.context?.callId && finished.context.callId === context.callId) return true;
  if (finished.dialToken && context.dialToken && finished.dialToken === context.dialToken) return true;
  return false;
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
