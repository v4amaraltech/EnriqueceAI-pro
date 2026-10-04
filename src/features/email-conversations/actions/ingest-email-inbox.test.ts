import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; filters: string[]; payload?: unknown }>,
  message: null as Record<string, unknown> | null,
  existingConv: null as unknown,
  leadByEmail: { id: 'lead-1' } as unknown,
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

const msg = (from: string, authResults: string | null) => ({
  id: 'g1',
  threadId: 't1',
  internalDate: new Date('2026-10-04T12:00:00Z'),
  headers: { from, subject: 'Re: proposta', 'message-id': '<x@lead.com>' },
  authResults,
  snippet: 'tenho interesse',
  text: 'tenho interesse',
  mimeType: 'text/plain',
});

const leadLookup = () => m.calls.find((c) => c.table === 'leads' && c.op === 'select');
const inboundInsert = () => m.calls.find((c) => c.table === 'email_inbound' && c.op === 'insert')?.payload as Record<string, unknown>;

beforeEach(() => {
  m.calls = [];
  m.existingConv = null;
  m.leadByEmail = { id: 'lead-1' };
  vi.clearAllMocks();
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

  it('e-mail interno do mesmo Workspace (sem cabeçalho de autenticação) é aceito', async () => {
    m.message = msg('Teste <vini@v4.com>', null);
    await ingestEmailInbox();
    expect(inboundInsert()).toMatchObject({ kind: 'lead', lead_id: 'lead-1' });
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
