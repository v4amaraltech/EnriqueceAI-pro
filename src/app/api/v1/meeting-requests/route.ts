import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { AgendaError, getOrCreateMeetingRequest, suggestSlots } from '@/features/bdr-agenda/actions/meeting-requests';
import { isUuid } from '@/shared/utils/uuid';

/**
 * BDR-4 — Cria (ou devolve) a solicitação de reunião ativa do lead e sugere
 * 2 horários livres do closer. Idempotente por `execution_id`.
 * POST /api/v1/meeting-requests  {lead_id, closer_id, conversation_id?, origem, execution_id?, count?, holidays?}
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`inbound-api:${auth.orgId}`, 100, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const leadId = body.lead_id, closerId = body.closer_id;
  if (typeof leadId !== 'string' || !isUuid(leadId) || typeof closerId !== 'string' || !isUuid(closerId)) {
    return NextResponse.json({ success: false, error: 'lead_id e closer_id (uuid) obrigatórios' }, { status: 400 });
  }
  const supabase = createServiceRoleClient();
  try {
    const { request: req, criada } = await getOrCreateMeetingRequest(supabase, {
      orgId: auth.orgId, leadId, closerId,
      conversationId: typeof body.conversation_id === 'string' ? body.conversation_id : null,
      origem: typeof body.origem === 'string' ? body.origem : 'agente',
      executionId: typeof body.execution_id === 'string' ? body.execution_id : null,
    });
    const slots = ['aberta', 'conflito'].includes(req.estado)
      ? await suggestSlots(supabase, req, { count: Number(body.count ?? 2), holidays: Array.isArray(body.holidays) ? (body.holidays as string[]) : [] })
      : [];
    return NextResponse.json({ success: true, data: { request: req, criada, slots } }, { status: criada ? 201 : 200 });
  } catch (e) {
    if (e instanceof AgendaError) return NextResponse.json({ success: false, error: e.message, code: e.code }, { status: e.statusCode });
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
