import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeAutoDialClient, type AutoDialDb, type Row } from './auto-dial.testkit';
import { checkDialGate } from './cockpit-auto-dial.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./cockpit-auto-dial-flag', () => ({ isCockpitAutoDialEnabled: vi.fn(), isCockpitAutoDialLive: vi.fn() }));

import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from './cockpit-auto-dial-flag';

/** Sexta 13/11/2026 12:00 BRT. */
const NOW = new Date('2026-11-13T15:00:00Z');
const ORG = 'org-1';
const ME = 'user-1';

function setup(tables: Record<string, Row[]>) {
  const db: AutoDialDb = {
    tables: { calls: [], contact_holds: [], interactions: [], leads: [], custom_fields: [], decision_events: [], scheduled_activities: [], loss_reasons: [], ...tables },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: vi.fn(async () => ({ data: [], error: null })),
  };
  return { db, client: makeAutoDialClient(db) as never };
}
const lead = (over: Row = {}): Row => ({
  id: 'A', org_id: ORG, assigned_to: ME, closer_id: null, deleted_at: null, status: 'contacted', telefone: '11999990000', lost_at: null, loss_reason_id: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
  vi.mocked(isCockpitAutoDialLive).mockResolvedValue(false);
});

describe('checkDialGate com leituras em paralelo: a ORDEM das recusas não mudou', () => {
  const gate = (client: never, now = NOW) => checkDialGate({ orgId: ORG, userId: ME, leadId: 'A', now, holidays: [], client });

  it('fluxo feliz continua liberando', async () => {
    const { client } = setup({ leads: [lead()] });
    expect(await gate(client)).toMatchObject({ ok: true, phone: '11999990000', leadId: 'A' });
  });

  it('fora da janela vence "lead de outro dono" (janela é avaliada antes)', async () => {
    const { client } = setup({ leads: [lead({ assigned_to: 'outro' })] });
    const night = new Date('2026-11-13T23:00:00Z');
    const r = await gate(client, night);
    expect(r.ok).toBe(false);
    expect(r).not.toMatchObject({ code: 'not_owner' });
  });

  it('too_soon vence "lead de outro dono"', async () => {
    const { client } = setup({
      leads: [lead({ assigned_to: 'outro' })],
      calls: [{ id: 'c1', org_id: ORG, user_id: ME, lead_id: 'Z', created_at: new Date(NOW.getTime() - 5_000).toISOString(), hangup_cause: 'x', metadata: {} }],
    });
    expect(await gate(client)).toEqual({ ok: false, code: 'too_soon' });
  });

  it('lead de outro dono, sem outras travas, recusa not_owner', async () => {
    const { client } = setup({ leads: [lead({ assigned_to: 'outro' })] });
    expect(await gate(client)).toEqual({ ok: false, code: 'not_owner' });
  });

  it('sem telefone recusa no_phone', async () => {
    const { client } = setup({ leads: [lead({ telefone: ' ' })] });
    expect(await gate(client)).toEqual({ ok: false, code: 'no_phone' });
  });
});
