import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { EmailService } from '@/features/integrations/services/email.service';
import { effectiveDailyCap } from '@/features/bdr-admission/services/capacity';
import { callRpc } from '@/features/bdr-steps/actions/rpc';
import {
  assuntoDeResposta,
  desfechoDoEnvio,
  parseEmailStepRequest,
  textoParaHtml,
} from '@/features/bdr-steps/services/email-step';

export const dynamic = 'force-dynamic';

type Caixa = { user_id: string; email_address: string; daily_cap: number | null; paused_reason: string | null; created_at: string };
type Exec = { execution_id: string; enrollment_id: string; channel: string; confirmed_at: string | null };
type Confirm = { aplicado: boolean; duplicado: boolean; motivo: string; interaction_id: string | null; advanced: boolean; completed: boolean; new_step: number | null };

/**
 * BDR — E-mail da Ana como atividade da cadência (fora do motor auto_email).
 *
 * POST /api/v1/bdr/steps/email
 *   { execution_id, remetente_email, assunto, corpo }   envia o passo reservado no claim (channel 'email')
 *   { teste_para, remetente_email, assunto, corpo }     modo teste: só envia, sem lead/registro/avanço
 *
 * - Envia pela caixa `remetente_email` (gmail_connections da org); o dono dessa conexão vira
 *   `performed_by` da interaction — o vigia de respostas usa o token dele.
 * - Se o lead já recebeu e-mail dessa caixa, responde na mesma conversa ("Re: <assunto original>").
 * - No máximo um e-mail por passo: intenção gravada antes do envio (begin_email_step); se já
 *   existe, não reenvia — registra como incerto e avança.
 * - Respostas: 200 enviado/registrado | 409 bloqueado (registrado e avançado) |
 *   429 teto_caixa / 503 caixa_indisponivel (nada saiu: devolva o passo com /release) |
 *   502 envio_incerto (registrado como incerto e avançado; NÃO reenvie).
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`bdr-steps-email:${auth.orgId}`, 120, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });

  const parsed = parseEmailStepRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  const q = parsed.value;
  const supabase = createServiceRoleClient();

  // Caixa remetente (precisa estar conectada na org)
  const { data: caixa } = (await from(supabase, 'gmail_connections')
    .select('user_id, email_address, daily_cap, paused_reason, created_at')
    .eq('org_id', auth.orgId).ilike('email_address', q.remetenteEmail).eq('status', 'connected')
    .maybeSingle()) as { data: Caixa | null };
  if (!caixa) {
    return NextResponse.json({ success: false, code: 'caixa_indisponivel', error: `Caixa ${q.remetenteEmail} não conectada nesta org` }, { status: 503 });
  }

  const corpoHtml = textoParaHtml(q.corpo);

  // ── Modo teste: envia e pronto ───────────────────────────────────────────
  if (q.testePara) {
    const r = await EmailService.sendEmail(caixa.user_id, auth.orgId, {
      to: q.testePara, subject: `[TESTE] ${q.assunto}`, htmlBody: corpoHtml, trackClicks: false,
    }, undefined, supabase).catch((e: unknown) => ({ success: false as const, stage: 'network' as const, error: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json(
      { success: r.success, data: { modo: 'teste', para: q.testePara, de: caixa.email_address }, error: r.success ? undefined : r.error },
      { status: r.success ? 200 : 502 },
    );
  }

  // ── Passo reservado ──────────────────────────────────────────────────────
  const executionId = q.executionId!;
  const { data: exec } = (await from(supabase, 'cadence_step_executions')
    .select('execution_id, enrollment_id, channel, confirmed_at')
    .eq('execution_id', executionId).eq('org_id', auth.orgId).maybeSingle()) as { data: Exec | null };
  if (!exec) return NextResponse.json({ success: false, code: 'execution_id_desconhecida', error: 'execution_id não reservado nesta org' }, { status: 404 });
  if (exec.channel !== 'email') return NextResponse.json({ success: false, error: `passo é ${exec.channel}, não email` }, { status: 400 });
  if (exec.confirmed_at) return NextResponse.json({ success: true, data: { estado: 'ja_confirmado' } });

  const { data: ce } = (await from(supabase, 'cadence_enrollments').select('lead_id').eq('id', exec.enrollment_id).maybeSingle()) as { data: { lead_id: string } | null };
  if (!ce) return NextResponse.json({ success: false, error: 'inscrição não encontrada' }, { status: 404 });
  const leadId = ce.lead_id;

  const confirmar = (evento: 'email_enviado' | 'email_falhou' | 'email_incerto', extra: {
    gmailMessageId?: string | null; conteudo?: string | null; metadata?: Record<string, unknown>; interactionId?: string;
  } = {}) => callRpc<Confirm[]>(supabase, 'confirm_email_step', {
    p_org_id: auth.orgId,
    p_execution_id: executionId,
    p_evento: evento,
    p_performed_by: caixa.user_id,
    p_gmail_message_id: extra.gmailMessageId ?? null,
    p_conteudo: extra.conteudo ?? null,
    p_metadata: { remetente: caixa.email_address, ...(extra.metadata ?? {}) },
    p_interaction_id: extra.interactionId ?? null,
  }).then((rows) => rows?.[0] ?? null);

  // Bloqueios no momento do envio (fonte central + descadastro + bounce)
  const { data: lead } = (await from(supabase, 'leads').select('email, email_bounced_at').eq('id', leadId).maybeSingle()) as { data: { email: string | null; email_bounced_at: string | null } | null };
  let bloqueio: string | null = null;
  if (!lead?.email) bloqueio = 'sem_email';
  else if (lead.email_bounced_at) bloqueio = 'bounce';
  else {
    const { data: holds } = (await from(supabase, 'contact_holds').select('tipo').eq('lead_id', leadId).in('tipo', ['prospeccao', 'conversa', 'total'])) as { data: Array<{ tipo: string }> | null };
    if (holds?.length) bloqueio = `hold_${holds[0]!.tipo}`;
    else {
      const { data: sup } = (await from(supabase, 'email_suppressions').select('id').eq('org_id', auth.orgId).ilike('email', lead.email).limit(1).maybeSingle()) as { data: { id: string } | null };
      if (sup) bloqueio = 'descadastro';
    }
  }
  if (bloqueio) {
    const c = await confirmar('email_falhou', { conteudo: `E-mail da Ana não enviado: ${bloqueio}.`, metadata: { motivo: bloqueio } });
    return NextResponse.json({ success: false, code: 'bloqueado', error: `Lead bloqueado: ${bloqueio}`, data: c }, { status: 409 });
  }

  // Teto diário da caixa (rampa pela idade da conexão quando daily_cap é nulo)
  const cap = effectiveDailyCap({ dailyCap: caixa.daily_cap, connectedAt: caixa.created_at, pausedReason: caixa.paused_reason, now: new Date() });
  const inicioDia = new Date(); inicioDia.setUTCHours(3, 0, 0, 0); // 00:00 BRT
  if (inicioDia > new Date()) inicioDia.setUTCDate(inicioDia.getUTCDate() - 1);
  const { count: hoje } = (await from(supabase, 'interactions').select('id', { count: 'exact', head: true })
    .eq('org_id', auth.orgId).eq('performed_by', caixa.user_id).eq('channel', 'email').eq('type', 'sent')
    .gte('created_at', inicioDia.toISOString())) as unknown as { count: number | null };
  if ((hoje ?? 0) >= cap) {
    return NextResponse.json({ success: false, code: 'teto_caixa', error: `Teto diário da caixa atingido (${hoje}/${cap})` }, { status: 429 });
  }

  // Mesma conversa: último e-mail desta caixa para este lead
  const { data: anterior } = (await from(supabase, 'interactions').select('metadata')
    .eq('lead_id', leadId).eq('performed_by', caixa.user_id).eq('channel', 'email').eq('type', 'sent')
    .not('external_id', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()) as { data: { metadata: Record<string, unknown> | null } | null };
  const meta = anterior?.metadata ?? {};
  const threadId = typeof meta.thread_id === 'string' ? meta.thread_id : undefined;
  const assuntoOriginal = typeof meta.subject === 'string' ? meta.subject : null;
  const subject = threadId && assuntoOriginal ? assuntoDeResposta(assuntoOriginal) : q.assunto;
  const inReplyTo = threadId && typeof meta.rfc_message_id === 'string' ? meta.rfc_message_id : undefined;

  // Intenção antes do envio (no máximo um e-mail por passo)
  const domain = caixa.email_address.split('@')[1] ?? 'enriqueceai.com.br';
  const rfcMessageId = `<bdr-${randomUUID()}@${domain}>`;
  const [inicio] = await callRpc<Array<{ estado: string; rfc_message_id: string | null }>>(supabase, 'begin_email_step', {
    p_org_id: auth.orgId, p_execution_id: executionId, p_rfc_message_id: rfcMessageId,
  });
  if (inicio?.estado === 'execucao_ja_confirmada') return NextResponse.json({ success: true, data: { estado: 'ja_confirmado' } });
  if (inicio?.estado === 'ja_iniciado') {
    // Uma chamada anterior começou o envio e não terminou: pode ter saído. Não reenvia.
    const c = await confirmar('email_incerto', {
      conteudo: 'E-mail da Ana com envio incerto (tentativa anterior interrompida). Não reenviado.',
      metadata: { motivo: 'tentativa_anterior_interrompida', rfc_message_id: inicio.rfc_message_id },
    });
    return NextResponse.json({ success: false, code: 'envio_incerto', error: 'Envio anterior interrompido; registrado como incerto. NÃO reenvie.', data: c }, { status: 502 });
  }
  if (inicio?.estado !== 'iniciado') {
    return NextResponse.json({ success: false, error: `Não foi possível iniciar o envio (${inicio?.estado ?? '?'})` }, { status: 409 });
  }

  const interactionId = randomUUID();
  let r: Awaited<ReturnType<typeof EmailService.sendEmail>>;
  try {
    r = await EmailService.sendEmail(caixa.user_id, auth.orgId, {
      to: lead!.email!, subject, htmlBody: corpoHtml, threadId, inReplyToMessageId: inReplyTo,
      messageId: rfcMessageId, leadId, trackOpens: true, trackClicks: false,
    }, interactionId, supabase);
  } catch (e) {
    r = { success: false, stage: 'network', error: e instanceof Error ? e.message : String(e) };
  }
  const desfecho = desfechoDoEnvio(r);
  const baseMeta = { subject, rfc_message_id: rfcMessageId, para: lead!.email };

  if (desfecho === 'enviado') {
    const c = await confirmar('email_enviado', {
      gmailMessageId: r.messageId ?? null, conteudo: q.corpo, interactionId,
      metadata: { ...baseMeta, thread_id: r.threadId ?? threadId ?? null },
    });
    return NextResponse.json({ success: true, data: { estado: 'enviado', gmail_message_id: r.messageId ?? null, de: caixa.email_address, assunto: subject, ...c } });
  }

  if (desfecho === 'caixa_indisponivel') {
    // Nada saiu: desfaz a intenção para o passo poder ser tentado de novo depois.
    await from(supabase, 'external_step_events').delete().eq('execution_id', executionId).eq('evento', 'email_enviando');
    await from(supabase, 'cadence_step_executions').update({ evento: null } as Record<string, unknown>).eq('execution_id', executionId);
    return NextResponse.json({ success: false, code: 'caixa_indisponivel', error: `Caixa recusou (${r.httpStatus ?? '-'}): ${r.error ?? ''}. Devolva o passo.` }, { status: 503 });
  }

  const evento = desfecho === 'falhou_avanca' ? 'email_falhou' : 'email_incerto';
  const c = await confirmar(evento, {
    conteudo: desfecho === 'falhou_avanca' ? `E-mail da Ana recusado pelo Gmail (${r.httpStatus}).` : 'E-mail da Ana com envio incerto (sem resposta do Gmail). Não reenviado.',
    metadata: { ...baseMeta, motivo: r.error ?? null, http_status: r.httpStatus ?? null, stage: r.stage ?? null },
  });
  return NextResponse.json({
    success: false,
    code: desfecho === 'falhou_avanca' ? 'envio_falhou' : 'envio_incerto',
    error: desfecho === 'falhou_avanca' ? `Gmail recusou (${r.httpStatus}): ${r.error ?? ''}` : `Resultado desconhecido (${r.error ?? 'sem resposta'}). NÃO reenvie.`,
    data: c,
  }, { status: 502 });
}
