import crypto from 'crypto';

import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { isEventProcessed, markEventProcessed } from '@/lib/webhooks';

import { apolloPhoneTipo } from '@/features/leads/services/apollo.service';
import { ordenarCelularPrimeiro, telefonePrincipal } from '@/features/bdr-steps/services/celular';

export const maxDuration = 30;

/**
 * Apollo.io phone reveal webhook.
 * When we call /people/match with reveal_phone_number=true + webhook_url,
 * Apollo asynchronously sends phone data here once verified.
 *
 * Actual payload shape (from Apollo docs):
 * {
 *   status: "success",
 *   people: [{
 *     id: string,
 *     status: "success",
 *     phone_numbers: [{ raw_number: string, sanitized_number: string, ... }]
 *   }]
 * }
 */

interface ApolloWebhookPerson {
  id: string;
  status?: string;
  email?: string;
  phone_numbers?: {
    raw_number: string;
    sanitized_number?: string;
    type?: string;
    type_cd?: string;
    confidence_cd?: string;
    status_cd?: string;
    dnc_status_cd?: string;
  }[];
  sanitized_phone?: string | null;
}

interface ApolloPhoneWebhook {
  status?: string;
  people?: ApolloWebhookPerson[];
  // Legacy format (fallback)
  person?: ApolloWebhookPerson;
}

export async function POST(request: Request) {
  // Verify webhook: org_id is cryptographically bound to the token via HMAC
  // URL format: ?org_id=xxx&token=HMAC(secret, org_id)
  const webhookSecret = process.env.APOLLO_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  const url = new URL(request.url);
  const orgId = url.searchParams.get('org_id');
  const token = url.searchParams.get('token') ?? '';

  if (!orgId) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 });
  }

  // Token MUST be HMAC-SHA256(secret, org_id) — binds org_id cryptographically so
  // a valid token can only ever write to the org it was minted for. The legacy
  // plain-secret path was removed: it accepted the global secret with an
  // arbitrary org_id, defeating exactly the binding the HMAC provides.
  const expectedHmac = crypto.createHmac('sha256', webhookSecret).update(orgId).digest('hex');
  const hmacBuf = Buffer.from(expectedHmac);
  const tokenBuf = Buffer.from(token);

  const isHmacValid = tokenBuf.length === hmacBuf.length && crypto.timingSafeEqual(tokenBuf, hmacBuf);

  if (!isHmacValid) {
    console.warn('[apollo-webhook] Auth failed for org_id=%s', orgId);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: ApolloPhoneWebhook;

  try {
    payload = (await request.json()) as ApolloPhoneWebhook;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Apollo sends `people` (array) — also handle legacy `person` format
  const people = payload.people ?? (payload.person ? [payload.person] : []);

  if (people.length === 0) {
    console.warn('[apollo-webhook] No people in payload');
    return NextResponse.json({ ok: true, message: 'No people data' });
  }

  const supabase = createServiceRoleClient();
  let updated = 0;

  for (const person of people) {
    if (!person.id) continue;

    // Idempotency check — scoped per org: the same Apollo person can be revealed
    // by two different orgs, and each must receive its own webhook.
    const eventId = `phone_${orgId}_${person.id}`;
    if (await isEventProcessed(supabase, 'apollo', eventId)) continue;

    const phoneNumbers = person.phone_numbers;
    const sanitizedPhone = person.sanitized_phone;

    if ((!phoneNumbers || phoneNumbers.length === 0) && !sanitizedPhone) {
      console.warn('[apollo-webhook] No phone data for person=%s', person.id);
      continue;
    }

    // Build phones array
    const phones: { tipo: string; numero: string }[] = [];
    if (phoneNumbers && phoneNumbers.length > 0) {
      for (const pn of phoneNumbers) {
        phones.push({ tipo: apolloPhoneTipo(pn.type_cd ?? pn.type), numero: pn.raw_number });
      }
    } else if (sanitizedPhone) {
      phones.push({ tipo: 'celular', numero: sanitizedPhone });
    }

    // Match lead by source_id (Apollo person ID) — most reliable
    type LeadRow = { id: string; telefone: string | null; phones: { tipo: string; numero: string }[] | null };
    let lead: LeadRow | null = null;

    const { data: bySourceId } = await from(supabase, 'leads')
      .select('id, telefone, phones')
      .eq('source_id', person.id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() as { data: LeadRow | null };

    lead = bySourceId;

    // Fallback: match by email if available (case-insensitive — gmail and most
    // providers treat the local part as case-insensitive, and we still have
    // legacy rows with mixed-case emails). O import grava canal='Apollo'
    // (lead_source='Outbound'), então o filtro precisa ser pelo canal.
    if (!lead && person.email) {
      const { data: byEmail } = await from(supabase, 'leads')
        .select('id, telefone, phones')
        .eq('canal', 'Apollo')
        .ilike('email', person.email)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle() as { data: LeadRow | null };

      lead = byEmail;
    }

    if (!lead) {
      console.warn('[apollo-webhook] Lead not found for apollo person_id');
      continue;
    }

    // O painel "Contatos" lê lead_contacts, não as colunas do lead — o telefone
    // precisa pousar no contato principal. O trg_sync_primary_contact espelha
    // o contato de volta em leads.phones/telefone, então gravar no contato
    // cobre os dois; gravar só em leads deixa o contato sem telefone para sempre
    // (e uma edição posterior do contato apagaria o número revelado).
    const { data: primaryContact } = await from(supabase, 'lead_contacts')
      .select('id, phones')
      .eq('lead_id', lead.id)
      .eq('is_primary', true)
      .maybeSingle() as { data: { id: string; phones: { tipo: string; numero: string }[] | null } | null };

    // Merge (dedupe por numero): contato primário + lead (pode ter número que o
    // contato ainda não tem, por dessincronização antiga) + payload do Apollo.
    const seenNumbers = new Set<string>();
    const unidos: { tipo: string; numero: string }[] = [];
    for (const p of [...(primaryContact?.phones ?? []), ...(lead.phones ?? []), ...phones]) {
      if (!seenNumbers.has(p.numero)) {
        seenNumbers.add(p.numero);
        unidos.push(p);
      }
    }
    // BDR IA (24/09/2026): celular brasileiro na frente — o trigger
    // sync_primary_contact_to_lead usa o 1º número do contato como telefone
    // principal, e a Ana liga para o telefone principal.
    const mergedPhones = ordenarCelularPrimeiro(unidos);

    if (primaryContact) {
      await from(supabase, 'lead_contacts')
        .update({ phones: mergedPhones } as Record<string, unknown>)
        .eq('id', primaryContact.id);
    } else {
      // Lead antigo sem contato — atualiza direto as colunas do lead.
      await from(supabase, 'leads')
        .update({
          telefone: telefonePrincipal(lead.telefone, mergedPhones),
          phones: mergedPhones,
        } as Record<string, unknown>)
        .eq('id', lead.id);
    }

    await markEventProcessed(supabase, 'apollo', eventId, 'phone_reveal', undefined, orgId);
    console.warn('[apollo-webhook] Updated lead with %d phones', mergedPhones.length);
    updated++;
  }

  return NextResponse.json({ ok: true, updated });
}
