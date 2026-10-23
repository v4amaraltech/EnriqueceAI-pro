import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
const h = vi.hoisted(() => ({
  env: { BDR_EMAIL_REPLY_WEBHOOK_URL: 'https://hook.test/ana' as string | undefined },
  cadence: { name: 'Inbound — E-mail (auto)', executor: 'sdr' } as { name: string; executor: string } | null,
  sendBdr: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => service);
vi.mock('@/config/env', () => ({ getEnv: () => h.env }));
vi.mock('../services/bdr-reply-webhook.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/bdr-reply-webhook.service')>()),
  sendBdrEmailReplyWebhook: h.sendBdr,
}));
vi.mock('@/lib/security/encryption', () => ({ decrypt: (v: string) => v }));
vi.mock('@/features/integrations/services/email.service', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/features/notifications/services/notification.service', () => ({ createNotification: vi.fn() }));
vi.mock('../services/webhook-dispatch.service', () => ({ dispatchWebhookEvent: vi.fn() }));
const leadEvent = vi.hoisted(() => ({ logLeadEvent: vi.fn() }));
vi.mock('@/features/leads/actions/log-lead-event', () => leadEvent);

import { createNotification } from '@/features/notifications/services/notification.service';

import { checkEmailReplies } from './check-email-replies';

interface Sent {
  id: string;
  lead_id: string;
  cadence_id: string;
  step_id: string | null;
  external_id: string;
  metadata: Record<string, unknown> | null;
  performed_by: string | null;
}

interface Captured {
  table: string;
  op: 'update' | 'insert';
  payload: Record<string, unknown>;
  filters: string[];
}

let sentRows: Sent[];
let leads: Array<{ id: string; assigned_to: string | null; email_bounced_at: string | null }>;
let processed: Array<{ cadence_id: string; lead_id: string }>;
let captured: Captured[];
let orders: string[];
/** Patches enviados a merge_interactions_metadata (carimbo do rodízio). */
let stamped: Array<{ id: string; patch: Record<string, unknown> }>;
/** thread_id → caixa (token) onde ela existe, e se tem resposta */
let threads: Record<string, { mailbox: string; reply: boolean; bounce?: boolean }>;

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const filters: string[] = [];
  let op: 'select' | 'update' | 'insert' = 'select';
  let selectCols = '';

  const passthrough = (name: string) =>
    vi.fn((...args: unknown[]) => {
      filters.push(`${name}:${String(args[0])}:${JSON.stringify(args[1])}`);
      return chain;
    });

  chain.select = vi.fn((cols: string) => {
    selectCols = cols;
    return chain;
  });
  for (const f of ['eq', 'neq', 'not', 'in', 'gte', 'is', 'ilike']) chain[f] = passthrough(f);
  chain.limit = vi.fn(() => chain);
  chain.order = vi.fn((col: string, opts: unknown) => {
    if (table === 'interactions') orders.push(`${col}:${JSON.stringify(opts)}`);
    return chain;
  });
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    op = 'update';
    captured.push({ table, op: 'update', payload, filters });
    return chain;
  });
  chain.insert = vi.fn((payload: Record<string, unknown>) => {
    op = 'insert';
    captured.push({ table, op: 'insert', payload, filters });
    return chain;
  });

  const resolveSingle = () => {
    if (table === 'organization_members') return { data: { org_id: 'org' } };
    if (table === 'gmail_connections') {
      const user = filters.find((f) => f.startsWith('eq:user_id'))?.split(':')[2]?.replace(/"/g, '');
      return {
        data: {
          status: 'connected',
          token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
          access_token_encrypted: `tok-${user}`,
          email_address: `${user}@v4.com`,
        },
      };
    }
    if (table === 'leads') return { data: { org_id: 'org', assigned_to: 'dono', nome_fantasia: 'ACME', first_name: 'Paula', last_name: 'Costa', job_title: 'Gerente', email: 'paula@acme.com' } };
    if (table === 'cadences') return { data: h.cadence };
    return { data: null };
  };
  chain.maybeSingle = vi.fn(() => Promise.resolve(resolveSingle()));
  chain.single = vi.fn(() => Promise.resolve(resolveSingle()));

  chain.then = (resolve: (v: unknown) => unknown) => {
    let result: unknown = { data: null, error: null };
    if (op === 'select' && table === 'interactions' && selectCols.includes('external_id')) {
      result = { data: sentRows, error: null };
    } else if (op === 'select' && table === 'interactions') {
      result = { data: processed, error: null };
    } else if (op === 'select' && table === 'leads') {
      result = { data: leads, error: null };
    }
    return Promise.resolve(result).then(resolve);
  };
  return chain;
}

function sent(over: Partial<Sent> = {}): Sent {
  return {
    id: 'int-1',
    lead_id: 'lead-1',
    cadence_id: 'cad-1',
    step_id: 'step-1',
    external_id: 'msg-1',
    metadata: { thread_id: 'th-1', subject: 'Proposta' },
    performed_by: 'criador',
    ...over,
  };
}

const metadataUpdateOf = (id: string) => stamped.find((s) => s.id === id)?.patch;

beforeEach(() => {
  h.env.BDR_EMAIL_REPLY_WEBHOOK_URL = 'https://hook.test/ana';
  h.cadence = { name: 'Inbound — E-mail (auto)', executor: 'sdr' };
  h.sendBdr.mockReset();
  h.sendBdr.mockResolvedValue({ ok: true, attempts: 1, status: 200 });
  sentRows = [];
  leads = [{ id: 'lead-1', assigned_to: 'dono', email_bounced_at: null }];
  processed = [];
  captured = [];
  orders = [];
  stamped = [];
  threads = {};
  service.createServiceRoleClient.mockReturnValue({
    from: (t: string) => makeChain(t),
    rpc: vi.fn((fn: string, args: { p_items: typeof stamped }) => {
      if (fn === 'merge_interactions_metadata') stamped.push(...args.p_items);
      return Promise.resolve({ data: args.p_items.length, error: null });
    }),
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { headers: { Authorization: string } }) => {
      const token = init.headers.Authorization.replace('Bearer tok-', '');
      const threadId = /threads\/([^?]+)/.exec(url)?.[1] ?? '';
      const thread = threads[threadId];
      if (!thread || thread.mailbox !== token) return new Response('', { status: 404 });
      const messages = [{ id: 'a', payload: { headers: [{ name: 'From', value: 'sdr@v4.com' }] } }];
      if (thread.reply) {
        messages.push({ id: 'b', payload: { headers: [
          { name: 'From', value: 'cliente@acme.com' }, { name: 'Subject', value: 'RES: Proposta' },
          { name: 'Message-ID', value: '<resp@acme.com>' }, { name: 'Date', value: 'Mon, 19 Oct 2026 12:00:00 -0300' },
        ] } });
      }
      if (thread.bounce) {
        messages.push({ id: 'c', payload: { headers: [{ name: 'From', value: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }] } });
      }
      return new Response(JSON.stringify({ messages }), { status: 200 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('checkEmailReplies', () => {
  it('linha antiga enviada da caixa do dono do lead: acha a resposta e grava o remetente', async () => {
    sentRows = [sent()];
    threads = { 'th-1': { mailbox: 'dono', reply: true } };

    const res = await checkEmailReplies();

    expect(res).toEqual({ success: true, data: { found: 1 } });
    const replied = captured.find((c) => c.op === 'insert' && c.payload.type === 'replied');
    expect(replied?.payload).toMatchObject({ lead_id: 'lead-1', cadence_id: 'cad-1', step_id: 'step-1' });
    expect(metadataUpdateOf('int-1')).toMatchObject({ sender_user_id: 'dono', thread_id: 'th-1' });
  });

  it('o carimbo manda só as chaves novas — o banco mescla, sem regravar o metadata inteiro', async () => {
    sentRows = [sent({ metadata: { thread_id: 'th-1', subject: 'Proposta', open_count: 2 } })];
    threads = { 'th-1': { mailbox: 'dono', reply: false } };

    await checkEmailReplies();

    const patch = metadataUpdateOf('int-1');
    expect(patch).not.toHaveProperty('open_count');
    expect(patch).not.toHaveProperty('subject');
    expect(captured.some((c) => c.table === 'interactions' && c.op === 'update')).toBe(false);
  });

  it('cai para a caixa do criador quando a conversa não está na do dono', async () => {
    sentRows = [sent()];
    threads = { 'th-1': { mailbox: 'criador', reply: true } };

    const res = await checkEmailReplies();

    expect(res).toEqual({ success: true, data: { found: 1 } });
    expect(metadataUpdateOf('int-1')).toMatchObject({ sender_user_id: 'criador' });
  });

  it('com sender_user_id gravado, abre só essa caixa', async () => {
    sentRows = [sent({ metadata: { thread_id: 'th-1', sender_user_id: 'sdr' } })];
    threads = { 'th-1': { mailbox: 'sdr', reply: true } };

    await checkEmailReplies();

    const fetchMock = vi.mocked(fetch);
    const tokensUsed = fetchMock.mock.calls.map(
      ([, init]) => (init as { headers: { Authorization: string } }).headers.Authorization,
    );
    expect(tokensUsed).toEqual(['Bearer tok-sdr']);
  });

  it('pega os menos conferidos primeiro (rodízio)', async () => {
    sentRows = [sent()];
    await checkEmailReplies();
    expect(orders[0]).toBe('metadata->>reply_checked_at:{"ascending":true,"nullsFirst":true}');
  });

  it('carimba reply_checked_at em todas as linhas, inclusive as puladas', async () => {
    sentRows = [sent(), sent({ id: 'int-2', lead_id: 'lead-2', metadata: { thread_id: 'th-2' } })];
    leads.push({ id: 'lead-2', assigned_to: 'dono', email_bounced_at: '2026-09-01T00:00:00Z' });
    threads = { 'th-1': { mailbox: 'dono', reply: false } };

    const res = await checkEmailReplies();

    expect(res).toEqual({ success: true, data: { found: 0 } });
    expect(metadataUpdateOf('int-1')?.reply_checked_at).toEqual(expect.any(String));
    expect(metadataUpdateOf('int-1')?.sender_user_id).toBe('dono');
    expect(metadataUpdateOf('int-2')?.reply_checked_at).toEqual(expect.any(String));
    expect(metadataUpdateOf('int-2')?.sender_user_id).toBeUndefined();
  });

  it('não grava remetente quando nenhuma caixa tem a conversa', async () => {
    sentRows = [sent()];
    threads = {};

    await checkEmailReplies();

    expect(metadataUpdateOf('int-1')).not.toHaveProperty('sender_user_id');
    expect(captured.some((c) => c.op === 'insert')).toBe(false);
  });

  it('registra a resposta uma vez só quando o lead tem dois envios no lote', async () => {
    sentRows = [sent(), sent({ id: 'int-2', metadata: { thread_id: 'th-2' } })];
    threads = { 'th-1': { mailbox: 'dono', reply: true }, 'th-2': { mailbox: 'dono', reply: true } };

    const res = await checkEmailReplies();

    expect(res).toEqual({ success: true, data: { found: 1 } });
    expect(captured.filter((c) => c.op === 'insert' && c.payload.type === 'replied')).toHaveLength(1);
  });

  it('bounce: para só a cadência de origem — as outras do lead seguem (não pausa)', async () => {
    sentRows = [sent()];
    threads = { 'th-1': { mailbox: 'dono', reply: false, bounce: true } };

    await checkEmailReplies();

    const enrollmentUpdates = captured.filter((c) => c.table === 'cadence_enrollments' && c.op === 'update');
    expect(enrollmentUpdates).toHaveLength(1);
    expect(enrollmentUpdates[0]?.payload).toEqual({ status: 'bounced' });
    expect(enrollmentUpdates[0]?.filters).toContain('eq:cadence_id:"cad-1"');
    expect(enrollmentUpdates.some((c) => c.payload.status === 'paused')).toBe(false);
    expect(captured.some((c) => c.table === 'leads' && 'email_bounced_at' in c.payload)).toBe(true);
    expect(leadEvent.logLeadEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'email_bounced', leadId: 'lead-1', userId: null }),
    );
  });
});

describe('checkEmailReplies — aviso no grupo interno (webhook do BDR IA)', () => {
  const bdrCadence = { name: 'BDR IA — Indústrias de Alimentos (v3 — ligação, e-mail e WhatsApp)', executor: 'bdr_ai' };

  it('resposta em cadência bdr_ai dispara o aviso, uma vez, com o contrato e event_id = id da interaction replied', async () => {
    h.cadence = bdrCadence;
    sentRows = [sent({ metadata: { thread_id: 'th-1', subject: 'Proposta', sender_user_id: 'ana' } })];
    threads = { 'th-1': { mailbox: 'ana', reply: true } };

    const res = await checkEmailReplies();

    expect(res).toEqual({ success: true, data: { found: 1 } });
    const replied = captured.find((c) => c.op === 'insert' && c.payload.type === 'replied');
    expect(h.sendBdr).toHaveBeenCalledTimes(1);
    const [url, payload] = h.sendBdr.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://hook.test/ana');
    expect(payload).toEqual({
      evento: 'email.replied',
      event_id: replied?.payload.id,
      org_id: 'org', lead_id: 'lead-1', enrollment_id: null, cadence_id: 'cad-1',
      cadence_nome: bdrCadence.name,
      mailbox: 'ana@v4.com', thread_id: 'th-1',
      rfc_message_id: '<resp@acme.com>', assunto: 'RES: Proposta', trecho: null,
      respondido_em: '2026-10-19T15:00:00.000Z',
      lead: { nome: 'Paula Costa', empresa: 'ACME', cargo: 'Gerente', email: 'paula@acme.com' },
      hold_criado: false,
    });
    expect(typeof payload.event_id).toBe('string');
  });

  it('resposta em cadência de SDR humano não dispara (mas segue registrando replied)', async () => {
    h.cadence = { name: 'Inbound — E-mail (auto)', executor: 'sdr' };
    sentRows = [sent()];
    threads = { 'th-1': { mailbox: 'dono', reply: true } };

    await checkEmailReplies();

    expect(captured.filter((c) => c.op === 'insert' && c.payload.type === 'replied')).toHaveLength(1);
    expect(h.sendBdr).not.toHaveBeenCalled();
  });

  it('não dispara duas vezes para a mesma resposta (dois envios do mesmo lead no lote)', async () => {
    h.cadence = bdrCadence;
    sentRows = [sent(), sent({ id: 'int-2', metadata: { thread_id: 'th-2' } })];
    threads = { 'th-1': { mailbox: 'dono', reply: true }, 'th-2': { mailbox: 'dono', reply: true } };

    await checkEmailReplies();

    expect(captured.filter((c) => c.op === 'insert' && c.payload.type === 'replied')).toHaveLength(1);
    expect(h.sendBdr).toHaveBeenCalledTimes(1);
  });

  it('falha do webhook não derruba o poll: replied gravado, SDR avisado, cron devolve sucesso', async () => {
    h.cadence = bdrCadence;
    h.sendBdr.mockRejectedValue(new Error('n8n fora do ar'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    sentRows = [sent()];
    threads = { 'th-1': { mailbox: 'dono', reply: true } };

    const res = await checkEmailReplies();

    expect(res).toEqual({ success: true, data: { found: 1 } });
    expect(captured.filter((c) => c.op === 'insert' && c.payload.type === 'replied')).toHaveLength(1);
    expect(captured.some((c) => c.table === 'cadence_enrollments' && c.op === 'update')).toBe(true);
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(expect.objectContaining({ type: 'lead_replied' }));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Aviso BDR IA falhou'), expect.any(Error));
    error.mockRestore();
  });

  it('sem BDR_EMAIL_REPLY_WEBHOOK_URL: não dispara e loga um aviso', async () => {
    h.cadence = bdrCadence;
    h.env.BDR_EMAIL_REPLY_WEBHOOK_URL = undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sentRows = [sent()];
    threads = { 'th-1': { mailbox: 'dono', reply: true } };

    await checkEmailReplies();

    expect(h.sendBdr).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('BDR_EMAIL_REPLY_WEBHOOK_URL não configurada'));
    warn.mockRestore();
  });
});
