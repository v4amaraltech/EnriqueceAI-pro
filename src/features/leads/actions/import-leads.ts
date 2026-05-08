'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { ERR_LEAD_LIMIT_EXCEEDED, ERR_LEAD_LIMIT_REACHED } from '@/lib/constants/error-codes';
import { MAX_CSV_SIZE } from '@/lib/constants/limits';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';
import { createNotification } from '@/features/notifications/services/notification.service';
import { exceedsLimit, remainingSlots } from '@/lib/utils/plan-limits';

import type { LeadImportErrorRow } from '../types';
import { logLeadEventBulk } from './log-lead-event';
import { normalizeOriginFields } from '../schemas/lead.schemas';
import { parseCsv } from '../utils/csv-parser';

export interface ImportLeadsResult {
  importId: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  duplicateCount: number;
  errors: LeadImportErrorRow[];
}

export async function importLeads(formData: FormData): Promise<ActionResult<ImportLeadsResult>> {
  const { userId, orgId, role } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  // Get lead source override from form
  const leadSource = (formData.get('lead_source') as string) || null;

  // Get file from form
  const file = formData.get('file') as File | null;
  if (!file || !(file instanceof File)) {
    return { success: false, error: 'Arquivo CSV é obrigatório' };
  }

  if (!file.name.endsWith('.csv')) {
    return { success: false, error: 'Apenas arquivos CSV são aceitos' };
  }

  if (file.size > MAX_CSV_SIZE) {
    return {
      success: false,
      error: `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo permitido: 10MB.`,
    };
  }

  // Read file content
  const content = await file.text();
  const parsed = parseCsv(content);

  // Check for parser-level errors (empty file, no CNPJ column, too many rows)
  if (parsed.rows.length === 0 && parsed.errors.length > 0 && parsed.errors[0]?.rowNumber === 0) {
    return { success: false, error: parsed.errors[0].errorMessage };
  }

  // Check lead limit before importing
  const { data: sub } = (await from(supabase, 'subscriptions')
    .select('plan_id')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { plan_id: string } | null };

  if (sub) {
    const { data: plan } = (await from(supabase, 'plans')
      .select('max_leads')
      .eq('id', sub.plan_id)
      .single()) as { data: { max_leads: number } | null };

    if (plan) {
      const { count: leadCount } = (await from(supabase, 'leads')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .is('deleted_at', null)) as { count: number | null };

      const currentLeads = leadCount ?? 0;
      if (exceedsLimit(currentLeads, 1, plan.max_leads)) {
        return {
          success: false,
          error: `Limite de leads atingido (${currentLeads}/${plan.max_leads}). Faça upgrade para adicionar mais.`,
          code: ERR_LEAD_LIMIT_REACHED,
        };
      }

      const availableSlots = remainingSlots(currentLeads, plan.max_leads);
      if (parsed.rows.length > availableSlots) {
        return {
          success: false,
          error: `Você tem espaço para ${availableSlots} leads, mas o CSV tem ${parsed.rows.length} linhas. Reduza o arquivo ou faça upgrade.`,
          code: ERR_LEAD_LIMIT_EXCEEDED,
        };
      }
    }
  }

  // Create import record
  const { data: importRecord, error: importError } = (await from(supabase, 'lead_imports')
    .insert({
      org_id: orgId,
      file_name: file.name,
      total_rows: parsed.totalRows,
      processed_rows: 0,
      success_count: 0,
      error_count: 0,
      status: 'processing',
      lead_source: leadSource,
      created_by: userId,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (importError || !importRecord) {
    return { success: false, error: 'Erro ao criar registro de importação' };
  }

  const importId = importRecord.id;
  let successCount = 0;
  let duplicateCount = 0;
  const importErrors: LeadImportErrorRow[] = [];
  const importedLeadIds: string[] = [];

  // SDR auto-assign: when an SDR imports leads, auto-assign to themselves
  const autoAssignTo = role === 'sdr' ? userId : null;

  // Insert valid rows
  for (const row of parsed.rows) {
    const normalized = normalizeOriginFields(leadSource ?? row.lead_source ?? null, null);

    // Detect whether the CSV row carries any contact data — when it does, the
    // lead is treated as already enriched (Rafael's "_enriquecido_" CSV use case).
    const hasContactData = !!(row.telefone || row.email || row.decisor || row.website);
    const socios = row.decisor
      ? [{ nome: row.decisor, qualificacao: row.job_title ?? null }]
      : null;

    const { data: insertedLead, error: insertError } = (await from(supabase, 'leads')
      .insert({
        org_id: orgId,
        cnpj: row.cnpj,
        status: 'new',
        enrichment_status: hasContactData ? 'enriched' : 'not_found',
        enriched_at: hasContactData ? new Date().toISOString() : null,
        razao_social: row.razao_social ?? null,
        nome_fantasia: row.nome_fantasia ?? null,
        telefone: row.telefone ?? null,
        phones: row.phones ?? [],
        email: row.email ?? null,
        emails: row.emails ?? null,
        socios,
        job_title: row.job_title ?? null,
        website: row.website ?? null,
        instagram: row.instagram ?? null,
        linkedin: row.linkedin ?? null,
        first_name: row.decisor ? row.decisor.split(' ')[0] ?? null : null,
        last_name: row.decisor ? (row.decisor.split(' ').slice(1).join(' ') || null) : null,
        lead_source: normalized.lead_source,
        canal: normalized.canal,
        created_by: userId,
        assigned_to: autoAssignTo,
        import_id: importId,
      } as Record<string, unknown>)
      .select('id')
      .single()) as { data: { id: string } | null; error: { message?: string } | null };

    if (insertError) {
      const isDuplicate = insertError.message?.includes('unique') || insertError.message?.includes('duplicate');

      // If duplicate, check if the existing lead is soft-deleted and restore it
      if (isDuplicate) {
        const { data: existingLead } = (await from(supabase, 'leads')
          .select('id, deleted_at')
          .eq('org_id', orgId)
          .eq('cnpj', row.cnpj)
          .single()) as { data: { id: string; deleted_at: string | null } | null };

        if (existingLead?.deleted_at) {
          // Restore soft-deleted lead — preserve existing enriched data
          const restoreFields: Record<string, unknown> = {
            deleted_at: null,
            import_id: importId,
          };
          // Only overwrite fields if the CSV actually provides them
          if (row.razao_social) restoreFields.razao_social = row.razao_social;
          if (row.nome_fantasia) restoreFields.nome_fantasia = row.nome_fantasia;
          const effectiveSource = leadSource ?? row.lead_source;
          if (effectiveSource) {
            const normRestore = normalizeOriginFields(effectiveSource, null);
            restoreFields.lead_source = normRestore.lead_source;
            if (normRestore.canal) restoreFields.canal = normRestore.canal;
          }

          const { error: restoreError } = await from(supabase, 'leads')
            .update(restoreFields)
            .eq('id', existingLead.id);

          if (!restoreError) {
            successCount++;
            continue;
          }
        }

        duplicateCount++;
      }

      const errorEntry = {
        id: '',
        import_id: importId,
        row_number: row.rowNumber,
        cnpj: row.cnpj,
        error_message: isDuplicate ? 'CNPJ duplicado nesta organização' : (insertError.message ?? 'Erro ao inserir'),
        created_at: new Date().toISOString(),
      };

      // Record error in database
      await from(supabase, 'lead_import_errors')
        .insert({
          import_id: importId,
          row_number: row.rowNumber,
          cnpj: row.cnpj,
          error_message: errorEntry.error_message,
        } as Record<string, unknown>);

      importErrors.push(errorEntry);
    } else {
      successCount++;
      if (insertedLead) importedLeadIds.push(insertedLead.id);
    }
  }

  // Record parse validation errors
  for (const error of parsed.errors) {
    await from(supabase, 'lead_import_errors')
      .insert({
        import_id: importId,
        row_number: error.rowNumber,
        cnpj: error.cnpj,
        error_message: error.errorMessage,
      } as Record<string, unknown>);

    importErrors.push({
      id: '',
      import_id: importId,
      row_number: error.rowNumber,
      cnpj: error.cnpj,
      error_message: error.errorMessage,
      created_at: new Date().toISOString(),
    });
  }

  const totalErrorCount = importErrors.length;

  // Update import record with final counts
  await from(supabase, 'lead_imports')
    .update({
      processed_rows: parsed.totalRows,
      success_count: successCount,
      error_count: totalErrorCount,
      status: 'completed',
    } as Record<string, unknown>)
    .eq('id', importId);

  // Log import event for each lead
  if (importedLeadIds.length > 0) {
    logLeadEventBulk(supabase, {
      orgId,
      leadIds: importedLeadIds,
      userId,
      event: 'lead_created',
      message: `Lead importado via CSV (${file.name})`,
      metadata: { source: 'csv_import', import_id: importId, file_name: file.name },
    });
  }

  // Notify user that import completed
  createNotification({
    org_id: orgId,
    user_id: userId,
    type: 'import_completed',
    title: `Importação concluída: ${successCount} leads`,
    body: totalErrorCount > 0 ? `${totalErrorCount} erro(s) encontrado(s)` : undefined,
    resource_type: 'lead',
    metadata: { import_id: importId, success_count: successCount, error_count: totalErrorCount },
  }).catch((err) => console.error('[notification] import_completed failed:', err));

  revalidatePath('/leads');
  revalidatePath('/leads/import');

  return {
    success: true,
    data: {
      importId,
      totalRows: parsed.totalRows,
      successCount,
      errorCount: totalErrorCount,
      duplicateCount,
      errors: importErrors,
    },
  };
}

