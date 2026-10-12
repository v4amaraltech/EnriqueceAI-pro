import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));
const leadEvent = vi.hoisted(() => ({ logLeadEvent: vi.fn() }));
vi.mock('@/lib/supabase/service', () => service);
vi.mock('@/features/leads/actions/log-lead-event', () => leadEvent);

import { createPausedCadenceFollowups } from './paused-cadence-followup';
import { FOLLOWUP_MAX_PER_ORG } from '../services/paused-cadence-followup.logic';

// Segunda 12/out/2026, 09h BRT.
const NOW = new Date('2026-10-12T12:00:00Z');
const OLD = '2026-10-06T15:00:00Z'; // terça anterior → 4 dias úteis
const RECENT = '2026-10-09T15:00:00Z'; // sexta → 1 dia útil

let limbo: Array<{ id: string; org_id: string; assigned_to: string | null }>;
let paused: Array<{ lead_id: string; cadence: { name: string } | null }>;
let lastContact: Record<string, string | undefined>;
let pauseReason: Record<string, string | undefined>;
let inserts: Array<Record<string, unknown>>;
let limboFilters: string[];

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const filters: Array<[string, unknown, unknown]> = [];
  const track = (name: string) =>
    vi.fn((a: unknown, b: unknown) => {
      filters.push([name, a, b]);
      if (table === 'v_leads_cadence_limbo') limboFilters.push(`${name}:${String(a)}`);
      return chain;
    });
  for (const f of ['select', 'eq', 'not', 'in', 'is', 'contains', 'order', 'limit']) chain[f] = track(f);
  chain.insert = vi.fn((payload: Record<string, unknown>) => {
    inserts.push(payload);
    return Promise.resolve({ error: null });
  });
  chain.then = (resolve: (v: unknown) => unknown) => {
    let result: unknown = { data: null, error: null };
    if (table === 'v_leads_cadence_limbo') result = { data: limbo, error: null };
    else if (table === 'cadence_enrollments') result = { data: paused, error: null };
    else if (table === 'interactions') {
      const leadId = filters.find(([n, a]) => n === 'eq' && a === 'lead_id')?.[2] as string;
      const isPauseLookup = filters.some(([n]) => n === 'contains');
      result = isPauseLookup
        ? { data: pauseReason[leadId] ? [{ metadata: { reason: pauseReason[leadId] } }] : [], error: null }
        : { data: lastContact[leadId] ? [{ created_at: lastContact[leadId] }] : [], error: null };
    }
    return Promise.resolve(result).then(resolve);
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  limbo = [{ id: 'lead-1', org_id: 'org', assigned_to: 'sdr-1' }];
  paused = [{ lead_id: 'lead-1', cadence: { name: 'Recovery' } }];
  lastContact = { 'lead-1': OLD };
  pauseReason = { 'lead-1': 'whatsapp_invalid' };
  inserts = [];
  limboFilters = [];
  service.createServiceRoleClient.mockReturnValue({ from: (t: string) => makeChain(t) });
  leadEvent.logLeadEvent.mockResolvedValue(undefined);
});

describe('createPausedCadenceFollowups', () => {
  it('cria a tarefa "Definir destino" para o dono, às 9h BRT, e registra na timeline', async () => {
    const res = await createPausedCadenceFollowups(NOW);

    expect(res).toEqual({ success: true, data: { candidates: 1, created: 1 } });
    expect(inserts[0]).toMatchObject({
      org_id: 'org',
      lead_id: 'lead-1',
      user_id: 'sdr-1',
      channel: 'research',
      scheduled_at: '2026-10-12T12:00:00.000Z',
    });
    expect(String(inserts[0]?.notes)).toContain('Recovery — número não é WhatsApp');
    expect(leadEvent.logLeadEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'paused_cadence_followup', leadId: 'lead-1', userId: null }),
    );
  });

  it('só considera lead do limbo com dono', async () => {
    await createPausedCadenceFollowups(NOW);
    expect(limboFilters).toContain('not:assigned_to');
  });

  it('lead sem cadência pausada (ex.: cadência concluída) não entra', async () => {
    paused = [];
    const res = await createPausedCadenceFollowups(NOW);
    expect(res).toEqual({ success: true, data: { candidates: 0, created: 0 } });
    expect(inserts).toHaveLength(0);
  });

  it('contato há menos de 3 dias úteis: espera', async () => {
    lastContact = { 'lead-1': RECENT };
    const res = await createPausedCadenceFollowups(NOW);
    expect(res).toEqual({ success: true, data: { candidates: 1, created: 0 } });
    expect(inserts).toHaveLength(0);
  });

  it('pausa sem motivo registrado (ex.: bounce antigo) ainda gera a tarefa', async () => {
    pauseReason = {};
    await createPausedCadenceFollowups(NOW);
    expect(String(inserts[0]?.notes)).toContain('motivo não registrado');
  });

  it('respeita o teto por org', async () => {
    limbo = Array.from({ length: FOLLOWUP_MAX_PER_ORG + 5 }, (_, i) => ({ id: `lead-${i}`, org_id: 'org', assigned_to: 'sdr-1' }));
    paused = limbo.map((l) => ({ lead_id: l.id, cadence: { name: 'Recovery' } }));
    lastContact = Object.fromEntries(limbo.map((l) => [l.id, OLD]));

    const res = await createPausedCadenceFollowups(NOW);

    expect(res.success && res.data.created).toBe(FOLLOWUP_MAX_PER_ORG);
    expect(inserts).toHaveLength(FOLLOWUP_MAX_PER_ORG);
  });
});
