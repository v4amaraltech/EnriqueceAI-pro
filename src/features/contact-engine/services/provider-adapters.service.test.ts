import { describe, expect, it, vi } from 'vitest';

import type { StoredSendCommand } from './outbox.service';
import type { DispatchPayload, ProviderSendRequest } from './dispatcher.service';
import {
  createDefaultAdapters,
  createEmailAdapter,
  createEvolutionAdapter,
  createMetaCloudAdapter,
  rfcMessageIdForOutbox,
} from './provider-adapters.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/features/email-conversations/services/gmail-inbox.service', () => ({ findMessageByRfcId: vi.fn() }));
vi.mock('@/features/integrations/services/email.service', () => ({ EmailService: { sendEmail: vi.fn() }, refreshAccessToken: vi.fn() }));
vi.mock('@/features/integrations/services/whatsapp-evolution.service', () => ({ EvolutionWhatsAppService: { sendFromUserInstance: vi.fn() } }));
vi.mock('@/features/integrations/services/whatsapp.service', () => ({ WhatsAppService: { sendMessage: vi.fn() } }));
vi.mock('@/lib/security/encryption', () => ({ decrypt: vi.fn() }));

const command = (over: Partial<StoredSendCommand> = {}): StoredSendCommand => ({
  provider: 'meta_cloud',
  senderInstanceId: 'conn-1',
  requiresTemplate: false,
  templateId: null,
  ownershipVersion: 1,
  payloadHash: 'a'.repeat(64),
  decidedAt: '2026-11-07T12:00:00.000Z',
  expiresAt: '2026-11-07T12:15:00.000Z',
  ...over,
});

const payload = (over: Partial<DispatchPayload> = {}): DispatchPayload => ({
  body: 'Ola',
  subject: 'Assunto',
  requestedBy: { orgId: 'org-1', userId: 'u1', source: 'cron', apiKeyId: null },
  senderUserId: 'u1',
  ...over,
});

const req = (over: Partial<ProviderSendRequest> = {}): ProviderSendRequest => ({
  orgId: 'org-1',
  outboxId: 'ob-1',
  leadId: 'lead-1',
  to: '5516999867577',
  payload: payload(),
  command: command(),
  ...over,
});

const db = () => ({}) as never;

describe('adaptador Meta Cloud', () => {
  it('aceita com o id da mensagem e usa texto fora de template', async () => {
    const sendMessage = vi.fn(async () => ({ success: true, messageId: 'wamid.1' }));
    const out = await createMetaCloudAdapter({ db, send: sendMessage as never }).send(req());
    expect(out).toEqual({ kind: 'accepted', externalId: 'wamid.1' });
    expect(sendMessage).toHaveBeenCalledWith('org-1', { to: '5516999867577', body: 'Ola' }, expect.anything());
  });

  it('exige o template aprovado do comando quando o gateway marcou requiresTemplate', async () => {
    const sendMessage = vi.fn(async () => ({ success: true, messageId: 'wamid.2' }));
    const adapter = createMetaCloudAdapter({ db, send: sendMessage as never });
    expect(await adapter.send(req({ command: command({ requiresTemplate: true }) }))).toEqual({ kind: 'rejected', reason: 'template_missing' });
    expect(sendMessage).not.toHaveBeenCalled();
    await adapter.send(
      req({ command: command({ requiresTemplate: true, templateId: 'tpl_ok' }), payload: payload({ templateParams: ['Ana'] }) }),
    );
    expect(sendMessage).toHaveBeenCalledWith('org-1', expect.objectContaining({ templateName: 'tpl_ok', templateParams: ['Ana'] }), expect.anything());
  });

  it('classifica: falha local conhecida e rejeitada; erro de API e excecao sao ambiguos', async () => {
    const mk = (r: unknown) => createMetaCloudAdapter({ db, send: vi.fn(async () => r) as never });
    expect(await mk({ success: false, error: 'Nenhuma conexão WhatsApp ativa encontrada' }).send(req())).toMatchObject({ kind: 'rejected' });
    expect(await mk({ success: false, error: 'Rate limit excedido. Tente novamente em 1s' }).send(req())).toMatchObject({ kind: 'rejected' });
    expect(await mk({ success: false, error: 'WhatsApp API error: 500' }).send(req())).toMatchObject({ kind: 'ambiguous' });
    expect(await mk({ success: false, error: 'WhatsApp API não retornou ID da mensagem' }).send(req())).toMatchObject({ kind: 'ambiguous' });
    expect(await mk({ success: true }).send(req())).toMatchObject({ kind: 'ambiguous' });
    const boom = createMetaCloudAdapter({ db, send: vi.fn(async () => { throw new Error('timeout'); }) as never });
    expect(await boom.send(req())).toMatchObject({ kind: 'ambiguous' });
  });

  it('a consulta ao provedor nao resolve sem id', async () => {
    expect(await createMetaCloudAdapter({ db }).lookup!(req())).toEqual({ kind: 'unknown' });
  });
});

describe('adaptador Evolution', () => {
  const dbWith = (rows: unknown[]) => () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit']) b[m] = vi.fn(() => b);
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok);
    return { from: vi.fn(() => b) } as never;
  };
  const evoCommand = command({ provider: 'evolution', senderInstanceId: 'inst-1' });

  it('envia pela instancia autorizada do usuario dono dela, nunca pela padrao da organizacao', async () => {
    const send = vi.fn(async () => ({ success: true, messageId: 'evo.1' }));
    const adapter = createEvolutionAdapter({ db: dbWith([{ id: 'inst-1', user_id: 'sdr-7' }]), sendFromUserInstance: send as never });
    const out = await adapter.send(req({ command: evoCommand }));
    expect(out).toEqual({ kind: 'accepted', externalId: 'evo.1' });
    expect(send).toHaveBeenCalledWith(expect.anything(), { orgId: 'org-1', userId: 'sdr-7', to: '5516999867577', body: 'Ola' });
  });

  it('sem instancia autorizada, instancia inexistente ou da organizacao: rejeita sem enviar', async () => {
    const send = vi.fn();
    expect(await createEvolutionAdapter({ db: dbWith([]), sendFromUserInstance: send as never }).send(req({ command: command({ provider: 'evolution', senderInstanceId: null }) }))).toMatchObject({ kind: 'rejected' });
    expect(await createEvolutionAdapter({ db: dbWith([]), sendFromUserInstance: send as never }).send(req({ command: evoCommand }))).toMatchObject({ kind: 'rejected' });
    expect(await createEvolutionAdapter({ db: dbWith([{ id: 'inst-1', user_id: null }]), sendFromUserInstance: send as never }).send(req({ command: evoCommand }))).toMatchObject({ kind: 'rejected', reason: 'instance_without_user' });
    expect(send).not.toHaveBeenCalled();
  });

  it('classifica codigos de sessao como rejeitados e erro desconhecido como ambiguo', async () => {
    const mk = (r: unknown) => createEvolutionAdapter({ db: dbWith([{ id: 'inst-1', user_id: 'sdr-7' }]), sendFromUserInstance: vi.fn(async () => r) as never });
    expect(await mk({ success: false, code: 'disconnected', error: 'x' }).send(req({ command: evoCommand }))).toMatchObject({ kind: 'rejected' });
    expect(await mk({ success: false, error: 'Esse número não está cadastrado no WhatsApp' }).send(req({ command: evoCommand }))).toMatchObject({ kind: 'rejected' });
    expect(await mk({ success: false, error: 'The operation was aborted due to timeout' }).send(req({ command: evoCommand }))).toMatchObject({ kind: 'ambiguous' });
    expect(await mk({ success: false, error: 'Evolution API error: 500' }).send(req({ command: evoCommand }))).toMatchObject({ kind: 'ambiguous' });
  });
});

describe('adaptador de e-mail', () => {
  const emailCommand = command({ provider: 'gmail', senderInstanceId: null });

  it('usa Message-ID deterministico por entrada e a caixa do usuario do payload', async () => {
    const sendEmail = vi.fn(async () => ({ success: true, messageId: 'gm1' }));
    const out = await createEmailAdapter({ db, sendEmail: sendEmail as never }).send(req({ command: emailCommand, to: 'a@b.com' }));
    expect(out).toEqual({ kind: 'accepted', externalId: 'gm1' });
    expect(sendEmail).toHaveBeenCalledWith(
      'u1',
      'org-1',
      expect.objectContaining({ to: 'a@b.com', subject: 'Assunto', leadId: 'lead-1', messageId: rfcMessageIdForOutbox('ob-1') }),
      undefined,
      expect.anything(),
    );
  });

  it('classifica por estagio: antes do POST e 4xx sao rejeitados; 5xx, 408 e excecao sao ambiguos', async () => {
    const mk = (r: unknown) => createEmailAdapter({ db, sendEmail: vi.fn(async () => r) as never });
    const r = req({ command: emailCommand });
    expect(await mk({ success: false, error: 'Nenhuma conexão Gmail ativa encontrada' }).send(r)).toMatchObject({ kind: 'rejected' });
    expect(await mk({ success: false, error: 'x', httpStatus: 403, stage: 'response' }).send(r)).toMatchObject({ kind: 'rejected' });
    expect(await mk({ success: false, error: 'x', httpStatus: 503, stage: 'response' }).send(r)).toMatchObject({ kind: 'ambiguous' });
    expect(await mk({ success: false, error: 'x', httpStatus: 408, stage: 'response' }).send(r)).toMatchObject({ kind: 'ambiguous' });
    const boom = createEmailAdapter({ db, sendEmail: vi.fn(async () => { throw new TypeError('fetch failed'); }) as never });
    expect(await boom.send(r)).toMatchObject({ kind: 'ambiguous' });
  });

  it('exige caixa do usuario e assunto', async () => {
    const sendEmail = vi.fn();
    const adapter = createEmailAdapter({ db, sendEmail: sendEmail as never });
    expect(await adapter.send(req({ command: emailCommand, payload: payload({ senderUserId: null }) }))).toMatchObject({ kind: 'rejected' });
    expect(await adapter.send(req({ command: emailCommand, payload: payload({ subject: undefined }) }))).toMatchObject({ kind: 'rejected' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('consulta o Gmail pelo Message-ID: achou = accepted, nao achou = not_accepted, erro = unknown', async () => {
    const getAccessToken = vi.fn(async () => 'tok');
    const found = createEmailAdapter({ db, getAccessToken, findByRfcId: vi.fn(async () => 'gm9') });
    expect(await found.lookup!(req({ command: emailCommand }))).toEqual({ kind: 'accepted', externalId: 'gm9' });
    const findByRfcId = vi.fn(async () => null);
    const missing = createEmailAdapter({ db, getAccessToken, findByRfcId });
    expect(await missing.lookup!(req({ command: emailCommand }))).toEqual({ kind: 'not_accepted' });
    expect(findByRfcId).toHaveBeenCalledWith('tok', rfcMessageIdForOutbox('ob-1'));
    const err = createEmailAdapter({ db, getAccessToken, findByRfcId: vi.fn(async () => { throw new Error('403'); }) });
    expect(await err.lookup!(req({ command: emailCommand }))).toEqual({ kind: 'unknown' });
    const noToken = createEmailAdapter({ db, getAccessToken: vi.fn(async () => null), findByRfcId });
    expect(await noToken.lookup!(req({ command: emailCommand }))).toEqual({ kind: 'unknown' });
  });
});

describe('conjunto padrao', () => {
  it('um adaptador por provedor, cada um com o proprio provedor', () => {
    const a = createDefaultAdapters();
    expect(Object.keys(a).sort()).toEqual(['evolution', 'gmail', 'meta_cloud']);
    expect(a.meta_cloud?.provider).toBe('meta_cloud');
    expect(a.evolution?.provider).toBe('evolution');
    expect(a.gmail?.provider).toBe('gmail');
  });
});
