import { NextResponse } from 'next/server';
import { z } from 'zod';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import {
  EDGE_CONSENT_SOURCES,
  canonicalWhatsappIdentity,
  captureWhatsappConsent,
} from '@/features/contact-engine/services/consent-capture.service';

export const dynamic = 'force-dynamic';

const MAX_BODY_SIZE = 16_384;

const bodySchema = z.object({
  lead_id: z.string().uuid('lead_id deve ser UUID válido'),
  telefone: z.string().min(1, 'telefone é obrigatório').max(40),
  tipo: z.enum(['opt_in', 'opt_out']),
  /** Nome do fluxo da Ana V4 que originou o evento (texto curto, só referência). */
  fluxo: z.string().max(60).regex(/^[a-zA-Z0-9_.:-]+$/).optional(),
});

/**
 * Consentimento de WhatsApp dos fluxos da Ana V4 (mesma auth das rotas /bdr: API key da org).
 *
 * POST /api/v1/edge/consent
 *   { lead_id, telefone, tipo: 'opt_in' | 'opt_out', fluxo? }
 *   Header opcional `x-idempotency-key`: reenvio com a mesma chave não grava de novo.
 *   Sem a chave, a idempotência é por (lead, telefone, tipo).
 *
 * Grava em `contact_consent_evidence` (append-only) com source `ana_v4_opt_in` ou
 * `ana_v4_opt_out`. Atrás da flag `consent_capture_v1` (escopo por org): desligada,
 * responde 200 com `gravado: false, status: 'disabled'` e não grava nada.
 * Opt-out vence: opt_in sobre opt_out vigente não é gravado (`skipped_opted_out`).
 * Não envia mensagem nem altera cadência.
 */
export async function POST(request: Request) {
  const length = request.headers.get('content-length');
  if (length && parseInt(length, 10) > MAX_BODY_SIZE) {
    return NextResponse.json({ success: false, error: 'Payload excede o limite' }, { status: 413 });
  }

  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });

  const rl = await checkRateLimit(`edge-consent:${auth.orgId}`, 120, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Erro de validação',
        details: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
      },
      { status: 422 },
    );
  }
  const body = parsed.data;

  const identity = canonicalWhatsappIdentity(body.telefone);
  if (!identity) return NextResponse.json({ success: false, error: 'telefone inválido' }, { status: 422 });

  const headerKey = request.headers.get('x-idempotency-key')?.trim().slice(0, 150);
  const ref = headerKey ? `edge:${headerKey}` : `edge:${body.tipo}:${body.lead_id}:${identity}`;

  const outcome = await captureWhatsappConsent({
    orgId: auth.orgId,
    leadId: body.lead_id,
    contact: body.telefone,
    kind: body.tipo,
    source: EDGE_CONSENT_SOURCES[body.tipo],
    ref,
    extra: { origin: 'ana_v4', flow: body.fluxo ?? null, api_key_id: auth.keyId },
  });

  switch (outcome.status) {
    case 'recorded':
      return NextResponse.json(
        { success: true, data: { gravado: true, status: 'recorded', id: outcome.id } },
        { status: 201 },
      );
    case 'lead_not_found':
      return NextResponse.json({ success: false, error: 'lead não encontrado nesta org' }, { status: 404 });
    case 'invalid_input':
      return NextResponse.json({ success: false, error: 'Dados inválidos' }, { status: 422 });
    case 'error':
      return NextResponse.json({ success: false, error: 'Erro ao registrar consentimento' }, { status: 500 });
    default:
      // disabled, duplicate, skipped_opted_out, already_opted_out: resposta final, sem retry.
      return NextResponse.json(
        { success: true, data: { gravado: false, status: outcome.status } },
        { status: 200 },
      );
  }
}
