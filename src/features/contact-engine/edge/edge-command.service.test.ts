import { describe, expect, it } from 'vitest';

import {
  authorizeSend, decideReplyRoute, edgeEventKey, registerResult, routeInboundReply, sendCadenceEmail,
} from './edge-command.service';
import {
  authorizeRequestSchema, emailSendRequestSchema, replyRouteRequestSchema, resultRequestSchema,
} from './edge-command.schemas';
import { ALLOWED, DENIED, DENIED_RETRYABLE, EXEC_A, LEAD_A, LEAD_B, ORG_A, ORG_B, makeFakePorts } from './edge-command.testkit';

const authA = { orgId: ORG_A, keyId: 'k1' };
const authB = { orgId: ORG_B, keyId: 'k2' };
const wpp = authorizeRequestSchema.parse({ workflow: 'ana_whatsapp', idempotency_key: 'run-0001', execution_id: EXEC_A });
const body = (r: { body: Record<string, unknown> }) => r.body.data as Record<string, unknown>;

describe('flag desligada: comportamento atual, nenhuma leitura nem escrita', () => {
  it('authorize, result, email-send e route respondem 403 sem tocar em dados', async () => {
    const { ports } = makeFakePorts({ enabledOrgs: [] });
    const results = await Promise.all([
      authorizeSend(authA, wpp, ports),
      registerResult(authA, resultRequestSchema.parse({ workflow: 'ana_whatsapp', idempotency_key: 'run-0001', execution_id: EXEC_A, status: 'falhou' }), ports),
      sendCadenceEmail(authA, emailSendRequestSchema.parse({ idempotency_key: 'run-0001', execution_id: EXEC_A, remetente_email: 'a@b.co', assunto: 'x', corpo: 'y' }), ports),
      routeInboundReply(authA, replyRouteRequestSchema.parse({ idempotency_key: 'run-0001', phone: '11999990000', message_id: 'm1', texto: 'oi' }), ports),
    ]);
    for (const r of results) {
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('adapter_disabled');
    }
    for (const fn of ['resolveTarget', 'evaluate', 'readEvent', 'recordEvent', 'skipStep', 'delegate', 'findLeadsByPhone', 'access'] as const) {
      expect(ports[fn]).not.toHaveBeenCalled();
    }
  });

  it('flag ligada só para a org A: a org B continua desligada', async () => {
    const { ports } = makeFakePorts({ enabledOrgs: [ORG_A] });
    expect((await authorizeSend(authB, wpp, ports)).status).toBe(403);
  });
});

describe('authorize', () => {
  it('permitido devolve destinatário escolhido pelo app e next_action send', async () => {
    const { ports } = makeFakePorts();
    const r = await authorizeSend(authA, wpp, ports);
    expect(r.status).toBe(200);
    expect(body(r)).toMatchObject({ allowed: true, next_action: 'send', to: '5511999990000', replay: false, provider: 'meta_cloud' });
    expect(r.body.contract_version).toBe('edge-command.v1');
  });

  it('gateway negando bloqueia e orienta skip; negação retentável orienta release', async () => {
    const f = makeFakePorts();
    f.ports.evaluate.mockResolvedValueOnce(DENIED);
    const denied = await authorizeSend(authA, wpp, f.ports);
    expect(body(denied)).toMatchObject({ allowed: false, next_action: 'skip', reasons: ['hold_total'] });
    expect(body(denied).to).toBeUndefined();

    f.ports.evaluate.mockResolvedValueOnce(DENIED_RETRYABLE);
    const retry = await authorizeSend(authA, { ...wpp, idempotency_key: 'run-0002' }, f.ports);
    expect(body(retry)).toMatchObject({ allowed: false, next_action: 'release', retryable: true });
  });

  it('o n8n não informa destinatário nem provedor: campos extras são rejeitados', () => {
    expect(authorizeRequestSchema.safeParse({ ...wpp, telefone: '5511999990000' }).success).toBe(false);
    expect(authorizeRequestSchema.safeParse({ ...wpp, provider: 'evolution' }).success).toBe(false);
  });

  it('o gateway recebe o pedido derivado no servidor, com origem n8n e provedor sem preferência', async () => {
    const { ports } = makeFakePorts();
    await authorizeSend(authA, wpp, ports);
    expect(ports.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_A, leadId: LEAD_A, channel: 'whatsapp', preferredProvider: null,
        contact: '5511999990000', requestedBy: expect.objectContaining({ source: 'n8n', apiKeyId: 'k1', orgId: ORG_A }),
      }),
    );
  });

  it('falha ao gravar a trilha nega (fail-closed)', async () => {
    const f = makeFakePorts();
    f.ports.recordEvent.mockResolvedValueOnce('error');
    const r = await authorizeSend(authA, wpp, f.ports);
    expect(r.status).toBe(503);
    expect(r.body.retryable).toBe(true);
  });

  it('falha ao ler a trilha nega (fail-closed) e não avalia', async () => {
    const f = makeFakePorts();
    f.ports.readEvent.mockResolvedValueOnce('error');
    expect((await authorizeSend(authA, wpp, f.ports)).status).toBe(503);
    expect(f.ports.evaluate).not.toHaveBeenCalled();
  });
});

describe('idempotência e replay', () => {
  it('mesma chave: um único evento gravado e replay sinalizado', async () => {
    const f = makeFakePorts();
    const first = await authorizeSend(authA, wpp, f.ports);
    const second = await authorizeSend(authA, wpp, f.ports);
    expect(body(first).replay).toBe(false);
    expect(body(second).replay).toBe(true);
    expect(f.events.size).toBe(1);
    expect(f.ports.recordEvent).toHaveBeenCalledTimes(1);
  });

  it('replay de negação devolve a negação gravada, mesmo que o gateway agora permita', async () => {
    const f = makeFakePorts();
    f.ports.evaluate.mockResolvedValueOnce(DENIED);
    await authorizeSend(authA, wpp, f.ports);
    f.ports.evaluate.mockResolvedValue(ALLOWED);
    const again = await authorizeSend(authA, wpp, f.ports);
    expect(body(again)).toMatchObject({ allowed: false, replay: true, reasons: ['hold_total'] });
    expect(f.ports.evaluate).toHaveBeenCalledTimes(1);
  });

  it('replay de permissão reavalia ao vivo: hold novo vira negação', async () => {
    const f = makeFakePorts();
    await authorizeSend(authA, wpp, f.ports);
    f.ports.evaluate.mockResolvedValueOnce(DENIED);
    const again = await authorizeSend(authA, wpp, f.ports);
    expect(body(again)).toMatchObject({ allowed: false, replay: true });
  });

  it('corrida: a negação gravada primeiro prevalece sobre uma permissão concorrente', async () => {
    const f = makeFakePorts();
    const key = edgeEventKey(ORG_A, 'authorize', wpp.idempotency_key);
    f.ports.readEvent.mockResolvedValueOnce(null);
    f.ports.recordEvent.mockImplementationOnce(async () => {
      f.events.set(`${ORG_A}|${key}`, { disposition: 'denied', reasons: ['hold_total'] });
      return 'duplicate';
    });
    const r = await authorizeSend(authA, wpp, f.ports);
    expect(body(r)).toMatchObject({ allowed: false });
  });

  it('a chave é escopada por organização e por operação', () => {
    expect(edgeEventKey(ORG_A, 'authorize', 'k')).not.toBe(edgeEventKey(ORG_B, 'authorize', 'k'));
    expect(edgeEventKey(ORG_A, 'authorize', 'k')).not.toBe(edgeEventKey(ORG_A, 'result', 'k'));
    expect(edgeEventKey(ORG_A, 'authorize', 'k').length).toBeLessThanOrEqual(200);
  });

  it('result: replay não delega de novo', async () => {
    const f = makeFakePorts();
    await authorizeSend(authA, wpp, f.ports);
    const res = resultRequestSchema.parse({ workflow: 'ana_whatsapp', idempotency_key: 'run-0001', execution_id: EXEC_A, status: 'enviado', texto: 'oi', message_id: 'wamid.1' });
    const first = await registerResult(authA, res, f.ports);
    const second = await registerResult(authA, res, f.ports);
    expect(body(first).replay).toBe(false);
    expect(body(second)).toMatchObject({ replay: true, status: 'enviado' });
    expect(f.ports.delegate).toHaveBeenCalledTimes(1);
    expect(f.ports.delegate).toHaveBeenCalledWith('whatsapp_registrar', expect.objectContaining({ acao: 'registrar', execution_id: EXEC_A }));
  });
});

describe('result: só registra o que o gateway autorizou', () => {
  const res = (status: 'enviado' | 'falhou' | 'incerto' | 'nao_enviado') =>
    resultRequestSchema.parse({ workflow: 'ana_whatsapp', idempotency_key: 'run-0001', execution_id: EXEC_A, status, texto: 'oi' });

  it('sem autorização prévia: 409 not_authorized e nada é delegado', async () => {
    const f = makeFakePorts();
    const r = await registerResult(authA, res('enviado'), f.ports);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('not_authorized');
    expect(f.ports.delegate).not.toHaveBeenCalled();
  });

  it('autorização negada: enviado é recusado, nao_enviado avança o passo', async () => {
    const f = makeFakePorts();
    f.ports.evaluate.mockResolvedValueOnce(DENIED);
    await authorizeSend(authA, wpp, f.ports);
    expect((await registerResult(authA, res('enviado'), f.ports)).body.code).toBe('authorization_denied');
    const ok = await registerResult(authA, res('nao_enviado'), f.ports);
    expect(ok.status).toBe(200);
    expect(f.ports.skipStep).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_A, executionId: EXEC_A, motivo: 'hold_total' }));
    expect(f.ports.delegate).not.toHaveBeenCalled();
  });

  it('erro do handler legado é repassado e não grava o resultado', async () => {
    const f = makeFakePorts();
    await authorizeSend(authA, wpp, f.ports);
    f.ports.delegate.mockResolvedValueOnce({ status: 404, body: { success: false, code: 'execution_id_desconhecida', error: 'x' } });
    const r = await registerResult(authA, res('enviado'), f.ports);
    expect(r.status).toBe(404);
    expect(f.events.size).toBe(1);
  });

  it('agente de e-mail: só trilha, sem delegar', async () => {
    const f = makeFakePorts();
    const auth = authorizeRequestSchema.parse({ workflow: 'ana_email_agent', idempotency_key: 'agent-001', lead_id: LEAD_A });
    await authorizeSend(authA, auth, f.ports);
    const r = await registerResult(authA, resultRequestSchema.parse({ workflow: 'ana_email_agent', idempotency_key: 'agent-001', lead_id: LEAD_A, status: 'enviado' }), f.ports);
    expect(r.status).toBe(200);
    expect(f.ports.delegate).not.toHaveBeenCalled();
    expect(f.events.size).toBe(2);
  });
});

describe('isolamento por organização', () => {
  it('lead e passo de outra org respondem 404 e o gateway não é consultado', async () => {
    const f = makeFakePorts({ enabledOrgs: [ORG_A, ORG_B] });
    const r = await authorizeSend(authB, wpp, f.ports);
    expect(r.status).toBe(404);
    const agent = authorizeRequestSchema.parse({ workflow: 'ana_email_agent', idempotency_key: 'agent-001', lead_id: LEAD_B });
    expect((await authorizeSend(authA, agent, f.ports)).status).toBe(404);
    expect(f.ports.evaluate).not.toHaveBeenCalled();
  });

  it('mesma idempotency_key em orgs diferentes não colide', async () => {
    const f = makeFakePorts({ enabledOrgs: [ORG_A, ORG_B] });
    const agentB = authorizeRequestSchema.parse({ workflow: 'ana_email_agent', idempotency_key: 'run-0001', lead_id: LEAD_B });
    await authorizeSend(authA, wpp, f.ports);
    const b = await authorizeSend(authB, agentB, f.ports);
    expect(body(b).replay).toBe(false);
    expect(f.events.size).toBe(2);
  });

  it('autorização da org A não habilita result da org B', async () => {
    const f = makeFakePorts({ enabledOrgs: [ORG_A, ORG_B] });
    await authorizeSend(authA, wpp, f.ports);
    const agentB = resultRequestSchema.parse({ workflow: 'ana_email_agent', idempotency_key: 'run-0001', lead_id: LEAD_B, status: 'enviado' });
    expect((await registerResult(authB, agentB, f.ports)).body.code).toBe('not_authorized');
  });

  it('roteador consulta leads só da org da chave', async () => {
    const f = makeFakePorts();
    await routeInboundReply(authA, replyRouteRequestSchema.parse({ idempotency_key: 'rep-0001', phone: '11999990000', message_id: 'm1', texto: 'oi' }), f.ports);
    expect(f.ports.findLeadsByPhone).toHaveBeenCalledWith(ORG_A, '11999990000');
  });
});

describe('email-send', () => {
  const send = emailSendRequestSchema.parse({ idempotency_key: 'run-0001', execution_id: EXEC_A, remetente_email: 'ana@x.co', assunto: 'a', corpo: 'b' });
  const emailAuth = authorizeRequestSchema.parse({ workflow: 'ana_email', idempotency_key: 'run-0001', execution_id: EXEC_A });

  it('exige autorização e revalida o gateway antes de enviar', async () => {
    const f = makeFakePorts();
    f.ports.resolveTarget.mockImplementation(async () => ({ ok: true as const, target: { leadId: LEAD_A, enrollmentId: 'e', stepId: 's', executionId: EXEC_A, contact: 'a@x.com', assignedTo: null } }));
    expect((await sendCadenceEmail(authA, send, f.ports)).body.code).toBe('not_authorized');
    await authorizeSend(authA, emailAuth, f.ports);
    f.ports.evaluate.mockResolvedValueOnce(DENIED);
    const denied = await sendCadenceEmail(authA, send, f.ports);
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe('gateway_denied');
    expect(f.ports.delegate).not.toHaveBeenCalled();
  });

  it('envia uma vez; replay devolve o resultado gravado sem reenviar', async () => {
    const f = makeFakePorts();
    f.ports.resolveTarget.mockImplementation(async () => ({ ok: true as const, target: { leadId: LEAD_A, enrollmentId: 'e', stepId: 's', executionId: EXEC_A, contact: 'a@x.com', assignedTo: null } }));
    await authorizeSend(authA, emailAuth, f.ports);
    f.ports.delegate.mockResolvedValue({ status: 200, body: { success: true, data: { estado: 'enviado' } } });
    expect(body(await sendCadenceEmail(authA, send, f.ports))).toMatchObject({ status: 'enviado', replay: false });
    expect(body(await sendCadenceEmail(authA, send, f.ports))).toMatchObject({ status: 'enviado', replay: true });
    expect(f.ports.delegate).toHaveBeenCalledTimes(1);
  });

  it('envio incerto é gravado e nunca reenviado', async () => {
    const f = makeFakePorts();
    f.ports.resolveTarget.mockImplementation(async () => ({ ok: true as const, target: { leadId: LEAD_A, enrollmentId: 'e', stepId: 's', executionId: EXEC_A, contact: 'a@x.com', assignedTo: null } }));
    await authorizeSend(authA, emailAuth, f.ports);
    f.ports.delegate.mockResolvedValue({ status: 502, body: { success: false, code: 'envio_incerto', error: 'x' } });
    expect((await sendCadenceEmail(authA, send, f.ports)).status).toBe(502);
    const again = await sendCadenceEmail(authA, send, f.ports);
    expect(body(again)).toMatchObject({ status: 'incerto', replay: true });
    expect(f.ports.delegate).toHaveBeenCalledTimes(1);
  });

  it('caixa indisponível não grava estado terminal (o passo volta)', async () => {
    const f = makeFakePorts();
    f.ports.resolveTarget.mockImplementation(async () => ({ ok: true as const, target: { leadId: LEAD_A, enrollmentId: 'e', stepId: 's', executionId: EXEC_A, contact: 'a@x.com', assignedTo: null } }));
    await authorizeSend(authA, emailAuth, f.ports);
    f.ports.delegate.mockResolvedValue({ status: 503, body: { success: false, code: 'caixa_indisponivel', error: 'x' } });
    expect((await sendCadenceEmail(authA, send, f.ports)).status).toBe(503);
    expect(f.events.size).toBe(1);
  });
});

describe('roteador de respostas', () => {
  const rep = replyRouteRequestSchema.parse({ idempotency_key: 'rep-0001', phone: '(11) 99999-0000', message_id: 'm1', texto: 'oi' });

  it('telefone sem lead na org: unknown, sem escrita', async () => {
    const f = makeFakePorts();
    const r = await routeInboundReply(authA, rep, f.ports);
    expect(body(r).route).toBe('unknown');
    expect(f.ports.delegate).not.toHaveBeenCalled();
  });

  it('registra via handler legado e roteia para a IA com dono automático', async () => {
    const f = makeFakePorts();
    f.ports.findLeadsByPhone.mockResolvedValue([LEAD_A]);
    const r = await routeInboundReply(authA, rep, f.ports);
    expect(body(r)).toMatchObject({ route: 'ai', lead_id: LEAD_A, replay: false });
    expect(f.ports.delegate).toHaveBeenCalledWith('whatsapp_resposta', expect.objectContaining({ acao: 'resposta', lead_id: LEAD_A, message_id: 'm1', opt_out: false }));
  });

  it('replay não registra de novo', async () => {
    const f = makeFakePorts();
    f.ports.findLeadsByPhone.mockResolvedValue([LEAD_A]);
    await routeInboundReply(authA, rep, f.ports);
    const again = await routeInboundReply(authA, rep, f.ports);
    expect(body(again).replay).toBe(true);
    expect(f.ports.delegate).toHaveBeenCalledTimes(1);
  });

  it('telefone ambíguo: humano, sem associar; opt-out vale para todos', async () => {
    const f = makeFakePorts();
    f.ports.findLeadsByPhone.mockResolvedValue([LEAD_A, LEAD_B]);
    const plain = await routeInboundReply(authA, rep, f.ports);
    expect(body(plain)).toMatchObject({ route: 'human', ambiguous: true });
    expect(f.ports.delegate).not.toHaveBeenCalled();
    const stop = await routeInboundReply(authA, { ...rep, idempotency_key: 'rep-0002', opt_out: true }, f.ports);
    expect(body(stop).route).toBe('human');
    expect(f.ports.delegate).toHaveBeenCalledTimes(2);
  });

  it('decideReplyRoute: total e opt-out calam; conversa e modo humano passam ao humano; falha vai ao humano', () => {
    const base = { allowed: true, reasons: [] as never[], lastConsent: null, owner: null, holds: { bloqueado_total: false, bloqueado_prospeccao: false, bloqueado_conversa: false } };
    const ok = (over: object) => ({ success: true as const, data: { ...base, ...over } });
    expect(decideReplyRoute(ok({ holds: { ...base.holds, bloqueado_total: true } })).route).toBe('none');
    expect(decideReplyRoute(ok({ lastConsent: 'opt_out' })).route).toBe('none');
    expect(decideReplyRoute(ok({ holds: { ...base.holds, bloqueado_conversa: true } })).route).toBe('human');
    expect(decideReplyRoute(ok({ owner: { ownerUserId: 'u', automationMode: 'human' } })).route).toBe('human');
    expect(decideReplyRoute(ok({ reasons: ['flag_disabled'] })).route).toBe('human');
    expect(decideReplyRoute({ success: false, error: 'x' }).route).toBe('human');
    expect(decideReplyRoute(ok({ holds: { ...base.holds, bloqueado_prospeccao: true } })).route).toBe('ai');
  });
});
