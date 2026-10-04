import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));

vi.mock('@/lib/supabase/service', () => service);
vi.mock('@/lib/security/encryption', () => ({ decrypt: (v: string) => v }));
vi.mock('@/features/integrations/services/email.service', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/features/notifications/services/notification.service', () => ({ createNotification: vi.fn() }));
vi.mock('../services/webhook-dispatch.service', () => ({ dispatchWebhookEvent: vi.fn() }));

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
let threads: Record<string, { mailbox: string; reply: boolean }>;

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
        },
      };
    }
    if (table === 'leads') return { data: { org_id: 'org', assigned_to: 'dono', nome_fantasia: 'ACME' } };
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
        messages.push({ id: 'b', payload: { headers: [{ name: 'From', value: 'cliente@acme.com' }] } });
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
});
