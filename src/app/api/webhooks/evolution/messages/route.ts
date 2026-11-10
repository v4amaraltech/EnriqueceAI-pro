import crypto from 'crypto';

import { NextResponse } from 'next/server';

import { parseEvolutionUpsert } from '@/features/lead-messages/evolution-parse';
import { storeOrQuarantine } from '@/features/lead-messages/inbound';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

function secretOk(header: string | null): boolean {
  const expected = process.env.EVOLUTION_MESSAGES_WEBHOOK_SECRET;
  if (!expected || !header) return false;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Webhook novo da Evolution, só para messages.upsert.
 * Não substitui o webhook de conexão que já existe. Não configura a instância.
 */
export async function POST(request: Request) {
  if (!process.env.EVOLUTION_MESSAGES_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook não configurado' }, { status: 503 });
  }
  if (!secretOk(request.headers.get('x-evolution-secret'))) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  let payload: { event?: string; instance?: string; date_time?: string; data?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const event = payload.event ?? '';
  if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') {
    return NextResponse.json({ received: true, ignored: true });
  }
  if (!payload.instance) {
    return NextResponse.json({ error: 'Instância ausente' }, { status: 400 });
  }

  const db = createServiceRoleClient();
  const { data: instance } = (await from(db, 'whatsapp_instances')
    .select('id, org_id, phone')
    .eq('instance_name', payload.instance)
    .maybeSingle()) as { data: { id: string; org_id: string; phone: string | null } | null };
  if (!instance) return NextResponse.json({ received: true, warning: 'instance_not_found' });

  const parsed = parseEvolutionUpsert(payload.data, payload.date_time ?? null);
  if (!parsed || parsed.skip || !parsed.phone) {
    return NextResponse.json({ received: true, ignored: parsed?.skip ?? 'empty' });
  }

  await storeOrQuarantine({
    db,
    orgId: instance.org_id,
    channel: 'whatsapp',
    provider: 'evolution',
    phone: parsed.phone,
    connectionId: instance.id,
    ourAddress: instance.phone,
    bodyText: parsed.text,
    media: parsed.media,
    providerMessageId: parsed.messageId,
    direction: parsed.direction,
    occurredAt: parsed.occurredAt,
    status: parsed.direction === 'outbound' ? 'sent' : null,
  });

  return NextResponse.json({ received: true });
}
