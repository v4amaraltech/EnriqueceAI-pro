import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { inboundLeadSchema } from '@/features/inbound-api/schemas/inbound-lead.schemas';
import { ingestInboundLeads } from '@/features/inbound-api/services/inbound-lead.service';
import { isEventProcessed, markEventProcessed } from '@/lib/webhooks/idempotency';

export const maxDuration = 30;

// Limit request body size to 1MB
export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export async function POST(request: Request) {
  // 1. Authenticate
  const auth = await authenticateApiKey(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: 'API key inválida ou expirada' },
      { status: 401 },
    );
  }

  // 2. Rate limit: 100 req/min per org
  const rateLimit = await checkRateLimit(`inbound-api:${auth.orgId}`, 100, 60_000);
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

  // 3. Idempotency check
  const idempotencyKey = request.headers.get('x-idempotency-key');
  if (idempotencyKey) {
    const supabase = createServiceRoleClient();
    const alreadyProcessed = await isEventProcessed(supabase, 'inbound-api', idempotencyKey);
    if (alreadyProcessed) {
      return NextResponse.json(
        { success: true, message: 'Requisição já processada (idempotência)' },
        { status: 200 },
      );
    }
  }

  // 4. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'JSON inválido' },
      { status: 400 },
    );
  }

  // 5. Validate single lead
  const parsed = inboundLeadSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return NextResponse.json(
      { success: false, error: 'Erro de validação', details: fieldErrors },
      { status: 422 },
    );
  }

  // 6. Ingest
  const supabase = createServiceRoleClient();
  const result = await ingestInboundLeads(
    [body as Record<string, unknown>],
    {
      orgId: auth.orgId,
      supabase,
      defaultSource: 'api',
      onDuplicate: 'skip',
    },
  );

  // 7. Mark idempotency
  if (idempotencyKey) {
    await markEventProcessed(supabase, 'inbound-api', idempotencyKey, 'lead.create').catch(() => {});
  }

  const firstResult = result.results[0];

  if (firstResult?.status === 'error') {
    // Check if it's a lead limit error
    if (firstResult.error?.includes('Limite de leads')) {
      return NextResponse.json(
        { success: false, error: firstResult.error },
        { status: 402 },
      );
    }
    return NextResponse.json(
      { success: false, error: firstResult.error },
      { status: 422 },
    );
  }

  if (firstResult?.status === 'duplicate') {
    return NextResponse.json(
      { success: false, error: 'Lead duplicado', existing_lead_id: firstResult.existing_lead_id },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { success: true, data: { lead_id: firstResult?.lead_id } },
    { status: 201 },
  );
}
