import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { callRpc } from '@/features/bdr-steps/actions/rpc';
import { isUuid } from '@/lib/utils/uuid';

export const dynamic = 'force-dynamic';

/**
 * BDR-2 — Devolve um passo reservado à fila antes de o lease expirar.
 *
 * POST /api/v1/bdr/steps/release
 *   { execution_id, motivo?: 'capacidade', nova_tentativa?: false, owner? }
 *
 * Padrão (nova_tentativa=false): a execução continua aberta e a próxima
 * reserva reutiliza o MESMO execution_id — use quando o V4 Call respondeu
 * 429 capacidade / 503 pool_esgotado / 503 holds_indisponivel.
 * nova_tentativa=true é a decisão explícita de tentar de novo comercialmente
 * (novo execution_id na próxima reserva). Nunca use para "resultado incerto".
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`bdr-steps:${auth.orgId}`, 300, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isUuid(body.execution_id)) return NextResponse.json({ success: false, error: 'execution_id obrigatório (uuid)' }, { status: 400 });

  try {
    const rows = await callRpc<Array<{ liberada: boolean; motivo: string }>>(createServiceRoleClient(), 'release_step_claim', {
      p_org_id: auth.orgId,
      p_execution_id: body.execution_id,
      p_motivo: typeof body.motivo === 'string' ? body.motivo.slice(0, 200) : null,
      p_nova_tentativa: body.nova_tentativa === true,
      p_owner: typeof body.owner === 'string' ? body.owner.slice(0, 120) : null,
    });
    const r = rows?.[0] ?? { liberada: false, motivo: 'sem_retorno' };
    return NextResponse.json({ success: r.liberada, ...r }, { status: r.motivo === 'execution_id_desconhecida' ? 404 : 200 });
  } catch (e) {
    console.error('[bdr-steps/release]', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'Falha ao liberar o passo' }, { status: 500 });
  }
}
