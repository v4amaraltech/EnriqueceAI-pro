import { NextResponse } from 'next/server';

import {
  INTERACTIVE_LOOKUP_WAIT_MS,
  lookupRecordingFromApi4Com,
} from '@/features/calls/services/recover-recording.service';
import { verifyRecordingToken } from '@/lib/security/recording-token';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

// Recording hosts we're willing to proxy. recording_url originates from the
// API4COM webhook payload (external), so without this allowlist proxyAudio would
// be an SSRF sink fetching arbitrary attacker-supplied URLs.
const ALLOWED_RECORDING_HOSTS = [
  'fs5.api4com.com',
  'fs4.api4com.com',
  'fs3.api4com.com',
  'listener.api4com.com',
];
function isAllowedRecordingUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_RECORDING_HOSTS.includes(hostname) || hostname.endsWith('.api4com.com');
  } catch {
    return false;
  }
}

/**
 * Proxy endpoint for call recordings.
 * Streams the MP3 from the recording URL, re-fetching from API4COM if the
 * original link is dead. No session (opened from closer briefing emails), so
 * access is gated by a signed, expiring token bound to the callId.
 */
export async function GET(request: Request, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(callId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  const token = new URL(request.url).searchParams.get('token');
  if (!verifyRecordingToken(callId, token)) {
    return NextResponse.json({ error: 'Link inválido ou expirado' }, { status: 403 });
  }

  const supabase = createServiceRoleClient();

  const { data: call } = (await from(supabase, 'calls')
    .select(
      'id, recording_url, metadata, destination, started_at, created_at, user_id, org_id, origin, duration_seconds',
    )
    .eq('id', callId)
    .single()) as {
    data: {
      id: string;
      recording_url: string | null;
      metadata: Record<string, unknown> | null;
      destination: string;
      started_at: string | null;
      created_at: string;
      user_id: string;
      org_id: string;
      origin: string | null;
      duration_seconds: number;
    } | null;
  };

  if (!call) {
    return NextResponse.json({ error: 'Ligação não encontrada' }, { status: 404 });
  }

  // Try existing recording URL first
  if (call.recording_url && isAllowedRecordingUrl(call.recording_url)) {
    const proxyResult = await proxyAudio(call.recording_url);
    if (proxyResult) return proxyResult;
  }

  // Recording URL is dead or missing — try to re-fetch from API4COM
  const newUrl = await refetchFromApi4com(supabase, call);
  if (newUrl && isAllowedRecordingUrl(newUrl)) {
    // Update the stored URL
    await from(supabase, 'calls')
      .update({ recording_url: newUrl, updated_at: new Date().toISOString() })
      .eq('id', callId);

    const proxyResult = await proxyAudio(newUrl);
    if (proxyResult) return proxyResult;
  }

  return NextResponse.json({ error: 'Gravação não disponível' }, { status: 404 });
}

async function proxyAudio(url: string): Promise<NextResponse | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !res.body) return null;

    const contentType = res.headers.get('content-type') ?? 'audio/mpeg';
    const contentLength = res.headers.get('content-length');

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    };
    if (contentLength) headers['Content-Length'] = contentLength;

    return new NextResponse(res.body as ReadableStream, { status: 200, headers });
  } catch {
    return null;
  }
}

/**
 * Busca na API4COM pelo caminho compartilhado (recover-recording.service):
 * primeiro o id do provedor (`filter.where.id`, 1 GET por id), depois a janela de
 * data paginada (paginação lida de `meta`, `metadata` só como fallback). Passa
 * pelo limitador de 15 GET /calls por minuto do token e desiste se a espera
 * passar de INTERACTIVE_LOOKUP_WAIT_MS, para não segurar quem abriu o link.
 */
async function refetchFromApi4com(
  supabase: ReturnType<typeof createServiceRoleClient>,
  call: {
    id: string;
    user_id: string;
    org_id: string;
    metadata: Record<string, unknown> | null;
    destination: string;
    started_at: string | null;
    created_at: string;
    origin: string | null;
    duration_seconds: number;
  },
): Promise<string | null> {
  try {
    return await lookupRecordingFromApi4Com(supabase, call, {
      waitBudgetMs: INTERACTIVE_LOOKUP_WAIT_MS,
    });
  } catch {
    return null;
  }
}
