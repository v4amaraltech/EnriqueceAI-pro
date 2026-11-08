import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';

import { POST as ingest } from './leads/ingest/route';
import { POST as lookup } from './calls/lookup/route';
import { POST as enrich } from './enrichment/result/route';

const mocks = vi.hoisted(() => ({ flag: vi.fn() }));
vi.mock('@/features/contact-engine/services/flag-scope.service', () => ({ isScopedFlagEnabled: mocks.flag }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => {
    throw new Error('nao deveria ler nada com a flag desligada');
  },
}));
vi.mock('@/features/inbound-api/services/api-key-auth', () => ({ authenticateApiKey: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));

const req = (path: string, body: unknown) =>
  new Request(`http://localhost/api/v1/edge/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const bodies = {
  ingest: { source: 'leadbroker', idempotency_key: 'lb-batch-0001', leads: [{ first_name: 'A', email: 'a@x.com', telefone: '1', empresa: 'X' }] },
  lookup: { provider: 'api4com', idempotency_key: 'call-0001', external_call_id: 'a1' },
  enrich: { lead_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', idempotency_key: 'enr-000001', provider: 'x', status: 'not_found' },
};

describe('rotas de ingestão de borda', () => {
  beforeEach(() => {
    mocks.flag.mockReset().mockResolvedValue(false);
    vi.mocked(authenticateApiKey).mockResolvedValue({ orgId: '11111111-1111-4111-8111-111111111111', keyId: 'k1' } as never);
  });

  it('sem API key: 401', async () => {
    vi.mocked(authenticateApiKey).mockResolvedValue(null as never);
    expect((await ingest(req('leads/ingest', bodies.ingest))).status).toBe(401);
  });

  it('corpo inválido: 400 com contrato versionado', async () => {
    const res = await lookup(req('calls/lookup', { ...bodies.lookup, extra: 1 }));
    expect(res.status).toBe(400);
    expect((await res.json()).contract_version).toBe('edge-ingestion.v1');
  });

  it('flag desligada (padrão): 403 adapter_disabled sem tocar no banco', async () => {
    for (const [fn, path, body] of [
      [ingest, 'leads/ingest', bodies.ingest],
      [lookup, 'calls/lookup', bodies.lookup],
      [enrich, 'enrichment/result', bodies.enrich],
    ] as const) {
      const res = await fn(req(path, body));
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('adapter_disabled');
    }
    expect(mocks.flag).toHaveBeenCalledWith('edge_ingestion_v1', { orgId: '11111111-1111-4111-8111-111111111111' });
  });
});
