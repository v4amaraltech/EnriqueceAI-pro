'use server';

import { randomUUID } from 'node:crypto';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { AUTO_EMAIL_TEMPLATE_PREFIX } from '@/features/templates/internal-templates';

import { saveAutoEmailCadenceSchema } from '../cadence.schemas';
import { ACTIVE_ENROLLMENTS_CODE } from '../types';
import { extractVariables } from '../utils/render-template';

interface SaveResult {
  saved: number;
  template_ids: string[];
}

interface ExistingStep {
  id: string;
  step_order: number;
  template_id: string | null;
  template_id_b: string | null;
}

/**
 * Salva os passos de uma cadência de e-mail automático.
 *
 * Os passos existentes são atualizados NO LUGAR (ID preservado, por posição):
 * o motor `execute-cadence` usa `interactions.step_id` como trava de
 * idempotência — recriar os passos com IDs novos zerava esse vínculo (FK ON
 * DELETE SET NULL) e permitia reenviar e-mails já enviados. Os templates
 * inline são recriados a cada salvamento (o conteúdo é do passo, não do lead).
 */
export async function saveAutoEmailSteps(
  input: Record<string, unknown>,
): Promise<ActionResult<SaveResult>> {
  const parsed = saveAutoEmailCadenceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const { cadence_id, steps, confirm_active_enrollments } = parsed.data;
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Verify cadence belongs to org and is editable
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id, status, type')
    .eq('id', cadence_id)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; status: string; type: string } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  if (cadence.type !== 'auto_email') {
    return { success: false, error: 'Esta ação é apenas para cadências de e-mail automático' };
  }

  if (cadence.status !== 'draft' && cadence.status !== 'paused') {
    return { success: false, error: 'Cadência precisa estar em rascunho ou pausada para editar passos' };
  }

  // Passos atuais (ordenados) — a posição i reaproveita o ID do passo i.
  const { data: existingRows, error: existingError } = (await from(supabase, 'cadence_steps')
    .select('id, step_order, template_id, template_id_b')
    .eq('cadence_id', cadence_id)
    .order('step_order', { ascending: true })) as { data: ExistingStep[] | null; error: { message: string } | null };

  if (existingError) {
    return { success: false, error: 'Erro ao ler passos existentes' };
  }

  const existing = existingRows ?? [];

  // Mudar a QUANTIDADE de passos com leads em andamento reposiciona quem está
  // no fim da régua (current_step é posicional). Só com confirmação.
  if (steps.length !== existing.length) {
    const { count } = (await from(supabase, 'cadence_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('cadence_id', cadence_id)
      .in('status', ['active', 'paused'])) as { count: number | null };

    const inProgress = count ?? 0;
    if (inProgress > 0 && !confirm_active_enrollments) {
      return {
        success: false,
        code: ACTIVE_ENROLLMENTS_CODE,
        error:
          `Esta cadência tem ${inProgress} lead${inProgress === 1 ? '' : 's'} em andamento. ` +
          'Adicionar ou remover passos muda a posição desses leads na régua de e-mails.',
      };
    }
  }

  const oldTemplateIds = existing
    .flatMap((s) => [s.template_id, s.template_id_b])
    .filter((id): id is string => id != null);

  // Create templates and upsert steps for each new step
  const newTemplateIds: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const variablesUsed = extractVariables(`${step.subject} ${step.body}`);

    // Create inline template
    const { data: template, error: templateError } = (await from(supabase, 'message_templates')
      .insert({
        org_id: orgId,
        name: `${AUTO_EMAIL_TEMPLATE_PREFIX}${i + 1}`,
        channel: 'email',
        subject: step.subject,
        body: step.body,
        variables_used: variablesUsed,
        is_system: false,
        created_by: userId,
      } as Record<string, unknown>)
      .select('id')
      .single()) as { data: { id: string } | null; error: { message: string } | null };

    if (templateError || !template) {
      return { success: false, error: `Erro ao criar template do step ${i + 1}` };
    }

    newTemplateIds.push(template.id);

    // Create variant B template if A/B is enabled
    let templateBId: string | null = null;
    if (step.ab_enabled && step.body_b) {
      const variablesUsedB = extractVariables(`${step.subject_b ?? ''} ${step.body_b}`);
      const { data: templateB, error: templateBError } = (await from(supabase, 'message_templates')
        .insert({
          org_id: orgId,
          name: `${AUTO_EMAIL_TEMPLATE_PREFIX}${i + 1} (B)`,
          channel: 'email',
          subject: step.subject_b ?? '',
          body: step.body_b,
          variables_used: variablesUsedB,
          is_system: false,
          created_by: userId,
        } as Record<string, unknown>)
        .select('id')
        .single()) as { data: { id: string } | null; error: { message: string } | null };

      if (templateBError || !templateB) {
        return { success: false, error: `Erro ao criar template B do step ${i + 1}` };
      }
      templateBId = templateB.id;
      newTemplateIds.push(templateB.id);
    }

    // Upsert cadence step — reaproveita o ID da posição i quando existe.
    const { error: stepError } = await from(supabase, 'cadence_steps')
      .upsert(
        {
          id: existing[i]?.id ?? randomUUID(),
          cadence_id,
          step_order: i + 1,
          channel: 'email',
          template_id: template.id,
          template_id_b: templateBId,
          ab_enabled: step.ab_enabled ?? false,
          ab_distribution: step.ab_distribution ?? 50,
          ab_enabled_at: step.ab_enabled ? new Date().toISOString() : null,
          delay_days: i === 0 ? 0 : step.delay_days,
          delay_hours: i === 0 ? 0 : step.delay_hours,
          ai_personalization: step.ai_personalization,
          reply_type: i === 0 ? 'new_conversation' : (step.reply_type ?? 'new_conversation'),
        } as Record<string, unknown>,
        { onConflict: 'id' },
      );

    if (stepError) {
      // Clean up orphaned templates
      await from(supabase, 'message_templates')
        .delete()
        .eq('id', template.id);
      if (templateBId) {
        await from(supabase, 'message_templates')
          .delete()
          .eq('id', templateBId);
      }
      return { success: false, error: `Erro ao salvar step ${i + 1}` };
    }
  }

  // Remove only the steps beyond the new length
  const extraIds = existing.slice(steps.length).map((s) => s.id);
  if (extraIds.length > 0) {
    const { error: deleteStepsError } = await from(supabase, 'cadence_steps')
      .delete()
      .in('id', extraIds);

    if (deleteStepsError) {
      return { success: false, error: 'Erro ao remover passos excedentes' };
    }
  }

  // Delete the previous inline templates (steps already point to the new ones)
  if (oldTemplateIds.length > 0) {
    const { error: orphanErr } = await from(supabase, 'message_templates')
      .delete()
      .in('id', oldTemplateIds)
      .eq('org_id', orgId);
    if (orphanErr) console.error('[saveAutoEmailSteps] Failed to delete orphaned templates:', orphanErr);
  }

  // Update total_steps
  const { error: countErr } = await from(supabase, 'cadences')
    .update({ total_steps: steps.length } as Record<string, unknown>)
    .eq('id', cadence_id);
  if (countErr) console.error(`[saveAutoEmailSteps] Failed to update total_steps for cadence=${cadence_id}:`, countErr);

  return { success: true, data: { saved: steps.length, template_ids: newTemplateIds } };
}
