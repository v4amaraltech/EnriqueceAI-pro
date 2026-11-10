import { NextResponse } from 'next/server';

import { finishCloserCalendarOAuth } from '@/features/closer-calendar/public-flow';
import { getAppUrl } from '@/lib/utils/app-url';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = await finishCloserCalendarOAuth({
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    googleError: url.searchParams.get('error'),
  });
  return NextResponse.redirect(new URL(`/conectar-agenda/resultado?status=${status}`, getAppUrl()));
}
