import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { verificarCelulares, type ItemVerificacao } from '@/features/bdr-steps/actions/verificar-celular';
import { isUuid } from '@/lib/utils/uuid';

export const dynamic = 'force-dynamic';

/**
 * BDR IA — decide o telefone dos passos reservados cujo lead não tem celular
 * brasileiro como telefone principal. Chamado pelo executor do n8n logo
 * depois do claim.
 *
 * POST /api/v1/bdr/steps/verificar-celular
 *   { itens: [{ execution_id, lead_id, enrollment_id }], espera_max_dias_uteis?: 3 }   (≤ 50)
 *
 * Resposta por item: acao = ligar | ligar_fixo (com telefone E.164) |
 * aguardar (revelação pedida ao Apollo, passo adiado para o próximo dia útil;
 * o executor devolve o passo com o mesmo execution_id) | encerrar (sem
 * telefone após a espera; o executor confirma o passo como telefone_invalido).
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`bdr-steps:${auth.orgId}`, 300, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { itens?: unknown; espera_max_dias_uteis?: unknown };
  const brutos = Array.isArray(body.itens) ? body.itens.slice(0, 50) : [];
  const itens: ItemVerificacao[] = [];
  for (const b of brutos as Array<Record<string, unknown>>) {
    if (!isUuid(b?.execution_id) || !isUuid(b?.lead_id)) {
      return NextResponse.json({ success: false, error: 'cada item precisa de execution_id e lead_id (uuid)' }, { status: 400 });
    }
    itens.push({ execution_id: String(b.execution_id), lead_id: String(b.lead_id), enrollment_id: isUuid(b.enrollment_id) ? String(b.enrollment_id) : null });
  }
  if (!itens.length) return NextResponse.json({ success: true, data: [] });

  const espera = Number(body.espera_max_dias_uteis);
  try {
    const data = await verificarCelulares(createServiceRoleClient(), {
      orgId: auth.orgId,
      itens,
      esperaMaxDiasUteis: Number.isFinite(espera) && espera >= 0 && espera <= 30 ? espera : 3,
    });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    console.error('[bdr-steps/verificar-celular]', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'Falha ao verificar celulares' }, { status: 500 });
  }
}
