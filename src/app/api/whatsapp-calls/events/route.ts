import type { NextRequest } from 'next/server';

import { getEnv } from '@/config/env';
import { createSseFilterStream } from '@/features/whatsapp-calls/services/sse-filter';
import { from } from '@/lib/supabase/from';
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

  // Pista 16: clientId SEMPRE derivado no servidor; o `clientId` da query é ignorado.
  const clientId = `enriquece-${user.id}`;
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

  // Só repassa eventos das sessões do usuário (RLS + filtro por user_id).
  let cache: Set<string> | null = null;
  let lastRefresh = 0;
  const getAllowedSids = async ({ refresh }: { refresh: boolean }): Promise<ReadonlySet<string>> => {
    const now = Date.now();
    if (cache && !(refresh && now - lastRefresh > 2000)) return cache;
    const { data } = (await from(supabase, 'whatsapp_call_sessions')
      .select('service_session_id')
      .eq('user_id', user.id)) as { data: { service_session_id: string }[] | null };
    cache = new Set((data ?? []).map((r) => r.service_session_id));
    lastRefresh = now;
    return cache;
  };

  return new Response(res.body.pipeThrough(createSseFilterStream(getAllowedSids)), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
