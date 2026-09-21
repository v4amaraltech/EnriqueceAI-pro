import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { isQueryablePhone, phoneDigits, resolveHoldFlags, type HoldRow } from '@/features/contact-holds/services/hold-flags';

export const dynamic = 'force-dynamic';

/**
 * BDR-1 — Fonte central de bloqueios (plano §1: "a fonte central autoriza,
 * o espelho só nega"). O V4 Call chama esta rota IMEDIATAMENTE antes de
 * submeter a ligação à Twilio, com HOLDS_SOURCE_URL apontando para cá.
 *
 * GET /api/v1/contacts/holds?telefone=+5516999867577
 *
 * Resposta (campos no topo — é o que o V4 Call lê; ver src/db/holds.js lá):
 *   { success, telefone, encontrado, lead_ids, bloqueado_total,
 *     bloqueado_prospeccao, bloqueado_conversa, holds: [{lead_id, tipo, origem, created_at}] }
 *
 * Telefone sem lead na org → encontrado=false e tudo `false`: quem decide o
 * resto (DNC local, limites) é o V4 Call. Erro aqui → 5xx e o V4 Call aguarda.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`inbound-api:${auth.orgId}`, 600, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const url = new URL(request.url);
  const digits = phoneDigits(url.searchParams.get('telefone'));
  if (!isQueryablePhone(digits)) {
    return NextResponse.json({ success: false, error: 'telefone inválido (informe DDD + número, com ou sem 55)' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  try {
    const { data: ids, error: rpcError } = await supabase.rpc('find_lead_ids_by_phone' as never, { p_org_id: auth.orgId, p_phone_digits: digits } as never);
    if (rpcError) throw new Error(rpcError.message);
    const leadIds = ((ids ?? []) as unknown as string[]).filter(Boolean);

    let holds: HoldRow[] = [];
    if (leadIds.length) {
      const { data, error } = await from(supabase, 'contact_holds')
        .select('lead_id, tipo, origem, created_at')
        .eq('org_id', auth.orgId)
        .in('lead_id', leadIds);
      if (error) throw new Error(error.message);
      holds = (data ?? []) as unknown as HoldRow[];
    }

    const flags = resolveHoldFlags(holds);
    return NextResponse.json(
      { success: true, telefone: digits, encontrado: leadIds.length > 0, lead_ids: leadIds, ...flags, holds },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    // 5xx de propósito: o V4 Call trata como "fonte indisponível" e aguarda, nunca libera.
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
