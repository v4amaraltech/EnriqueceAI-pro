import { NextResponse } from 'next/server';

import { beginCloserCalendarOAuth } from '@/features/closer-calendar/public-flow';
import { getAppUrl } from '@/lib/utils/app-url';

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const started = await beginCloserCalendarOAuth(token);
  if (!started.ok) {
    return NextResponse.redirect(new URL(`/conectar-agenda/resultado?status=${started.status}`, getAppUrl()));
  }
  return NextResponse.redirect(started.url);
}
