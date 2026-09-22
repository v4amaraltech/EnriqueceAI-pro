import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { callRpc } from '@/features/bdr-steps/actions/rpc';
import { clampInt } from '@/features/bdr-steps/services/external-step';
import { isUuid } from '@/lib/utils/uuid';

export const dynamic = 'force-dynamic';

/**
 * BDR-2 — Heartbeat do executor: estende o lease de uma execução em curso.
 * POST /api/v1/bdr/steps/renew { execution_id, owner?, lease_minutes?: 15 }
 * → { success: true, renovado: boolean } — false = execução já confirmada/liberada
 *   ou lease de outro executor; o chamador deve parar de agir sobre ela.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`bdr-steps:${auth.orgId}`, 600, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isUuid(body.execution_id)) return NextResponse.json({ success: false, error: 'execution_id obrigatório (uuid)' }, { status: 400 });

  try {
    const renovado = await callRpc<boolean>(createServiceRoleClient(), 'renew_step_lease', {
      p_org_id: auth.orgId,
      p_execution_id: body.execution_id,
      p_owner: typeof body.owner === 'string' ? body.owner.slice(0, 120) : null,
      p_lease_minutes: clampInt(body.lease_minutes, 15, 1, 240),
    });
    return NextResponse.json({ success: true, renovado: renovado === true });
  } catch (e) {
    console.error('[bdr-steps/renew]', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'Falha ao renovar o lease' }, { status: 500 });
  }
}
