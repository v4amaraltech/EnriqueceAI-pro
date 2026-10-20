import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBdrEmailReplyPayload, sendBdrEmailReplyWebhook, type BdrEmailReplyPayload } from './bdr-reply-webhook.service';
import { fetchReplyText, inspectThread } from './reply-detection.service';

const lead = { first_name: 'Paula', last_name: 'Costa', nome_fantasia: 'M. Dias Branco', razao_social: 'M DIAS BRANCO S.A.', job_title: 'Gerente de Canais', email: 'paula.costa@mdiasbranco.com.br' };

const base = {
  repliedInteractionId: '9a6ea244-2836-4155-aadf-724fff3456bc',
  orgId: 'org-1', leadId: 'lead-1', enrollmentId: 'enr-1', cadenceId: 'cad-1',
  cadenceName: 'BDR IA — Indústrias de Alimentos (v3 — ligação, e-mail e WhatsApp)',
  mailboxEmail: 'analuiza@v4companyamaral.com', threadId: '1a144b1154806fd8',
  reply: { rfcMessageId: '<abc@mdiasbranco.com.br>', subject: 'RES: canais da m. dias branco', date: '2026-10-19T14:52:10.000Z' },
  sentSubject: 'canais da m. dias branco', trecho: 'Oi Ana, podemos falar quinta?', lead, holdCriado: false,
};

describe('buildBdrEmailReplyPayload — contrato do n8n', () => {
  it('monta o corpo exatamente no formato combinado', () => {
    expect(buildBdrEmailReplyPayload(base)).toEqual({
      evento: 'email.replied',
      event_id: '9a6ea244-2836-4155-aadf-724fff3456bc',
      org_id: 'org-1', lead_id: 'lead-1', enrollment_id: 'enr-1', cadence_id: 'cad-1',
      cadence_nome: 'BDR IA — Indústrias de Alimentos (v3 — ligação, e-mail e WhatsApp)',
      mailbox: 'analuiza@v4companyamaral.com', thread_id: '1a144b1154806fd8',
      rfc_message_id: '<abc@mdiasbranco.com.br>', assunto: 'RES: canais da m. dias branco',
      trecho: 'Oi Ana, podemos falar quinta?', respondido_em: '2026-10-19T14:52:10.000Z',
      lead: { nome: 'Paula Costa', empresa: 'M. Dias Branco', cargo: 'Gerente de Canais', email: 'paula.costa@mdiasbranco.com.br' },
      hold_criado: false,
    });
  });
  it('sem cabeçalhos da resposta: assunto cai para o do envio, respondido_em para agora, trecho null', () => {
    const now = new Date('2026-10-19T15:10:07Z');
    const p = buildBdrEmailReplyPayload({ ...base, reply: null, trecho: null, now });
    expect(p).toMatchObject({ rfc_message_id: null, assunto: 'canais da m. dias branco', respondido_em: now.toISOString(), trecho: null });
  });
  it('lead sem nome vira null; empresa cai para razão social; trecho corta em 500', () => {
    const p = buildBdrEmailReplyPayload({ ...base, trecho: 'x'.repeat(600), lead: { ...lead, first_name: null, last_name: ' ', nome_fantasia: null } });
    expect(p.lead).toEqual({ nome: null, empresa: 'M DIAS BRANCO S.A.', cargo: 'Gerente de Canais', email: 'paula.costa@mdiasbranco.com.br' });
    expect(p.trecho).toHaveLength(500);
  });
});

describe('sendBdrEmailReplyWebhook — entrega com retentativa', () => {
  const payload = buildBdrEmailReplyPayload(base);
  const url = 'https://webhook-n8n.v4companyamaral.com/webhook/ana-email-resposta';
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('POST com Content-Type json, X-Enriquece-Event e o corpo do contrato; sucesso na 1ª', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const r = await sendBdrEmailReplyWebhook(url, payload, { fetchImpl: fetchImpl as unknown as typeof fetch, delaysMs: [0, 0] });
    expect(r).toEqual({ ok: true, attempts: 1, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Enriquece-Event': 'email.replied' });
    expect(JSON.parse(init.body as string) as BdrEmailReplyPayload).toEqual(payload);
    expect(error).not.toHaveBeenCalled();
  });

  it('erro 5xx e depois 2xx: entrega na 2ª tentativa', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const r = await sendBdrEmailReplyWebhook(url, payload, { fetchImpl, delaysMs: [0, 0] });
    expect(r).toEqual({ ok: true, attempts: 2, status: 200 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('rede fora as 3 vezes: não lança, devolve ok=false com 3 tentativas e registra erro no log', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await sendBdrEmailReplyWebhook(url, payload, { fetchImpl, delaysMs: [0, 0] });
    expect(r).toEqual({ ok: false, attempts: 3, error: 'ECONNREFUSED' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FALHOU após 3 tentativas'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining(payload.event_id));
  });

  it('espera crescente entre as tentativas (imediata, +1 s, +3 s por padrão)', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    const pending = sendBdrEmailReplyWebhook(url, payload, { fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(await pending).toMatchObject({ ok: false, attempts: 3, status: 500 });
    vi.useRealTimers();
  });
});

describe('inspectThread / fetchReplyText — o que o poll lê da resposta', () => {
  afterEach(() => vi.unstubAllGlobals());
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

  it('devolve os cabeçalhos da primeira resposta genuína (só cabeçalhos, sem corpo)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('fields=messages(id,payload(headers))');
      return new Response(JSON.stringify({ messages: [
        { id: 'a', payload: { headers: [{ name: 'From', value: 'ana@v4.com' }] } },
        { id: 'auto', payload: { headers: [{ name: 'From', value: 'x@lead.com' }, { name: 'Auto-Submitted', value: 'auto-replied' }] } },
        { id: 'b', payload: { headers: [
          { name: 'From', value: 'Paula <paula@lead.com>' }, { name: 'Subject', value: 'RES: canais' },
          { name: 'Message-ID', value: '<abc@lead.com>' }, { name: 'Date', value: 'Sun, 19 Oct 2026 11:52:10 -0300' },
        ] } },
      ] }), { status: 200 });
    }));
    expect(await inspectThread('th', 'tok')).toEqual({
      outcome: 'reply',
      reply: { messageId: 'b', from: 'Paula <paula@lead.com>', subject: 'RES: canais', rfcMessageId: '<abc@lead.com>', date: '2026-10-19T14:52:10.000Z' },
    });
  });

  it('fetchReplyText pega o texto sem HTML e sem a citação; falha vira null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ payload: { mimeType: 'text/html', body: { data: b64('<p>Podemos falar quinta?</p><br>Em seg., Ana escreveu:<br>&gt; oi') } } }), { status: 200 })));
    expect(await fetchReplyText('b', 'tok')).toBe('Podemos falar quinta?');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    expect(await fetchReplyText('b', 'tok')).toBeNull();
  });
});
