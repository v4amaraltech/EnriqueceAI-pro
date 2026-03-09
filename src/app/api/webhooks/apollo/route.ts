import crypto from 'crypto';

import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { isEventProcessed, markEventProcessed } from '@/lib/webhooks';

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
  // Verify webhook secret (passed as query param)
  const webhookSecret = process.env.APOLLO_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(webhookSecret);
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    console.warn('[apollo-webhook] Auth failed: tokenLen=%d secretLen=%d', tokenBuf.length, secretBuf.length);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let rawBody: string;
  let payload: ApolloPhoneWebhook;

  try {
    rawBody = await request.text();
    payload = JSON.parse(rawBody) as ApolloPhoneWebhook;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Log complete raw payload to understand Apollo's webhook format
  console.warn('[apollo-webhook] RAW payload:', rawBody.slice(0, 2000));
  console.warn('[apollo-webhook] Top-level keys:', Object.keys(payload));

  const orgId = url.searchParams.get('org_id');
  if (!orgId) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 });
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

    // Idempotency check
    const eventId = `phone_${person.id}`;
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
        const tipo = pn.type === 'mobile' || pn.type === 'mobile_phone' ? 'celular' : 'fixo';
        phones.push({ tipo, numero: pn.raw_number });
      }
    } else if (sanitizedPhone) {
      phones.push({ tipo: 'celular', numero: sanitizedPhone });
    }

    const primaryPhone = phones[0]?.numero ?? null;

    // Match lead by source_id (Apollo person ID) — most reliable
    let lead: { id: string; phones: { tipo: string; numero: string }[] | null } | null = null;

    const { data: bySourceId } = await from(supabase, 'leads')
      .select('id, phones')
      .eq('source_id', person.id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() as { data: { id: string; phones: { tipo: string; numero: string }[] | null } | null };

    lead = bySourceId;

    // Fallback: match by email if available
    if (!lead && person.email) {
      const { data: byEmail } = await from(supabase, 'leads')
        .select('id, phones')
        .eq('lead_source', 'apollo')
        .eq('email', person.email)
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle() as { data: { id: string; phones: { tipo: string; numero: string }[] | null } | null };

      lead = byEmail;
    }

    if (!lead) {
      console.warn('[apollo-webhook] Lead not found for person=%s org=%s', person.id, orgId);
      continue;
    }

    // Merge with existing phones (avoid duplicates)
    const existingNumbers = new Set(
      (lead.phones ?? []).map((p: { numero: string }) => p.numero),
    );
    const mergedPhones = [...(lead.phones ?? [])];
    for (const p of phones) {
      if (!existingNumbers.has(p.numero)) {
        mergedPhones.push(p);
      }
    }

    await from(supabase, 'leads')
      .update({
        telefone: primaryPhone,
        phones: mergedPhones,
      } as Record<string, unknown>)
      .eq('id', lead.id);

    await markEventProcessed(supabase, 'apollo', eventId, 'phone_reveal');
    console.warn('[apollo-webhook] Updated lead=%s with %d phones, primary=%s', lead.id, mergedPhones.length, primaryPhone);
    updated++;
  }

  return NextResponse.json({ ok: true, updated });
}
