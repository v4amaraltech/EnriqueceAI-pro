import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { CONSENT_CAPTURE_FLAG_KEY } from '@/features/contact-engine/services/consent-capture.service';
import { makeConsentClient, makeConsentWorld, type ConsentWorld } from '@/features/contact-engine/services/consent-capture.testkit';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { POST } from './route';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/features/inbound-api/services/api-key-auth', () => ({ authenticateApiKey: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));

const LEAD = '11111111-1111-4111-8111-111111111111';
const OTHER_LEAD = '22222222-2222-4222-8222-222222222222';

function setup(over: Partial<ConsentWorld> = {}): ConsentWorld {
  const w = makeConsentWorld({
    flags: { [CONSENT_CAPTURE_FLAG_KEY]: { enabled: true } },
    leads: [
      { id: LEAD, org_id: 'org-1' },
      { id: OTHER_LEAD, org_id: 'org-2' },
    ],
    ...over,
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(makeConsentClient(w) as never);
  return w;
}

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/v1/edge/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

const payload = (over: Record<string, unknown> = {}) => ({
  lead_id: LEAD,
  telefone: '(16) 99986-7577',
  tipo: 'opt_in',
  ...over,
});

describe('POST /api/v1/edge/consent', () => {
  beforeEach(() => {
    vi.mocked(createServiceRoleClient).mockReset();
    vi.mocked(authenticateApiKey).mockResolvedValue({ orgId: 'org-1', keyId: 'key-1', scopes: ['leads.write'] });
  });

  it('sem API key valida: 401 e nada gravado', async () => {
    const w = setup();
    vi.mocked(authenticateApiKey).mockResolvedValue(null);
    expect((await call(payload())).status).toBe(401);
    expect(w.consent).toHaveLength(0);
  });

  it('payload invalido: 422', async () => {
    setup();
    expect((await call(payload({ tipo: 'maybe' }))).status).toBe(422);
    expect((await call(payload({ lead_id: 'x' }))).status).toBe(422);
    expect((await call(payload({ telefone: '12' }))).status).toBe(422);
  });

  it('grava opt_in com source ana_v4_opt_in e a org vem da chave, nao do corpo', async () => {
    const w = setup();
    const res = await call(payload({ org_id: 'org-2', fluxo: 'consentimento_v4' }));
    expect(res.status).toBe(201);
    expect(w.consent[0]).toMatchObject({
      org_id: 'org-1', kind: 'opt_in', source: 'ana_v4_opt_in', contact_identity: '5516999867577',
      evidence: { origin: 'ana_v4', flow: 'consentimento_v4', api_key_id: 'key-1' },
    });
  });

  it('idempotente: mesma chave ou mesmo (lead, telefone, tipo) nao duplica', async () => {
    const w = setup();
    expect((await call(payload(), { 'x-idempotency-key': 'abc' })).status).toBe(201);
    const again = await call(payload(), { 'x-idempotency-key': 'abc' });
    expect(again.status).toBe(200);
    expect((await again.json()).data).toEqual({ gravado: false, status: 'duplicate' });
    expect((await call(payload({ tipo: 'opt_out' }))).status).toBe(201);
    expect((await call(payload({ tipo: 'opt_out' }))).status).toBe(200);
    expect(w.consent.map((r) => r.kind)).toEqual(['opt_in', 'opt_out']);
  });

  it('opt_out vence: opt_in depois do opt_out nao e gravado', async () => {
    const w = setup();
    await call(payload({ tipo: 'opt_out' }));
    const res = await call(payload(), { 'x-idempotency-key': 'novo' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('skipped_opted_out');
    expect(w.consent.map((r) => r.kind)).toEqual(['opt_out']);
  });

  it('flag desligada: 200 sem gravar e sem ler dados', async () => {
    const w = setup({ flags: { [CONSENT_CAPTURE_FLAG_KEY]: { enabled: false } } });
    const res = await call(payload());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ gravado: false, status: 'disabled' });
    expect(w.writes).toEqual([]);
    expect(w.reads).toEqual([]);
  });

  it('isolamento: lead de outra org retorna 404 e nao grava', async () => {
    const w = setup();
    expect((await call(payload({ lead_id: OTHER_LEAD }))).status).toBe(404);
    expect(w.consent).toHaveLength(0);
  });
});
