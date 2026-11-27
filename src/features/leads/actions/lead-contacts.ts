'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { LeadContact, LeadEmail, LeadPhone } from '../types';

export interface LeadContactInput {
  id?: string;
  leadId: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  emails: LeadEmail[];
  phones: LeadPhone[];
  /** Só na criação: não vira principal nem quando é o primeiro contato (o espelho do lead fica como está). */
  neverPrimary?: boolean;
}

/** Drop entries with empty email/numero so we never persist blank rows. */
function cleanEmails(emails: LeadEmail[]): LeadEmail[] {
  return (emails ?? [])
    .filter((e) => (e.email ?? '').trim() !== '')
    .map((e) => ({ tipo: e.tipo, email: e.email.trim() }));
}
function cleanPhones(phones: LeadPhone[]): LeadPhone[] {
  return (phones ?? [])
    .filter((p) => (p.numero ?? '').trim() !== '')
    .map((p) => ({ tipo: p.tipo, numero: p.numero.trim() }));
}

/**
 * List all contacts for a lead, primary first then oldest first.
 */
export async function listLeadContacts(leadId: string): Promise<ActionResult<LeadContact[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'lead_contacts')
    .select('*')
    .eq('lead_id', leadId)
    .eq('org_id', orgId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })) as {
    data: LeadContact[] | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[listLeadContacts] Error:', error.message);
    return { success: false, error: 'Erro ao carregar contatos do lead.' };
  }

  return { success: true, data: data ?? [] };
}

/**
 * Create or update a contact. On create, the very first contact of a lead
 * becomes the primary one automatically (so the mirror trigger has a source).
 */
export async function upsertLeadContact(input: LeadContactInput): Promise<ActionResult<LeadContact>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Ensure the lead belongs to the caller's org (prevents cross-org writes).
  const { data: lead } = (await from(supabase, 'leads')
    .select('id')
    .eq('id', input.leadId)
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { id: string } | null };
  if (!lead) return { success: false, error: 'Lead não encontrado.' };

  const emails = cleanEmails(input.emails);
  const phones = cleanPhones(input.phones);
  const first = (input.first_name ?? '').trim() || null;
  const last = (input.last_name ?? '').trim() || null;
  const role = (input.job_title ?? '').trim() || null;

  if (!first && !last && !role && emails.length === 0 && phones.length === 0) {
    return { success: false, error: 'Informe ao menos um dado do contato (nome, cargo, telefone ou e-mail).' };
  }

  if (input.id) {
    const { data, error } = (await from(supabase, 'lead_contacts')
      .update({
        first_name: first,
        last_name: last,
        job_title: role,
        emails,
        phones,
      } as Record<string, unknown>)
      .eq('id', input.id)
      .eq('org_id', orgId)
      .select('*')
      .single()) as { data: LeadContact | null; error: { message: string } | null };

    if (error || !data) {
      console.error('[upsertLeadContact] update error:', error?.message);
      return { success: false, error: 'Erro ao salvar contato.' };
    }
    revalidatePath(`/leads/${input.leadId}`);
    return { success: true, data };
  }

  // Create — first contact of the lead is the primary one.
  const { count } = (await from(supabase, 'lead_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', input.leadId)
    .eq('org_id', orgId)) as { count: number | null };

  const isPrimary = !input.neverPrimary && (count ?? 0) === 0;

  const { data, error } = (await from(supabase, 'lead_contacts')
    .insert({
      org_id: orgId,
      lead_id: input.leadId,
      first_name: first,
      last_name: last,
      job_title: role,
      emails,
      phones,
      is_primary: isPrimary,
    } as Record<string, unknown>)
    .select('*')
    .single()) as { data: LeadContact | null; error: { message: string } | null };

  if (error || !data) {
    console.error('[upsertLeadContact] insert error:', error?.message);
    return { success: false, error: 'Erro ao criar contato.' };
  }

  revalidatePath(`/leads/${input.leadId}`);
  return { success: true, data };
}

/**
 * Delete a contact. The primary contact can only be removed when it's the last
 * one left — otherwise the SDR must first promote another contact to primary
 * (keeps the lead's mirrored columns pointing at a real person).
 */
export async function deleteLeadContact(contactId: string): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: contact } = (await from(supabase, 'lead_contacts')
    .select('id, lead_id, is_primary')
    .eq('id', contactId)
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { id: string; lead_id: string; is_primary: boolean } | null };
  if (!contact) return { success: false, error: 'Contato não encontrado.' };

  if (contact.is_primary) {
    const { count } = (await from(supabase, 'lead_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', contact.lead_id)
      .eq('org_id', orgId)) as { count: number | null };
    if ((count ?? 0) > 1) {
      return {
        success: false,
        error: 'Defina outro contato como principal antes de remover este.',
      };
    }
  }

  const { error } = await from(supabase, 'lead_contacts')
    .delete()
    .eq('id', contactId)
    .eq('org_id', orgId);

  if (error) {
    console.error('[deleteLeadContact] error:', error.message);
    return { success: false, error: 'Erro ao remover contato.' };
  }

  revalidatePath(`/leads/${contact.lead_id}`);
  return { success: true, data: undefined };
}

/**
 * Promote a contact to primary (atomic swap via RPC). The mirror trigger then
 * copies this contact's data onto the lead's scalar columns.
 */
export async function setPrimaryLeadContact(contactId: string): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  const { error } = await supabase.rpc('set_primary_lead_contact', { p_contact_id: contactId });

  if (error) {
    console.error('[setPrimaryLeadContact] error:', error.message);
    return { success: false, error: 'Erro ao definir contato principal.' };
  }

  return { success: true, data: undefined };
}
