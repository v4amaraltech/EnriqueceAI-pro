import { describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => ({ logLeadEvent: vi.fn(() => Promise.resolve()) }));
vi.mock('@/features/leads/actions/log-lead-event', () => events);

import { scheduleCallbackActivity } from './schedule-callback.service';

type Op = { table: string; op: string; payload?: Record<string, unknown>; filters: Array<[string, string, unknown]> };

function fakeSupabase(updateResults: Array<Array<{ id: string; cadence_id: string }>>) {
  const ops: Op[] = [];
  let enrollmentUpdates = 0;
  const client = {
    from(table: string) {
      const op: Op = { table, op: 'select', filters: [] };
      const chain: Record<string, unknown> = {};
      const result = () => {
        if (op.op === 'insert') return { data: { id: 'sa-1' }, error: null };
        if (table === 'cadence_enrollments' && op.op === 'update') return { data: updateResults[enrollmentUpdates++] ?? [], error: null };
        return { data: null, error: null };
      };
      for (const m of ['eq', 'neq', 'lt']) {
        chain[m] = (col: string, val: unknown) => {
          op.filters.push([m, col, val]);
          return chain;
        };
      }
      chain.select = () => chain;
      chain.single = () => Promise.resolve(result());
      chain.insert = (payload: Record<string, unknown>) => {
        op.op = 'insert';
        op.payload = payload;
        ops.push(op);
        return chain;
      };
      chain.update = (payload: Record<string, unknown>) => {
        op.op = 'update';
        op.payload = payload;
        ops.push(op);
        return chain;
      };
      chain.then = (r: (v: unknown) => void) => r(result());
      return chain;
    },
  };
  return { client, ops };
}

const input = {
  orgId: 'org',
  leadId: 'lead-1',
  userId: 'u1',
  // sexta 06/11/2026 15:00 BRT → retoma segunda 09/11 9h BRT (12:00Z)
  scheduledAt: '2026-11-06T18:00:00.000Z',
};

describe('scheduleCallbackActivity — pausa a cadência até o retorno', () => {
  it('pausa as inscrições ativas até as 9h do dia útil seguinte ao retorno', async () => {
    events.logLeadEvent.mockClear();
    const { client, ops } = fakeSupabase([[{ id: 'e1', cadence_id: 'c1' }], []]);

    const r = await scheduleCallbackActivity(client as never, input);

    expect(r).toEqual({ id: 'sa-1', cadencePausedUntil: '2026-11-09T12:00:00.000Z' });
    const pause = ops.find((o) => o.table === 'cadence_enrollments' && o.payload?.status === 'paused');
    expect(pause?.payload).toEqual({ status: 'paused', scheduled_start_at: '2026-11-09T12:00:00.000Z' });
    expect(pause?.filters).toContainEqual(['eq', 'status', 'active']);
    expect(events.logLeadEvent).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ event: 'cadence_paused_for_return', leadId: 'lead-1' }),
    );
  });

  it('sem inscrição ativa nem pausada antes: não pausa nada', async () => {
    events.logLeadEvent.mockClear();
    const { client } = fakeSupabase([[], []]);

    const r = await scheduleCallbackActivity(client as never, input);

    expect(r).toEqual({ id: 'sa-1' });
    expect(events.logLeadEvent).not.toHaveBeenCalled();
  });
});
