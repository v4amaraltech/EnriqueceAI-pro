import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import type { EdgeAuth, EdgeResponse } from '@/features/contact-engine/edge/edge-command.service';
import { createEdgeIngestionPorts } from '@/features/contact-engine/edge/edge-ingestion-ports';
import type { EdgeIngestionPorts } from '@/features/contact-engine/edge/edge-ingestion.service';
import { EDGE_INGESTION_CONTRACT_VERSION } from '@/features/contact-engine/edge/edge-ingestion.schemas';

const MAX_BODY_SIZE = 1_048_576;

/** Casca comum das rotas de ingestao de borda: mesma API key e rate limit por organizacao das rotas /bdr. */
export async function handleIngestion<T>(
  request: Request,
  op: string,
  schema: ZodType<T>,
  run: (auth: EdgeAuth, body: T, ports: EdgeIngestionPorts) => Promise<EdgeResponse>,
): Promise<NextResponse> {
  const length = request.headers.get('content-length');
  if (length && parseInt(length, 10) > MAX_BODY_SIZE) {
    return NextResponse.json({ success: false, error: 'Payload excede o limite' }, { status: 413 });
  }
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`edge-ingest-v1-${op}:${auth.orgId}`, 120, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { contract_version: EDGE_INGESTION_CONTRACT_VERSION, success: false, code: 'invalid_request', error: `${first?.path.join('.') || 'corpo'}: ${first?.message ?? 'inválido'}` },
      { status: 400 },
    );
  }

  try {
    const out = await run({ orgId: auth.orgId, keyId: auth.keyId }, parsed.data, createEdgeIngestionPorts());
    return NextResponse.json(out.body, { status: out.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error(`[edge-ingestion/${op}]`, e instanceof Error ? e.message : 'erro');
    return NextResponse.json({ contract_version: EDGE_INGESTION_CONTRACT_VERSION, success: false, code: 'unavailable', error: 'Falha interna.', retryable: true }, { status: 503 });
  }
}
