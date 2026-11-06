import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; payload: unknown }>,
  member: null as unknown,
}));

vi.mock('@/features/inbound-api/services/api-key-auth', () => ({ authenticateApiKey: () => Promise.resolve({ orgId: 'org-1' }) }));
vi.mock('@/lib/security/rate-limit', () => ({ checkRateLimit: () => Promise.resolve({ allowed: true }) }));
vi.mock('@/features/integrations/services/email.service', () => ({ EmailService: {} }));

function chain(table: string) {
  const c: Record<string, unknown> = {};
  let op = 'select';
  let payload: unknown;
  for (const f of ['eq', 'select']) c[f] = () => c;
  c.update = (p: unknown) => { op = 'update'; payload = p; m.updates.push({ table, payload }); return c; };
  c.upsert = (p: unknown) => { op = 'upsert'; payload = p; return c; };
  const result = () => {
    if (table === 'email_conversations' && op === 'select') return { data: { id: 'c1', org_id: 'org-1', lead_id: 'lead-1', estado: 'ia_ativa' } };
    if (table === 'organization_members') return { data: m.member };
    return { data: null, error: null };
  };
  c.maybeSingle = () => Promise.resolve(result());
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  void payload;
  return c;
}
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({ from: (t: string) => chain(t) }) }));
vi.mock('@/lib/supabase/from', () => ({ from: (s: { from: (t: string) => unknown }, t: string) => s.from(t) }));

import { POST } from './route';

const CONV = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const call = (body: unknown) =>
  POST(new Request(`https://x/api/v1/email-conversations/${CONV}/handoff`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: CONV, action: 'handoff' }),
  });

beforeEach(() => {
  m.updates = [];
  m.member = null;
});

describe('handoff — user_id só de membro ativo da org', () => {
  it('membro ativo da org → humano assume com esse usuário', async () => {
    m.member = { user_id: USER };
    const res = await call({ user_id: USER });
    expect(res.status).toBe(200);
    expect(m.updates.find((u) => u.table === 'email_conversations')?.payload).toMatchObject({ estado: 'humano_assumiu', humano_user_id: USER });
  });

  it('usuário de outra org (ou inativo) → 400, sem mexer na conversa', async () => {
    const res = await call({ user_id: USER });
    expect(res.status).toBe(400);
    expect(m.updates).toEqual([]);
  });

  it('user_id que não é uuid → 400', async () => {
    const res = await call({ user_id: 'nao-uuid' });
    expect(res.status).toBe(400);
  });

  it('sem user_id → humano assume sem dono definido (como antes)', async () => {
    const res = await call({ motivo: 'pediu humano' });
    expect(res.status).toBe(200);
    expect(m.updates.find((u) => u.table === 'email_conversations')?.payload).toMatchObject({ humano_user_id: null });
  });
});
