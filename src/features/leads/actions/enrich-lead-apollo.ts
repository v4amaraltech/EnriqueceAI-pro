'use server';

import { revalidatePath } from 'next/cache';

import { getEnv } from '@/config/env';
import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

import { getApolloApiKey } from '../services/apollo-key.service';
import { enrichPerson } from '../services/apollo.service';
import type { LeadPhone } from '../types';

export async function enrichLeadWithApollo(leadId: string): Promise<ActionResult<void>> {
  const { orgId } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  // Verify lead belongs to user's org
  const { data: lead } = (await from(supabase, 'leads')
    .select('id, org_id, first_name, last_name, email, linkedin, razao_social, source_id, telefone, phones, job_title, website, porte')
    .eq('id', leadId)
    .single()) as {
    data: {
      id: string;
      org_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      linkedin: string | null;
      razao_social: string | null;
      source_id: string | null;
      telefone: string | null;
      phones: LeadPhone[] | null;
      job_title: string | null;
      website: string | null;
      porte: string | null;
    } | null;
  };

  if (!lead || lead.org_id !== orgId) {
    return { success: false, error: 'Lead não encontrado' };
  }

  // Get Apollo API key (org-level or env fallback)
  const apiKey = await getApolloApiKey(orgId);
  if (!apiKey) {
    return { success: false, error: 'Apollo não configurado. Configure a API key nas integrações.' };
  }

  // Build webhook URL for async phone reveal
  const webhookSecret = process.env.APOLLO_WEBHOOK_SECRET?.trim();
  const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
  const webhookUrl = webhookSecret
    ? `${appUrl}/api/webhooks/apollo?token=${encodeURIComponent(webhookSecret)}&org_id=${encodeURIComponent(orgId)}`
    : undefined;

  try {
    const { person } = await enrichPerson(
      apiKey,
      {
        id: lead.source_id ?? undefined,
        firstName: lead.first_name ?? undefined,
        lastName: lead.last_name ?? undefined,
        email: lead.email ?? undefined,
        organizationName: lead.razao_social ?? undefined,
        linkedinUrl: lead.linkedin ?? undefined,
      },
      webhookUrl,
    );

    if (!person) {
      return { success: false, error: 'Pessoa não encontrada no Apollo' };
    }

    // Merge: only fill empty fields
    const updates: Record<string, unknown> = {
      source_id: person.id,
      enrichment_status: 'enriched',
      enriched_at: new Date().toISOString(),
    };

    if (!lead.email && person.email) updates.email = person.email;
    if (!lead.job_title && person.title) updates.job_title = person.title;
    if (!lead.linkedin && person.linkedin_url) updates.linkedin = person.linkedin_url;
    if (!lead.website && person.organization?.website_url) updates.website = person.organization.website_url;
    if (!lead.razao_social && person.organization?.name) updates.razao_social = person.organization.name;
    if (!lead.porte && person.organization?.estimated_num_employees) {
      updates.porte = categorizePorte(person.organization.estimated_num_employees);
    }

    // Merge phones (Apollo sync response may include sanitized_phone)
    if (person.sanitized_phone || (person.phone_numbers && person.phone_numbers.length > 0)) {
      const existingPhones = lead.phones ?? [];
      const existingNumbers = new Set(existingPhones.map((p) => p.numero));
      const newPhones = [...existingPhones];

      if (person.sanitized_phone && !existingNumbers.has(person.sanitized_phone)) {
        newPhones.push({ tipo: 'fixo', numero: person.sanitized_phone });
        existingNumbers.add(person.sanitized_phone);
      }

      if (person.phone_numbers) {
        for (const phone of person.phone_numbers) {
          if (!existingNumbers.has(phone.raw_number)) {
            newPhones.push({
              tipo: phone.type === 'mobile' ? 'celular' : 'fixo',
              numero: phone.raw_number,
            });
            existingNumbers.add(phone.raw_number);
          }
        }
      }

      updates.phones = newPhones;
      if (!lead.telefone && newPhones.length > 0) {
        updates.telefone = newPhones[0]!.numero;
      }
    }

    await from(supabase, 'leads').update(updates).eq('id', leadId);

    revalidatePath('/leads');
    revalidatePath(`/leads/${leadId}`);

    return { success: true, data: undefined };
  } catch (error) {
    console.error('Apollo enrichment error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao enriquecer com Apollo',
    };
  }
}

function categorizePorte(employees: number): string {
  if (employees <= 10) return 'MEI';
  if (employees <= 49) return 'ME';
  if (employees <= 99) return 'EPP';
  if (employees <= 499) return 'Média';
  return 'Grande';
}
