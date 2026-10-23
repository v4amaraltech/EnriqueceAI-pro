'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { ERR_LEAD_LIMIT_EXCEEDED } from '@/lib/constants/error-codes';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';
import { remainingSlots } from '@/lib/utils/plan-limits';

import { enrichPerson, apolloPhoneTipo, type ApolloPersonFull } from '../services/apollo.service';
import { ordenarCelularPrimeiro, telefonePrincipal } from '@/features/bdr-steps/services/celular';
import { logLeadEventBulk } from './log-lead-event';
import { getApolloApiKey, buildApolloWebhookUrl } from '../services/apollo-key.service';

export interface ImportApolloResult {
  imported: number;
  duplicates: number;
  errors: number;
  /** Amostra de motivos dos erros (distintos), para a tela mostrar o "porquê"
   *  em vez de só o contador. Ex.: "Apollo sem créditos…". */
  errorSamples?: string[];
}

/** Traduz a falha do Apollo (do enrichPerson) para uma mensagem acionável. */
function describeApolloError(reason: unknown): string {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (/Apollo API 402|payment|credit|insufficient/i.test(msg)) {
    return 'Apollo sem créditos disponíveis para revelar os dados (reveal consome crédito).';
  }
  if (/Apollo API 429|rate.?limit|too many/i.test(msg)) {
    return 'Apollo: limite de requisições atingido — tente novamente em alguns minutos.';
  }
  if (/Apollo API 40[13]|unauthorized|forbidden/i.test(msg)) {
    return 'Apollo: chave inválida ou sem permissão para reveal — verifique a conexão em Integrações.';
  }
  return msg.slice(0, 160);
}

interface ApolloPersonInput {
  id: string;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  domain: string | null;
  linkedinUrl: string | null;
}

export async function importApolloLeads(
  people: ApolloPersonInput[],
): Promise<ActionResult<ImportApolloResult>> {
  const { userId, orgId, role } = await requireAuthWithMember();

  // Use org-level key only (no global fallback for multi-tenant isolation)
  const apiKey = await getApolloApiKey(orgId);
  if (!apiKey) {
    return { success: false, error: 'Apollo não conectado. Configure em Settings > Integrações.' };
  }

  if (people.length === 0) {
    return { success: false, error: 'Nenhuma pessoa selecionada para importar' };
  }

  if (people.length > 100) {
    return { success: false, error: 'Máximo de 100 pessoas por importação' };
  }

  const supabase = await createServerSupabaseClient();

  // Check lead limit
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
      const availableSlots = remainingSlots(currentLeads, plan.max_leads);
      if (people.length > availableSlots) {
        return {
          success: false,
          error: `Você tem espaço para ${availableSlots} leads, mas selecionou ${people.length}. Reduza a seleção ou faça upgrade.`,
          code: ERR_LEAD_LIMIT_EXCEEDED,
        };
      }
    }
  }

  const autoAssignTo = role === 'sdr' ? userId : null;
  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  const errorMessages = new Set<string>();
  const apolloImportedIds: string[] = [];

  // Build webhook URL for async phone reveal (HMAC-bound to org_id)
  const webhookUrl = buildApolloWebhookUrl(orgId) ?? undefined;

  // Process in chunks of 10
  for (let i = 0; i < people.length; i += 10) {
    const chunk = people.slice(i, i + 10);

    const enrichedResults = await Promise.allSettled(
      chunk.map((person) =>
        enrichPerson(apiKey, {
          id: person.id,
          firstName: person.firstName ?? undefined,
          lastName: person.lastName ?? undefined,
          organizationName: person.organizationName ?? undefined,
          domain: person.domain ?? undefined,
          linkedinUrl: person.linkedinUrl ?? undefined,
        }, webhookUrl),
      ),
    );

    // Map enrichment results to leads
    const enrichedLeads: Array<{ lead: ReturnType<typeof mapApolloToLead>; index: number }> = [];
    for (let j = 0; j < chunk.length; j++) {
      const enrichResult = enrichedResults[j]!;

      if (enrichResult.status === 'rejected') {
        console.error('[apollo-import] enrichPerson failed:', enrichResult.reason);
        errorMessages.add(describeApolloError(enrichResult.reason));
        errors++;
        continue;
      }

      const enriched = enrichResult.value.person;
      if (!enriched) {
        errorMessages.add('O Apollo não retornou dados desta pessoa (reveal indisponível — pode ser falta de crédito ou dados não disponíveis para este contato).');
        errors++;
        continue;
      }

      enrichedLeads.push({
        lead: mapApolloToLead(enriched, orgId, userId, autoAssignTo, enriched.id, chunk[j]!.organizationName),
        index: j,
      });
    }

    // Batch duplicate check: source_id (Apollo ID), email, phone (last 8 digits), linkedin
    const duplicateSet = new Set<number>(); // indexes of duplicates in enrichedLeads

    // 1. Check by Apollo source_id (exact match — same person imported before)
    const chunkSourceIds = enrichedLeads
      .map((e) => e.lead.source_id)
      .filter((id): id is string => !!id);

    if (chunkSourceIds.length > 0) {
      const { data: existingBySource } = (await from(supabase, 'leads')
        .select('source_id')
        .eq('org_id', orgId)
        .in('source_id', chunkSourceIds)
        .is('deleted_at', null)) as { data: { source_id: string }[] | null };

      const existingSources = new Set((existingBySource ?? []).map((e) => e.source_id));
      for (let idx = 0; idx < enrichedLeads.length; idx++) {
        const sid = enrichedLeads[idx]!.lead.source_id;
        if (sid && existingSources.has(sid)) duplicateSet.add(idx);
      }
    }

    // 2. Check by email (exact match)
    const chunkEmails = enrichedLeads
      .filter((_, idx) => !duplicateSet.has(idx))
      .map((e) => e.lead.email)
      .filter((email): email is string => !!email);

    if (chunkEmails.length > 0) {
      const { data: existingByEmail } = (await from(supabase, 'leads')
        .select('email')
        .eq('org_id', orgId)
        .in('email', chunkEmails)
        .is('deleted_at', null)) as { data: { email: string }[] | null };

      const existingEmails = new Set((existingByEmail ?? []).map((e) => e.email));
      for (let idx = 0; idx < enrichedLeads.length; idx++) {
        if (duplicateSet.has(idx)) continue;
        const email = enrichedLeads[idx]!.lead.email;
        if (email && existingEmails.has(email)) duplicateSet.add(idx);
      }
    }

    // 3. Check by phone (last 8 digits match — covers different formats)
    const phoneCandidates: Array<{ idx: number; suffix: string }> = [];
    for (let idx = 0; idx < enrichedLeads.length; idx++) {
      if (duplicateSet.has(idx)) continue;
      const phone = enrichedLeads[idx]!.lead.telefone;
      if (!phone) continue;
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 8) {
        phoneCandidates.push({ idx, suffix: digits.slice(-8) });
      }
    }

    if (phoneCandidates.length > 0) {
      // Query each phone suffix individually (LIKE patterns can't be batched with IN)
      for (const { idx, suffix } of phoneCandidates) {
        if (duplicateSet.has(idx)) continue;
        const { count } = (await from(supabase, 'leads')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .like('telefone', `%${suffix}`)) as { count: number | null };

        if ((count ?? 0) > 0) duplicateSet.add(idx);
      }
    }

    // 4. Check by LinkedIn URL (exact match on normalized URL)
    const linkedinCandidates: Array<{ idx: number; url: string }> = [];
    for (let idx = 0; idx < enrichedLeads.length; idx++) {
      if (duplicateSet.has(idx)) continue;
      const linkedin = enrichedLeads[idx]!.lead.linkedin;
      if (linkedin) linkedinCandidates.push({ idx, url: linkedin });
    }

    if (linkedinCandidates.length > 0) {
      const urls = linkedinCandidates.map((c) => c.url);
      const { data: existingByLinkedin } = (await from(supabase, 'leads')
        .select('linkedin')
        .eq('org_id', orgId)
        .in('linkedin', urls)
        .is('deleted_at', null)) as { data: { linkedin: string }[] | null };

      const existingLinkedins = new Set((existingByLinkedin ?? []).map((e) => e.linkedin));
      for (const { idx, url } of linkedinCandidates) {
        if (existingLinkedins.has(url)) duplicateSet.add(idx);
      }
    }

    for (let idx = 0; idx < enrichedLeads.length; idx++) {
      const { lead } = enrichedLeads[idx]!;

      if (duplicateSet.has(idx)) {
        duplicates++;
        continue;
      }

      const { data: insertedLead, error: insertError } = (await from(supabase, 'leads')
        .insert(lead as Record<string, unknown>)
        .select('id')
        .single()) as { data: { id: string } | null; error: { message?: string } | null };

      if (insertError) {
        const isDuplicate = insertError.message?.includes('unique') || insertError.message?.includes('duplicate');
        if (isDuplicate) {
          duplicates++;
        } else {
          errorMessages.add(`Erro ao salvar no banco: ${(insertError.message ?? 'desconhecido').slice(0, 140)}`);
          errors++;
        }
      } else {
        imported++;
        if (insertedLead) apolloImportedIds.push(insertedLead.id);
      }
    }
  }

  // Log import event for Apollo leads
  if (apolloImportedIds.length > 0) {
    logLeadEventBulk(supabase, {
      orgId,
      leadIds: apolloImportedIds,
      userId,
      event: 'lead_created',
      message: 'Lead importado via Apollo.io',
      metadata: { source: 'apollo_import' },
    });
  }

  revalidatePath('/leads');

  return {
    success: true,
    data: { imported, duplicates, errors, errorSamples: [...errorMessages].slice(0, 3) },
  };
}

function mapApolloToLead(
  person: ApolloPersonFull,
  orgId: string,
  userId: string,
  assignTo: string | null,
  apolloPersonId?: string,
  searchOrgName?: string | null,
) {
  const org = person.organization;

  // All phones with explicit type → phones JSONB
  const rawPhones: Array<{ tipo: string; numero: string }> = [];
  if (person.phone_numbers && person.phone_numbers.length > 0) {
    for (const pn of person.phone_numbers) {
      rawPhones.push({ tipo: apolloPhoneTipo(pn.type), numero: pn.raw_number });
    }
  } else if (person.sanitized_phone) {
    // Only sanitized_phone available — default to celular
    rawPhones.push({ tipo: 'celular', numero: person.sanitized_phone });
  }
  // BDR IA (24/09/2026): o 1º número do Apollo costuma ser o da sede; o
  // celular brasileiro vai na frente e vira o telefone principal do lead.
  const allPhones = ordenarCelularPrimeiro(rawPhones);
  const phone = telefonePrincipal(null, allPhones);

  return {
    org_id: orgId,
    cnpj: null,
    status: 'new',
    // Apollo leads arrive already enriched — mark status + timestamp so the n8n/
    // APIFY automation skips them (it must NOT re-enrich what came pre-enriched).
    enrichment_status: 'enriched',
    enriched_at: new Date().toISOString(),
    first_name: person.first_name ?? null,
    last_name: person.last_name ?? null,
    razao_social: org?.name ?? searchOrgName ?? null,
    nome_fantasia: org?.name ?? searchOrgName ?? null,
    job_title: person.title ?? null,
    lead_source: 'Outbound',
    canal: 'Apollo',
    is_inbound: false,
    email: person.email ?? null,
    telefone: phone,
    phones: allPhones,
    linkedin: person.linkedin_url ?? null,
    website: org?.website_url ?? null,
    porte: org?.estimated_num_employees
      ? `${org.estimated_num_employees} funcionários`
      : null,
    source_id: apolloPersonId ?? null,
    created_by: userId,
    assigned_to: assignTo,
    notes: null,
  };
}
