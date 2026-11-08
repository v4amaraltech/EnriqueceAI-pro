import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

import {
  CONSENT_CAPTURE_FLAG_KEY,
  canonicalWhatsappIdentity,
  captureFormConsent,
  captureInboundMessageConsent,
  captureWhatsappConsent,
  isConsentFlag,
  isStopRequest,
} from './consent-capture.service';
import { makeConsentClient, makeConsentWorld, type ConsentWorld } from './consent-capture.testkit';
import { getContactAccess } from './ownership.service';
import { decideSend, type SendGatewayRequest } from './send-decision.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

const NOW = new Date('2026-11-08T12:00:00.000Z');
const PHONE = '(16) 99986-7577';
const IDENTITY = '5516999867577';

function setup(over: Partial<ConsentWorld> = {}): ConsentWorld {
  const w = makeConsentWorld({ flags: { [CONSENT_CAPTURE_FLAG_KEY]: { enabled: true } }, ...over });
  vi.mocked(createServiceRoleClient).mockReturnValue(makeConsentClient(w) as never);
  return w;
}

const optIn = (over: Partial<Parameters<typeof captureWhatsappConsent>[0]> = {}) =>
  captureWhatsappConsent({
    orgId: 'org-1',
    leadId: 'lead-1',
    contact: PHONE,
    kind: 'opt_in',
    source: 'lead_form',
    ref: 'lead:lead-1',
    ...over,
  });

describe('captura de consentimento: flag', () => {
  beforeEach(() => vi.mocked(createServiceRoleClient).mockReset());

  it('flag desligada: nada e lido nem gravado', async () => {
    const w = setup({ flags: { [CONSENT_CAPTURE_FLAG_KEY]: { enabled: false } } });
    expect(await optIn()).toEqual({ status: 'disabled' });
    expect(await captureFormConsent({ orgId: 'org-1', leadId: 'lead-1', phone: PHONE })).toEqual({ status: 'disabled' });
    expect(
      await captureInboundMessageConsent({
        orgId: 'org-1', leadId: 'lead-1', phone: PHONE, messageId: 'm1', text: 'oi', provider: 'meta_cloud',
      }),
    ).toEqual({ status: 'disabled' });
    expect(w.writes).toEqual([]);
    expect(w.reads).toEqual([]);
    expect(w.consent).toHaveLength(0);
  });

  it('linha da flag ausente conta como desligada', async () => {
    const w = setup({ flags: {} });
    expect(await optIn()).toEqual({ status: 'disabled' });
    expect(w.writes).toEqual([]);
  });

  it('desligada globalmente mas com a org na lista: grava so para essa org', async () => {
    const w = setup({
      flags: { [CONSENT_CAPTURE_FLAG_KEY]: { enabled: false, allow_org_ids: ['org-1'] } },
    });
    expect((await optIn()).status).toBe('recorded');
    expect(await optIn({ orgId: 'org-2', leadId: 'lead-2' })).toEqual({ status: 'disabled' });
    expect(w.consent).toHaveLength(1);
    expect(w.consent[0]).toMatchObject({ org_id: 'org-1' });
  });
});

describe('captura de consentimento: gravacao e idempotencia', () => {
  beforeEach(() => vi.mocked(createServiceRoleClient).mockReset());

  it('grava opt_in com source, identidade canonica e referencia, sem corpo de mensagem', async () => {
    const w = setup();
    const res = await optIn({ extra: { origin: 'inbound_form' } });
    expect(res.status).toBe('recorded');
    expect(w.consent[0]).toMatchObject({
      org_id: 'org-1',
      lead_id: 'lead-1',
      contact_identity: IDENTITY,
      channel: 'whatsapp',
      kind: 'opt_in',
      source: 'lead_form',
      evidence: { ref: 'lead:lead-1', origin: 'inbound_form' },
      created_by: null,
    });
  });

  it('mesma evidencia duas vezes grava uma linha so', async () => {
    const w = setup();
    expect((await optIn()).status).toBe('recorded');
    expect(await optIn()).toEqual({ status: 'duplicate' });
    expect(await optIn({ contact: '+55 16 99986 7577' })).toEqual({ status: 'duplicate' });
    expect(w.consent).toHaveLength(1);
  });

  it('referencias diferentes sao evidencias diferentes (append-only)', async () => {
    const w = setup();
    await optIn({ ref: 'edge:a', source: 'ana_v4_opt_in' });
    await optIn({ ref: 'edge:b', source: 'ana_v4_opt_in' });
    expect(w.consent).toHaveLength(2);
  });

  it('nunca atualiza nem apaga linhas existentes (o cliente falso nem expoe update/delete)', async () => {
    const w = setup();
    await optIn();
    const first = structuredClone(w.consent[0]);
    await optIn();
    await optIn({ kind: 'opt_out', source: 'inbound_stop_request', ref: 'm9' });
    expect(w.consent).toHaveLength(2);
    expect(w.consent[0]).toEqual(first);
    expect(w.writes.every((t) => t === 'contact_consent_evidence')).toBe(true);
  });

  it('telefone invalido e lead inexistente nao gravam', async () => {
    const w = setup();
    expect(await optIn({ contact: '123' })).toEqual({ status: 'invalid_input' });
    expect(await optIn({ leadId: 'nao-existe' })).toEqual({ status: 'lead_not_found' });
    expect(await optIn({ ref: '   ' })).toEqual({ status: 'invalid_input' });
    expect(w.consent).toHaveLength(0);
  });
});

describe('captura de consentimento: opt_out vence', () => {
  beforeEach(() => vi.mocked(createServiceRoleClient).mockReset());

  it('opt_in automatico nao e gravado sobre opt_out vigente', async () => {
    const w = setup();
    await optIn({ ref: 'a', source: 'ana_v4_opt_in' });
    await optIn({ kind: 'opt_out', source: 'inbound_stop_request', ref: 'm1' });
    expect(await optIn({ ref: 'lead:lead-1' })).toEqual({ status: 'skipped_opted_out' });
    expect(
      await captureInboundMessageConsent({
        orgId: 'org-1', leadId: 'lead-1', phone: PHONE, messageId: 'm2', text: 'oi, tudo bem?', provider: 'evolution',
      }),
    ).toEqual({ status: 'skipped_opted_out' });
    expect(w.consent.map((r) => r.kind)).toEqual(['opt_in', 'opt_out']);
  });

  it('opt_out posterior a um opt_in antigo e gravado e passa a valer', async () => {
    const w = setup();
    await optIn();
    const res = await captureInboundMessageConsent({
      orgId: 'org-1', leadId: 'lead-1', phone: PHONE, messageId: 'm5', text: 'Por favor, PARE de me enviar mensagens', provider: 'meta_cloud',
    });
    expect(res.status).toBe('recorded');
    expect(w.consent[1]).toMatchObject({ kind: 'opt_out', source: 'inbound_stop_request', evidence: { ref: 'm5' } });
  });

  it('segundo pedido para parar nao empilha linhas', async () => {
    const w = setup();
    await optIn({ kind: 'opt_out', source: 'inbound_stop_request', ref: 'm1' });
    expect(await optIn({ kind: 'opt_out', source: 'inbound_stop_request', ref: 'm2' })).toEqual({ status: 'already_opted_out' });
    expect(w.consent).toHaveLength(1);
  });
});

describe('captura de consentimento: isolamento por organizacao', () => {
  beforeEach(() => vi.mocked(createServiceRoleClient).mockReset());

  it('lead de outra org nao recebe evidencia', async () => {
    const w = setup();
    expect(await optIn({ orgId: 'org-1', leadId: 'lead-2' })).toEqual({ status: 'lead_not_found' });
    expect(w.consent).toHaveLength(0);
  });

  it('opt_out de uma org nao bloqueia o mesmo telefone em outra org', async () => {
    const w = setup();
    await optIn({ orgId: 'org-1', leadId: 'lead-1', kind: 'opt_out', source: 'inbound_stop_request', ref: 'm1' });
    expect((await optIn({ orgId: 'org-2', leadId: 'lead-2' })).status).toBe('recorded');
    expect(w.consent.map((r) => `${r.org_id}:${r.kind}`)).toEqual(['org-1:opt_out', 'org-2:opt_in']);
  });

  it('dedupe e por org: mesma referencia em outra org grava', async () => {
    const w = setup();
    await optIn({ ref: 'x' });
    expect((await optIn({ orgId: 'org-2', leadId: 'lead-2', ref: 'x' })).status).toBe('recorded');
    expect(w.consent).toHaveLength(2);
  });
});

describe('captura de consentimento: mensagem inbound', () => {
  beforeEach(() => vi.mocked(createServiceRoleClient).mockReset());

  const inbound = (text: string, id = 'wamid.1') =>
    captureInboundMessageConsent({
      orgId: 'org-1', leadId: 'lead-1', phone: '5516999867577', messageId: id, text, provider: 'meta_cloud',
    });

  it('lead que escreveu primeiro: opt_in inbound_message, uma vez so, sem guardar o texto', async () => {
    const w = setup({ interactions: [{ id: 'i1', org_id: 'org-1', lead_id: 'lead-1', channel: 'whatsapp', type: 'replied' }] });
    expect((await inbound('Oi, quero saber mais')).status).toBe('recorded');
    expect(await inbound('e o preco?', 'wamid.2')).toEqual({ status: 'duplicate' });
    expect(w.consent).toHaveLength(1);
    expect(w.consent[0]).toMatchObject({ kind: 'opt_in', source: 'inbound_message' });
    expect(JSON.stringify(w.consent)).not.toContain('saber mais');
  });

  it('resposta a um envio nosso nao e pedido de contato', async () => {
    const w = setup({ interactions: [{ id: 'i0', org_id: 'org-1', lead_id: 'lead-1', channel: 'whatsapp', type: 'sent' }] });
    expect(await inbound('ok')).toEqual({ status: 'skipped_not_first_contact' });
    expect(w.consent).toHaveLength(0);
  });

  it('pedido de parar grava opt_out mesmo apos envio nosso', async () => {
    const w = setup({ interactions: [{ id: 'i0', org_id: 'org-1', lead_id: 'lead-1', channel: 'whatsapp', type: 'sent' }] });
    expect((await inbound('Não quero mais receber mensagens')).status).toBe('recorded');
    expect(w.consent[0]).toMatchObject({ kind: 'opt_out', source: 'inbound_stop_request' });
  });

  it('reentrega da mesma mensagem e idempotente', async () => {
    const w = setup();
    await inbound('parar', 'wamid.9');
    await inbound('parar', 'wamid.9');
    expect(w.consent).toHaveLength(1);
  });
});

describe('gateway com a evidencia capturada', () => {
  beforeEach(() => vi.mocked(createServiceRoleClient).mockReset());

  const request = (): SendGatewayRequest => ({
    orgId: 'org-1',
    leadId: 'lead-1',
    enrollmentId: null,
    stepId: null,
    channel: 'whatsapp',
    preferredProvider: 'meta_cloud',
    requestedBy: { orgId: 'org-1', userId: 'u1', source: 'app', apiKeyId: null },
    contact: '+55 (16) 99986-7577',
    senderInstanceId: null,
    template: { id: 'tpl-1', approved: true },
  });

  async function decide() {
    const res = await getContactAccess({ orgId: 'org-1', leadId: 'lead-1', contact: request().contact, channel: 'whatsapp' });
    if (!res.success) throw new Error('access failed');
    const a = res.data;
    return decideSend({
      request: request(),
      contactValid: true,
      access: { holds: a.holds, lastConsent: a.lastConsent, blockedReasons: a.reasons, owner: null },
      conversation: { lastInboundAt: null, leadRequestedContact: false, leadReplied: false },
      instance: { id: 'conn-1', connected: true, paused: false },
      now: NOW,
    });
  }

  const flags = {
    [CONSENT_CAPTURE_FLAG_KEY]: { enabled: true },
    conversation_ownership_v1: { enabled: true },
  };

  it('sem evidencia nega por no_consent; com opt_in capturado permite', async () => {
    const w = setup({ flags });
    const before = await decide();
    expect(before).toMatchObject({ allowed: false });
    expect(before.allowed === false && before.reasons).toContain('no_consent');

    expect((await captureFormConsent({ orgId: 'org-1', leadId: 'lead-1', phone: '16999867577' })).status).toBe('recorded');
    expect(w.consent).toHaveLength(1);
    expect(await decide()).toMatchObject({ allowed: true, provider: 'meta_cloud', requiresTemplate: true });
  });

  it('opt_out posterior derruba a permissao', async () => {
    setup({ flags });
    await captureFormConsent({ orgId: 'org-1', leadId: 'lead-1', phone: '16999867577' });
    expect(await decide()).toMatchObject({ allowed: true });
    await captureWhatsappConsent({
      orgId: 'org-1', leadId: 'lead-1', contact: '16999867577', kind: 'opt_out',
      source: 'ana_v4_opt_out', ref: 'edge:k1',
    });
    const after = await decide();
    expect(after.allowed === false && after.reasons).toContain('consent_opted_out');
  });
});

describe('helpers puros', () => {
  it('identidade canonica', () => {
    expect(canonicalWhatsappIdentity('(16) 99986-7577')).toBe(IDENTITY);
    expect(canonicalWhatsappIdentity('+55 16 99986-7577')).toBe(IDENTITY);
    expect(canonicalWhatsappIdentity('1699')).toBeNull();
    expect(canonicalWhatsappIdentity(null)).toBeNull();
  });

  it('detecta pedido de parar sem acento e com acento', () => {
    for (const t of ['PARE', 'Parar', 'sair', 'STOP', 'Não quero mais receber', 'nao me mande mais mensagem', 'Descadastrar por favor', 'remova meu número', 'para de me enviar isso']) {
      expect(isStopRequest(t), t).toBe(true);
    }
    for (const t of ['Oi, quero saber mais', 'Pode me ligar amanha', 'obrigado', '', null, undefined]) {
      expect(isStopRequest(t as string | null | undefined), String(t)).toBe(false);
    }
  });

  it('aceite de formulario: so true booleano ou a string "true"', () => {
    expect(isConsentFlag(true)).toBe(true);
    expect(isConsentFlag('true')).toBe(true);
    expect(isConsentFlag('TRUE')).toBe(true);
    for (const v of [false, 'false', 'on', 'sim', 1, undefined, null, '']) expect(isConsentFlag(v), String(v)).toBe(false);
  });
});
