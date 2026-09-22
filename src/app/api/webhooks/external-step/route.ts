import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { callRpc } from '@/features/bdr-steps/actions/rpc';
import { httpStatusFor, parseExternalStepEvent, type ConfirmResult } from '@/features/bdr-steps/services/external-step';
import { markLeadLostOnCadenceEnd } from '@/features/cadences/services/cadence-end-loss.service';
import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BDR-2 — Confirmação de passo executado fora do Enriquece (plano §7.2/§7.5).
 *
 * POST /api/webhooks/external-step
 * Auth: API key da org (`Authorization: Bearer <key>` ou `?token=`), a mesma
 * das demais rotas /api/v1. Quem chama é o n8n, repassando o evento que o
 * V4 Call entregou pela outbox — o corpo pode ir como veio:
 *   { evento, event_id, execution_id, call_sid, resultado: {...}, gravacao_url,
 *     duracao_total_seg, numero_utilizado, transcricao_texto, motivo, ... }
 * Opcional: `performed_by` (uuid do usuário dono da caixa da Ana) para a interaction.
 *
 * Idempotente por `event_id` (outbox) e por `execution_id` (reserva):
 *   200 { aplicado: true }                       → interaction gravada, passo avançado
 *   200 { aplicado: false, duplicado: true }     → event_id já processado; nada mudou
 *   200 { aplicado: false, motivo }              → execução já confirmada / passo já avançado / evento não terminal
 *   404 { motivo: 'execution_id_desconhecida' }  → o Enriquece nunca reservou essa execução
 *   400 payload inválido · 401 sem API key · 500 erro (o chamador reenvia)
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`external-step:${auth.orgId}`, 600, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const body = await request.json().catch(() => null);
  const parsed = parseExternalStepEvent(body);
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const ev = parsed.value;

  const supabase = createServiceRoleClient();
  let result: ConfirmResult | undefined;
  try {
    const rows = await callRpc<ConfirmResult[]>(supabase, 'confirm_external_step', {
      p_org_id: auth.orgId,
      p_event_id: ev.eventId,
      p_execution_id: ev.executionId,
      p_evento: ev.evento,
      p_call_sid: ev.callSid,
      p_resultado: ev.resultado,
      p_payload: ev.payload,
      p_performed_by: ev.performedBy,
    });
    result = rows?.[0];
  } catch (e) {
    console.error('[external-step] confirm_external_step falhou:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'Falha ao confirmar o passo' }, { status: 500 });
  }
  if (!result) return NextResponse.json({ success: false, error: 'RPC sem retorno' }, { status: 500 });

  // Fim natural da cadência: mesmos efeitos do executeActivity (timeline + Perdido "Nunca respondeu").
  if (result.aplicado && result.completed && result.lead_id && result.cadence_id && result.enrollment_id) {
    await logLeadEvent(supabase, {
      orgId: auth.orgId,
      leadId: result.lead_id,
      userId: ev.performedBy,
      event: 'cadence_completed',
      message: 'Cadência concluída — todos os passos foram executados',
      metadata: { cadence_id: result.cadence_id, enrollment_id: result.enrollment_id, source: 'v4call' },
    });
    await markLeadLostOnCadenceEnd({
      orgId: auth.orgId, leadId: result.lead_id, cadenceId: result.cadence_id, enrollmentId: result.enrollment_id,
    }).catch((err) => console.error('[external-step] markLeadLostOnCadenceEnd falhou:', err));
  }

  return NextResponse.json(
    { success: result.motivo !== 'execution_id_desconhecida', ...result, event_id: ev.eventId, execution_id: ev.executionId },
    { status: httpStatusFor(result) },
  );
}
