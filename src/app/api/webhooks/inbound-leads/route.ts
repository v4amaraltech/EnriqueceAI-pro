import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { ingestInboundLeads } from '@/features/inbound-api/services/inbound-lead.service';

export const maxDuration = 60;

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
  const rateLimit = await checkRateLimit(`inbound-webhook:${auth.orgId}`, 100, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Rate limit excedido' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateLimit.retryAfterMs ?? 60_000) / 1000)),
        },
      },
    );
  }

  // 3. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'JSON inválido' },
      { status: 400 },
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { success: false, error: 'Payload deve ser um objeto JSON' },
      { status: 400 },
    );
  }

  // 4. Normalize payload — support multiple formats
  const rawLeads = normalizePayload(body as Record<string, unknown>);
  if (rawLeads.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Nenhum lead encontrado no payload' },
      { status: 422 },
    );
  }

  if (rawLeads.length > 100) {
    return NextResponse.json(
      { success: false, error: 'Máximo de 100 leads por request' },
      { status: 422 },
    );
  }

  // 5. Apply field mapping to each lead
  const mappedLeads = rawLeads.map(mapExternalFields);

  // 6. Determine on_duplicate from payload
  const onDuplicate = (body as Record<string, unknown>).on_duplicate === 'update' ? 'update' as const : 'skip' as const;

  // 7. Ingest
  const supabase = createServiceRoleClient();
  const result = await ingestInboundLeads(mappedLeads, {
    orgId: auth.orgId,
    supabase,
    defaultSource: 'webhook',
    onDuplicate,
  });

  // Check if all failed due to lead limit
  if (result.errors === result.received && result.results[0]?.error?.includes('Limite')) {
    return NextResponse.json(
      { success: false, error: result.results[0].error },
      { status: 402 },
    );
  }

  return NextResponse.json(
    { success: true, data: result },
    { status: result.created > 0 ? 201 : 200 },
  );
}

/**
 * Normalize incoming payload into an array of lead objects.
 * Supports: { leads: [...] }, [...], or { name: "..." } (single flat object)
 */
function normalizePayload(body: Record<string, unknown>): Record<string, unknown>[] {
  // Array of leads at root
  if (Array.isArray(body)) {
    return body as Record<string, unknown>[];
  }

  // { leads: [...] } — RD Station style
  if (Array.isArray(body.leads)) {
    return body.leads as Record<string, unknown>[];
  }

  // { data: [...] } — some platforms use "data" key
  if (Array.isArray(body.data)) {
    return body.data as Record<string, unknown>[];
  }

  // Single flat lead object — check if it has lead-like fields
  if (body.first_name || body.name || body.full_name || body.email) {
    return [body];
  }

  return [];
}

/**
 * Map common external field names to our internal schema.
 * Handles variations from RD Station, landing page builders, Zapier, etc.
 */
function mapExternalFields(raw: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = { ...raw };

  // name / full_name → first_name + last_name
  const fullName = (raw.name ?? raw.full_name ?? raw.nome ?? raw.nome_completo) as string | undefined;
  if (fullName && !raw.first_name) {
    const parts = fullName.trim().split(/\s+/);
    mapped.first_name = parts[0];
    if (parts.length > 1) {
      mapped.last_name = parts.slice(1).join(' ');
    }
    delete mapped.name;
    delete mapped.full_name;
    delete mapped.nome;
    delete mapped.nome_completo;
  }

  // phone / personal_phone / mobile → telefone
  const phone = raw.phone ?? raw.personal_phone ?? raw.mobile ?? raw.celular ?? raw.whatsapp;
  if (phone && !raw.telefone) {
    mapped.telefone = phone;
    delete mapped.phone;
    delete mapped.personal_phone;
    delete mapped.mobile;
    delete mapped.celular;
    delete mapped.whatsapp;
  }

  // company / company_name / organization → empresa
  const company = raw.company ?? raw.company_name ?? raw.organization ?? raw.empresa_nome;
  if (company && !raw.empresa) {
    mapped.empresa = company;
    delete mapped.company;
    delete mapped.company_name;
    delete mapped.organization;
    delete mapped.empresa_nome;
  }

  // title / position / cargo → job_title
  const title = raw.title ?? raw.position ?? raw.cargo;
  if (title && !raw.job_title) {
    mapped.job_title = title;
    delete mapped.title;
    delete mapped.position;
    delete mapped.cargo;
  }

  return mapped;
}
