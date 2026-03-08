'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { LeadImportErrorRow } from '../types';
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

  const MAX_CSV_SIZE = 10 * 1024 * 1024; // 10 MB
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
  const { data: sub } = (await (supabase
    .from('subscriptions') as ReturnType<typeof supabase.from>)
    .select('plan_id')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { plan_id: string } | null };

  if (sub) {
    const { data: plan } = (await (supabase
      .from('plans') as ReturnType<typeof supabase.from>)
      .select('max_leads')
      .eq('id', sub.plan_id)
      .single()) as { data: { max_leads: number } | null };

    if (plan) {
      const { count: leadCount } = (await (supabase
        .from('leads') as ReturnType<typeof supabase.from>)
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .is('deleted_at', null)) as { count: number | null };

      const currentLeads = leadCount ?? 0;
      if (currentLeads >= plan.max_leads) {
        return {
          success: false,
          error: `Limite de leads atingido (${currentLeads}/${plan.max_leads}). Faça upgrade para adicionar mais.`,
          code: 'LEAD_LIMIT_REACHED',
        };
      }

      const availableSlots = plan.max_leads - currentLeads;
      if (parsed.rows.length > availableSlots) {
        return {
          success: false,
          error: `Você tem espaço para ${availableSlots} leads, mas o CSV tem ${parsed.rows.length} linhas. Reduza o arquivo ou faça upgrade.`,
          code: 'LEAD_LIMIT_EXCEEDED',
        };
      }
    }
  }

  // Create import record
  const { data: importRecord, error: importError } = (await (supabase
    .from('lead_imports') as ReturnType<typeof supabase.from>)
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

  // SDR auto-assign: when an SDR imports leads, auto-assign to themselves
  const autoAssignTo = role === 'sdr' ? userId : null;

  // Insert valid rows
  for (const row of parsed.rows) {
    const { error: insertError } = await (supabase
      .from('leads') as ReturnType<typeof supabase.from>)
      .insert({
        org_id: orgId,
        cnpj: row.cnpj,
        status: 'new',
        enrichment_status: 'pending',
        razao_social: row.razao_social ?? null,
        nome_fantasia: row.nome_fantasia ?? null,
        lead_source: leadSource ?? row.lead_source ?? null,
        created_by: userId,
        assigned_to: autoAssignTo,
        import_id: importId,
      } as Record<string, unknown>);

    if (insertError) {
      const isDuplicate = insertError.message?.includes('unique') || insertError.message?.includes('duplicate');

      // If duplicate, check if the existing lead is soft-deleted and restore it
      if (isDuplicate) {
        const { data: existingLead } = (await (supabase
          .from('leads') as ReturnType<typeof supabase.from>)
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
          if (effectiveSource) restoreFields.lead_source = effectiveSource;

          const { error: restoreError } = await (supabase
            .from('leads') as ReturnType<typeof supabase.from>)
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
      await (supabase
        .from('lead_import_errors') as ReturnType<typeof supabase.from>)
        .insert({
          import_id: importId,
          row_number: row.rowNumber,
          cnpj: row.cnpj,
          error_message: errorEntry.error_message,
        } as Record<string, unknown>);

      importErrors.push(errorEntry);
    } else {
      successCount++;
    }
  }

  // Record parse validation errors
  for (const error of parsed.errors) {
    await (supabase
      .from('lead_import_errors') as ReturnType<typeof supabase.from>)
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
  await (supabase
    .from('lead_imports') as ReturnType<typeof supabase.from>)
    .update({
      processed_rows: parsed.totalRows,
      success_count: successCount,
      error_count: totalErrorCount,
      status: 'completed',
    } as Record<string, unknown>)
    .eq('id', importId);

  // Trigger auto-enrichment (fire-and-forget)
  if (successCount > 0) {
    triggerAutoEnrichment(importId).catch(() => {});
  }

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

async function triggerAutoEnrichment(importId: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.warn('[import-leads] Cannot trigger enrichment: missing SUPABASE_SERVICE_ROLE_KEY');
    return;
  }

  // Fire-and-forget: don't await the full processing, just ensure the request is sent.
  // The worker processes synchronously (needed for Vercel serverless), but we don't
  // need to wait for it to finish — the import response should return immediately.
  fetch(`${appUrl}/api/workers/enrich-leads`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ importId }),
  }).catch((err) => {
    console.error('[import-leads] Enrichment trigger failed:', err);
  });
}
