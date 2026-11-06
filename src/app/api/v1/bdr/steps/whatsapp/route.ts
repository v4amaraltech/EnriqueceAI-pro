import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { callRpc } from '@/features/bdr-steps/actions/rpc';
import {
  MAX_WHATSAPP_POR_DIA,
  autorizouNasInformacoes,
  decidirWhatsApp,
  escolherCelular,
  parseWhatsAppStepRequest,
} from '@/features/bdr-steps/services/whatsapp-step';

export const dynamic = 'force-dynamic';

type Exec = { execution_id: string; enrollment_id: string; channel: string; confirmed_at: string | null };
type Lead = {
  id: string; email: string | null; telefone: string | null; phones: unknown;
  whatsapp_invalid_at: string | null; lost_at: string | null; assigned_to: string | null;
};
type Confirm = { aplicado: boolean; duplicado: boolean; motivo: string; interaction_id: string | null; advanced: boolean; completed: boolean; new_step: number | null };

/**
 * BDR — WhatsApp da Ana como atividade da cadência (regras de 15/10/2026: só com sinal, máx. 3).
 * O envio é do n8n; esta rota decide, trava e registra.
 *
 * POST /api/v1/bdr/steps/whatsapp
 *   { acao: 'checar',    execution_id }  → { enviar: true, telefone, sinal } ou { enviar: false, motivo }
 *                                          (sem sinal/bloqueado: o passo já fica registrado como pulado e avança;
 *                                          429 teto_do_dia: nada registrado, devolva o passo)
 *   { acao: 'iniciar',   execution_id }  → grava a intenção ANTES do envio. 409 envio_incerto = tentativa
 *                                          anterior interrompida: registrado como incerto, NÃO envie.
 *   { acao: 'registrar', execution_id, status: 'enviado'|'falhou'|'incerto', texto, message_id?, erro? }
 *                                        → histórico do lead + avanço do passo.
 *   { acao: 'resposta',  lead_id, texto, message_id, opt_out? }
 *                                        → lead respondeu: bloqueio de prospecção (ou total se pediu para parar)
 *                                          e resposta no histórico. Idempotente por message_id.
 * Passo que não deve sair agora (fora do horário, IA falhou antes de iniciar) → /release sem nova tentativa.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`bdr-steps-whatsapp:${auth.orgId}`, 120, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const parsed = parseWhatsAppStepRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const q = parsed.value;
  const supabase = createServiceRoleClient();

  // ── resposta: o lead respondeu no WhatsApp da Ana ─────────────────────
  // Sai da prospecção (bloqueio 'prospeccao'; pedido para parar → 'total') e a resposta
  // entra no histórico. Idempotente por message_id. Um humano assume a conversa.
  if (q.acao === 'resposta') {
    const { data: lead } = (await from(supabase, 'leads').select('id, assigned_to')
      .eq('id', q.leadId!).eq('org_id', auth.orgId).maybeSingle()) as { data: { id: string; assigned_to: string | null } | null };
    if (!lead) return NextResponse.json({ success: false, error: 'lead não encontrado nesta org' }, { status: 404 });

    if (q.messageId) {
      const { data: ja } = (await from(supabase, 'interactions').select('id').eq('lead_id', lead.id).eq('channel', 'whatsapp')
        .eq('type', 'replied').eq('external_id', q.messageId).limit(1).maybeSingle()) as { data: { id: string } | null };
      if (ja) return NextResponse.json({ success: true, data: { estado: 'ja_registrada', interaction_id: ja.id } });
    }

    const tipo = q.optOut ? 'total' : 'prospeccao';
    await from(supabase, 'contact_holds').upsert(
      { org_id: auth.orgId, lead_id: lead.id, tipo, origem: q.optOut ? 'whatsapp_pediu_para_parar' : 'whatsapp_respondeu' } as Record<string, unknown>,
      { onConflict: 'lead_id,tipo', ignoreDuplicates: true },
    );
    const { data: inter } = (await from(supabase, 'interactions').insert({
      org_id: auth.orgId, lead_id: lead.id, channel: 'whatsapp', type: 'replied',
      message_content: q.texto, external_id: q.messageId, performed_by: lead.assigned_to, ai_generated: false,
      metadata: { source: 'ana_ia_whatsapp', opt_out: q.optOut, bloqueio: tipo },
    } as Record<string, unknown>).select('id').maybeSingle()) as { data: { id: string } | null };
    return NextResponse.json({ success: true, data: { estado: 'registrada', bloqueio: tipo, interaction_id: inter?.id ?? null } });
  }

  const { data: exec } = (await from(supabase, 'cadence_step_executions')
    .select('execution_id, enrollment_id, channel, confirmed_at')
    .eq('execution_id', q.executionId!).eq('org_id', auth.orgId).maybeSingle()) as { data: Exec | null };
  if (!exec) return NextResponse.json({ success: false, code: 'execution_id_desconhecida', error: 'execution_id não reservado nesta org' }, { status: 404 });
  if (exec.channel !== 'whatsapp') return NextResponse.json({ success: false, error: `passo é ${exec.channel}, não whatsapp` }, { status: 400 });
  if (exec.confirmed_at) return NextResponse.json({ success: true, data: { enviar: false, estado: 'ja_confirmado' } });

  const { data: ce } = (await from(supabase, 'cadence_enrollments').select('lead_id').eq('id', exec.enrollment_id).maybeSingle()) as { data: { lead_id: string } | null };
  if (!ce) return NextResponse.json({ success: false, error: 'inscrição não encontrada' }, { status: 404 });
  const { data: lead } = (await from(supabase, 'leads')
    .select('id, email, telefone, phones, whatsapp_invalid_at, lost_at, assigned_to')
    .eq('id', ce.lead_id).maybeSingle()) as { data: Lead | null };
  if (!lead) return NextResponse.json({ success: false, error: 'lead não encontrado' }, { status: 404 });

  const confirmar = (evento: 'whatsapp_enviado' | 'whatsapp_falhou' | 'whatsapp_incerto' | 'whatsapp_pulado', conteudo: string | null, metadata: Record<string, unknown>, messageId: string | null = null) =>
    callRpc<Confirm[]>(supabase, 'confirm_email_step', {
      p_org_id: auth.orgId,
      p_execution_id: q.executionId,
      p_evento: evento,
      p_performed_by: lead.assigned_to,
      p_gmail_message_id: messageId,
      p_conteudo: conteudo,
      p_metadata: metadata,
      p_interaction_id: null,
    }).then((rows) => rows?.[0] ?? null);

  // ── registrar ──────────────────────────────────────────────────────────
  if (q.acao === 'registrar') {
    const evento = q.status === 'enviado' ? 'whatsapp_enviado' : q.status === 'falhou' ? 'whatsapp_falhou' : 'whatsapp_incerto';
    const conteudo = q.status === 'enviado' ? q.texto : `WhatsApp da Ana ${q.status === 'falhou' ? 'não enviado (falha)' : 'com envio incerto'}${q.erro ? `: ${q.erro}` : ''}.`;
    const c = await confirmar(evento, conteudo, { texto: q.texto, erro: q.erro }, q.messageId);
    return NextResponse.json({ success: true, data: c });
  }

  // ── iniciar ────────────────────────────────────────────────────────────
  if (q.acao === 'iniciar') {
    const [inicio] = await callRpc<Array<{ estado: string }>>(supabase, 'begin_email_step', {
      p_org_id: auth.orgId, p_execution_id: q.executionId, p_rfc_message_id: `wpp-${randomUUID()}`,
    });
    if (inicio?.estado === 'iniciado') return NextResponse.json({ success: true, data: { estado: 'iniciado' } });
    if (inicio?.estado === 'ja_iniciado') {
      const c = await confirmar('whatsapp_incerto', 'WhatsApp da Ana com envio incerto (tentativa anterior interrompida). Não reenviado.', { motivo: 'tentativa_anterior_interrompida' });
      return NextResponse.json({ success: false, code: 'envio_incerto', error: 'Envio anterior interrompido; registrado como incerto. NÃO envie.', data: c }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: `Não foi possível iniciar (${inicio?.estado ?? '?'})` }, { status: 409 });
  }

  // ── checar: sinais do lead no momento do envio ─────────────────────────
  // Teto do dia: nada sai e o passo volta para a fila (o n8n chama /release, sem nova tentativa).
  const inicioDia = new Date(); inicioDia.setUTCHours(3, 0, 0, 0); // 00:00 BRT
  if (inicioDia > new Date()) inicioDia.setUTCDate(inicioDia.getUTCDate() - 1);
  const { count: hoje } = (await from(supabase, 'interactions').select('id', { count: 'exact', head: true })
    .eq('org_id', auth.orgId).eq('channel', 'whatsapp').eq('type', 'sent').eq('metadata->>source', 'ana_ia_whatsapp')
    .gte('created_at', inicioDia.toISOString())) as unknown as { count: number | null };
  if ((hoje ?? 0) >= MAX_WHATSAPP_POR_DIA) {
    return NextResponse.json({ success: false, code: 'teto_do_dia', error: `Teto diário de WhatsApp atingido (${hoje}/${MAX_WHATSAPP_POR_DIA}). Devolva o passo.` }, { status: 429 });
  }

  const [holds, recusas, wppAna, respostas, aberturas, enrolls] = await Promise.all([
    from(supabase, 'contact_holds').select('tipo').eq('lead_id', lead.id).in('tipo', ['prospeccao', 'conversa', 'total']).limit(1),
    from(supabase, 'interactions').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id).eq('channel', 'phone')
      .in('metadata->resultado->>proxima_acao', ['nao_contatar']),
    from(supabase, 'interactions').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id).eq('channel', 'whatsapp')
      .eq('type', 'sent').eq('metadata->>source', 'ana_ia_whatsapp'),
    from(supabase, 'interactions').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id).eq('channel', 'email').eq('type', 'replied'),
    // E-mails abertos (ou clicados) de verdade: só conta o que chegou depois do corte e ficou gravado no
    // próprio envio (src/lib/email/engajamento-real.ts) — a abertura do robô de segurança não é sinal.
    from(supabase, 'interactions').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id).eq('channel', 'email').eq('type', 'sent')
      .or('metadata->>aberto_real_em.not.is.null,metadata->>clicado_real_em.not.is.null'),
    from(supabase, 'cadence_enrollments').select('id').eq('lead_id', lead.id),
  ]) as unknown as [
    { data: Array<{ tipo: string }> | null }, { count: number | null }, { count: number | null },
    { count: number | null }, { count: number | null }, { data: Array<{ id: string }> | null },
  ];

  const enrollmentIds = (enrolls.data ?? []).map((e) => e.id);
  const { data: infos } = enrollmentIds.length
    ? ((await from(supabase, 'external_step_events').select('informacoes:payload->informacoes_chave')
        .in('enrollment_id', enrollmentIds).not('payload->informacoes_chave', 'is', null)) as { data: Array<{ informacoes: unknown }> | null })
    : { data: [] };

  let descadastrado = false;
  if (lead.email) {
    const { data: sup } = (await from(supabase, 'email_suppressions').select('id').eq('org_id', auth.orgId).ilike('email', lead.email).limit(1).maybeSingle()) as { data: { id: string } | null };
    descadastrado = Boolean(sup);
  }

  const decisao = decidirWhatsApp({
    bloqueio: holds.data?.[0]?.tipo ?? null,
    descadastrado,
    perdido: Boolean(lead.lost_at),
    recusouNaLigacao: (recusas.count ?? 0) > 0,
    whatsappInvalido: Boolean(lead.whatsapp_invalid_at),
    celular: escolherCelular(lead.telefone, lead.phones),
    enviadosPelaAna: wppAna.count ?? 0,
    autorizouNaLigacao: autorizouNasInformacoes((infos ?? []).map((i) => i.informacoes)),
    respondeuEmail: (respostas.count ?? 0) > 0,
    aberturasEmail: aberturas.count ?? 0,
  });

  if (!decisao.enviar) {
    const c = await confirmar('whatsapp_pulado', `WhatsApp da Ana não enviado: ${decisao.motivo}.`, { motivo: decisao.motivo });
    return NextResponse.json({ success: true, data: { enviar: false, motivo: decisao.motivo, ...c } });
  }
  return NextResponse.json({
    success: true,
    data: { enviar: true, telefone: decisao.telefone, sinal: decisao.sinal, lead_id: lead.id, enviados_pela_ana: wppAna.count ?? 0 },
  });
}
