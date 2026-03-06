'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { AIService } from '@/features/ai/services/ai.service';
import { buildLeadContext } from '@/features/ai/utils/build-lead-context';
import { EmailService } from '@/features/integrations/services/email.service';

import { createNotification } from '@/features/notifications/services/notification.service';

import { dispatchWebhookEvent } from '../services/webhook-dispatch.service';
import { buildLeadTemplateVariables } from '../utils/build-template-variables';
import { renderTemplate } from '../utils/render-template';
import type { CadenceStepRow, InteractionRow, MessageTemplateRow, ReplyType } from '../types';

const BATCH_SIZE = 25;
const MAX_SEND_RETRIES = 3;
/** Delay between successful sends (ms) to avoid Gmail rate limits */
const SEND_DELAY_MS = 2000;

/** Patterns that indicate a permanent (non-retryable) email error */
const PERMANENT_EMAIL_ERRORS = [
  'invalid',
  'not found',
  'not exist',
  'disabled',
  'suspended',
  'blocked',
  'bounce',
  'spam',
  'abuse',
  'reconexão necessária',
];

function isPermanentError(error: string): boolean {
  const lower = error.toLowerCase();
  return PERMANENT_EMAIL_ERRORS.some((p) => lower.includes(p));
}

/** Count failed interactions for a specific enrollment + step (retry tracking) */
async function getFailedAttemptCount(
  supabase: SupabaseClient,
  cadenceId: string,
  leadId: string,
  stepId: string,
): Promise<number> {
  const { count } = (await (supabase
    .from('interactions') as ReturnType<typeof supabase.from>)
    .select('id', { count: 'exact', head: true })
    .eq('cadence_id', cadenceId)
    .eq('lead_id', leadId)
    .eq('step_id', stepId)
    .eq('type', 'failed')) as { count: number | null };
  return count ?? 0;
}

/** Auto-pause an enrollment, log the reason, and notify the SDR */
async function autoPauseEnrollment(
  supabase: SupabaseClient,
  enrollmentId: string,
  reason: string,
  notifyCtx?: {
    orgId: string;
    userId: string | null;
    leadName: string;
    leadId: string;
    cadenceName: string;
    cadenceId: string;
    channel: 'email' | 'whatsapp';
  },
): Promise<void> {
  await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
    .update({ status: 'paused' } as Record<string, unknown>)
    .eq('id', enrollmentId);
  console.error(`[cadence-engine] enrollment=${enrollmentId} status=auto_paused reason=${reason}`);

  if (notifyCtx) {
    dispatchWebhookEvent(supabase, notifyCtx.orgId, 'enrollment.paused', {
      lead_id: notifyCtx.leadId,
      cadence_id: notifyCtx.cadenceId,
      enrollment_id: enrollmentId,
      reason,
    });
  }

  // Notify SDR (assigned_to) or skip if no user assigned
  if (notifyCtx?.userId) {
    const channelLabel = notifyCtx.channel === 'email' ? 'sem email' : 'sem telefone válido';
    try {
      await createNotification({
        org_id: notifyCtx.orgId,
        user_id: notifyCtx.userId,
        type: 'integration_error',
        title: `Cadência pausada — lead ${channelLabel}`,
        body: `"${notifyCtx.leadName}" foi pausado na cadência "${notifyCtx.cadenceName}" porque o lead está ${channelLabel}. Atualize o cadastro do lead para retomar.`,
        resource_type: 'lead',
        resource_id: notifyCtx.leadId,
        metadata: { reason, cadence_id: notifyCtx.cadenceId, enrollment_id: enrollmentId },
      });
    } catch (notifErr) {
      console.error(`[cadence-engine] Failed to create notification for enrollment=${enrollmentId}:`, notifErr);
    }
  }
}

/** Mark an interaction as failed with error metadata */
async function markInteractionFailed(
  supabase: SupabaseClient,
  interactionId: string,
  errorReason: string,
): Promise<void> {
  await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
    .update({
      type: 'failed',
      metadata: { error: errorReason },
    } as Record<string, unknown>)
    .eq('id', interactionId);
}

/** Remove any leftover {{variable}} placeholders from rendered content */
function stripUnresolvedVars(text: string): string {
  return text.replace(/\{\{[^}]+\}\}/g, '').replace(/\s{2,}/g, ' ').trim();
}

interface EnrollmentWithLead {
  id: string;
  cadence_id: string;
  lead_id: string;
  current_step: number;
  status: string;
  next_step_due: string | null;
  lead: {
    id: string;
    org_id: string;
    nome_fantasia: string | null;
    razao_social: string | null;
    cnpj: string;
    email: string | null;
    telefone: string | null;
    municipio: string | null;
    uf: string | null;
    porte: string | null;
    primeiro_nome: string | null;
    assigned_to: string | null;
    email_bounced_at: string | null;
    socios: Array<{ nome: string; qualificacao?: string }> | null;
  };
  cadence: {
    status: string;
    name: string;
    type: string;
  };
}

export interface ExecutionResult {
  processed: number;
  sent: number;
  failed: number;
  completed: number;
  skipped: number;
  errors: string[];
}

/** Check if current time is within business hours (8h-18h BRT, Mon-Fri) */
function isBusinessHours(): boolean {
  const now = new Date();
  // BRT = UTC-3
  const brtDate = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const brtHour = brtDate.getUTCHours();
  const brtDay = brtDate.getUTCDay();
  return brtDay >= 1 && brtDay <= 5 && brtHour >= 8 && brtHour < 18;
}

/**
 * Core execution logic — processes pending cadence enrollments.
 * Accepts any Supabase client (cookie-based or service-role).
 */
async function executeStepsCore(supabase: SupabaseClient): Promise<ActionResult<ExecutionResult>> {
  // Guard: only send during business hours (8h-18h BRT, Mon-Fri)
  if (!isBusinessHours()) {
    return { success: true, data: { processed: 0, sent: 0, failed: 0, completed: 0, skipped: 0, errors: [] } };
  }

  const startTime = Date.now();

  // Fetch active enrollments that are due — join cadences to ensure cadence is active too
  const { data: enrollments, error: enrollError } = (await (supabase
    .from('cadence_enrollments') as ReturnType<typeof supabase.from>)
    .select('*, lead:leads(*), cadence:cadences!inner(status, name, type)')
    .eq('status', 'active')
    .eq('cadence.status', 'active')
    .eq('cadence.type', 'auto_email')
    .not('next_step_due', 'is', null)
    .lte('next_step_due', new Date().toISOString())
    .limit(BATCH_SIZE)) as { data: EnrollmentWithLead[] | null; error: { message: string } | null };

  if (enrollError) {
    console.error('[cadence-engine] Failed to fetch enrollments:', enrollError.message);
    return { success: false, error: 'Erro ao buscar enrollments pendentes' };
  }

  const result: ExecutionResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    completed: 0,
    skipped: 0,
    errors: [],
  };

  console.warn(`[cadence-engine] Found ${enrollments?.length ?? 0} due enrollments`);

  // Load blacklisted email domains for all orgs in this batch
  const orgIds = [...new Set((enrollments ?? []).map((e) => e.lead.org_id))];
  const blacklistedDomains = new Set<string>();
  if (orgIds.length > 0) {
    const { data: blacklistRows } = (await (supabase
      .from('email_blacklist') as ReturnType<typeof supabase.from>)
      .select('domain, org_id')
      .in('org_id', orgIds)) as { data: Array<{ domain: string; org_id: string }> | null };
    for (const row of blacklistRows ?? []) {
      blacklistedDomains.add(`${row.org_id}:${row.domain}`);
    }
  }

  for (const enrollment of enrollments ?? []) {
    const stepStart = Date.now();
    result.processed++;

    try {
      // Fetch current step
      const { data: step } = (await (supabase
        .from('cadence_steps') as ReturnType<typeof supabase.from>)
        .select('*')
        .eq('cadence_id', enrollment.cadence_id)
        .eq('step_order', enrollment.current_step)
        .single()) as { data: CadenceStepRow | null };

      if (!step) {
        await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
          .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
          .eq('id', enrollment.id);
        result.completed++;
        console.warn(`[cadence-engine] enrollment=${enrollment.id} status=completed reason=no_step duration_ms=${Date.now() - stepStart}`);
        continue;
      }

      // Only auto-execute email steps — all other channels (whatsapp, phone, linkedin, etc.)
      // are handled manually by SDRs through the activities queue
      if (step.channel !== 'email') {
        result.skipped++;
        continue;
      }

      // Idempotency check: skip if a *successful* interaction already exists for this enrollment + step
      // Only checks for 'sent' type so that failed interactions can be retried on the next batch
      const { data: existingInteraction } = (await (supabase
        .from('interactions') as ReturnType<typeof supabase.from>)
        .select('id')
        .eq('cadence_id', enrollment.cadence_id)
        .eq('step_id', step.id)
        .eq('lead_id', enrollment.lead_id)
        .eq('type', 'sent')
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };

      if (existingInteraction) {
        // Already executed this step — advance to next so enrollment doesn't get stuck
        const { data: nextIdempStep } = (await (supabase
          .from('cadence_steps') as ReturnType<typeof supabase.from>)
          .select('step_order')
          .eq('cadence_id', enrollment.cadence_id)
          .gt('step_order', enrollment.current_step)
          .order('step_order', { ascending: true })
          .limit(1)
          .maybeSingle()) as { data: { step_order: number } | null };

        if (nextIdempStep) {
          await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
            .update({ current_step: nextIdempStep.step_order } as Record<string, unknown>)
            .eq('id', enrollment.id);
        } else {
          await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
            .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
            .eq('id', enrollment.id);
          result.completed++;
        }
        result.skipped++;
        console.warn(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} status=skipped_and_advanced reason=idempotent duration_ms=${Date.now() - stepStart}`);
        continue;
      }

      // Auto-stop: check if lead already replied to this cadence
      const { data: replyInteraction } = (await (supabase
        .from('interactions') as ReturnType<typeof supabase.from>)
        .select('id')
        .eq('cadence_id', enrollment.cadence_id)
        .eq('lead_id', enrollment.lead_id)
        .eq('type', 'replied')
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };

      if (replyInteraction) {
        await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
          .update({ status: 'replied' } as Record<string, unknown>)
          .eq('id', enrollment.id);
        result.skipped++;
        console.warn(`[cadence-engine] enrollment=${enrollment.id} status=replied reason=auto_stop duration_ms=${Date.now() - stepStart}`);
        continue;
      }

      // Auto-stop: check if lead's email bounced in this cadence
      const { data: bounceInteraction } = (await (supabase
        .from('interactions') as ReturnType<typeof supabase.from>)
        .select('id')
        .eq('cadence_id', enrollment.cadence_id)
        .eq('lead_id', enrollment.lead_id)
        .eq('type', 'bounced')
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };

      if (bounceInteraction) {
        await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
          .update({ status: 'bounced' } as Record<string, unknown>)
          .eq('id', enrollment.id);
        result.skipped++;
        console.warn(`[cadence-engine] enrollment=${enrollment.id} status=bounced reason=auto_stop duration_ms=${Date.now() - stepStart}`);
        continue;
      }

      let messageContent = '';
      let subject: string | null = null;
      let aiGenerated = false;
      let cadenceCreatedBy: string | null = null;

      // A/B variant selection
      let selectedTemplateId = step.template_id;
      let abVariant: 'A' | 'B' | null = null;
      if (step.ab_enabled && step.template_id_b) {
        abVariant = Math.random() * 100 < step.ab_distribution ? 'A' : 'B';
        selectedTemplateId = abVariant === 'A' ? step.template_id : step.template_id_b;
      }

      if (selectedTemplateId) {
        const { data: template } = (await (supabase
          .from('message_templates') as ReturnType<typeof supabase.from>)
          .select('*')
          .eq('id', selectedTemplateId)
          .single()) as { data: MessageTemplateRow | null };

        if (template) {
          // Build variables: lead data + vendor data
          const variables: Record<string, string | null> = {
            ...buildLeadTemplateVariables(enrollment.lead, enrollment.lead.socios?.[0]?.nome),
            nome_vendedor: null,
            email_vendedor: null,
          };
          try {
            const { data: cadenceForVendor } = (await (supabase
              .from('cadences') as ReturnType<typeof supabase.from>)
              .select('created_by')
              .eq('id', enrollment.cadence_id)
              .single()) as { data: { created_by: string | null } | null };

            cadenceCreatedBy = cadenceForVendor?.created_by ?? null;

            if (cadenceCreatedBy) {
              const adminClient = createAdminSupabaseClient();
              const { data: vendorUser } = await adminClient.auth.admin.getUserById(cadenceCreatedBy);
              if (vendorUser?.user) {
                const meta = vendorUser.user.user_metadata as { full_name?: string } | undefined;
                variables.nome_vendedor = meta?.full_name ?? null;
                variables.email_vendedor = vendorUser.user.email ?? null;
              }
            }
          } catch (vendorErr) {
            console.error(`[cadence-engine] enrollment=${enrollment.id} failed to fetch vendor data:`, vendorErr);
          }

          messageContent = stripUnresolvedVars(renderTemplate(template.body, variables));
          if (template.subject) {
            subject = stripUnresolvedVars(renderTemplate(template.subject, variables));
          }

          // AI personalization when enabled
          if (step.ai_personalization && messageContent) {
            try {
              const leadContext = buildLeadContext(enrollment.lead);
              const aiResult = await AIService.personalizeMessage(
                step.channel as 'email' | 'whatsapp',
                messageContent,
                leadContext,
                enrollment.lead.org_id,
              );
              messageContent = aiResult.body;
              aiGenerated = true;
            } catch (aiError) {
              console.error(`[cadence-engine] enrollment=${enrollment.id} AI personalization failed, using template fallback:`, aiError);
            }
          }
        }
      }

      // Record interaction
      const interactionMeta: Record<string, unknown> = {};
      if (subject) interactionMeta.subject = subject;
      if (abVariant) interactionMeta.ab_variant = abVariant;

      const { data: interaction } = (await (supabase
        .from('interactions') as ReturnType<typeof supabase.from>)
        .insert({
          org_id: enrollment.lead.org_id,
          lead_id: enrollment.lead_id,
          cadence_id: enrollment.cadence_id,
          step_id: step.id,
          channel: step.channel,
          type: 'sent',
          message_content: messageContent || null,
          metadata: Object.keys(interactionMeta).length > 0 ? interactionMeta : null,
          ai_generated: aiGenerated,
          original_template_id: selectedTemplateId,
        } as Record<string, unknown>)
        .select('id')
        .single()) as { data: Pick<InteractionRow, 'id'> | null };

      if (!interaction) {
        result.failed++;
        result.errors.push(`Falha ao registrar interação para lead ${enrollment.lead_id}`);
        console.error(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} channel=${step.channel} status=failed reason=insert_error duration_ms=${Date.now() - stepStart}`);
        continue;
      }

      // Send via the appropriate channel
      let sendSuccess = false;

      // Build notification context once per enrollment (reused by all auto-pause calls)
      const leadName = enrollment.lead.nome_fantasia || enrollment.lead.razao_social || enrollment.lead.cnpj;
      const pauseNotifyCtx = {
        orgId: enrollment.lead.org_id,
        userId: enrollment.lead.assigned_to,
        leadName,
        leadId: enrollment.lead_id,
        cadenceName: enrollment.cadence.name,
        cadenceId: enrollment.cadence_id,
      };

      if (step.channel === 'email') {
        if (!enrollment.lead.email) {
          await markInteractionFailed(supabase, interaction.id, 'no_lead_email');
          await autoPauseEnrollment(supabase, enrollment.id, 'no_lead_email', { ...pauseNotifyCtx, channel: 'email' });
          result.failed++;
          result.errors.push(`Lead ${enrollment.lead_id} sem email — enrollment pausado automaticamente`);
          continue;
        }

        // Skip leads with bounced email
        if (enrollment.lead.email_bounced_at) {
          await markInteractionFailed(supabase, interaction.id, 'email_bounced');
          await autoPauseEnrollment(supabase, enrollment.id, 'email_bounced', { ...pauseNotifyCtx, channel: 'email' });
          result.failed++;
          result.errors.push(`Lead ${enrollment.lead_id} com email bounce — enrollment pausado`);
          continue;
        }

        // Skip leads whose email domain is blacklisted
        const emailDomain = enrollment.lead.email.split('@')[1]?.toLowerCase();
        if (emailDomain && blacklistedDomains.has(`${enrollment.lead.org_id}:${emailDomain}`)) {
          await markInteractionFailed(supabase, interaction.id, 'domain_blacklisted');
          await autoPauseEnrollment(supabase, enrollment.id, 'domain_blacklisted', { ...pauseNotifyCtx, channel: 'email' });
          result.failed++;
          result.errors.push(`Lead ${enrollment.lead_id} com domínio bloqueado (${emailDomain}) — enrollment pausado`);
          console.warn(`[cadence-engine] enrollment=${enrollment.id} status=paused reason=domain_blacklisted domain=${emailDomain}`);
          continue;
        }

        // Use cached cadenceCreatedBy (fetched earlier for vendor vars)
        if (!cadenceCreatedBy) {
          // Fallback: fetch if template block was skipped
          const { data: cadenceFallback } = (await (supabase
            .from('cadences') as ReturnType<typeof supabase.from>)
            .select('created_by')
            .eq('id', enrollment.cadence_id)
            .single()) as { data: { created_by: string | null } | null };
          cadenceCreatedBy = cadenceFallback?.created_by ?? null;
        }

        if (!cadenceCreatedBy) {
          await markInteractionFailed(supabase, interaction.id, 'no_cadence_creator');
          result.failed++;
          result.errors.push(`Cadência ${enrollment.cadence_id} sem created_by`);
          console.error(`[cadence-engine] enrollment=${enrollment.id} status=failed reason=no_cadence_creator duration_ms=${Date.now() - stepStart}`);
          continue;
        }

        // Reply threading: fetch previous thread info when reply_type is 'reply'
        let replyThreadId: string | undefined;
        const stepReplyType = (step as CadenceStepRow & { reply_type?: ReplyType }).reply_type;
        if (stepReplyType === 'reply') {
          const { data: prevInteraction } = (await (supabase
            .from('interactions') as ReturnType<typeof supabase.from>)
            .select('metadata, external_id')
            .eq('cadence_id', enrollment.cadence_id)
            .eq('lead_id', enrollment.lead_id)
            .eq('type', 'sent')
            .eq('channel', 'email')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()) as { data: { metadata: Record<string, unknown> | null; external_id: string | null } | null };

          if (prevInteraction?.metadata) {
            const prevThreadId = prevInteraction.metadata.thread_id as string | undefined;
            const prevSubject = prevInteraction.metadata.subject as string | undefined;
            if (prevThreadId) {
              replyThreadId = prevThreadId;
            }
            if (prevSubject && subject) {
              subject = subject.startsWith('Re:') ? subject : `Re: ${prevSubject}`;
            } else if (prevSubject) {
              subject = `Re: ${prevSubject}`;
            }
          }
          // Fallback: if no previous interaction found, send as new conversation
        }

        const emailResult = await EmailService.sendEmail(
          cadenceCreatedBy,
          enrollment.lead.org_id,
          {
            to: enrollment.lead.email,
            subject: subject ?? '',
            htmlBody: messageContent,
            threadId: replyThreadId,
          },
          interaction.id,
          supabase,
        );

        if (emailResult.success && emailResult.messageId) {
          // Save messageId, threadId and subject for reply tracking
          const updateData: Record<string, unknown> = { external_id: emailResult.messageId };
          const metaUpdate: Record<string, unknown> = {};
          if (subject) metaUpdate.subject = subject;
          if (emailResult.threadId) metaUpdate.thread_id = emailResult.threadId;
          if (abVariant) metaUpdate.ab_variant = abVariant;
          if (Object.keys(metaUpdate).length > 0) {
            updateData.metadata = metaUpdate;
          }
          await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
            .update(updateData)
            .eq('id', interaction.id);
          sendSuccess = true;
          dispatchWebhookEvent(supabase, enrollment.lead.org_id, 'email.sent', {
            lead_id: enrollment.lead_id,
            cadence_id: enrollment.cadence_id,
            step_order: step.step_order,
            email: enrollment.lead.email,
            subject: subject ?? '',
            message_id: emailResult.messageId,
          });
          console.warn(`[cadence-engine] enrollment=${enrollment.id} email sent messageId=${emailResult.messageId} threadId=${emailResult.threadId ?? 'n/a'}`);
        } else {
          const emailError = emailResult.error ?? 'unknown_email_error';
          await markInteractionFailed(supabase, interaction.id, emailError);
          result.failed++;
          result.errors.push(`Email falhou para lead ${enrollment.lead_id}: ${emailError}`);

          // Classify error: permanent → pause immediately, transient → pause after MAX_SEND_RETRIES
          if (isPermanentError(emailError)) {
            await autoPauseEnrollment(supabase, enrollment.id, `permanent_email_error: ${emailError}`, { ...pauseNotifyCtx, channel: 'email' });
            result.errors.push(`Lead ${enrollment.lead_id} — enrollment pausado (erro permanente)`);
          } else {
            const attempts = await getFailedAttemptCount(supabase, enrollment.cadence_id, enrollment.lead_id, step.id);
            if (attempts >= MAX_SEND_RETRIES) {
              await autoPauseEnrollment(supabase, enrollment.id, `max_retries_email (${attempts}/${MAX_SEND_RETRIES})`, { ...pauseNotifyCtx, channel: 'email' });
              result.errors.push(`Lead ${enrollment.lead_id} — enrollment pausado após ${attempts} tentativas`);
            } else {
              console.warn(`[cadence-engine] enrollment=${enrollment.id} email transient error, attempt ${attempts}/${MAX_SEND_RETRIES} — will retry`);
            }
          }
          console.error(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} status=failed reason=email_send_error error="${emailError}" duration_ms=${Date.now() - stepStart}`);
          continue;
        }
      }

      // Check if there's a next step (handles non-contiguous step_order)
      const { data: nextStep } = (await (supabase
        .from('cadence_steps') as ReturnType<typeof supabase.from>)
        .select('step_order')
        .eq('cadence_id', enrollment.cadence_id)
        .gt('step_order', enrollment.current_step)
        .order('step_order', { ascending: true })
        .limit(1)
        .maybeSingle()) as { data: { step_order: number } | null };

      if (nextStep) {
        await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
          .update({ current_step: nextStep.step_order } as Record<string, unknown>)
          .eq('id', enrollment.id);
      } else {
        await (supabase.from('cadence_enrollments') as ReturnType<typeof supabase.from>)
          .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
          .eq('id', enrollment.id);
        result.completed++;
        dispatchWebhookEvent(supabase, enrollment.lead.org_id, 'enrollment.completed', {
          lead_id: enrollment.lead_id,
          cadence_id: enrollment.cadence_id,
          enrollment_id: enrollment.id,
        });
      }

      result.sent++;
      console.warn(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} channel=${step.channel} status=sent ai=${aiGenerated} send_success=${sendSuccess} duration_ms=${Date.now() - stepStart}`);

      // Rate limit: wait between sends to avoid Gmail/WhatsApp API throttling
      if (SEND_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
      }
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`enrollment=${enrollment.id}: ${message}`);
      console.error(`[cadence-engine] enrollment=${enrollment.id} status=error error="${message}" duration_ms=${Date.now() - stepStart}`);
    }
  }

  console.warn(`[cadence-engine] Batch complete: processed=${result.processed} sent=${result.sent} failed=${result.failed} completed=${result.completed} skipped=${result.skipped} total_ms=${Date.now() - startTime}`);

  return { success: true, data: result };
}

/**
 * Executes pending cadence steps using cookie-based auth.
 * For manual invocation from the UI (Server Action).
 */
export async function executePendingSteps(): Promise<ActionResult<ExecutionResult>> {
  const supabase = await createServerSupabaseClient();
  return executeStepsCore(supabase);
}

/**
 * Executes pending cadence steps using service role (bypasses RLS).
 * For cron/API route invocation — no cookies needed.
 */
export async function executePendingStepsCron(): Promise<ActionResult<ExecutionResult>> {
  const supabase = createServiceRoleClient();
  return executeStepsCore(supabase);
}
