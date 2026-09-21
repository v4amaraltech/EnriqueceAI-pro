import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { computeEmailAdmission } from '@/features/bdr-admission/actions/admission';
import { isUuid } from '@/shared/utils/uuid';

/**
 * BDR-5 — Capacidade de e-mail nos próximos dias úteis e contatos novos admissíveis hoje.
 * POST /api/v1/bdr/admission {cadence_ids: uuid[], dias?: 14, holidays?: ['YYYY-MM-DD']}
 * O n8n combina com GET /capacity do V4 Call (ligações) e admite o mínimo.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`api-read:${auth.orgId}`, 100, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const cadenceIds = Array.isArray(body.cadence_ids) ? (body.cadence_ids as string[]).filter(isUuid) : [];
  if (!cadenceIds.length) return NextResponse.json({ success: false, error: 'cadence_ids obrigatório' }, { status: 400 });
  const data = await computeEmailAdmission(createServiceRoleClient(), {
    orgId: auth.orgId, cadenceIds, dias: Math.min(30, Number(body.dias ?? 14)),
    holidays: Array.isArray(body.holidays) ? (body.holidays as string[]) : [],
  });
  return NextResponse.json({ success: true, data });
}
