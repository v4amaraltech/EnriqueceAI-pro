import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const maxDuration = 60;

/**
 * Proxy audio recordings from API4COM to bypass CORS.
 * Only allows URLs from known recording domains.
 */
export async function GET(request: Request) {
  // Require authenticated user (session cookie)
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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
