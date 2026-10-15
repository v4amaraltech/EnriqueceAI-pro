import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { resumirHistorico, type InteracaoBruta } from '@/features/bdr-steps/services/lead-contexto';
import { isUuid } from '@/shared/utils/uuid';

export const dynamic = 'force-dynamic';

type Lead = {
  id: string; first_name: string | null; last_name: string | null; job_title: string | null; email: string | null;
  nome_fantasia: string | null; razao_social: string | null; segmento: string | null; porte: string | null;
  website: string | null; linkedin: string | null; endereco: Record<string, unknown> | null; notes: string | null;
  custom_field_values: Record<string, unknown> | null; status: string | null;
};

/**
 * BDR — Contexto do lead para a IA escrever o e-mail/WhatsApp da cadência.
 *
 * GET /api/v1/bdr/leads/{id}/contexto
 * → { success, data: { lead: {...}, historico: [{ quando, canal, tipo, texto, resultado?, assunto? }],
 *      contagem: { ligacoes, ligacoes_atendidas, emails_enviados, emails_abertos, respostas } } }
 * Histórico em ordem cronológica (mais antigo primeiro), últimas 40 interações, textos cortados.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`api-read:${auth.orgId}`, 100, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ success: false, error: 'id inválido' }, { status: 400 });
  const supabase = createServiceRoleClient();

  const { data: lead } = (await from(supabase, 'leads')
    .select('id, first_name, last_name, job_title, email, nome_fantasia, razao_social, segmento, porte, website, linkedin, endereco, notes, custom_field_values, status')
    .eq('id', id).eq('org_id', auth.orgId).is('deleted_at', null).maybeSingle()) as { data: Lead | null };
  if (!lead) return NextResponse.json({ success: false, error: 'Lead não encontrado' }, { status: 404 });

  const { data: rows } = (await from(supabase, 'interactions')
    .select('created_at, channel, type, message_content, metadata')
    .eq('lead_id', id).eq('org_id', auth.orgId)
    .order('created_at', { ascending: false }).limit(40)) as { data: InteracaoBruta[] | null };

  const end = lead.endereco ?? {};
  const pick = (k: string) => (typeof end[k] === 'string' ? (end[k] as string) : null);

  return NextResponse.json({
    success: true,
    data: {
      lead: {
        id: lead.id,
        nome: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || null,
        primeiro_nome: lead.first_name,
        cargo: lead.job_title,
        email: lead.email,
        empresa: lead.nome_fantasia || lead.razao_social,
        segmento: lead.segmento,
        porte: lead.porte,
        site: lead.website,
        linkedin: lead.linkedin,
        cidade: pick('cidade') ?? pick('municipio'),
        uf: pick('uf') ?? pick('estado'),
        status: lead.status,
        anotacoes: lead.notes,
        campos: lead.custom_field_values ?? {},
      },
      ...resumirHistorico((rows ?? []).reverse()),
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
