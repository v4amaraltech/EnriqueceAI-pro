import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { makeDb, makeFakeClient, type FakeDb, type Row } from '@/features/contact-engine/services/call-priority.testkit';

import type { CockpitViewer } from '../types';

import { fetchNextCallCard } from './next-call-card.service';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

const NOW = new Date('2026-11-07T12:00:00Z');
const viewer: CockpitViewer = { viewerId: 'u1', orgId: 'org-1', isManager: false, targetUserId: 'u1', targetName: 'U', sdrOptions: [] };

const lead = (id: string, over: Row = {}): Row => ({
  id,
  org_id: 'org-1',
  assigned_to: 'u1',
  closer_id: null,
  deleted_at: null,
  nome_fantasia: `Empresa ${id}`,
  razao_social: null,
  cnpj: null,
  segmento: null,
  porte: null,
  status: 'contacted',
  first_name: 'Ana',
  last_name: null,
  job_title: 'Diretora',
  email: null,
  telefone: '11999990000',
  socios: [],
  fit_score: null,
  engagement_score: null,
  meeting_no_show_at: null,
  updated_at: '2026-11-06T00:00:00Z',
  custom_field_values: {},
  ...over,
});

/**
 * "lead-v1" vence na regra atual (clicou ha 1 dia, nada mais). "lead-v2" so tem
 * resultado de ligacao relevante informado pelo SDR: pela regra atual empata em 1
 * e perde no desempate por updated_at.
 */
function seed(): FakeDb {
  const db = makeDb({
    app_flags: [
      { key: 'call_cockpit_v1', enabled: true },
      { key: 'call_priority_v2', enabled: false },
    ],
    leads: [lead('lead-v1', { updated_at: '2026-11-06T12:00:00Z' }), lead('lead-v2', { updated_at: '2026-11-01T00:00:00Z' })],
    contact_holds: [],
    interactions: [{ id: 'i1', org_id: 'org-1', lead_id: 'lead-v1', channel: 'email', type: 'clicked', created_at: '2026-11-06T10:00:00Z' }],
    calls: [
      {
        id: 'c1',
        org_id: 'org-1',
        lead_id: 'lead-v2',
        started_at: '2026-11-06T09:00:00Z',
        created_at: '2026-11-06T09:00:00Z',
        duration_seconds: 300,
        connected: true,
        status: 'completed',
        sdr_outcome: null,
        sdr_disposition: 'callback_requested',
        notes: null,
        metadata: {},
      },
    ],
    custom_fields: [],
    decision_events: [],
  });
  const client = makeFakeClient(db) as never;
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client);
  vi.mocked(createServiceRoleClient).mockReturnValue(client);
  return db;
}

const setFlag = (db: FakeDb, key: string, enabled: boolean) => {
  db.tables.app_flags!.find((f) => f.key === key)!.enabled = enabled;
};

async function pick(): Promise<{ leadId: string; version: string; priority: boolean }> {
  const r = await fetchNextCallCard({ viewer, now: NOW });
  if (r.status !== 'ok') throw new Error(`status ${r.status}`);
  return { leadId: r.data.context.leadId, version: r.data.approach.version, priority: r.data.priority !== undefined };
}

beforeEach(() => vi.clearAllMocks());

describe('fetchNextCallCard com call_priority_v2', () => {
  it('desligada: ordem e abordagem de antes, sem tocar em dados do score v2', async () => {
    const db = seed();
    expect(await pick()).toEqual({ leadId: 'lead-v1', version: 'v0', priority: false });
    expect(db.reads.some((r) => r.table === 'custom_fields' || r.table === 'decision_events')).toBe(false);
    expect(db.tables.decision_events).toHaveLength(0);
  });

  it('ligada: o score v2 escolhe o lead por interesse real e mostra fonte e versão', async () => {
    const db = seed();
    setFlag(db, 'call_priority_v2', true);
    const r = await fetchNextCallCard({ viewer, now: NOW });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.data.context.leadId).toBe('lead-v2');
    expect(r.data.approach.version).toBe('v2');
    expect(r.data.priority).toMatchObject({ version: 'call_priority_v2.0', sourceLabel: 'resultado da ligação', humanCorrected: false });
    expect(r.data.priority?.reasons.length).toBeGreaterThan(0);
    // Abordagem v0 preservada: o v2 só acrescenta pontos.
    expect(r.data.approach.headline).toBeTruthy();
  });

  it('ligada: grava a sugestão na trilha com versão e fonte, e recarregar não duplica', async () => {
    const db = seed();
    setFlag(db, 'call_priority_v2', true);
    await pick();
    await pick();
    await Promise.resolve();
    expect(db.tables.decision_events).toHaveLength(1);
    expect(db.tables.decision_events![0]).toMatchObject({
      event_type: 'priority_suggestion',
      model_version: 'call_priority_v2.0',
      source: 'call_outcome_sdr',
      lead_id: 'lead-v2',
      org_id: 'org-1',
    });
    expect((db.tables.decision_events![0]!.payload as Row).v1_pick_same).toBe(false);
  });

  it('reversível: desligar a flag devolve exatamente a ordem anterior', async () => {
    const db = seed();
    const before = await pick();
    setFlag(db, 'call_priority_v2', true);
    expect((await pick()).leadId).toBe('lead-v2');
    setFlag(db, 'call_priority_v2', false);
    expect(await pick()).toEqual(before);
  });

  it('falha ao ler sinais: mantém a escolha de antes em vez de decidir com dado parcial', async () => {
    const db = seed();
    setFlag(db, 'call_priority_v2', true);
    db.failReads.add('decision_events');
    expect(await pick()).toEqual({ leadId: 'lead-v1', version: 'v0', priority: false });
  });

  it('correção humana vigente prevalece e aparece na sugestão', async () => {
    const db = seed();
    setFlag(db, 'call_priority_v2', true);
    db.tables.decision_events!.push({
      org_id: 'org-1',
      lead_id: 'lead-v2',
      event_type: 'human_correction',
      idempotency_key: 'correction:lead-v2:r1',
      actor_user_id: 'u1',
      payload: { interest_set: 0 },
      created_at: '2026-11-07T09:00:00Z',
    });
    expect((await pick()).leadId).toBe('lead-v1');
  });

  it('isolamento: sinais de outra organização não mudam a escolha', async () => {
    const db = seed();
    setFlag(db, 'call_priority_v2', true);
    db.tables.interactions!.push({ id: 'ix', org_id: 'org-2', lead_id: 'lead-v1', channel: 'email', type: 'replied', created_at: '2026-11-07T08:00:00Z' });
    db.tables.decision_events!.push({
      org_id: 'org-2',
      lead_id: 'lead-v1',
      event_type: 'human_correction',
      idempotency_key: 'correction:lead-v1:z',
      actor_user_id: 'u9',
      payload: { interest_set: 100 },
      created_at: '2026-11-07T09:00:00Z',
    });
    expect((await pick()).leadId).toBe('lead-v2');
  });
});
