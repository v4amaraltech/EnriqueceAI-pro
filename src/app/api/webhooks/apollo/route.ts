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
 * Payload shape (from Apollo docs):
 * {
 *   person: {
 *     id: string,
 *     sanitized_phone: string | null,
 *     phone_numbers: [{ raw_number: string, type: string }]
 *   }
 * }
 */

interface ApolloPhoneWebhook {
  person?: {
    id: string;
    email?: string;
    sanitized_phone?: string | null;
    phone_numbers?: { raw_number: string; type: string }[];
  };
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

  let payload: ApolloPhoneWebhook;

  try {
    payload = await request.json() as ApolloPhoneWebhook;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Diagnostic logging — remove after confirming phone flow works
  console.warn('[apollo-webhook] Received payload:', JSON.stringify({
    personId: payload.person?.id,
    email: payload.person?.email,
    sanitized_phone: payload.person?.sanitized_phone,
    phone_numbers: payload.person?.phone_numbers,
    orgId: new URL(request.url).searchParams.get('org_id'),
  }));

  const person = payload.person;
  if (!person?.id) {
    console.warn('[apollo-webhook] No person data in payload');
    return NextResponse.json({ ok: true, message: 'No person data' });
  }

  const supabase = createServiceRoleClient();

  // Idempotency check — skip already-processed events
  const eventId = `phone_${person.id}`;
  if (await isEventProcessed(supabase, 'apollo', eventId)) {
    return NextResponse.json({ ok: true, message: 'Already processed' });
  }

  const phoneNumbers = person.phone_numbers;
  const sanitizedPhone = person.sanitized_phone;

  if ((!phoneNumbers || phoneNumbers.length === 0) && !sanitizedPhone) {
    console.warn('[apollo-webhook] No phone data for person=%s', person.id);
    return NextResponse.json({ ok: true, message: 'No phone data' });
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

  // Find lead by email (Apollo person.id is not stored in our DB)
  const email = person.email;
  if (!email) {
    return NextResponse.json({ ok: true, message: 'No email to match lead' });
  }

  // org_id is required for multi-tenant isolation
  const reqUrl = new URL(request.url);
  const orgId = reqUrl.searchParams.get('org_id');
  if (!orgId) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 });
  }

  const query = from(supabase, 'leads')
    .select('id, phones')
    .eq('lead_source', 'apollo')
    .eq('email', email)
    .eq('org_id', orgId)
    .is('deleted_at', null);

  const { data: lead } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: { id: string; phones: { tipo: string; numero: string }[] | null } | null };

  if (!lead) {
    console.warn('[apollo-webhook] Lead not found for email=%s org=%s', email, orgId);
    return NextResponse.json({ ok: true, message: 'Lead not found' });
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

  // Mark event as processed for idempotency
  await markEventProcessed(supabase, 'apollo', eventId, 'phone_reveal');

  console.warn('[apollo-webhook] Updated lead=%s with %d phones, primary=%s', lead.id, mergedPhones.length, primaryPhone);
  return NextResponse.json({ ok: true, updated: lead.id });
}
