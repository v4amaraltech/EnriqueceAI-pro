'use client';

import type { ActionResult } from '@/lib/actions/action-result';

import type { WebphoneCallOutcome } from './actions/get-webphone-call-outcome';

/**
 * Consulta o resultado da ligação pela rota GET `/api/webphone/call-outcome`.
 *
 * Não usar a Server Action `getWebphoneCallOutcome` no navegador: as actions
 * saem em fila, uma por vez, e o polling de 3 s atrasava a próxima discagem.
 * Devolve `null` em falha de rede (o chamador tenta de novo no próximo ciclo).
 */
export async function fetchWebphoneCallOutcome(
  callId: string,
): Promise<ActionResult<WebphoneCallOutcome> | null> {
  try {
    const res = await fetch(`/api/webphone/call-outcome?callId=${encodeURIComponent(callId)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as ActionResult<WebphoneCallOutcome>;
  } catch {
    return null;
  }
}
