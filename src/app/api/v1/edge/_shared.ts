import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import type { EdgeAuth, EdgePorts, EdgeResponse } from '@/features/contact-engine/edge/edge-command.service';
import { createEdgePorts } from '@/features/contact-engine/edge/edge-ports';
import { EDGE_CONTRACT_VERSION } from '@/features/contact-engine/edge/edge-command.schemas';
import { POST as legacyWhatsApp } from '@/app/api/v1/bdr/steps/whatsapp/route';
import { POST as legacyEmail } from '@/app/api/v1/bdr/steps/email/route';

/**
 * Casca comum das rotas de borda (v1): mesma autenticacao por API key e mesmo
 * limite de taxa por organizacao das rotas /api/v1/bdr/*. Nao decide nada.
 */
export async function handleEdge<T>(
  request: Request,
  op: string,
  schema: ZodType<T>,
  run: (auth: EdgeAuth, body: T, ports: EdgePorts) => Promise<EdgeResponse>,
): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`edge-v1-${op}:${auth.orgId}`, 120, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { contract_version: EDGE_CONTRACT_VERSION, success: false, code: 'invalid_request', error: `${first?.path.join('.') || 'corpo'}: ${first?.message ?? 'inválido'}` },
      { status: 400 },
    );
  }

  // Os handlers legados leem o mesmo Authorization do pedido original; reenviamos o cabecalho.
  const delegate: EdgePorts['delegate'] = async (kind, body) => {
    const handler = kind === 'email_send' ? legacyEmail : legacyWhatsApp;
    const path = kind === 'email_send' ? '/api/v1/bdr/steps/email' : '/api/v1/bdr/steps/whatsapp';
    const headers = new Headers({ 'content-type': 'application/json' });
    const authorization = request.headers.get('authorization');
    if (authorization) headers.set('authorization', authorization);
    const res = await handler(new Request(new URL(path, request.url), { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const out = await run({ orgId: auth.orgId, keyId: auth.keyId }, parsed.data, createEdgePorts(delegate));
    return NextResponse.json(out.body, { status: out.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error(`[edge-v1/${op}]`, e instanceof Error ? e.message : 'erro');
    return NextResponse.json({ contract_version: EDGE_CONTRACT_VERSION, success: false, code: 'unavailable', error: 'Falha interna; nada foi enviado.', retryable: true }, { status: 503 });
  }
}
