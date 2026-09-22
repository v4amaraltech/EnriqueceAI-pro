import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { callRpc } from '@/features/bdr-steps/actions/rpc';
import { parseClaimRequest } from '@/features/bdr-steps/services/external-step';

export const dynamic = 'force-dynamic';

/**
 * BDR-2 — Reserva de passos vencidos para o executor (n8n).
 *
 * POST /api/v1/bdr/steps/claim
 *   { cadence_ids: uuid[], channel?: 'phone', limit?: 10, lease_minutes?: 15, owner?: 'n8n-<execution>' }
 * → { success, data: [{ execution_id, attempt, recuperada, lease_until, enrollment_id, cadence_id,
 *      step_id, step_order, instructions, dono, lead_id, lead_nome, lead_empresa, lead_cargo,
 *      lead_telefone, lead_email, ... }] }
 *
 * `execution_id` é persistente por (inscrição, passo, tentativa): mande-o no
 * dispatch do V4 Call. Se o n8n cair e reservar de novo (`recuperada: true`),
 * o id é o mesmo e o V4 Call devolve o call_sid existente sem discar.
 * Passo reservado some da fila até `lease_until` (ou até /release).
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`bdr-steps:${auth.orgId}`, 300, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const parsed = parseClaimRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const q = parsed.value;

  try {
    const rows = await callRpc<unknown[]>(createServiceRoleClient(), 'claim_due_steps', {
      p_org_id: auth.orgId,
      p_cadence_ids: q.cadenceIds,
      p_channel: q.channel,
      p_limit: q.limit,
      p_lease_minutes: q.leaseMinutes,
      p_owner: q.owner,
    });
    return NextResponse.json({ success: true, data: rows ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[bdr-steps/claim]', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'Falha ao reservar passos' }, { status: 500 });
  }
}
