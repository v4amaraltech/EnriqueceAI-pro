import { NextResponse } from 'next/server';

import { getAuthOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { CALL_RECORDINGS_BUCKET } from '@/features/calls/services/recording-storage.service';

export const maxDuration = 60;

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

const ALLOWED_DOMAINS = ['fs5.api4com.com', 'fs4.api4com.com', 'fs3.api4com.com', 'listener.api4com.com'];

function isAllowedRecordingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some((d) => parsed.hostname === d || parsed.hostname.endsWith('.api4com.com'));
  } catch {
    return false;
  }
}

/** Stream the persisted recording from our private Storage bucket. */
async function streamFromStorage(supabase: ServiceClient, path: string): Promise<NextResponse | null> {
  const { data, error } = await supabase.storage.from(CALL_RECORDINGS_BUCKET).download(path);
  if (error || !data) return null;
  return new NextResponse(data as Blob, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(data.size),
      'Cache-Control': 'private, max-age=86400',
      'Accept-Ranges': 'bytes',
    },
  });
}

/** Stream an API4COM recording URL (CORS bypass). */
async function streamFromUrl(url: string): Promise<NextResponse> {
  if (!isAllowedRecordingUrl(url)) {
    return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
  }
  const response = await fetch(url);
  if (!response.ok) {
    return NextResponse.json({ error: `Upstream error: ${response.status}` }, { status: 502 });
  }
  const body = response.body;
  if (!body) return NextResponse.json({ error: 'No body' }, { status: 502 });

  const headers: Record<string, string> = {
    'Content-Type': response.headers.get('content-type') ?? 'audio/mpeg',
    'Cache-Control': 'public, max-age=86400',
    'Accept-Ranges': 'bytes',
  };
  const contentLength = response.headers.get('content-length');
  if (contentLength) headers['Content-Length'] = contentLength;

  return new NextResponse(body as ReadableStream, { status: 200, headers });
}

/**
 * Proxy audio recordings for the authenticated user's org.
 *
 * Preferred: `?callId=` — serves the durable copy from our Storage bucket,
 * falling back to the call's (still-live) recording_url during the persistence
 * gap. Legacy: `?url=` — streams an API4COM URL after verifying it belongs to
 * a call in the org. Both paths bypass CORS and enforce org ownership.
 */
export async function GET(request: Request) {
  let orgId: string;
  try {
    ({ orgId } = await getAuthOrgId());
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const callId = params.get('callId');
  const url = params.get('url');
  const supabase = createServiceRoleClient();

  // Preferred path: by callId → Storage first, then live URL fallback.
  if (callId) {
    const { data: call } = (await from(supabase, 'calls')
      .select('id, recording_storage_path, recording_url')
      .eq('org_id', orgId)
      .eq('id', callId)
      .maybeSingle()) as {
      data: { id: string; recording_storage_path: string | null; recording_url: string | null } | null;
    };

    if (!call) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (call.recording_storage_path) {
      const stored = await streamFromStorage(supabase, call.recording_storage_path);
      if (stored) return stored;
      // Storage miss — fall through to the URL if we have one.
    }

    if (call.recording_url) return streamFromUrl(call.recording_url);
    return NextResponse.json({ error: 'No recording' }, { status: 404 });
  }

  // Legacy path: by url (verify it belongs to a call in the org).
  if (!url) {
    return NextResponse.json({ error: 'Missing callId or url parameter' }, { status: 400 });
  }
  if (!isAllowedRecordingUrl(url)) {
    return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
  }

  const { data: call } = (await from(supabase, 'calls')
    .select('id')
    .eq('org_id', orgId)
    .eq('recording_url', url)
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };

  if (!call) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return streamFromUrl(url);
}
