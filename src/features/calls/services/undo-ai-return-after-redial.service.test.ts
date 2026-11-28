import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  concludeMotorCallExternally,
  confirmMotorOutcome,
} from '@/features/cockpit/services/cockpit-auto-dial-outcome.service';

import { undoAiReturnAfterRedial } from './undo-ai-return-after-redial.service';

type Row = Record<string, unknown>;
type Db = Record<'calls' | 'scheduled_activities' | 'interactions', Row[]>;

const at = (minute: number) => `2026-11-28T15:${String(minute).padStart(2, '0')}:00.000Z`;
const AI_EVENT = {
  system_event: 'activity_scheduled',
  scheduled_activity_id: 'ret-ia',
  scheduled_by: 'ai_call_outcome',
};

function value(row: Row, column: string): unknown {
  return (
    column.split(/->>?/).reduce<unknown>((v, k) => (v as Row | null | undefined)?.[k], row) ?? null
  );
}

/** Banco em memória com os filtros usados (todos em AND). `failOn` = tabela que devolve erro. */
function fakeClient(db: Db, failOn?: { table: keyof Db; op: 'select' | 'update' }) {
  const from = (table: keyof Db) => {
    const filters: Array<[string, unknown]> = [];
    let patch: Row | null = null;
    let single = false;
    let max = Infinity;
    const run = () => {
      const op = patch ? 'update' : 'select';
      // A leitura da própria religação (por id) segue funcionando: só o desfazer é derrubado.
      if (
        failOn?.table === table &&
        failOn.op === op &&
        !filters.some(([c, v]) => c === 'id' && v === 'b')
      ) {
        return { data: null, error: { message: 'boom' } };
      }
      const rows = db[table]
        .filter((r) => filters.every(([c, v]) => value(r, c) === v))
        .slice(0, max);
      if (patch) rows.forEach((r) => Object.assign(r, patch));
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
      limit: (n: number) => ((max = n), chain),
      contains: () => chain,
      maybeSingle: () => ((single = true), chain),
      single: () => ((single = true), chain),
      update: (p: Row) => ((patch = p), chain),
      insert: (row: Row) => (db[table].push(row), Promise.resolve({ data: null, error: null })),
      then: (resolve: (v: unknown) => unknown) => resolve(run()),
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

function call(id: string, minute: number, redialOf: string | null, over: Row = {}): Row {
  return {
    id,
    org_id: 'org-1',
    lead_id: 'lead-1',
    user_id: 'u1',
    created_at: at(minute),
    started_at: at(minute),
    answered_at: at(minute),
    duration_seconds: 80,
    hangup_cause: 'NORMAL_CLEARING',
    notes: null,
    sdr_disposition: null,
    metadata: {
      cockpit_auto_dial: { attempt_no: 1, ...(redialOf ? { redial_of: redialOf } : {}) },
    },
    ...over,
  };
}

const withAi = (row: Row, activityId = 'ret-ia', status = 'done'): Row => ({
  ...row,
  sdr_disposition: 'callback_requested',
  metadata: {
    ...(row.metadata as Row),
    ai_outcome: { status, disposition: 'callback_requested', scheduled_activity_id: activityId },
  },
});

const activity = (over: Row = {}): Row => ({
  id: 'ret-ia',
  org_id: 'org-1',
  lead_id: 'lead-1',
  status: 'pending',
  channel: 'phone',
  kind: 'return',
  created_at: at(2),
  scheduled_at: '2026-11-30T12:00:00.000Z',
  ...over,
});

const event = (metadata: Row = AI_EVENT): Row => ({
  id: 'ev-1',
  org_id: 'org-1',
  lead_id: 'lead-1',
  metadata,
});

function scene(over: Partial<Db> = {}): Db {
  return {
    calls: [withAi(call('a', 1, null)), call('b', 3, 'a')],
    scheduled_activities: [activity()],
    interactions: [event()],
    ...over,
  };
}

const run = (db: Db, disposition = 'relevant_conversation', client = fakeClient(db)) =>
  undoAiReturnAfterRedial(client, {
    orgId: 'org-1',
    userId: 'u1',
    call: db.calls.find((c) => c.id === 'b') as never,
    disposition,
  });
const status = (db: Db) => db.scheduled_activities[0]!.status;
const undoEvents = (db: Db) =>
  db.interactions.filter(
    (i) =>
      i.message_content ===
      'Retorno da IA de 30/11/2026, 09:00 desfeito: a religação teve conversa',
  );

afterEach(() => vi.restoreAllMocks());

describe('undoAiReturnAfterRedial', () => {
  it.each([
    'relevant_conversation',
    'answered_no_progress',
    'callback_requested',
    'referred_contact',
  ])(
    'conversa (%s): cancela o retorno da IA e registra na timeline uma vez só',
    async (disposition) => {
      const db = scene();
      await run(db, disposition);
      await run(db, disposition);
      expect(status(db)).toBe('cancelled');
      expect(undoEvents(db)).toHaveLength(1);
      expect(undoEvents(db)[0]!.metadata).toMatchObject({
        system_event: 'scheduled_activity_cancelled',
        scheduled_at: '2026-11-30T12:00:00.000Z',
        call_id: 'b',
        origin_call_id: 'a',
      });
    },
  );

  it.each(['no_answer', 'voicemail', 'technical_failure'])(
    'sem conversa (%s): fica',
    async (disposition) => {
      const db = scene();
      await run(db, disposition);
      expect(status(db)).toBe('pending');
    },
  );

  it('ligação que não é religação: fica', async () => {
    const db = scene({ calls: [withAi(call('a', 1, null)), call('b', 3, null)] });
    await run(db);
    expect(status(db)).toBe('pending');
  });

  it('cadeia A<-B1<-B: acha o retorno criado por A, inclusive se o B1 e o próprio B só o mantiveram', async () => {
    const db = scene({
      calls: [withAi(call('a', 1, null)), withAi(call('b1', 3, 'a')), withAi(call('b', 5, 'b1'))],
    });
    await run(db);
    expect(status(db)).toBe('cancelled');
  });

  it('retorno do SDR mantido pela IA (sem o evento da IA): fica', async () => {
    const db = scene({
      interactions: [
        event({ system_event: 'activity_scheduled', scheduled_activity_id: 'ret-ia' }),
      ],
    });
    await run(db);
    expect(status(db)).toBe('pending');
  });

  it('retorno anterior à ligação de origem (IA manteve): fica', async () => {
    const db = scene({ scheduled_activities: [activity({ created_at: at(0) })] });
    await run(db);
    expect(status(db)).toBe('pending');
  });

  it('retorno de ligação de IA fora da cadeia (A só manteve): fica', async () => {
    const db = scene();
    db.calls.push(withAi(call('outra', 0, null)));
    await run(db);
    expect(status(db)).toBe('pending');
  });

  it.each([
    ['o novo retorno que o SDR marcou em B', { id: 'ret-sdr', created_at: at(4) }],
    ['outro lead', { lead_id: 'lead-2' }],
    ['outra org', { org_id: 'org-2' }],
    ['retorno já cancelado', { status: 'cancelled' }],
    ['tarefa "Definir destino"', { kind: 'limbo_followup' }],
  ])('não toca: %s', async (_name, over) => {
    const db = scene({ scheduled_activities: [activity(over)] });
    const before = status(db);
    await run(db, 'callback_requested');
    expect(status(db)).toBe(before);
    expect(undoEvents(db)).toHaveLength(0);
  });

  it('SDR marcou outro desfecho na origem: fica', async () => {
    const db = scene();
    db.calls[0]!.sdr_disposition = 'voicemail';
    await run(db);
    expect(status(db)).toBe('pending');
  });

  it('painel durante a religação grava o mesmo desfecho nas duas: cancela', async () => {
    const db = scene();
    db.calls[0]!.sdr_disposition = 'relevant_conversation';
    await run(db);
    expect(status(db)).toBe('cancelled');
  });

  it('IA da origem ainda processando: nada a desfazer', async () => {
    const db = scene({
      calls: [withAi(call('a', 1, null), 'ret-ia', 'processing'), call('b', 3, 'a')],
    });
    await run(db);
    expect(status(db)).toBe('pending');
  });

  it.each(['calls', 'interactions', 'scheduled_activities'] as const)(
    'falha ao ler %s: não lança e não cancela',
    async (table) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const db = scene();
      await expect(
        run(db, 'relevant_conversation', fakeClient(db, { table, op: 'select' })),
      ).resolves.toBeUndefined();
      expect(status(db)).toBe('pending');
      expect(log).toHaveBeenCalled();
    },
  );
});

describe('desfechos do discador chamam o desfazer', () => {
  const base = { orgId: 'org-1', userId: 'u1', callId: 'b' };

  it('confirmar o desfecho em B', async () => {
    const db = scene();
    await expect(
      confirmMotorOutcome({
        ...base,
        supabase: fakeClient(db),
        disposition: 'relevant_conversation',
      }),
    ).resolves.toEqual({ status: 'confirmed' });
    expect(status(db)).toBe('cancelled');
  });

  it('Agendar reunião pelo painel em B', async () => {
    const db = scene();
    await expect(
      concludeMotorCallExternally({ ...base, supabase: fakeClient(db), kind: 'scheduled' }),
    ).resolves.toMatchObject({ status: 'recorded' });
    expect(status(db)).toBe('cancelled');
  });

  it('religação não atendida: recusada e o retorno fica', async () => {
    const db = scene();
    db.calls[1]!.answered_at = null;
    await expect(
      concludeMotorCallExternally({ ...base, supabase: fakeClient(db), kind: 'scheduled' }),
    ).resolves.toEqual({ status: 'refused' });
    expect(status(db)).toBe('pending');
  });

  it('falha ao cancelar não impede o desfecho do SDR', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = scene();
    const client = fakeClient(db, { table: 'scheduled_activities', op: 'update' });
    await expect(
      confirmMotorOutcome({ ...base, supabase: client, disposition: 'relevant_conversation' }),
    ).resolves.toEqual({ status: 'confirmed' });
    expect(db.calls[1]!.sdr_disposition).toBe('relevant_conversation');
    expect(status(db)).toBe('pending');
  });
});
