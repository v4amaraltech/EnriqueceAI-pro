'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getEnv } from '@/config/env';

import { enrichPerson, type ApolloPersonFull } from '../services/apollo.service';
import { getApolloApiKey } from '../services/apollo-key.service';

export interface ImportApolloResult {
  imported: number;
  duplicates: number;
  errors: number;
}

interface ApolloPersonInput {
  id: string;
  firstName: string | null;
  lastName: string | null;
  domain: string | null;
  linkedinUrl: string | null;
}

export async function importApolloLeads(
  people: ApolloPersonInput[],
): Promise<ActionResult<ImportApolloResult>> {
  const { userId, orgId, role } = await requireAuthWithMember();

  // Try org-level key first, fall back to env var
  const apiKey = await getApolloApiKey(orgId) ?? getEnv().APOLLO_API_KEY;
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
      const availableSlots = plan.max_leads - currentLeads;
      if (people.length > availableSlots) {
        return {
          success: false,
          error: `Você tem espaço para ${availableSlots} leads, mas selecionou ${people.length}. Reduza a seleção ou faça upgrade.`,
          code: 'LEAD_LIMIT_EXCEEDED',
        };
      }
    }
  }

  const autoAssignTo = role === 'sdr' ? userId : null;
  let imported = 0;
  let duplicates = 0;
  let errors = 0;

  // Process in chunks of 10
  for (let i = 0; i < people.length; i += 10) {
    const chunk = people.slice(i, i + 10);

    const enrichedResults = await Promise.allSettled(
      chunk.map((person) =>
        enrichPerson(apiKey, {
          id: person.id,
          firstName: person.firstName ?? undefined,
          lastName: person.lastName ?? undefined,
          domain: person.domain ?? undefined,
          linkedinUrl: person.linkedinUrl ?? undefined,
        }),
      ),
    );

    for (let j = 0; j < chunk.length; j++) {
      const enrichResult = enrichedResults[j]!;

      if (enrichResult.status === 'rejected') {
        errors++;
        continue;
      }

      const enriched = enrichResult.value.person;
      if (!enriched) {
        errors++;
        continue;
      }

      const lead = mapApolloToLead(enriched, orgId, userId, autoAssignTo);

      // Check duplicate by email
      if (lead.email) {
        const { data: existing } = (await (supabase
          .from('leads') as ReturnType<typeof supabase.from>)
          .select('id')
          .eq('org_id', orgId)
          .eq('email', lead.email)
          .is('deleted_at', null)
          .maybeSingle()) as { data: { id: string } | null };

        if (existing) {
          duplicates++;
          continue;
        }
      }

      const { error: insertError } = await (supabase
        .from('leads') as ReturnType<typeof supabase.from>)
        .insert(lead as Record<string, unknown>);

      if (insertError) {
        const isDuplicate = insertError.message?.includes('unique') || insertError.message?.includes('duplicate');
        if (isDuplicate) {
          duplicates++;
        } else {
          errors++;
        }
      } else {
        imported++;
      }
    }
  }

  revalidatePath('/leads');

  return {
    success: true,
    data: { imported, duplicates, errors },
  };
}

function mapApolloToLead(
  person: ApolloPersonFull,
  orgId: string,
  userId: string,
  assignTo: string | null,
) {
  const phone = person.phone_numbers?.[0]?.raw_number ?? person.sanitized_phone ?? null;
  const org = person.organization;

  // Extra phones (index 1+) → phones JSONB
  const extraPhones: Array<{ tipo: string; numero: string }> = [];
  if (person.phone_numbers && person.phone_numbers.length > 1) {
    for (let i = 1; i < person.phone_numbers.length; i++) {
      const pn = person.phone_numbers[i];
      if (pn) {
        const tipo = pn.type === 'mobile' || pn.type === 'mobile_phone' ? 'celular' : 'fixo';
        extraPhones.push({ tipo, numero: pn.raw_number });
      }
    }
  }

  return {
    org_id: orgId,
    cnpj: null,
    status: 'new',
    enrichment_status: 'enriched',
    first_name: person.first_name ?? null,
    last_name: person.last_name ?? null,
    razao_social: org?.name ?? null,
    nome_fantasia: null,
    job_title: person.title ?? null,
    lead_source: 'apollo',
    is_inbound: false,
    email: person.email ?? null,
    telefone: phone,
    phones: extraPhones.length > 0 ? extraPhones : [],
    linkedin: person.linkedin_url ?? null,
    website: org?.website_url ?? null,
    porte: org?.estimated_num_employees
      ? `${org.estimated_num_employees} funcionários`
      : null,
    created_by: userId,
    assigned_to: assignTo,
  };
}
