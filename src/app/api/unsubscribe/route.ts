import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { unsubscribeByToken } from '@/features/cadences/actions/unsubscribe';
import { getAppUrl } from '@/lib/utils/app-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// M9 / RFC 8058: one-click unsubscribe target referenced by the List-Unsubscribe
// header. Modern clients (Gmail/Apple) send a POST here to opt out without any
// confirmation. A human clicking the footer link hits GET, which redirects to the
// confirmation page. GET never mutates — keeps link scanners from opting people out.
export async function POST(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'missing token' }, { status: 400 });
  }
  const result = await unsubscribeByToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: 'invalid token' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get('token');
  const base = getAppUrl();
  if (!token) {
    return NextResponse.json({ error: 'missing token' }, { status: 400 });
  }
  return NextResponse.redirect(`${base}/unsubscribe/${encodeURIComponent(token)}`, 302);
}
