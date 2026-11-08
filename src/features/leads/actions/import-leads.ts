'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { ERR_LEAD_LIMIT_EXCEEDED, ERR_LEAD_LIMIT_REACHED } from '@/lib/constants/error-codes';
import { MAX_CSV_SIZE } from '@/lib/constants/limits';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { countOrgLeads } from '../services/org-lead-count';
import { createNotification } from '@/features/notifications/services/notification.service';
import { escapeLikePattern } from '@/lib/utils/like';
import { exceedsLimit, remainingSlots } from '@/lib/utils/plan-limits';

import type { LeadImportErrorRow } from '../types';
import type { ParsedRow } from '../utils/csv-parser';
import { logLeadEventBulk } from './log-lead-event';
import { normalizeOriginFields } from '../schemas/lead.schemas';
import { parseCsv } from '../utils/csv-parser';
import { decodeCsvFile } from '../utils/decode-csv';

/**
 * Linhas por bloco. 100 mantém a URL do `.in()` de dedup dentro do limite do
 * PostgREST e o payload do INSERT em tamanho saudável.
 */
const IMPORT_CHUNK_SIZE = 100;

export interface ImportLeadsResult {
  importId: string;
  totalRows: number;
  successCount: number;
  /** Só falhas reais — duplicados têm contador próprio. */
  errorCount: number;
  duplicateCount: number;
  errors: LeadImportErrorRow[];
  /** Linhas importadas com ressalva (ex.: CNPJ inválido ignorado). */
  warnings: LeadImportErrorRow[];
}

export async function importLeads(formData: FormData): Promise<ActionResult<ImportLeadsResult>> {
  const { userId, orgId, role } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();
  // As checagens de duplicidade precisam ver a ORG inteira — igual aos índices
  // únicos org-wide de email e CNPJ —, não só os leads visíveis ao importador sob
  // RLS. Importar NÃO é restrito a manager; sob `lead_visibility_mode='own'` um
  // SDR não veria o duplicado de outro SDR, a checagem passaria em branco e o
  // INSERT bateria no índice, gerando um "duplicado por CNPJ" enganoso. Service
  // role alinha a checagem aos índices.
  const dupClient = createServiceRoleClient();

  // Lead source override from the import form. When the operator didn't
  // pick anything, every imported row falls back to Outbound / Prospecção
  // Ativa — that's what the V4 playbook calls a CSV-driven outreach push.
  // (Per-row CSV `lead_source` columns still take precedence over the
  // default; they only lose to a value the operator explicitly typed.)
  const rawLeadSource = (formData.get('lead_source') as string)?.trim() || '';
  const operatorPickedSource = rawLeadSource.length > 0;
  const leadSource = operatorPickedSource ? rawLeadSource : null;
  const DEFAULT_SOURCE = 'Outbound';
  const DEFAULT_CANAL = 'Prospecção Ativa';

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
  const content = await decodeCsvFile(file);
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
      const leadCount = await countOrgLeads(orgId);

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
  const importWarnings: LeadImportErrorRow[] = [];
  const importedLeadIds: string[] = [];

  // Toda linha não-importada (ou importada com ressalva) vira uma linha em
  // lead_import_errors classificada por `kind`. Só `error` conta como erro:
  // duplicado é resultado esperado de re-importação e antes inflava o
  // error_count, fazendo um arquivo só de duplicatas parecer um desastre.
  const recordRow = async (
    kind: 'error' | 'duplicate' | 'warning',
    rowNumber: number,
    cnpj: string | null,
    message: string,
  ) => {
    await from(supabase, 'lead_import_errors').insert({
      import_id: importId,
      row_number: rowNumber,
      cnpj,
      error_message: message,
      kind,
    } as Record<string, unknown>);

    const entry: LeadImportErrorRow = {
      id: '',
      import_id: importId,
      row_number: rowNumber,
      cnpj,
      error_message: message,
      kind,
      created_at: new Date().toISOString(),
    };
    if (kind === 'error') importErrors.push(entry);
    else if (kind === 'warning') importWarnings.push(entry);
  };

  // SDR auto-assign: when an SDR imports leads, auto-assign to themselves
  const autoAssignTo = role === 'sdr' ? userId : null;

  // Wrap the row-by-row work in a try/catch so an exception (DB hiccup, RLS
  // violation, etc.) doesn't leave lead_imports stuck in 'processing' forever.
  // We've seen 2 stuck imports (852f11c4, 9b0967af) before this guard existed.
  try {
  const buildLeadPayload = (row: ParsedRow): Record<string, unknown> => {
    // Resolution order: operator dropdown → CSV column → DEFAULT_SOURCE.
    // Same rule for canal, but only the default fallback is named explicitly
    // — normalizeOriginFields will move sub-origens (Reativação, Apollo, etc.)
    // to canal automatically when they appear in the source slot.
    const resolvedSource = leadSource ?? row.lead_source ?? DEFAULT_SOURCE;
    const resolvedCanal = operatorPickedSource || row.lead_source ? null : DEFAULT_CANAL;
    const normalized = normalizeOriginFields(resolvedSource, resolvedCanal);

    // Enrichment status reflects whether the CSV brought the decisor (contact
    // human) — that's the signal we actually need for cadences. Earlier this
    // flag fired on telefone/email/website alone, which marked CNPJ-only
    // lists as "enriched" even with empty socios/first_name (Giovanni's
    // "Clínica de estética_enriquecido" CSV on 2026-05-12 hit this: 44 leads
    // stayed forever without decisor because the status said "done").
    //   - decisor present              → 'enriched'  (CSV brought a contact)
    //   - decisor absent + cnpj present → 'pending'   (queue for external enrichment)
    //   - decisor absent + cnpj absent  → 'not_found' (nothing to enrich from)
    const enrichmentStatus: 'enriched' | 'pending' | 'not_found' = row.decisor
      ? 'enriched'
      : row.cnpj
        ? 'pending'
        : 'not_found';

    return {
      org_id: orgId,
      cnpj: row.cnpj,
      status: 'new',
      enrichment_status: enrichmentStatus,
      enriched_at: enrichmentStatus === 'enriched' ? new Date().toISOString() : null,
      razao_social: row.razao_social ?? null,
      nome_fantasia: row.nome_fantasia ?? null,
      telefone: row.telefone ?? null,
      phones: row.phones ?? [],
      email: row.email ?? null,
      emails: row.emails ?? null,
      socios: row.decisor ? [{ nome: row.decisor, qualificacao: row.job_title ?? null }] : null,
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
    };
  };

  // Caminho linha-a-linha: 1 SELECT de dedup + 1 INSERT por linha, com todo o
  // tratamento de restore/duplicata. Deixou de ser o caminho normal (agora é
  // o lote, abaixo) e virou o fallback para quando o INSERT em lote falha —
  // tipicamente uma unique violation que o pré-carregamento não previu.
  const processRowIndividually = async (row: ParsedRow): Promise<void> => {
    // Pre-INSERT dedup for rows without CNPJ. The DB has a unique constraint
    // on (org_id, cnpj), so CNPJ-keyed rows are caught by the duplicate path
    // below. Rows without CNPJ have no DB-level constraint — without an
    // app-level check, CSVs that repeat the same lead would create duplicates.
    //
    // Match order (first hit wins): email, then razao_social + telefone.
    // Email is the strongest non-CNPJ identifier; razao+telefone covers CSVs
    // from sources that have no email at all (LinkedIn lists, event sheets).
    if (!row.cnpj) {
      let existing: { id: string; deleted_at: string | null } | null = null;

      if (row.email) {
        // escapeLikePattern: `%`/`_` no e-mail viram wildcard no ILIKE e
        // casariam com outro lead (`joao_silva@` ≡ `joaoXsilva@`), descartando
        // o lead novo como falso duplicado.
        const { data } = (await from(dupClient, 'leads')
          .select('id, deleted_at')
          .eq('org_id', orgId)
          .ilike('email', escapeLikePattern(row.email))
          .limit(1)
          .maybeSingle()) as { data: { id: string; deleted_at: string | null } | null };
        existing = data;
      }

      // Fallback: company name + phone. Both must be non-empty for the match
      // to be useful — matching by razao alone would over-dedup (multiple
      // branches of the same company); matching by phone alone collides on
      // reception/main switchboard numbers.
      if (!existing && row.razao_social && row.telefone) {
        const { data } = (await from(dupClient, 'leads')
          .select('id, deleted_at')
          .eq('org_id', orgId)
          .ilike('razao_social', escapeLikePattern(row.razao_social))
          .eq('telefone', row.telefone)
          .limit(1)
          .maybeSingle()) as { data: { id: string; deleted_at: string | null } | null };
        existing = data;
      }

      if (existing) {
        if (existing.deleted_at) {
          // Restore soft-deleted lead — same conservative attribution policy
          // as the CNPJ-restore branch below.
          const restoreFields: Record<string, unknown> = {
            deleted_at: null,
            import_id: importId,
          };
          if (row.razao_social) restoreFields.razao_social = row.razao_social;
          if (row.nome_fantasia) restoreFields.nome_fantasia = row.nome_fantasia;
          const restoreSource = leadSource ?? row.lead_source;
          if (restoreSource) {
            const normRestore = normalizeOriginFields(restoreSource, null);
            restoreFields.lead_source = normRestore.lead_source;
            if (normRestore.canal) restoreFields.canal = normRestore.canal;
          }

          // Restaura sob RLS: só o próprio importador restaura seus leads. Se o
          // lead detectado (via service role) for de OUTRO responsável, o UPDATE
          // sob RLS não afeta linha nenhuma → `restored` null → não conta como
          // sucesso; cai em duplicado (reportado corretamente), sem falso positivo.
          const { data: restored, error: restoreError } = await from(supabase, 'leads')
            .update(restoreFields)
            .eq('id', existing.id)
            .select('id')
            .maybeSingle();

          if (!restoreError && restored) {
            successCount++;
            return;
          }
        }

        duplicateCount++;
        await recordRow(
          'duplicate',
          row.rowNumber,
          row.cnpj,
          `Lead já existe nesta organização (casou por ${row.email ? 'e-mail' : 'razão social + telefone'})`,
        );
        return;
      }
    }

    const { data: insertedLead, error: insertError } = (await from(supabase, 'leads')
      .insert(buildLeadPayload(row))
      .select('id')
      .single()) as { data: { id: string } | null; error: { message?: string } | null };

    if (insertError) {
      const isDuplicate = insertError.message?.includes('unique') || insertError.message?.includes('duplicate');

      // If duplicate, check if the existing lead can be restored. Three
      // states qualify: soft-deleted (deleted_at IS NOT NULL), archived,
      // or unqualified — all terminal states where the lead is out of the
      // active pipeline. Anything still in flight (new/contacted/qualified/
      // won) gets rejected so re-imports don't silently overwrite the
      // SDR's in-progress work.
      let alreadyExistsStatus: string | null = null;
      if (isDuplicate) {
        // Re-resolve o lead em conflito pela coluna que causou a colisão: CNPJ
        // quando a linha tem CNPJ, senão email (linha sem CNPJ só bate no índice
        // único de email). Antes consultava sempre por CNPJ — null nas linhas sem
        // CNPJ —, devolvendo null e rotulando erroneamente como "CNPJ duplicado".
        // Service role para enxergar leads de outros responsáveis (RLS 'own').
        let existingLead: { id: string; deleted_at: string | null; status: string } | null = null;
        if (row.cnpj) {
          const { data } = (await from(dupClient, 'leads')
            .select('id, deleted_at, status')
            .eq('org_id', orgId)
            .eq('cnpj', row.cnpj)
            .limit(1)
            .maybeSingle()) as { data: { id: string; deleted_at: string | null; status: string } | null };
          existingLead = data;
        } else if (row.email) {
          const { data } = (await from(dupClient, 'leads')
            .select('id, deleted_at, status')
            .eq('org_id', orgId)
            .ilike('email', escapeLikePattern(row.email))
            .limit(1)
            .maybeSingle()) as { data: { id: string; deleted_at: string | null; status: string } | null };
          existingLead = data;
        }

        if (existingLead) {
          alreadyExistsStatus = existingLead.status;
          const isRestorable =
            !!existingLead.deleted_at ||
            existingLead.status === 'archived' ||
            existingLead.status === 'unqualified';

          if (isRestorable) {
            const restoreFields: Record<string, unknown> = {
              deleted_at: null,
              status: 'new',
              import_id: importId,
            };
            // Only overwrite fields if the CSV actually provides them
            if (row.razao_social) restoreFields.razao_social = row.razao_social;
            if (row.nome_fantasia) restoreFields.nome_fantasia = row.nome_fantasia;
            // Carry the CSV contact data into the restored row so e-mail and
            // telefone get repopulated even if the prior lead had them blank.
            if (row.telefone) restoreFields.telefone = row.telefone;
            if (row.phones) restoreFields.phones = row.phones;
            if (row.email) restoreFields.email = row.email;
            if (row.emails) restoreFields.emails = row.emails;
            if (row.decisor) {
              restoreFields.first_name = row.decisor.split(' ')[0] ?? null;
              restoreFields.last_name = row.decisor.split(' ').slice(1).join(' ') || null;
              if (row.job_title) restoreFields.job_title = row.job_title;
            }
            // Same attribution resolution as the insert path.
            const restoreSource = leadSource ?? row.lead_source;
            if (restoreSource) {
              const normRestore = normalizeOriginFields(restoreSource, null);
              restoreFields.lead_source = normRestore.lead_source;
              if (normRestore.canal) restoreFields.canal = normRestore.canal;
            }

            const { data: restored, error: restoreError } = await from(supabase, 'leads')
              .update(restoreFields)
              .eq('id', existingLead.id)
              .select('id')
              .maybeSingle();

            if (!restoreError && restored) {
              successCount++;
              return;
            }
          }
        }

        duplicateCount++;
      }

      // O campo do conflito reflete a linha: CNPJ quando há CNPJ, senão email.
      const dupField = row.cnpj ? 'CNPJ' : 'email';
      const dupReason = alreadyExistsStatus
        ? `${dupField} duplicado (lead já existe, status=${alreadyExistsStatus})`
        : `${dupField} duplicado nesta organização`;

      await recordRow(
        isDuplicate ? 'duplicate' : 'error',
        row.rowNumber,
        row.cnpj,
        isDuplicate ? dupReason : (insertError.message ?? 'Erro ao inserir'),
      );
    } else {
      successCount++;
      if (insertedLead) importedLeadIds.push(insertedLead.id);
    }
  };

  /**
   * Caminho rápido. Antes eram 1-3 queries POR LINHA (dedup + insert), o que
   * estourava o timeout da Server Action em arquivos grandes e deixava o
   * import travado — a razão de existir o cron reap-stuck-imports. Agora cada
   * bloco de 100 linhas custa 3 SELECTs de dedup + 1 INSERT: um arquivo de
   * 1.000 linhas sai de ~2.500 queries para ~40.
   *
   * O que o lote NÃO tenta resolver sozinho cai em processRowIndividually:
   * lead que já existe (restore tem regra própria) e INSERT em lote recusado
   * pelo banco (o Postgres aborta o comando inteiro na primeira violação, e
   * aí não dá para saber qual linha causou sem reprocessar).
   */
  const importRowsInChunks = async (rows: ParsedRow[]): Promise<void> => {
    // Dedup DENTRO do próprio arquivo. Antes isso saía de graça: como cada
    // INSERT era imediato, a 2ª ocorrência já encontrava a 1ª gravada. Com
    // lote, as duas linhas iriam juntas no mesmo comando — precisa ser
    // explícito.
    const seenCnpj = new Set<string>();
    const seenEmail = new Set<string>();
    const seenRazaoPhone = new Set<string>();

    const emailKeyOf = (row: ParsedRow) => row.email?.trim().toLowerCase() || null;
    const razaoPhoneKeyOf = (row: ParsedRow) =>
      row.razao_social && row.telefone
        ? `${row.razao_social.trim().toLowerCase()}|${row.telefone.trim()}`
        : null;

    for (let offset = 0; offset < rows.length; offset += IMPORT_CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + IMPORT_CHUNK_SIZE);

      const cnpjs = [...new Set(chunk.map((r) => r.cnpj).filter((v): v is string => !!v))];
      const emails = [...new Set(chunk.map(emailKeyOf).filter((v): v is string => !!v))];
      const phones = [...new Set(chunk.map((r) => r.telefone).filter((v): v is string => !!v))];

      const existingCnpj = new Set<string>();
      const existingEmail = new Set<string>();
      const existingRazaoPhone = new Set<string>();

      // Service role pelos mesmos motivos do caminho individual: a checagem
      // precisa enxergar a org inteira, como os índices únicos.
      if (cnpjs.length > 0) {
        const { data } = (await from(dupClient, 'leads')
          .select('cnpj')
          .eq('org_id', orgId)
          .in('cnpj', cnpjs)) as { data: { cnpj: string | null }[] | null };
        for (const r of data ?? []) if (r.cnpj) existingCnpj.add(r.cnpj);
      }

      if (emails.length > 0) {
        // `.in()` compara byte a byte, então mandamos a forma do CSV e a
        // minúscula. Uma caixa diferente das duas escapa daqui e é pega pelo
        // índice único lower(email) no INSERT → fallback individual.
        const variants = [...new Set([...emails, ...chunk.map((r) => r.email).filter((v): v is string => !!v)])];
        const { data } = (await from(dupClient, 'leads')
          .select('email')
          .eq('org_id', orgId)
          .in('email', variants)) as { data: { email: string | null }[] | null };
        for (const r of data ?? []) if (r.email) existingEmail.add(r.email.toLowerCase());
      }

      if (phones.length > 0) {
        const { data } = (await from(dupClient, 'leads')
          .select('razao_social, telefone')
          .eq('org_id', orgId)
          .in('telefone', phones)) as { data: { razao_social: string | null; telefone: string | null }[] | null };
        for (const r of data ?? []) {
          if (r.razao_social && r.telefone) {
            existingRazaoPhone.add(`${r.razao_social.trim().toLowerCase()}|${r.telefone.trim()}`);
          }
        }
      }

      const pending: Array<{ row: ParsedRow; payload: Record<string, unknown> }> = [];

      for (const row of chunk) {
        const emailKey = emailKeyOf(row);
        const razaoPhoneKey = razaoPhoneKeyOf(row);

        const repeatedInFile =
          (row.cnpj && seenCnpj.has(row.cnpj)) ||
          (emailKey && seenEmail.has(emailKey)) ||
          (razaoPhoneKey && seenRazaoPhone.has(razaoPhoneKey));

        if (repeatedInFile) {
          duplicateCount++;
          await recordRow('duplicate', row.rowNumber, row.cnpj, 'Linha repetida dentro do próprio arquivo');
          continue;
        }

        if (row.cnpj) seenCnpj.add(row.cnpj);
        if (emailKey) seenEmail.add(emailKey);
        if (razaoPhoneKey) seenRazaoPhone.add(razaoPhoneKey);

        const alreadyInBase =
          (row.cnpj && existingCnpj.has(row.cnpj)) ||
          (emailKey && existingEmail.has(emailKey)) ||
          (razaoPhoneKey && existingRazaoPhone.has(razaoPhoneKey));

        if (alreadyInBase) {
          // Restore (soft-deleted/arquivado/desqualificado) tem regra própria
          // e é minoria — vale pagar as queries individuais.
          await processRowIndividually(row);
          continue;
        }

        pending.push({ row, payload: buildLeadPayload(row) });
      }

      if (pending.length === 0) continue;

      const { data: inserted, error: insertError } = (await from(supabase, 'leads')
        .insert(pending.map((p) => p.payload))
        .select('id')) as { data: { id: string }[] | null; error: { message?: string } | null };

      if (!insertError && inserted) {
        successCount += inserted.length;
        importedLeadIds.push(...inserted.map((r) => r.id));
        continue;
      }

      // O INSERT em lote é all-or-nothing: uma linha ruim derruba as 100. Sem
      // saber qual foi, reprocessa o bloco no caminho individual, que isola a
      // linha problemática e classifica o motivo certo.
      console.warn(
        `[importLeads] lote de ${pending.length} recusado (import=${importId}), reprocessando linha a linha:`,
        insertError?.message,
      );
      for (const item of pending) {
        await processRowIndividually(item.row);
      }
    }
  };

  await importRowsInChunks(parsed.rows);

  // Record parse validation errors
  for (const error of parsed.errors) {
    await recordRow('error', error.rowNumber, error.cnpj, error.errorMessage);
  }

  // Record parse warnings — linhas que ENTRARAM, mas com ressalva (CNPJ
  // inválido ignorado, zeros à esquerda restaurados). Ficam visíveis para o
  // operador sem contaminar o contador de erros.
  for (const warning of parsed.warnings) {
    await recordRow('warning', warning.rowNumber, warning.cnpj, warning.message);
  }

  const totalErrorCount = importErrors.length;

  // Update import record with final counts. `processed_rows` fica limitado a
  // total_rows por causa do CHECK chk_imports_processed.
  await from(supabase, 'lead_imports')
    .update({
      processed_rows: Math.min(parsed.totalRows, successCount + duplicateCount + totalErrorCount),
      success_count: successCount,
      error_count: totalErrorCount,
      duplicate_count: duplicateCount,
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
      warnings: importWarnings,
    },
  };
  } catch (err) {
    // Hard-fail path: mark the import as 'failed' with whatever counts we
    // accumulated before the exception. Without this, the row sits in
    // 'processing' forever and the user sees a perpetual spinner.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[importLeads] Aborted import=${importId} after ${successCount} successes:`, message);
    await from(supabase, 'lead_imports')
      .update({
        processed_rows: Math.min(parsed.totalRows, successCount + duplicateCount + importErrors.length),
        success_count: successCount,
        error_count: importErrors.length,
        duplicate_count: duplicateCount,
        status: 'failed',
      } as Record<string, unknown>)
      .eq('id', importId);
    return { success: false, error: `Importação interrompida: ${message}` };
  }
}

