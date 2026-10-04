import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  results: {} as Record<string, unknown>,
  calls: [] as Array<{ table: string; filters: string[] }>,
}));

function chain(table: string) {
  const call = { table, filters: [] as string[] };
  state.calls.push(call);
  const c: Record<string, unknown> = {};
  const pass = (name: string) => (...args: unknown[]) => {
    call.filters.push(`${name}:${String(args[0])}`);
    return c;
  };
  for (const f of ['select', 'eq', 'in', 'filter', 'order', 'limit']) c[f] = pass(f);
  c.then = (resolve: (v: unknown) => unknown) => {
    const isLifecycle = table === 'interactions' && call.filters.some((f) => f.startsWith('filter:metadata->>system_event'));
    const key = table === 'interactions' ? (isLifecycle ? 'interactions:lifecycle' : 'interactions:recent') : table;
    return Promise.resolve(state.results[key] ?? { data: [], error: null }).then(resolve);
  };
  return c;
}

vi.mock('@/lib/auth/get-org-id', () => ({
  getAuthOrgIdResult: vi.fn(() =>
    Promise.resolve({ success: true, data: { orgId: 'org-1', userId: 'u-1', supabase: { from: (t: string) => chain(t) } } }),
  ),
}));
vi.mock('@/lib/supabase/from', () => ({ from: (supabase: { from: (t: string) => unknown }, t: string) => supabase.from(t) }));
vi.mock('@/lib/auth/user-directory', () => ({
  resolveUserProfiles: vi.fn((ids: string[]) =>
    Promise.resolve(new Map(ids.map((id) => [id, { id, displayName: `Nome ${id}` }]))),
  ),
}));

import { fetchLeadTimeline } from './fetch-interactions';

const ix = (over: Record<string, unknown>) => ({
  id: 'i',
  type: 'sent',
  channel: 'phone',
  message_content: null,
  ai_generated: false,
  created_at: '2026-10-01T12:00:00Z',
  cadence_id: null,
  step_id: null,
  performed_by: null,
  metadata: null,
  ...over,
});

beforeEach(() => {
  state.calls = [];
  state.results = {};
});

describe('fetchLeadTimeline', () => {
  it('junta recentes + ciclo de vida sem duplicar, do mais novo ao mais antigo, e enriquece', async () => {
    state.results['interactions:recent'] = {
      data: [
        ix({ id: 'a', created_at: '2026-10-03T12:00:00Z', cadence_id: 'c1', step_id: 's1', performed_by: 'u1', metadata: { callId: 'call-1' } }),
        ix({ id: 'b', created_at: '2026-10-02T12:00:00Z' }),
      ],
      error: null,
    };
    state.results['interactions:lifecycle'] = {
      data: [
        ix({ id: 'b', created_at: '2026-10-02T12:00:00Z' }), // repetida
        ix({ id: 'old', created_at: '2026-09-01T12:00:00Z', channel: 'system', metadata: { system_event: 'cadence_enrolled' } }),
      ],
      error: null,
    };
    state.results.cadences = { data: [{ id: 'c1', name: 'Prospecção Fria' }] };
    state.results.cadence_steps = { data: [{ id: 's1', step_order: 2, activity_name: 'Ligar', instructions: null }] };
    state.results.calls = { data: [{ id: 'call-1', recording_url: 'https://r/1.mp3', transcription: 'oi', duration_seconds: 90 }] };

    const res = await fetchLeadTimeline('lead-1');

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.map((e) => e.id)).toEqual(['a', 'b', 'old']);
    expect(res.data[0]).toMatchObject({
      cadence_name: 'Prospecção Fria',
      step_order: 2,
      step_activity_name: 'Ligar',
      performed_by_name: 'Nome u1',
      call_id: 'call-1',
      recording_url: 'https://r/1.mp3',
      transcription: 'oi',
      call_duration: 90,
    });
  });

  it('sem cadência/passo/ligação não faz as consultas de enriquecimento', async () => {
    state.results['interactions:recent'] = { data: [ix({ id: 'x' })], error: null };

    const res = await fetchLeadTimeline('lead-1');

    expect(res.success).toBe(true);
    expect(state.calls.map((c) => c.table).sort()).toEqual(['interactions', 'interactions']);
  });

  it('erro na busca das recentes devolve erro tratado', async () => {
    state.results['interactions:recent'] = { data: null, error: { message: 'boom' } };
    const res = await fetchLeadTimeline('lead-1');
    expect(res).toEqual({ success: false, error: 'Erro ao buscar interações' });
  });
});
