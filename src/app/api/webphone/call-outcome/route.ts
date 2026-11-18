import { NextResponse } from 'next/server';

import { getWebphoneCallOutcome } from '@/features/calls/actions/get-webphone-call-outcome';

export const dynamic = 'force-dynamic';

/**
 * Leitura do resultado da ligação (o lead atendeu? causa do fim, sugestões).
 *
 * É rota GET, e não Server Action, de propósito: o Next manda as Server
 * Actions uma de cada vez, em fila. O modal de resultado consulta isto a cada
 * 3 s; como action, essas consultas ficavam na frente do `initiateCall` e o
 * "Ligar de novo" levava ~10 s para tocar o ramal. Rota comum não entra na fila.
 * A lógica (auth + filtro por org) é a mesma da action.
 */
export async function GET(request: Request) {
  const callId = new URL(request.url).searchParams.get('callId');
  const result = await getWebphoneCallOutcome({ callId });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
