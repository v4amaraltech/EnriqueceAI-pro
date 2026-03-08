import crypto from 'crypto';

import { NextResponse } from 'next/server';

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
  const webhookSecret = process.env.APOLLO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(webhookSecret);
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: ApolloPhoneWebhook;

  try {
    payload = await request.json() as ApolloPhoneWebhook;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const person = payload.person;
  if (!person?.id) {
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

  const query = (supabase
    .from('leads') as ReturnType<typeof supabase.from>)
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

  await (supabase
    .from('leads') as ReturnType<typeof supabase.from>)
    .update({
      telefone: primaryPhone,
      phones: mergedPhones,
    } as Record<string, unknown>)
    .eq('id', lead.id);

  // Mark event as processed for idempotency
  await markEventProcessed(supabase, 'apollo', eventId, 'phone_reveal');

  return NextResponse.json({ ok: true, updated: lead.id });
}
