import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { isUuid } from '@/shared/utils/uuid';

interface Item { check: string; ok: boolean; critico: boolean; detalhe: string }

/**
 * BDR-6 — Pré-voo do lado do Enriquece. GET /api/v1/bdr/preflight?closer_ids=a,b&min_caixas=3
 * Consolidado com o V4 Call por callcenter/scripts/bdr-preflight.mjs.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const url = new URL(request.url);
  const closerIds = (url.searchParams.get('closer_ids') ?? '').split(',').map((s) => s.trim()).filter(isUuid);
  const minCaixas = Number(url.searchParams.get('min_caixas') ?? 3);
  const supabase = createServiceRoleClient();

  const [{ data: caixas }, { data: cadencias }, { data: agendas }, { data: hooks }] = await Promise.all([
    from(supabase, 'gmail_connections').select('email_address, status, paused_reason, daily_cap').eq('org_id', auth.orgId).eq('bdr_ai', true) as unknown as Promise<{ data: Array<{ email_address: string; status: string; paused_reason: string | null; daily_cap: number | null }> | null }>,
    from(supabase, 'cadences').select('name, status, type').eq('org_id', auth.orgId).ilike('name', 'BDR IA%').is('deleted_at', null) as unknown as Promise<{ data: Array<{ name: string; status: string; type: string }> | null }>,
    closerIds.length ? (from(supabase, 'calendar_connections').select('user_id, status').eq('org_id', auth.orgId).in('user_id', closerIds) as unknown as Promise<{ data: Array<{ user_id: string; status: string }> | null }>) : Promise.resolve({ data: [] as Array<{ user_id: string; status: string }> }),
    from(supabase, 'webhook_endpoints').select('url, events, is_active').eq('org_id', auth.orgId).eq('is_active', true) as unknown as Promise<{ data: Array<{ url: string; events: string[] | null; is_active: boolean }> | null }>,
  ]);

  const conectadas = (caixas ?? []).filter((c) => c.status === 'connected' && !c.paused_reason);
  const ativas = (cadencias ?? []).filter((c) => c.status === 'active');
  const closersOk = closerIds.filter((id) => (agendas ?? []).some((a) => a.user_id === id && a.status === 'connected'));
  const hookReplied = (hooks ?? []).some((h) => !h.events?.length || h.events.includes('email.replied'));

  const itens: Item[] = [
    { check: `caixas do BDR conectadas e não pausadas ≥ ${minCaixas}`, ok: conectadas.length >= minCaixas, critico: true, detalhe: `${conectadas.length}/${caixas?.length ?? 0} (${conectadas.map((c) => c.email_address).join(', ') || 'nenhuma'})` },
    { check: 'cadências "BDR IA" ativas (contato + e-mail auto)', ok: ativas.some((c) => c.type === 'standard') && ativas.some((c) => c.type === 'auto_email'), critico: true, detalhe: ativas.map((c) => `${c.name} [${c.type}]`).join('; ') || 'nenhuma' },
    { check: 'closers com agenda Google conectada', ok: closerIds.length > 0 && closersOk.length === closerIds.length, critico: true, detalhe: closerIds.length ? `${closersOk.length}/${closerIds.length}` : 'closer_ids não informado' },
    { check: 'webhook ativo para email.replied (agente no n8n)', ok: hookReplied, critico: true, detalhe: (hooks ?? []).map((h) => h.url).join(', ') || 'nenhum' },
  ];
  const bloqueios = itens.filter((i) => i.critico && !i.ok).map((i) => i.check);
  return NextResponse.json({ success: true, data: { go: bloqueios.length === 0, bloqueios, itens } });
}
