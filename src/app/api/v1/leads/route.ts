import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { inboundLeadSchema } from '@/features/inbound-api/schemas/inbound-lead.schemas';
import { readLeadsQuerySchema } from '@/features/inbound-api/schemas/read-leads.schemas';
import { ingestInboundLeads } from '@/features/inbound-api/services/inbound-lead.service';
import { listLeads } from '@/features/inbound-api/services/read-leads.service';
import { isEventProcessed, markEventProcessed } from '@/lib/webhooks/idempotency';

export const maxDuration = 30;

const MAX_BODY_SIZE = 1_048_576; // 1MB

const READ_QUERY_KEYS = ['page', 'per_page', 'status', 'updated_since', 'lead_source', 'canal'] as const;

/**
 * List leads for the authenticated org (paginated, filtered).
 * GET /api/v1/leads?page=1&per_page=50&status=new,contacted&updated_since=ISO
 */
export async function GET(request: Request) {
  try {
    // 1. Authenticate
    const auth = await authenticateApiKey(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'API key inválida ou expirada' },
        { status: 401 },
      );
    }

    // 2. Rate limit: 100 req/min per org (separate bucket from writes)
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

    // 3. Parse + validate query params
    const searchParams = new URL(request.url).searchParams;
    const rawQuery: Record<string, string> = {};
    for (const key of READ_QUERY_KEYS) {
      const value = searchParams.get(key);
      if (value !== null) rawQuery[key] = value;
    }

    const parsed = readLeadsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      const fieldErrors = parsed.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return NextResponse.json(
        { success: false, error: 'Parâmetros inválidos', details: fieldErrors },
        { status: 422 },
      );
    }

    // 4. Query (org-scoped — service role bypasses RLS, so org_id is enforced here)
    const supabase = createServiceRoleClient();
    const result = await listLeads(supabase, auth.orgId, parsed.data);

    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: {
        page: result.page,
        per_page: result.per_page,
        total: result.total,
        total_pages: result.total_pages,
      },
    });
  } catch (err) {
    console.error('[v1/leads GET] error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Erro interno do servidor' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
  // 0. Check body size
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return NextResponse.json(
      { success: false, error: 'Payload excede o limite de 1MB' },
      { status: 413 },
    );
  }

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
  try {
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
      await markEventProcessed(supabase, 'inbound-api', idempotencyKey, 'lead.create').catch((err: unknown) => console.error('[v1/leads] markEventProcessed failed:', err));
    }

    const firstResult = result.results[0];

    if (firstResult?.status === 'error') {
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
  } catch (err) {
    console.error('[v1/leads] Unhandled error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Erro interno do servidor' },
      { status: 500 },
    );
  }
  } catch (outerErr) {
    console.error('[v1/leads] Top-level error:', outerErr);
    return NextResponse.json(
      { success: false, error: outerErr instanceof Error ? outerErr.message : 'Erro interno' },
      { status: 500 },
    );
  }
}
