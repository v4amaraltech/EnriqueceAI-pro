import { NextResponse } from 'next/server';

import { getAuthOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const maxDuration = 60;

/**
 * Proxy audio recordings from API4COM to bypass CORS.
 * Only allows URLs from known recording domains and only for calls
 * belonging to the authenticated user's org.
 */
export async function GET(request: Request) {
  let orgId: string;
  try {
    ({ orgId } = await getAuthOrgId());
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url).searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Whitelist recording domains
  const allowedDomains = ['fs5.api4com.com', 'fs4.api4com.com', 'fs3.api4com.com', 'listener.api4com.com'];
  try {
    const parsedUrl = new URL(url);
    if (!allowedDomains.some((d) => parsedUrl.hostname === d || parsedUrl.hostname.endsWith('.api4com.com'))) {
      return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  // Verify URL belongs to a call of the authenticated user's org —
  // previously any logged-in user could fetch any recording from any
  // org if they had the URL (sales calls of other companies leak).
  const supabase = createServiceRoleClient();
  const { data: call } = (await from(supabase, 'calls')
    .select('id')
    .eq('org_id', orgId)
    .eq('recording_url', url)
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };

  if (!call) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fetch audio from API4COM
  const response = await fetch(url);
  if (!response.ok) {
    return NextResponse.json({ error: `Upstream error: ${response.status}` }, { status: 502 });
  }

  const contentType = response.headers.get('content-type') ?? 'audio/mpeg';
  const contentLength = response.headers.get('content-length');
  const body = response.body;

  if (!body) {
    return NextResponse.json({ error: 'No body' }, { status: 502 });
  }

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=86400',
    'Accept-Ranges': 'bytes',
  };
  if (contentLength) headers['Content-Length'] = contentLength;

  return new NextResponse(body as ReadableStream, { status: 200, headers });
}
