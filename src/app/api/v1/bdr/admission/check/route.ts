import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { checkCandidates, type Candidate } from '@/features/bdr-admission/actions/admission';

/**
 * BDR-5 — Exclusões por candidato antes de gastar crédito de enriquecimento.
 * POST /api/v1/bdr/admission/check {candidates: [{external_id, email, telefone, cnpj, empresa}]} (≤ 200)
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`inbound-api:${auth.orgId}`, 100, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });
  const body = (await request.json().catch(() => ({}))) as { candidates?: Candidate[] };
  const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 200) : [];
  if (!candidates.length) return NextResponse.json({ success: false, error: 'candidates obrigatório' }, { status: 400 });
  const data = await checkCandidates(createServiceRoleClient(), { orgId: auth.orgId, candidates });
  return NextResponse.json({ success: true, data: { total: data.length, admissiveis: data.filter((d) => d.admissivel).length, itens: data } });
}
