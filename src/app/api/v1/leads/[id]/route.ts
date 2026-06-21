import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { getLeadById } from '@/features/inbound-api/services/read-leads.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetch a single lead by id, scoped to the authenticated org.
 * GET /api/v1/leads/{id}
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // 1. Authenticate
    const auth = await authenticateApiKey(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'API key inválida ou expirada' },
        { status: 401 },
      );
    }

    // 2. Rate limit: 100 req/min per org (shared read bucket)
    const rateLimit = await checkRateLimit(`api-read:${auth.orgId}`, 100, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit excedido. Tente novamente em breve.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rateLimit.retryAfterMs ?? 60_000) / 1000)),
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
          },
        },
      );
    }

    // 3. Validate id
    const { id } = await params;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { success: false, error: 'ID de lead inválido' },
        { status: 422 },
      );
    }

    // 4. Fetch (org-scoped — service role bypasses RLS, so org_id is enforced here)
    const supabase = createServiceRoleClient();
    const lead = await getLeadById(supabase, auth.orgId, id);

    if (!lead) {
      return NextResponse.json(
        { success: false, error: 'Lead não encontrado' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: lead });
  } catch (err) {
    console.error('[v1/leads/:id GET] error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Erro interno do servidor' },
      { status: 500 },
    );
  }
}
