import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { entraNaFilaHumana } from '@/features/activities/utils/fila-humana';

/** Teto de inscrições lidas por rodada (o cron roda a cada minuto). */
export const ENQUEUE_SCAN_LIMIT = 500;

interface AutoStepRow {
  id: string;
  cadence_id: string;
  step_order: number;
  cadence: { status: string; type: string | null; executor: string | null } | null;
}

interface DueEnrollmentRow {
  id: string;
  cadence_id: string;
  lead_id: string;
  current_step: number;
  lead: { org_id: string; assigned_to: string | null; whatsapp_invalid_at: string | null } | null;
}

export interface QueueInsertRow {
  org_id: string;
  sender_user_id: string;
  lead_id: string;
  enrollment_id: string;
  cadence_id: string;
  step_id: string;
}

/**
 * Monta os itens da fila a partir das inscrições vencidas cujo passo ATUAL é um
 * WhatsApp automático (critério 1). Pura: recebe o que veio do banco.
 *
 * Fica de fora (segue como tarefa manual — critério 15 e regras da fila humana):
 * lead sem SDR responsável e lead marcado como "Não é WhatsApp".
 */
export function buildQueueRows(steps: AutoStepRow[], enrollments: DueEnrollmentRow[]): QueueInsertRow[] {
  const stepByPosition = new Map<string, AutoStepRow>();
  for (const s of steps) stepByPosition.set(`${s.cadence_id}:${s.step_order}`, s);

  const rows: QueueInsertRow[] = [];
  for (const e of enrollments) {
    const step = stepByPosition.get(`${e.cadence_id}:${e.current_step}`);
    if (!step || !e.lead) continue;
    if (!e.lead.assigned_to || e.lead.whatsapp_invalid_at) continue;
    rows.push({
      org_id: e.lead.org_id,
      sender_user_id: e.lead.assigned_to,
      lead_id: e.lead_id,
      enrollment_id: e.id,
      cadence_id: e.cadence_id,
      step_id: step.id,
    });
  }
  return rows;
}

/**
 * Coloca na fila do número do SDR os passos de WhatsApp automático que venceram.
 * Nada é enviado aqui. Idempotente: 1 item por inscrição + passo (UNIQUE no banco).
 */
export async function enqueueDueAutoSteps(supabase: SupabaseClient, now: Date): Promise<{ enqueued: number }> {
  const { data: steps, error: stepsErr } = (await from(supabase, 'cadence_steps')
    .select('id, cadence_id, step_order, cadence:cadences!inner(status, type, executor)')
    .eq('channel', 'whatsapp')
    .eq('auto_send', true)
    .not('template_id', 'is', null)
    .eq('cadence.status', 'active')) as { data: AutoStepRow[] | null; error: { message: string } | null };

  if (stepsErr) {
    console.error('[whatsapp-auto-send] erro ao ler passos automáticos:', stepsErr.message);
    return { enqueued: 0 };
  }

  // Só cadências trabalhadas por humanos: auto_email e as da IA (Ana) têm executor próprio.
  const eligible = (steps ?? []).filter((s) => s.cadence && entraNaFilaHumana(s.cadence));
  if (eligible.length === 0) return { enqueued: 0 };

  const cadenceIds = [...new Set(eligible.map((s) => s.cadence_id))];

  const { data: enrollments, error: enrErr } = (await from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, lead_id, current_step, lead:leads!inner(org_id, assigned_to, whatsapp_invalid_at)')
    .eq('status', 'active')
    .in('cadence_id', cadenceIds)
    .not('next_step_due', 'is', null)
    .lte('next_step_due', now.toISOString())
    .not('lead.assigned_to', 'is', null)
    .is('lead.whatsapp_invalid_at', null)
    .order('next_step_due', { ascending: true })
    .limit(ENQUEUE_SCAN_LIMIT)) as { data: DueEnrollmentRow[] | null; error: { message: string } | null };

  if (enrErr) {
    console.error('[whatsapp-auto-send] erro ao ler inscrições vencidas:', enrErr.message);
    return { enqueued: 0 };
  }

  const rows = buildQueueRows(eligible, enrollments ?? []);
  if (rows.length === 0) return { enqueued: 0 };

  const { data: inserted, error: insErr } = (await from(supabase, 'whatsapp_send_queue' as never)
    .upsert(rows as never, { onConflict: 'enrollment_id,step_id', ignoreDuplicates: true } as never)
    .select('id')) as { data: Array<{ id: string }> | null; error: { message: string } | null };

  if (insErr) {
    console.error('[whatsapp-auto-send] erro ao enfileirar:', insErr.message);
    return { enqueued: 0 };
  }

  return { enqueued: inserted?.length ?? 0 };
}
