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

interface BackfillResult {
  total: number;
  updated: number;
  noMatch: number;
  errors: number;
}

/**
 * Re-enriches Apollo leads that are missing source_id.
 * This backfills the source_id field so the phone reveal webhook
 * can match them, and also fills any missing fields (nome_fantasia, etc).
 */
export async function backfillApolloSourceIds(): Promise<ActionResult<BackfillResult>> {
  const { orgId } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const apiKey = await getApolloApiKey(orgId);
  if (!apiKey) {
    return { success: false, error: 'Apollo não configurado. Configure a API key nas integrações.' };
  }

  // Find Apollo leads without source_id
  const { data: leads } = (await from(supabase, 'leads')
    .select('id, first_name, last_name, email, linkedin, razao_social, nome_fantasia, telefone, phones, job_title, website, porte')
    .eq('org_id', orgId)
    .eq('lead_source', 'apollo')
    .is('source_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(100)) as {
    data: Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      linkedin: string | null;
      razao_social: string | null;
      nome_fantasia: string | null;
      telefone: string | null;
      phones: LeadPhone[] | null;
      job_title: string | null;
      website: string | null;
      porte: string | null;
    }> | null;
  };

  if (!leads || leads.length === 0) {
    return { success: true, data: { total: 0, updated: 0, noMatch: 0, errors: 0 } };
  }

  // Build webhook URL for phone reveal
  const webhookSecret = process.env.APOLLO_WEBHOOK_SECRET?.trim();
  const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
  const webhookUrl = webhookSecret
    ? `${appUrl}/api/webhooks/apollo?token=${encodeURIComponent(webhookSecret)}&org_id=${encodeURIComponent(orgId)}`
    : undefined;

  let updated = 0;
  let noMatch = 0;
  let errors = 0;

  // Process in chunks of 5 to avoid rate limits
  for (let i = 0; i < leads.length; i += 5) {
    const chunk = leads.slice(i, i + 5);

    const results = await Promise.allSettled(
      chunk.map((lead) =>
        enrichPerson(
          apiKey,
          {
            firstName: lead.first_name ?? undefined,
            lastName: lead.last_name ?? undefined,
            email: lead.email ?? undefined,
            organizationName: lead.razao_social ?? undefined,
            linkedinUrl: lead.linkedin ?? undefined,
          },
          webhookUrl,
        ),
      ),
    );

    for (let j = 0; j < chunk.length; j++) {
      const lead = chunk[j]!;
      const result = results[j]!;

      if (result.status === 'rejected') {
        console.error('[apollo-backfill] enrichPerson failed for lead=%s:', lead.id, result.reason);
        errors++;
        continue;
      }

      const person = result.value.person;
      if (!person) {
        noMatch++;
        continue;
      }

      // Build update: always set source_id, fill empty fields
      const updates: Record<string, unknown> = {
        source_id: person.id,
      };

      if (!lead.email && person.email) updates.email = person.email;
      if (!lead.job_title && person.title) updates.job_title = person.title;
      if (!lead.linkedin && person.linkedin_url) updates.linkedin = person.linkedin_url;
      if (!lead.website && person.organization?.website_url) updates.website = person.organization.website_url;
      if (person.organization?.name) {
        if (!lead.razao_social) updates.razao_social = person.organization.name;
        if (!lead.nome_fantasia) updates.nome_fantasia = person.organization.name;
      }

      // Merge phones from sync response (if any)
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

      await from(supabase, 'leads').update(updates).eq('id', lead.id);
      updated++;
    }
  }

  revalidatePath('/leads');

  return {
    success: true,
    data: { total: leads.length, updated, noMatch, errors },
  };
}
