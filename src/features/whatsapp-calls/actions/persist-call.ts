'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { formatDuration } from '@/lib/utils/format';

import { callDispositionValues } from '@/features/calls/schemas/call.schemas';

import { toE164BR } from '../phone';

const persistSchema = z.object({
  // Opcionais: uma Ligação via WhatsApp avulsa (disparada da tela do lead, fora
  // da fila de atividades) não tem passo/cadência. A linha em `calls` continua
  // alimentando o BI + o pipeline de gravação→transcrição→BANT do mesmo jeito.
  stepId: z.string().uuid().optional(),
  cadenceId: z.string().uuid().optional(),
  leadId: z.string().uuid(),
  // Contato (lead_contacts) dono do número discado — para relatório. Null quando
  // o número é de sócio/enriquecido, sem contato vinculado.
  contactId: z.string().uuid().nullable().optional(),
  sid: z.string().min(1),
  callId: z.string().optional().default(''),
  // Número discado (lead).
  destination: z.string().min(1),
  // Sinal TÉCNICO da chamada — vira `calls.status` (atendeu / não conectou).
  disposition: z.enum(['significant', 'not_significant', 'no_contact', 'busy', 'not_connected']),
  // Desfecho informado pelo SDR no modal de resultado — vira
  // `calls.sdr_disposition` (enum próprio), SEM tocar em `calls.status`. Os dois
  // convivem de propósito (ver a migration 20260801210000 e o comentário em
  // classify-webphone-call.ts).
  sdrOutcome: z.enum(callDispositionValues).optional(),
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
 * Persiste uma TENTATIVA de Ligação via WhatsApp (story 7.7):
 *  - 1 linha em `calls` com type='outbound' + metadata.provider='whatsapp' (o
 *    type='outbound' garante a contagem no BI — ver memória calls-bi-sync-path).
 *  - 1 `interaction` channel='phone', type='sent', ligada ao step/cadência, com
 *    texto legível (atendida/não atendida) pra tentativa aparecer na timeline.
 *
 * Chamada em TODA saída do modal de resultado — Concluir (com desfecho do SDR +
 * anotação), Tentar novamente, Cancelar/ESC e Perdido — garantindo rastro de
 * cada tentativa (atendida ou não) no histórico do lead. Upsert idempotente por
 * `service_call_id`: reenviar o mesmo callId ATUALIZA a linha (protege contra
 * duplo clique / re-render); cada re-discagem tem um callId novo, então vira um
 * registro distinto — assim retentativas ficam metrificáveis.
 *
 * NÃO avança a cadência (isso é 7.6) e NÃO dispara o webhook do n8n: a call em
 * `calls` é puxada pelo watchdog pg_cron existente → BI sem mudança no warehouse.
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

  // Gravação: usa a URL passada ou consome o buffer (o webhook do AstraCalls pode
  // ter chegado antes desta call ser criada). Ver /api/webhooks/wacalls.
  // O buffer tem RLS habilitada SEM policies (acesso só via service role), então
  // o cliente do usuário não enxerga essas linhas — lemos com service role.
  // Fica antes do upsert de propósito: no "Concluir" (2ª gravação da tentativa) a
  // gravação pode já ter chegado, e o update preenche o recording_url que faltou.
  let recordingUrl = p.recordingUrl ?? null;
  if (!recordingUrl && p.callId) {
    const serviceClient = createServiceRoleClient();
    const { data: pending } = (await from(serviceClient, 'whatsapp_pending_recordings')
      .select('recording_url')
      .eq('service_call_id', p.callId)
      .maybeSingle()) as { data: { recording_url: string } | null };
    if (pending) recordingUrl = pending.recording_url;
  }

  // Texto legível na timeline mesmo sem anotação do SDR (espelha o "Ligação
  // iniciada…" do discador API4COM) — sem isto, uma tentativa não atendida
  // aparecia em branco no histórico do lead. A anotação, quando existe, tem
  // prioridade: é o que o SDR quis registrar.
  const description = p.connected
    ? `Ligação WhatsApp — atendida (${formatDuration(p.durationSeconds)})`
    : 'Ligação WhatsApp — não atendida';
  const messageContent = p.notes?.trim() ? p.notes.trim() : description;
  const interactionMeta: Record<string, unknown> = {
    provider: 'whatsapp',
    service_call_id: p.callId,
    connected: p.connected,
    disposition: p.disposition,
  };
  const destination = toE164BR(p.destination) || p.destination;

  // Insere a interação-espelho da tentativa na timeline do lead. A retentativa da
  // MESMA atividade de cadência colide com o índice único
  // `uq_interactions_sent_step_lead_real` (1 interação 'sent' por (cadence,step,lead)
  // — o anti-duplicata do contador de atividades). Nesse caso reinsere como toque
  // manual (step_id null, fora do índice parcial) pra a retentativa AINDA
  // aparecer no histórico. O erro é checado de propósito: antes era engolido, e a
  // retentativa sumia da timeline sem deixar rastro (só a linha em `calls`).
  async function insertAttemptInteraction(): Promise<void> {
    const base = {
      org_id: orgId,
      lead_id: p.leadId,
      contact_id: p.contactId ?? null,
      cadence_id: p.cadenceId ?? null,
      channel: 'phone',
      type: 'sent',
      performed_by: user.id,
      message_content: messageContent,
      metadata: interactionMeta,
    };
    const first = (await from(supabase, 'interactions').insert({
      ...base,
      step_id: p.stepId ?? null,
    } as Record<string, unknown>)) as { error: { code?: string; message?: string } | null };
    if (!first.error) return;

    if (first.error.code === '23505' && p.stepId) {
      const retry = (await from(supabase, 'interactions').insert({
        ...base,
        step_id: null,
      } as Record<string, unknown>)) as { error: { code?: string; message?: string } | null };
      if (retry.error) {
        console.error(
          '[whatsapp-call] falha ao registrar interação (toque manual):',
          retry.error.message,
        );
      }
      return;
    }
    console.error('[whatsapp-call] falha ao registrar interação da ligação:', first.error.message);
  }

  // Upsert idempotente por `service_call_id`: cada TENTATIVA é gravada assim que
  // encerra (inclusive não atendida) e depois enriquecida no "Concluir" com o
  // desfecho do SDR + anotação. Re-submeter o mesmo callId ATUALIZA a linha em
  // vez de duplicar — é assim que retentativas viram registros distintos (cada
  // discagem gera um callId novo) sem inflar o contador de atividades.
  if (p.callId) {
    const { data: existing } = (await from(supabase, 'calls')
      .select('id')
      .eq('org_id', orgId)
      .eq('metadata->>service_call_id', p.callId)
      .maybeSingle()) as { data: { id: string } | null };

    if (existing) {
      const callUpdates: Record<string, unknown> = {
        duration_seconds: p.durationSeconds,
        status: p.disposition,
        connected: p.connected,
        answered_at: p.answeredAt ?? null,
        updated_at: new Date().toISOString(),
      };
      // sdr_outcome e recording_url só são setados quando temos o valor — a
      // gravação-base do encerramento roda SEM eles; o "Concluir" chega depois
      // com o desfecho, e a gravação pode ter chegado nesse meio-tempo. Nunca
      // limpamos um desfecho já informado nem uma gravação já baixada.
      if (p.sdrOutcome) callUpdates.sdr_disposition = p.sdrOutcome;
      if (recordingUrl) callUpdates.recording_url = recordingUrl;
      await from(supabase, 'calls').update(callUpdates).eq('id', existing.id).eq('org_id', orgId);

      // Atualiza a interação espelho (achada por service_call_id) em vez de
      // inserir outra — senão 1 tentativa viraria 2 no contador de atividades.
      const { data: existingInteraction } = (await from(supabase, 'interactions')
        .select('id, metadata')
        .eq('lead_id', p.leadId)
        .eq('channel', 'phone')
        .contains('metadata', { service_call_id: p.callId })
        .limit(1)
        .maybeSingle()) as {
        data: { id: string; metadata: Record<string, unknown> | null } | null;
      };

      if (existingInteraction) {
        const interactionUpdates: Record<string, unknown> = {
          metadata: { ...(existingInteraction.metadata ?? {}), ...interactionMeta },
        };
        // Só sobrescreve o texto quando o SDR de fato anotou — não apaga a
        // descrição automática já gravada na base.
        if (p.notes?.trim()) interactionUpdates.message_content = p.notes.trim();
        await from(supabase, 'interactions').update(interactionUpdates).eq('id', existingInteraction.id);
      } else {
        // Fallback: a linha de calls existe mas a interação não (legado/raro).
        await insertAttemptInteraction();
      }

      return { success: true, data: { callId: existing.id } };
    }
  }

  // INSERT: primeira gravação desta tentativa.
  const { data: call, error: callError } = (await from(supabase, 'calls')
    .insert({
      org_id: orgId,
      user_id: user.id,
      lead_id: p.leadId,
      contact_id: p.contactId ?? null,
      origin: 'whatsapp',
      destination,
      started_at: p.startedAt,
      duration_seconds: p.durationSeconds,
      status: p.disposition,
      sdr_disposition: p.sdrOutcome ?? null,
      type: 'outbound',
      connected: p.connected,
      answered_at: p.answeredAt ?? null,
      recording_url: recordingUrl,
      metadata: { provider: 'whatsapp', service_session_id: p.sid, service_call_id: p.callId },
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (callError || !call) return { success: false, error: 'Erro ao registrar a ligação' };

  // Interação-espelho da tentativa (flui para timeline + métricas de Ligação). A
  // 1ª tentativa de cadência mantém o step_id; a retentativa do mesmo passo vira
  // toque manual (step_id null) dentro de insertAttemptInteraction.
  await insertAttemptInteraction();

  return { success: true, data: { callId: call.id } };
}
