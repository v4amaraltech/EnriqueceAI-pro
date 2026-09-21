import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { isUuid } from '@/shared/utils/uuid';

/**
 * BDR-3 — Estado da conversa + mensagens (lead e IA) + intenções de resposta.
 * GET /api/v1/email-conversations/{id}
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`api-read:${auth.orgId}`, 100, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ success: false, error: 'id inválido' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: conv } = (await from(supabase, 'email_conversations').select('*').eq('id', id).eq('org_id', auth.orgId).maybeSingle()) as { data: Record<string, unknown> | null };
  if (!conv) return NextResponse.json({ success: false, error: 'Conversa não encontrada' }, { status: 404 });

  const [{ data: inbound }, { data: intents }, { data: holds }, { data: lead }] = await Promise.all([
    from(supabase, 'email_inbound').select('id, kind, from_email, subject, body_text, internal_date, rfc_message_id').eq('conversation_id', id).in('kind', ['lead', 'own']).order('internal_date', { ascending: true }) as unknown as Promise<{ data: unknown[] | null }>,
    from(supabase, 'email_reply_intents').select('id, estado, subject, body_html, responde_a, rfc_message_id, created_at').eq('conversation_id', id).order('created_at', { ascending: true }) as unknown as Promise<{ data: unknown[] | null }>,
    from(supabase, 'contact_holds').select('tipo, origem, created_at').eq('lead_id', conv.lead_id as string) as unknown as Promise<{ data: unknown[] | null }>,
    from(supabase, 'leads').select('id, first_name, last_name, email, razao_social, nome_fantasia, job_title, segmento, assigned_to').eq('id', conv.lead_id as string).maybeSingle() as unknown as Promise<{ data: unknown | null }>,
  ]);
  return NextResponse.json({ success: true, data: { conversation: conv, lead, inbound: inbound ?? [], intents: intents ?? [], holds: holds ?? [] } });
}
