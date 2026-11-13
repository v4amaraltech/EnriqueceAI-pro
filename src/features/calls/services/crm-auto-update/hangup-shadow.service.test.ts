import { afterEach, describe, expect, it, vi } from 'vitest';

import { runHangupCrmShadow, triggerHangupCrmShadow } from './hangup-shadow.service';

type Row = Record<string, unknown>;

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';

/** Banco em memória com o mínimo do builder usado pelo service. Insert no log simula UNIQUE (call_id). */
function fakeDb(seed: Record<string, Row[]>, opts: { uniqueByMessage?: boolean; failLogInsert?: boolean } = {}) {
  const tables: Record<string, Row[]> = { crm_auto_update_shadow_log: [], ...seed };
  const writes: Array<{ table: string; op: string; data: Row }> = [];
  const db = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let mode: 'select' | 'update' | 'insert' | 'delete' = 'select';
      let payload: Row = {};
      const rows = () => tables[table] ?? (tables[table] = []);
      const result = (single = false) => {
        if (mode === 'insert') {
          if (table === 'crm_auto_update_shadow_log' && opts.failLogInsert) {
            return { data: null, error: { code: '23502', message: 'null value in column "qualification_id"' } };
          }
          if (table === 'crm_auto_update_shadow_log' && rows().some((r) => r.call_id === payload.call_id)) {
            return opts.uniqueByMessage
              ? { data: null, error: { message: 'duplicate key value violates unique constraint' } }
              : { data: null, error: { code: '23505', message: 'duplicate' } };
          }
          rows().push({ id: `log-${rows().length + 1}`, ...payload });
          writes.push({ table, op: 'insert', data: payload });
          return { data: null, error: null };
        }
        if (mode !== 'select') {
          writes.push({ table, op: mode, data: payload });
          return { data: [], error: null };
        }
        const hit = rows().filter((r) => filters.every((f) => f(r)));
        return { data: single ? (hit[0] ?? null) : hit, error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (d: Row) => ((mode = 'insert'), (payload = d), b),
        update: (d: Row) => ((mode = 'update'), (payload = d), b),
        delete: () => ((mode = 'delete'), b),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
        is: (k: string, v: null) => (filters.push((r) => (r[k] ?? null) === v), b),
        limit: () => b,
        single: () => Promise.resolve(result(true)),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
      };
      return b;
    },
  };
  return { db: db as never, tables, writes };
}

const SHADOW_ONLY = [
  { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
  { key: 'crm_auto_update_v1_live', enabled: false, allow_org_ids: [], allow_user_ids: [] },
];
const LIVE = [
  { key: 'crm_auto_update_v1', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
  { key: 'crm_auto_update_v1_live', enabled: false, allow_org_ids: [ORG], allow_user_ids: [] },
];

function seed(over: { flags?: Row[]; call?: Partial<Row> } = {}) {
  return {
    app_flags: over.flags ?? SHADOW_ONLY,
    calls: [
      {
        id: 'call-1',
        org_id: ORG,
        lead_id: 'lead-1',
        sdr_disposition: null,
        hangup_cause: 'NUMBER_CHANGED',
        answered_at: null,
        duration_seconds: 0,
        connected: false,
        status: 'no_contact',
        metadata: null,
        ...over.call,
      },
    ],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('runHangupCrmShadow', () => {
  it('org off: não insere nada', async () => {
    const { db, writes } = fakeDb(seed({ flags: [] }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('off');
    expect(writes).toEqual([]);
  });

  it('causa sem sinal claro: unmapped, não insere', async () => {
    const { db, writes } = fakeDb(seed({ call: { hangup_cause: 'ORIGINATOR_CANCEL' } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('unmapped');
    expect(writes).toEqual([]);
  });

  it('ligação inexistente: call_not_found', async () => {
    const { db, writes } = fakeDb(seed());
    expect(await runHangupCrmShadow(db, 'nope')).toBe('call_not_found');
    expect(writes).toEqual([]);
  });

  it('would_apply: grava só no log, shadow, sem qualificação, hangup_v1', async () => {
    const { db, writes, tables } = fakeDb(seed());
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual(['insert:crm_auto_update_shadow_log']);
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      call_id: 'call-1',
      org_id: ORG,
      lead_id: 'lead-1',
      qualification_id: null,
      qualification_completed_at: null,
      mode: 'shadow',
      applied: false,
      applied_at: null,
      verdict: 'would_apply',
      skip_reason: null,
      rules_version: 'hangup_v1',
      proposed_changes: { disposition: 'no_answer', next_activity: { type: 'retry', channel: 'phone' }, lead_status: null },
      input_snapshot: {
        source: 'hangup_deterministic',
        hangup_cause: 'NUMBER_CHANGED',
        answered_at: null,
        duration_seconds: 0,
        connected: false,
        status: 'no_contact',
        sdr_disposition: null,
        outcome: 'no_answer',
        confidence: 1,
        legacy_ai_outcome_applied: false,
      },
    });
  });

  it('org em live: o log continua shadow e applied = false, nenhum update em calls', async () => {
    const { db, writes, tables } = fakeDb(seed({ flags: LIVE }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(writes.every((w) => w.op === 'insert' && w.table === 'crm_auto_update_shadow_log')).toBe(true);
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({ mode: 'shadow', applied: false, applied_at: null });
    expect(tables.calls?.[0]).toMatchObject({ sdr_disposition: null, metadata: null });
  });

  it('SDR já registrou: skip already_dispositioned com proposta', async () => {
    const { db, tables } = fakeDb(seed({ call: { sdr_disposition: 'no_answer' } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      proposed_changes: { disposition: 'no_answer' },
      input_snapshot: { sdr_disposition: 'no_answer' },
    });
  });

  it('desfecho do fluxo antigo da IA: already_dispositioned', async () => {
    const metadata = { ai_outcome: { status: 'done', disposition: 'voicemail', applied: true } };
    const { db, tables } = fakeDb(seed({ call: { metadata } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'already_dispositioned',
      input_snapshot: { legacy_ai_outcome_applied: true },
    });
  });

  it('sem lead: skip no_lead com proposta', async () => {
    const { db, tables } = fakeDb(seed({ call: { lead_id: null, hangup_cause: 'UNALLOCATED_NUMBER' } }));
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('logged');
    expect(tables.crm_auto_update_shadow_log?.[0]).toMatchObject({
      verdict: 'skip',
      skip_reason: 'no_lead',
      proposed_changes: { disposition: 'technical_failure', next_activity: { type: 'none', channel: null } },
    });
  });

  it('linha única já existe: already_logged, sem update', async () => {
    const { db, writes } = fakeDb(seed());
    await runHangupCrmShadow(db, 'call-1');
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('already_logged');
    expect(writes.filter((w) => w.op !== 'insert')).toEqual([]);
    expect(writes).toHaveLength(1);
  });

  it('unique reconhecida pela mensagem também vira already_logged', async () => {
    const { db } = fakeDb(seed(), { uniqueByMessage: true });
    await runHangupCrmShadow(db, 'call-1');
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('already_logged');
  });

  it('outro erro no INSERT (ex.: migration não aplicada): log_failed, sem lançar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, writes } = fakeDb(seed(), { failLogInsert: true });
    expect(await runHangupCrmShadow(db, 'call-1')).toBe('log_failed');
    expect(writes).toEqual([]);
  });
});

describe('triggerHangupCrmShadow', () => {
  it('não lança quando o service rejeita', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      from: () => {
        throw new Error('db down');
      },
    } as never;
    expect(() => triggerHangupCrmShadow(db, 'call-1')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalled();
  });

  it('não lança quando a Promise rejeita depois', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = { from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.reject(new Error('timeout')) }) }) }) } as never;
    expect(() => triggerHangupCrmShadow(db, 'call-1')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalledWith(expect.stringContaining('timeout'));
  });
});
