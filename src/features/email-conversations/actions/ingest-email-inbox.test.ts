import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; filters: string[]; payload?: unknown }>,
  message: null as Record<string, unknown> | null,
  existingConv: null as unknown,
  leadByEmail: { id: 'lead-1' } as unknown,
  // envios nossos (cadência bdr_ai) que casam com a mensagem; [] = thread não é nosso
  ourSends: [{ metadata: { thread_id: 't1', rfc_message_id: '<cad-1@v4.com>' } }] as unknown,
  dispatch: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('@/features/cadences/services/webhook-dispatch.service', () => ({ dispatchWebhookEvent: m.dispatch }));
vi.mock('@/features/notifications/services/notification.service', () => ({ createNotification: m.notify }));
vi.mock('../services/gmail-inbox.service', () => ({
  listBdrMailboxes: () =>
    Promise.resolve([{ id: 'mb', user_id: 'u-bdr', org_id: 'org-1', email_address: 'bdr@v4.com', history_id: 'h', last_processed_internal_date: '2026-10-01T00:00:00Z' }]),
  getMailboxAccessToken: () => Promise.resolve('tok'),
  listNewMessageIds: () => Promise.resolve({ ids: ['g1'], historyId: 'h2', historyExpired: false }),
  getMessageFull: () => Promise.resolve(m.message),
}));

function chain(table: string) {
  const call = { table, op: 'select', filters: [] as string[], payload: undefined as unknown };
  m.calls.push(call);
  const c: Record<string, unknown> = {};
  const pass = (name: string) => (col: string, val?: unknown) => {
    call.filters.push(`${name}:${col}=${JSON.stringify(val)}`);
    return c;
  };
  for (const f of ['eq', 'is', 'ilike', 'in']) c[f] = pass(f);
  c.select = () => c;
  c.limit = () => c;
  c.insert = (p: unknown) => { call.op = 'insert'; call.payload = p; return c; };
  c.update = (p: unknown) => { call.op = 'update'; call.payload = p; return c; };
  c.upsert = (p: unknown) => { call.op = 'upsert'; call.payload = p; return c; };
  const result = () => {
    if (table === 'email_inbound' && call.op === 'select') return { data: null };
    if (table === 'email_inbound' && call.op === 'insert') return { data: { id: 'in-1' } };
    if (table === 'email_conversations' && call.op === 'select') return { data: m.existingConv };
    if (table === 'email_conversations' && call.op === 'insert') return { data: { id: 'conv-1', lead_id: 'lead-1', estado: 'ia_ativa' } };
    if (table === 'interactions' && call.op === 'select') return { data: m.ourSends };
    if (table === 'leads' && call.op === 'select') {
      // a busca do dono (notificação) seleciona por id
      if (call.filters.some((f) => f.startsWith('eq:id='))) return { data: { assigned_to: 'sdr-1', nome_fantasia: 'ACME', razao_social: null } };
      return { data: m.leadByEmail };
    }
    return { data: null };
  };
  c.maybeSingle = () => Promise.resolve(result());
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return c;
}
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({ from: (t: string) => chain(t), rpc: () => Promise.resolve({ data: null }) }) }));
vi.mock('@/lib/supabase/from', () => ({ from: (s: { from: (t: string) => unknown }, t: string) => s.from(t) }));

import { ingestEmailInbox } from './ingest-email-inbox';

const msg = (from: string, authResults: string | null, { headers: extraHeaders, ...extra }: Record<string, unknown> & { headers?: Record<string, string> } = {}) => ({
  id: 'g1',
  threadId: 't1',
  internalDate: new Date('2026-10-04T12:00:00Z'),
  headers: { from, subject: 'Re: proposta', 'message-id': '<x@lead.com>', ...extraHeaders },
  ...extra,
  authResults,
  snippet: 'tenho interesse',
  text: 'tenho interesse',
  mimeType: 'text/plain',
});

const leadLookup = () => m.calls.find((c) => c.table === 'leads' && c.op === 'select');
const inboundInsert = () => m.calls.find((c) => c.table === 'email_inbound' && c.op === 'insert')?.payload as Record<string, unknown>;
const convCreated = () => m.calls.some((c) => c.table === 'email_conversations' && c.op === 'insert');
const convUpdated = () => m.calls.some((c) => c.table === 'email_conversations' && c.op === 'update');
const holdUpserted = () => m.calls.some((c) => c.table === 'contact_holds' && c.op === 'upsert');

beforeEach(() => {
  m.calls = [];
  m.existingConv = null;
  m.leadByEmail = { id: 'lead-1' };
  m.ourSends = [{ metadata: { thread_id: 't1', rfc_message_id: '<cad-1@v4.com>' } }];
  vi.clearAllMocks();
});

const AUTH_OK = 'mx.google.com; dkim=pass header.i=@lead.com; spf=pass smtp.mailfrom=joao@lead.com; dmarc=pass header.from=lead.com';

describe('ingestEmailInbox — agenda e e-mail avulso não viram conversa', () => {
  it('convite do Google Agenda (assunto real) → calendar: gravado, sem lead, sem conversa, sem agente, sem hold', async () => {
    m.message = msg('Wagner <joao@lead.com>', AUTH_OK, { headers: { subject: 'Convite atualizado: V4 Company + Grupo Prever - qui. 15 out. 2026 4pm - 5:30pm (BRT) (Vinicius Mercante)' } });
    const r = await ingestEmailInbox();
    expect(inboundInsert()).toMatchObject({ kind: 'calendar', lead_id: null, conversation_id: null });
    expect(convCreated()).toBe(false);
    expect(holdUpserted()).toBe(false);
    expect(m.dispatch).not.toHaveBeenCalled();
    expect(r.data).toMatchObject({ agenda: 1, avulsas: 0, conversas: 0 });
  });

  it('agenda em thread que JÁ tem conversa não alimenta a conversa', async () => {
    m.existingConv = { id: 'conv-1', lead_id: 'lead-1', estado: 'aguardando_lead' };
    m.message = msg('Wagner <joao@lead.com>', AUTH_OK, { partMimeTypes: ['multipart/mixed', 'text/calendar; method=REPLY'] });
    await ingestEmailInbox();
    expect(inboundInsert()).toMatchObject({ kind: 'calendar', conversation_id: null });
    expect(convUpdated()).toBe(false);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it('lead autenticado fora de thread nosso (assunto real) → unrelated: gravado com o lead, sem conversa, sem replied, sem hold', async () => {
    m.ourSends = [];
    m.message = msg('Wagner <joao@lead.com>', AUTH_OK, { threadId: '1a0ed92b6bd9f9f9', headers: { subject: 'Re: Proposta Comercial V4 Company <> DaColônia Alimentos Naturais' } });
    const r = await ingestEmailInbox();
    expect(inboundInsert()).toMatchObject({ kind: 'unrelated', lead_id: 'lead-1', conversation_id: null });
    expect(convCreated()).toBe(false);
    expect(holdUpserted()).toBe(false);
    expect(m.calls.some((c) => c.table === 'cadence_enrollments' && c.op === 'update')).toBe(false);
    expect(m.dispatch).not.toHaveBeenCalled();
    expect(r.data).toMatchObject({ agenda: 0, avulsas: 1, conversas: 0 });
  });

  it('casa pelo In-Reply-To com Message-ID nosso mesmo em outra thread do Gmail → conversa', async () => {
    m.ourSends = [{ metadata: { rfc_message_id: '<bdr-1@v4.com>' } }];
    m.message = msg('Lead <joao@lead.com>', AUTH_OK, { threadId: 'outra', headers: { 'in-reply-to': '<bdr-1@v4.com>' } });
    await ingestEmailInbox();
    expect(inboundInsert()).toMatchObject({ kind: 'lead', lead_id: 'lead-1' });
    expect(convCreated()).toBe(true);
    expect(m.dispatch).toHaveBeenCalled();
  });

  it('busca os envios nossos só em cadências bdr_ai, por thread e por Message-ID referenciado', async () => {
    m.message = msg('Lead <joao@lead.com>', AUTH_OK, { headers: { 'in-reply-to': '<a@v4.com>', references: '<b@v4.com>' } });
    await ingestEmailInbox();
    const sel = m.calls.filter((c) => c.table === 'interactions' && c.op === 'select');
    expect(sel.map((c) => c.filters)).toEqual([
      expect.arrayContaining(['eq:cadences.executor="bdr_ai"', 'eq:metadata->>thread_id="t1"']),
      expect.arrayContaining(['eq:cadences.executor="bdr_ai"', 'in:metadata->>rfc_message_id=["<a@v4.com>","<b@v4.com>"]']),
    ]);
  });
});

describe('ingestEmailInbox — segurança do remetente', () => {
  it('remetente autenticado: casa o lead por igualdade (curingas escapados)', async () => {
    m.message = msg('Lead <joao_silva@lead.com>', 'mx.google.com; dkim=pass header.i=@lead.com; spf=pass smtp.mailfrom=joao_silva@lead.com; dmarc=pass header.from=lead.com');
    await ingestEmailInbox();
    expect(leadLookup()?.filters).toContain('ilike:email="joao\\\\_silva@lead.com"');
    expect(inboundInsert()).toMatchObject({ kind: 'lead', lead_id: 'lead-1' });
    expect(m.dispatch).toHaveBeenCalled();
  });

  it('From forjado ("%@%.%") não vira curinga', async () => {
    m.message = msg('<%@%.%>', 'mx.google.com; dmarc=pass');
    await ingestEmailInbox();
    expect(leadLookup()?.filters).toContain('ilike:email="\\\\%@\\\\%.\\\\%"');
  });

  it('From forjado com SPF/DKIM do domínio do atacante (lead sem DMARC) não é aceito', async () => {
    m.message = msg('Lead <joao@lead.com>', 'mx.google.com; dkim=pass header.i=@evil.com; spf=pass smtp.mailfrom=x@evil.com');
    await ingestEmailInbox();
    expect(inboundInsert()).toMatchObject({ kind: 'unknown' });
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it('e-mail interno do mesmo domínio da casa é own: nunca conversa (regra 3)', async () => {
    m.message = msg('Teste <vini@v4.com>', null);
    await ingestEmailInbox();
    expect(inboundInsert()).toMatchObject({ kind: 'own', lead_id: null });
    expect(convCreated()).toBe(false);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it('remetente NÃO autenticado (lead novo): não abre conversa, não chama o agente, mas avisa o SDR dono', async () => {
    m.message = msg('Lead <joao@lead.com>', 'mx.google.com; spf=softfail; dkim=none; dmarc=fail');
    await ingestEmailInbox();
    expect(m.notify).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'sdr-1', resource_id: 'lead-1', title: 'Resposta não verificada: ACME' }),
    );
    // texto genérico, nunca o conteúdo (não confiável) da mensagem
    expect((m.notify.mock.calls[0]![0] as { body: string }).body).not.toContain('tenho interesse');
    expect(inboundInsert()).toMatchObject({ kind: 'unknown', lead_id: null });
    expect(m.calls.some((c) => c.table === 'email_conversations' && c.op === 'insert')).toBe(false);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it('sem cabeçalho de autenticação, lead novo também não é aceito', async () => {
    m.message = msg('Lead <joao@lead.com>', null);
    await ingestEmailInbox();
    expect(inboundInsert()).toMatchObject({ kind: 'unknown' });
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it('conversa já existente na thread: sem cabeçalho (unknown) ainda segue como lead', async () => {
    m.existingConv = { id: 'conv-1', lead_id: 'lead-1', estado: 'aguardando_lead' };
    m.message = msg('Lead <joao@lead.com>', null);
    await ingestEmailInbox();
    expect(inboundInsert()).toMatchObject({ kind: 'lead', lead_id: 'lead-1' });
    expect(m.dispatch).toHaveBeenCalled();
  });

  it('conversa existente mas falha explícita de autenticação: não conta como lead', async () => {
    m.existingConv = { id: 'conv-1', lead_id: 'lead-1', estado: 'ia_ativa' };
    m.message = msg('Lead <joao@lead.com>', 'mx.google.com; dmarc=fail');
    await ingestEmailInbox();
    expect(inboundInsert()).toMatchObject({ kind: 'unknown' });
    expect(m.dispatch).not.toHaveBeenCalled();
  });
});
