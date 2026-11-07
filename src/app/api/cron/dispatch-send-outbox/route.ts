import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';

import { runDispatchCycle } from '@/features/contact-engine/services/dispatch-cycle.service';

export const maxDuration = 60;

/**
 * Cron do dispatcher da outbox de envio (PR08 do motor de contato).
 *
 * NAO esta agendado: ativar e uma acao separada (docs/architecture/call-cockpit-engine.md,
 * secao 10). Com a flag `dispatcher_v1` desligada (padrao) responde 200 sem ler
 * nem enviar nada. Nao usa runTrackedWorker para que a flag desligada nao escreva
 * nem o estado do worker.
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runDispatchCycle();
    return NextResponse.json({ ok: true, enabled: result.enabled, reason: result.reason, data: result });
  } catch (err) {
    console.error('[dispatch-send-outbox] falhou:', err instanceof Error ? err.name : 'erro');
    return NextResponse.json({ error: 'Falha ao despachar a outbox de envio' }, { status: 500 });
  }
}
