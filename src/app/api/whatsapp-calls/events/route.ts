import type { NextRequest } from 'next/server';

import { getEnv } from '@/config/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// SSE same-origin do lifecycle de chamada (story 7.5/7.1). O EventSource do
// browser não pode mandar header X-API-Key, então a key vai no `?apiKey=` —
// e por isso o stream é PROXIADO aqui (a key fica no servidor, nunca no browser).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  // Só usuários autenticados podem abrir o stream.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('unauthorized', { status: 401 });

  const env = getEnv();
  if (!env.WACALLS_BASE_URL || !env.WACALLS_API_KEY) {
    return new Response('voice service not configured', { status: 503 });
  }

  const clientId = req.nextUrl.searchParams.get('clientId') ?? `enriquece-${user.id}`;
  const base = env.WACALLS_BASE_URL.replace(/\/$/, '');
  const upstream = `${base}/api/events?clientId=${encodeURIComponent(clientId)}&apiKey=${encodeURIComponent(env.WACALLS_API_KEY)}`;

  const res = await fetch(upstream, {
    headers: { Accept: 'text/event-stream' },
    signal: req.signal,
    cache: 'no-store',
  }).catch(() => null);

  if (!res || !res.ok || !res.body) {
    return new Response('voice service unavailable', { status: 502 });
  }

  return new Response(res.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
