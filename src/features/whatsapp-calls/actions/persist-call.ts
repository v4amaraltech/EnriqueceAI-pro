'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { toE164BR } from '../phone';

const persistSchema = z.object({
  // Opcionais: uma Ligação via WhatsApp avulsa (disparada da tela do lead, fora
  // da fila de atividades) não tem passo/cadência. A linha em `calls` continua
  // alimentando o BI + o pipeline de gravação→transcrição→BANT do mesmo jeito.
  stepId: z.string().uuid().optional(),
  cadenceId: z.string().uuid().optional(),
  leadId: z.string().uuid(),
  sid: z.string().min(1),
  callId: z.string().optional().default(''),
  // Número discado (lead).
  destination: z.string().min(1),
  disposition: z.enum(['significant', 'not_significant', 'no_contact', 'busy', 'not_connected']),
  connected: z.boolean(),
  durationSeconds: z.number().int().min(0),
  startedAt: z.string().datetime(),
  answeredAt: z.string().datetime().nullable().optional(),
  // URL da gravação vinda do serviço de voz (story 7.8). Quando setada, o cron
  // `persist-pending-recordings` baixa + armazena no bucket call-recordings e o
  // `process-pending-transcriptions` transcreve — pipeline já provider-agnóstico.
  recordingUrl: z.string().url().nullable().optional(),
  // Anotações do SDR no modal de resultado (gravadas na interação da call).
  notes: z.string().optional(),
});

export type PersistWhatsAppCallInput = z.infer<typeof persistSchema>;

/**
 * Persiste uma Ligação via WhatsApp encerrada (story 7.7):
 *  - 1 linha em `calls` com type='outbound' + metadata.provider='whatsapp' (o
 *    type='outbound' garante a contagem no BI — ver memória calls-bi-sync-path).
 *  - 1 `interaction` channel='phone', type='sent', ligada ao step/cadência.
 *
 * NÃO avança a cadência (isso é 7.6) e NÃO dispara o webhook do n8n: a call em
 * `calls` é puxada pelo watchdog pg_cron existente → BI sem mudança no warehouse.
 *
 * Idempotente por `service_call_id` (re-submit não duplica a call).
 */
export async function persistWhatsAppCall(
  input: PersistWhatsAppCallInput,
): Promise<ActionResult<{ callId: string }>> {
  const parsed = persistSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Dados da ligação inválidos' };
  const p = parsed.data;

  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };
  if (!member) return { success: false, error: 'Organização não encontrada' };
  const orgId = member.org_id;

  // Idempotência: se já gravamos esta call do serviço, não duplica.
  if (p.callId) {
    const { data: existing } = (await from(supabase, 'calls')
      .select('id')
      .eq('org_id', orgId)
      .eq('metadata->>service_call_id', p.callId)
      .maybeSingle()) as { data: { id: string } | null };
    if (existing) return { success: true, data: { callId: existing.id } };
  }

  // Gravação: usa a URL passada ou consome o buffer (o webhook do AstraCalls pode
  // ter chegado antes desta call ser criada). Ver /api/webhooks/wacalls.
  // O buffer tem RLS habilitada SEM policies (acesso só via service role), então
  // o cliente do usuário não enxerga essas linhas — lemos com service role.
  let recordingUrl = p.recordingUrl ?? null;
  if (!recordingUrl && p.callId) {
    const serviceClient = createServiceRoleClient();
    const { data: pending } = (await from(serviceClient, 'whatsapp_pending_recordings')
      .select('recording_url')
      .eq('service_call_id', p.callId)
      .maybeSingle()) as { data: { recording_url: string } | null };
    if (pending) recordingUrl = pending.recording_url;
  }

  const { data: call, error: callError } = (await from(supabase, 'calls')
    .insert({
      org_id: orgId,
      user_id: user.id,
      lead_id: p.leadId,
      origin: 'whatsapp',
      destination: toE164BR(p.destination) || p.destination,
      started_at: p.startedAt,
      duration_seconds: p.durationSeconds,
      status: p.disposition,
      type: 'outbound',
      connected: p.connected,
      answered_at: p.answeredAt ?? null,
      recording_url: recordingUrl,
      metadata: { provider: 'whatsapp', service_session_id: p.sid, service_call_id: p.callId },
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (callError || !call) return { success: false, error: 'Erro ao registrar a ligação' };

  // Interação canônica do passo (flui para as métricas de Ligação + BI). Numa
  // ligação avulsa, cadence_id/step_id ficam NULL (a coluna aceita) e a interação
  // entra como toque manual — fora do índice único parcial (que exige step_id).
  await from(supabase, 'interactions').insert({
    org_id: orgId,
    lead_id: p.leadId,
    cadence_id: p.cadenceId ?? null,
    step_id: p.stepId ?? null,
    channel: 'phone',
    type: 'sent',
    performed_by: user.id,
    message_content: p.notes || null,
    metadata: { provider: 'whatsapp', service_call_id: p.callId },
  } as Record<string, unknown>);

  return { success: true, data: { callId: call.id } };
}
