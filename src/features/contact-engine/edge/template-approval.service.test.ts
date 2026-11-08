import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TEMPLATE_CACHE_TTL_MS, clearTemplateCache, matchTemplate, verifyApprovedTemplate, type ApprovedTemplate,
} from './template-approval.service';

vi.mock('@/lib/security/encryption', () => ({ decrypt: (v: string) => v }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({}) }));
vi.mock('@/lib/supabase/from', () => ({ from: () => ({}) }));

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const APPROVED: ApprovedTemplate[] = [
  { id: '111', name: 'boas_vindas', language: 'pt_BR' },
  { id: '222', name: 'retomada', language: 'en_US' },
];

const graphOk = (data: unknown[] = APPROVED) =>
  vi.fn(async () => new Response(JSON.stringify({ data: data.map((t) => ({ ...(t as object), status: 'APPROVED' })) }), { status: 200 }));
type Conn = { wabaId: string; token: string } | null | 'error';
const conn = (waba = 'waba-1') => vi.fn(async (): Promise<Conn> => ({ wabaId: waba, token: 'tok' }));

describe('matchTemplate', () => {
  it('aprovado por id ou por nome, no idioma certo', () => {
    expect(matchTemplate(APPROVED, '111', 'pt_BR')).toBe('approved');
    expect(matchTemplate(APPROVED, 'boas_vindas', 'pt_BR')).toBe('approved');
  });
  it('não aprovado quando id e nome não existem entre os APPROVED', () => {
    expect(matchTemplate(APPROVED, 'rascunho', 'pt_BR')).toBe('not_approved');
  });
  it('idioma errado', () => {
    expect(matchTemplate(APPROVED, 'boas_vindas', 'en_US')).toBe('language_mismatch');
    expect(matchTemplate(APPROVED, '222', 'pt_BR')).toBe('language_mismatch');
  });
});

describe('verifyApprovedTemplate', () => {
  beforeEach(() => clearTemplateCache());

  it('aprovado: consulta só APPROVED da WABA da org com o token, sem vazá-lo na URL', async () => {
    const fetchImpl = graphOk();
    const v = await verifyApprovedTemplate(ORG_A, { id: 'boas_vindas' }, { fetchImpl: fetchImpl as never, loadConnection: conn() });
    expect(v).toBe('approved');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/waba-1/message_templates?status=APPROVED');
    expect(url).not.toContain('tok');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('não aprovado e idioma errado', async () => {
    const deps = { fetchImpl: graphOk() as never, loadConnection: conn() };
    expect(await verifyApprovedTemplate(ORG_A, { id: 'inexistente' }, deps)).toBe('not_approved');
    expect(await verifyApprovedTemplate(ORG_A, { id: 'boas_vindas', language: 'es_ES' }, deps)).toBe('language_mismatch');
  });

  it('template que a Meta devolve como não APPROVED é ignorado', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: '9', name: 'x', language: 'pt_BR', status: 'REJECTED' }] }), { status: 200 }));
    expect(await verifyApprovedTemplate(ORG_A, { id: 'x' }, { fetchImpl: fetchImpl as never, loadConnection: conn() })).toBe('not_approved');
  });

  it('falha de leitura nega (error): HTTP 500, corpo inválido, rede, sem conexão e erro de credencial', async () => {
    const run = (fetchImpl: unknown, loadConnection = conn()) =>
      verifyApprovedTemplate(ORG_A, { id: 'boas_vindas' }, { fetchImpl: fetchImpl as never, loadConnection });
    expect(await run(vi.fn(async () => new Response('{}', { status: 500 })))).toBe('error');
    expect(await run(vi.fn(async () => new Response('nao-json', { status: 200 })))).toBe('error');
    expect(await run(vi.fn(async () => { throw new Error('timeout'); }))).toBe('error');
    expect(await run(graphOk(), vi.fn(async (): Promise<Conn> => null))).toBe('error');
    expect(await run(graphOk(), vi.fn(async (): Promise<Conn> => 'error'))).toBe('error');
  });

  it('erro não é cacheado: a próxima chamada tenta de novo', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ ...APPROVED[0], status: 'APPROVED' }] }), { status: 200 }));
    const deps = { fetchImpl: fetchImpl as never, loadConnection: conn() };
    expect(await verifyApprovedTemplate(ORG_A, { id: 'boas_vindas' }, deps)).toBe('error');
    expect(await verifyApprovedTemplate(ORG_A, { id: 'boas_vindas' }, deps)).toBe('approved');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('cache: segunda chamada dentro do TTL não chama a Graph API; expira depois do TTL', async () => {
    const fetchImpl = graphOk();
    let t = 1_000;
    const deps = { fetchImpl: fetchImpl as never, loadConnection: conn(), now: () => t };
    await verifyApprovedTemplate(ORG_A, { id: 'boas_vindas' }, deps);
    t += TEMPLATE_CACHE_TTL_MS - 1;
    await verifyApprovedTemplate(ORG_A, { id: 'retomada', language: 'en_US' }, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 2;
    await verifyApprovedTemplate(ORG_A, { id: 'boas_vindas' }, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('cache é por organização: a lista da org A não vale para a org B', async () => {
    const fetchImpl = graphOk();
    await verifyApprovedTemplate(ORG_A, { id: 'boas_vindas' }, { fetchImpl: fetchImpl as never, loadConnection: conn('waba-a') });
    const other = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    expect(await verifyApprovedTemplate(ORG_B, { id: 'boas_vindas' }, { fetchImpl: other as never, loadConnection: conn('waba-b') })).toBe('not_approved');
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('paginação fora do host da Graph API é ignorada; lista maior que o limite de páginas nega', async () => {
    const off = vi.fn(async () => new Response(JSON.stringify({ data: [], paging: { next: 'https://evil.example/x' } }), { status: 200 }));
    expect(await verifyApprovedTemplate(ORG_A, { id: 'a' }, { fetchImpl: off as never, loadConnection: conn() })).toBe('not_approved');
    expect(off).toHaveBeenCalledTimes(1);
    clearTemplateCache();
    const endless = vi.fn(async () => new Response(JSON.stringify({ data: [], paging: { next: 'https://graph.facebook.com/v21.0/p?after=1' } }), { status: 200 }));
    expect(await verifyApprovedTemplate(ORG_A, { id: 'a' }, { fetchImpl: endless as never, loadConnection: conn() })).toBe('error');
  });
});
