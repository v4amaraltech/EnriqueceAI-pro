import { NextResponse } from 'next/server';
import crypto from 'crypto';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Webhook do AstraCalls (Epic 7 — gravação): notifica a URL de gravação de uma
// Ligação via WhatsApp quando ela fica pronta no serviço de voz.
//
// CONTRATO (lado AstraCalls — repo Go, AstraOnlineWeb/AstraCalls):
//   POST {WACALLS público}/api/webhooks/wacalls
//   Header: X-Webhook-Secret: <WACALLS_WEBHOOK_SECRET>   (mesmo valor nos dois lados)
//   Body:   { "service_call_id": "<callId do serviço>", "recording_url": "https://..." }
//   Respostas: 200 ok | 400 payload inválido | 401 secret inválido | 503 não configurado
//
// A gravação costuma ficar pronta ANTES de a call ser persistida (o SDR conclui o
// modal de resultado depois). Por isso gravamos num buffer
// (whatsapp_pending_recordings) que o persistWhatsAppCall consome ao criar a call;
// se a call já existir, atualizamos calls.recording_url direto — daí o cron
// persist-pending-recordings baixa pro bucket e o process-pending-transcriptions
// transcreve (pipeline já provider-agnóstico).

function authorized(request: Request): boolean {
  const secret = process.env.WACALLS_WEBHOOK_SECRET;
  if (!secret) return false;
  const provided = request.headers.get('x-webhook-secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface RecordingPayload {
  service_call_id?: string;
  callId?: string;
  recording_url?: string;
  recordingUrl?: string;
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.WACALLS_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'WACALLS_WEBHOOK_SECRET not configured' }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: RecordingPayload;
  try {
    body = (await request.json()) as RecordingPayload;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const serviceCallId = body.service_call_id ?? body.callId;
  const recordingUrl = body.recording_url ?? body.recordingUrl;
  if (!serviceCallId || !recordingUrl) {
    return NextResponse.json({ error: 'missing service_call_id or recording_url' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // 1) Buffer idempotente — cobre a corrida de a call ainda não existir.
  await from(supabase, 'whatsapp_pending_recordings').upsert(
    { service_call_id: serviceCallId, recording_url: recordingUrl } as Record<string, unknown>,
    { onConflict: 'service_call_id' },
  );

  // 2) Se a call já foi persistida e ainda não tem gravação, popula direto.
  const { data: call } = (await from(supabase, 'calls')
    .select('id, recording_url')
    .eq('metadata->>service_call_id', serviceCallId)
    .maybeSingle()) as { data: { id: string; recording_url: string | null } | null };

  if (call && !call.recording_url) {
    await from(supabase, 'calls')
      .update({ recording_url: recordingUrl } as Record<string, unknown>)
      .eq('id', call.id);
    return NextResponse.json({ ok: true, linked: true });
  }

  return NextResponse.json({ ok: true, buffered: true });
}
