'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { AIService } from '@/features/ai/services/ai.service';
import { buildLeadContext } from '@/features/ai/utils/build-lead-context';
import { EmailService } from '@/features/integrations/services/email.service';
import { WhatsAppCreditService } from '@/features/integrations/services/whatsapp-credit.service';
import { WhatsAppService, validateBrazilianPhone } from '@/features/integrations/services/whatsapp.service';

import { buildLeadTemplateVariables } from '../utils/build-template-variables';
import { renderTemplate } from '../utils/render-template';
import type { CadenceStepRow, InteractionRow, MessageTemplateRow, ReplyType } from '../types';

const BATCH_SIZE = 50;

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
    socios: Array<{ nome: string; qualificacao?: string }> | null;
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
  const brtHour = (now.getUTCHours() - 3 + 24) % 24;
  const brtDay = now.getUTCDay(); // 0=Sun, 6=Sat
  // Adjust day if UTC-3 crosses midnight
  const brtDate = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const adjustedDay = brtDate.getUTCDay();
  return adjustedDay >= 1 && adjustedDay <= 5 && brtHour >= 8 && brtHour < 18;
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

  const { data: enrollments, error: enrollError } = (await (supabase
    .from('cadence_enrollments') as ReturnType<typeof supabase.from>)
    .select('*, lead:leads(*)')
    .eq('status', 'active')
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

      // Skip manual channels — only auto-send email and whatsapp
      if (step.channel !== 'email' && step.channel !== 'whatsapp') {
        result.skipped++;
        console.warn(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} status=skipped reason=manual_channel channel=${step.channel} duration_ms=${Date.now() - stepStart}`);
        continue;
      }

      // Idempotency check: skip if interaction already exists for this enrollment + step
      const { data: existingInteraction } = (await (supabase
        .from('interactions') as ReturnType<typeof supabase.from>)
        .select('id')
        .eq('cadence_id', enrollment.cadence_id)
        .eq('step_id', step.id)
        .eq('lead_id', enrollment.lead_id)
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };

      if (existingInteraction) {
        result.skipped++;
        console.warn(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} status=skipped reason=idempotent duration_ms=${Date.now() - stepStart}`);
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

      if (step.template_id) {
        const { data: template } = (await (supabase
          .from('message_templates') as ReturnType<typeof supabase.from>)
          .select('*')
          .eq('id', step.template_id)
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
          metadata: subject ? { subject } : null,
          ai_generated: aiGenerated,
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

      if (step.channel === 'email') {
        if (!enrollment.lead.email) {
          await markInteractionFailed(supabase, interaction.id, 'no_lead_email');
          result.failed++;
          result.errors.push(`Lead ${enrollment.lead_id} sem email — não é possível enviar`);
          console.error(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} status=failed reason=no_lead_email duration_ms=${Date.now() - stepStart}`);
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
          if (Object.keys(metaUpdate).length > 0) {
            updateData.metadata = metaUpdate;
          }
          await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
            .update(updateData)
            .eq('id', interaction.id);
          sendSuccess = true;
          console.warn(`[cadence-engine] enrollment=${enrollment.id} email sent messageId=${emailResult.messageId} threadId=${emailResult.threadId ?? 'n/a'}`);
        } else {
          await markInteractionFailed(supabase, interaction.id, emailResult.error ?? 'unknown_email_error');
          result.failed++;
          result.errors.push(`Email falhou para lead ${enrollment.lead_id}: ${emailResult.error}`);
          console.error(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} status=failed reason=email_send_error error="${emailResult.error}" duration_ms=${Date.now() - stepStart}`);
          continue;
        }
      } else if (step.channel === 'whatsapp') {
        const phone = enrollment.lead.telefone;
        if (!phone || !validateBrazilianPhone(phone)) {
          await markInteractionFailed(supabase, interaction.id, 'invalid_phone');
          result.failed++;
          result.errors.push(`Lead ${enrollment.lead_id} sem telefone válido — não é possível enviar WhatsApp`);
          console.error(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} status=failed reason=invalid_phone duration_ms=${Date.now() - stepStart}`);
          continue;
        }

        // Check and deduct WhatsApp credit
        const creditResult = await WhatsAppCreditService.checkAndDeductCredit(enrollment.lead.org_id, supabase);
        if (!creditResult.allowed) {
          await markInteractionFailed(supabase, interaction.id, creditResult.error ?? 'no_credits');
          result.failed++;
          result.errors.push(`Org ${enrollment.lead.org_id} sem créditos WhatsApp: ${creditResult.error}`);
          console.error(`[cadence-engine] enrollment=${enrollment.id} status=failed reason=no_credits duration_ms=${Date.now() - stepStart}`);
          continue;
        }

        if (creditResult.isOverage) {
          console.warn(`[cadence-engine] enrollment=${enrollment.id} whatsapp overage: used=${creditResult.used} limit=${creditResult.limit}`);
        }

        const waResult = await WhatsAppService.sendMessage(
          enrollment.lead.org_id,
          { to: phone, body: messageContent },
          supabase,
        );

        if (waResult.success && waResult.messageId) {
          await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
            .update({ external_id: waResult.messageId } as Record<string, unknown>)
            .eq('id', interaction.id);
          sendSuccess = true;
          console.warn(`[cadence-engine] enrollment=${enrollment.id} whatsapp sent messageId=${waResult.messageId}`);
        } else {
          await markInteractionFailed(supabase, interaction.id, waResult.error ?? 'unknown_whatsapp_error');
          result.failed++;
          result.errors.push(`WhatsApp falhou para lead ${enrollment.lead_id}: ${waResult.error}`);
          console.error(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} status=failed reason=whatsapp_send_error error="${waResult.error}" duration_ms=${Date.now() - stepStart}`);
          continue;
        }
      }

      if (!sendSuccess) {
        // Unknown channel or no send attempted
        continue;
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
      }

      result.sent++;
      console.warn(`[cadence-engine] enrollment=${enrollment.id} step=${step.step_order} channel=${step.channel} status=sent ai=${aiGenerated} send_success=${sendSuccess} duration_ms=${Date.now() - stepStart}`);
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
