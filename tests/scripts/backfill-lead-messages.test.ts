import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_ATTEMPTS,
  parseFromCursor,
  parseScriptArgs,
  retryDelayMs,
  runBackfill,
  shouldRetry,
} from '../../scripts/backfill-lead-messages';

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const LEAD = '22222222-2222-4222-8222-222222222222';
const CURSOR_AT = '2026-08-10T18:12:00.000Z';
const CURSOR_ID = '33333333-3333-4333-8333-333333333333';
const ROW_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ROW_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ROW_C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function interaction(id: string) {
  return {
    id,
    org_id: ORG,
    lead_id: LEAD,
    channel: 'whatsapp',
    type: 'sent',
    message_content: 'Oi Roberta, tudo bem?',
    external_id: null,
    metadata: null,
    ai_generated: false,
    performed_by: null,
    created_at: CURSOR_AT,
  };
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

function header(init: RequestInit | undefined, name: string): string {
  return new Headers(init?.headers).get(name) ?? '';
}

function bodyRows(init: RequestInit | undefined): Array<Record<string, unknown>> {
  const raw = typeof init?.body === 'string' ? init.body : '[]';
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [parsed as Record<string, unknown>];
}

function leadOk(): Response {
  return json({ telefone: '11988887777', phones: null, email: null, emails: null });
}

function networkError(code: string, message: string): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause: { code, message } });
}

async function settle<T>(pending: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await pending };
  } catch (error) {
    return { ok: false, error };
  }
}

afterEach(() => {
  fetchMock.mockReset();
  vi.useRealTimers();
});

describe('retry de rede do backfill', () => {
  it('espera o backoff e não trata constraint como rede', () => {
    expect(retryDelayMs(1, () => 0)).toBe(250);
    expect(retryDelayMs(2, () => 0)).toBe(500);
    expect(retryDelayMs(3, () => 0)).toBe(1000);
    expect(retryDelayMs(1, () => 1)).toBe(250 + Math.floor(250 * 0.25));
    expect(shouldRetry(0, networkError('ECONNRESET', 'socket hang up'))).toBe(true);
    expect(shouldRetry(0, networkError('ETIMEDOUT', 'timeout'))).toBe(true);
    expect(shouldRetry(0, networkError('UND_ERR_CONNECT_TIMEOUT', 'connect timeout'))).toBe(true);
    expect(shouldRetry(503, { message: 'timeout', code: '57014' })).toBe(true);
    expect(shouldRetry(429, { message: 'rate limit', code: '429' })).toBe(true);
    expect(shouldRetry(409, { message: 'duplicate key', code: '23505' })).toBe(false);
    expect(shouldRetry(400, { message: 'invalid', code: '22P02' })).toBe(false);
    expect(shouldRetry(406, { message: 'JSON object requested', code: 'PGRST116' })).toBe(false);
  });

  it('repete o select da página no fetch failed e só então lê a linha', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let pages = 0;
    fetchMock.mockImplementation(async (input) => {
      const path = pathOf(input);
      if (path.endsWith('/interactions')) {
        pages += 1;
        if (pages < 3) throw networkError('ECONNRESET', 'socket hang up');
        return json([interaction(ROW_A)]);
      }
      if (path.endsWith('/leads')) return leadOk();
      if (path.endsWith('/lead_contacts')) return json([]);
      throw new Error(`inesperado ${path}`);
    });

    const logs: string[] = [];
    const pending = settle(runBackfill({
      argv: ['--org', ORG, '--from-cursor', `${CURSOR_AT},${CURSOR_ID}`],
      url: 'http://backfill.test',
      key: 'service-role-test',
      fetch: fetchMock,
      log: (line) => logs.push(line),
      random: () => 0,
    }));

    await vi.advanceTimersByTimeAsync(0);
    expect(pages).toBe(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(pages).toBe(1);
    await vi.advanceTimersByTimeAsync(1 + 500);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);
    expect(pages).toBe(3);
    const report = logs.join('\n');
    expect(report).toContain('whatsapp  copiaria: 1');
    expect(report).toContain('Dry-run: nenhuma escrita.');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/lead_messages'))).toBe(false);
    const pageUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(decodeURIComponent(pageUrl)).toContain(CURSOR_AT);
    expect(decodeURIComponent(pageUrl)).toContain(CURSOR_ID);
  });

  it('repete loadAudience, upsert e status em 5xx ou 429, e não repete 409', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hits = { leads: 0, messages: 0, status: 0 };
    fetchMock.mockImplementation(async (input, init) => {
      const path = pathOf(input);
      if (path.endsWith('/interactions')) return json([interaction(ROW_A)]);
      if (path.endsWith('/leads')) {
        hits.leads += 1;
        if (hits.leads === 1) return json({ message: 'unavailable', code: '57014' }, 503);
        return leadOk();
      }
      if (path.endsWith('/lead_contacts')) return json([]);
      if (path.endsWith('/lead_messages')) {
        hits.messages += 1;
        if (hits.messages === 1) return json({ message: 'slow down', code: '429' }, 429);
        return json([{ id: 'msg-1', provider_message_id: `interaction:${ROW_A}` }]);
      }
      if (path.endsWith('/lead_message_status_events')) {
        hits.status += 1;
        if (hits.status === 1) return json({ message: 'bad gateway' }, 502);
        expect(header(init, 'prefer')).toContain('resolution=ignore-duplicates');
        expect(decodeURIComponent(String(input))).toContain('on_conflict=message_id,status');
        return new Response('', { status: 201 });
      }
      throw new Error(`inesperado ${path}`);
    });

    const pending = settle(runBackfill({
      argv: ['--org', ORG, '--execute'],
      url: 'http://backfill.test',
      key: 'service-role-test',
      fetch: fetchMock,
      log: () => undefined,
      random: () => 0,
    }));
    await vi.advanceTimersByTimeAsync(10_000);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);
    expect(hits).toEqual({ leads: 2, messages: 2, status: 2 });
  });

  it('não repete unique violation e o log traz o cursor para retomar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let messages = 0;
    fetchMock.mockImplementation(async (input) => {
      const path = pathOf(input);
      if (path.endsWith('/interactions')) return json([interaction(ROW_A)]);
      if (path.endsWith('/leads')) return leadOk();
      if (path.endsWith('/lead_contacts')) return json([]);
      if (path.endsWith('/lead_messages')) {
        messages += 1;
        return json({
          code: '23505',
          message: 'duplicate key value violates unique constraint',
          details: 'Key (org_id, provider, provider_message_id) already exists.',
        }, 409);
      }
      throw new Error(`inesperado ${path}`);
    });

    const logs: string[] = [];
    const pending = settle(runBackfill({
      argv: ['--execute', '--org', ORG, '--from-cursor', `${CURSOR_AT},${CURSOR_ID}`],
      url: 'http://backfill.test',
      key: 'service-role-test',
      fetch: fetchMock,
      log: (line) => logs.push(line),
      random: () => 0,
    }));
    await vi.advanceTimersByTimeAsync(20_000);
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    expect(messages).toBe(1);
    if (outcome.ok) throw new Error('deveria falhar');
    const text = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    expect(text).toContain('23505');
    expect(text).toContain('duplicate key value violates unique constraint');
    expect(text).toContain(`Cursor: ${CURSOR_AT},${CURSOR_ID}`);
    expect(text).toContain(`--from-cursor ${CURSOR_AT},${CURSOR_ID}`);
    expect(logs.join('\n')).toContain('copiadas: 0');
  });

  it('na última falha de rede registra a causa e o cursor', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let pages = 0;
    fetchMock.mockImplementation(async (input) => {
      if (pathOf(input).endsWith('/interactions')) {
        pages += 1;
        throw networkError('UND_ERR_CONNECT_TIMEOUT', 'connect timeout');
      }
      throw new Error(`inesperado ${String(input)}`);
    });

    const pending = settle(runBackfill({
      argv: ['--org', ORG, '--from-cursor', `${CURSOR_AT},${CURSOR_ID}`],
      url: 'http://backfill.test',
      key: 'service-role-test',
      fetch: fetchMock,
      log: () => undefined,
      random: () => 0,
    }));
    await vi.advanceTimersByTimeAsync(20_000);
    const outcome = await pending;
    expect(pages).toBe(MAX_ATTEMPTS);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('deveria falhar');
    const text = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    expect(text).toContain('fetch failed');
    expect(text).toContain('UND_ERR_CONNECT_TIMEOUT');
    expect(text).toContain('connect timeout');
    expect(text).toContain(`--from-cursor ${CURSOR_AT},${CURSOR_ID}`);
  });
});

describe('lote do upsert', () => {
  it('grava a página inteira num POST e conta cópia pela resposta, não pelo envio', async () => {
    const messageBodies: Array<Array<Record<string, unknown>>> = [];
    const statusBodies: Array<Array<Record<string, unknown>>> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = pathOf(input);
      if (path.endsWith('/interactions')) return json([interaction(ROW_A), interaction(ROW_B), interaction(ROW_C)]);
      if (path.endsWith('/leads')) {
        expect(String(input)).toContain(LEAD);
        expect(String(input)).toContain(ORG);
        return leadOk();
      }
      if (path.endsWith('/lead_contacts')) return json([]);
      if (path.endsWith('/lead_messages')) {
        expect(header(init, 'prefer')).toContain('resolution=ignore-duplicates');
        expect(decodeURIComponent(String(input))).toContain('on_conflict=org_id,provider,provider_message_id');
        expect(decodeURIComponent(String(input))).toContain('provider_message_id');
        const rows = bodyRows(init);
        messageBodies.push(rows);
        return json([
          { id: 'msg-a', provider_message_id: `interaction:${ROW_A}` },
          { id: 'msg-c', provider_message_id: `interaction:${ROW_C}` },
        ]);
      }
      if (path.endsWith('/lead_message_status_events')) {
        expect(header(init, 'prefer')).toContain('resolution=ignore-duplicates');
        expect(decodeURIComponent(String(input))).toContain('on_conflict=message_id,status');
        statusBodies.push(bodyRows(init));
        return new Response('', { status: 201 });
      }
      throw new Error(`inesperado ${path}`);
    });

    const logs: string[] = [];
    await runBackfill({
      argv: ['--org', ORG, '--execute'],
      url: 'http://backfill.test',
      key: 'service-role-test',
      fetch: fetchMock,
      log: (line) => logs.push(line),
    });

    expect(messageBodies).toHaveLength(1);
    expect(messageBodies[0]?.map((row) => row.provider_message_id)).toEqual([
      `interaction:${ROW_A}`,
      `interaction:${ROW_B}`,
      `interaction:${ROW_C}`,
    ]);
    expect(messageBodies[0]?.every((row) => row.provider === 'legacy_interactions')).toBe(true);
    expect(statusBodies).toHaveLength(1);
    expect(statusBodies[0]?.map((row) => row.message_id).sort()).toEqual(['msg-a', 'msg-c']);
    expect(statusBodies[0]?.every((row) => row.status === 'sent')).toBe(true);
    const report = logs.join('\n');
    expect(report).toContain('whatsapp  copiadas: 2  duplicadas: 1');
    expect(report).toContain('Modo: execute');
  });

  it('parte o lote quando passa do tamanho pedido', async () => {
    const sizes: number[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = pathOf(input);
      if (path.endsWith('/interactions')) return json([interaction(ROW_A), interaction(ROW_B), interaction(ROW_C)]);
      if (path.endsWith('/leads')) return leadOk();
      if (path.endsWith('/lead_contacts')) return json([]);
      if (path.endsWith('/lead_messages')) {
        const rows = bodyRows(init);
        sizes.push(rows.length);
        return json(rows.map((row, index) => ({ id: `msg-${index}-${rows.length}`, provider_message_id: row.provider_message_id })));
      }
      if (path.endsWith('/lead_message_status_events')) return new Response('', { status: 201 });
      throw new Error(`inesperado ${path}`);
    });

    const logs: string[] = [];
    await runBackfill({
      argv: ['--org', ORG, '--execute'],
      url: 'http://backfill.test',
      key: 'service-role-test',
      fetch: fetchMock,
      log: (line) => logs.push(line),
      messageBatch: 2,
      statusBatch: 2,
    });

    expect(sizes).toEqual([2, 1]);
    expect(logs.join('\n')).toContain('whatsapp  copiadas: 3  duplicadas: 0');
  });
});

describe('argumentos', () => {
  it('exige --org, continua seco sem --execute e aceita o cursor', async () => {
    expect(parseScriptArgs(['--org', ORG]).cursor).toBeNull();
    expect(parseFromCursor(`${CURSOR_AT},${CURSOR_ID}`)).toEqual({ createdAt: CURSOR_AT, id: CURSOR_ID });
    const parsed = parseScriptArgs(['--from-cursor', `${CURSOR_AT},${CURSOR_ID}`, '--execute', `--org=${ORG}`]);
    expect(parsed.cursor).toEqual({ createdAt: CURSOR_AT, id: CURSOR_ID });
    expect(parsed.argv).toEqual(['--execute', `--org=${ORG}`]);
    expect(() => parseFromCursor('ontem,nao-uuid')).toThrow(/--from-cursor/);
    expect(() => parseScriptArgs(['--execute'])).not.toThrow();
    await expect(runBackfill({
      argv: ['--execute'],
      url: 'http://backfill.test',
      key: 'service-role-test',
      fetch: fetchMock,
    })).rejects.toThrow(/--org/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
