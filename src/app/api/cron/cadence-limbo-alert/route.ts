import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { checkCadenceLimbo } from '@/features/cadences/actions/cadence-limbo-alert';
import { createPausedCadenceFollowups } from '@/features/cadences/actions/paused-cadence-followup';

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Antes do alerta: cadência pausada sem data de volta vira tarefa "Definir
  // destino" na fila do SDR. O alerta aos gestores fica só com o que sobrar.
  const followups = await createPausedCadenceFollowups();

  const result = await checkCadenceLimbo();

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: result.data, followups: followups.success ? followups.data : { error: followups.error } });
}
