import { describe, expect, it, vi } from 'vitest';

import {
  type OriginateApi4ComDeps,
  originateApi4ComCallWithRef,
} from './originate-api4com-call.service';

const REF = '6f1c2a3e-1234-4abc-8def-0123456789ab';
const RAMAL_424 = 'API4COM POST /calls failed (424): call from 1001 to +5511999999999 has been failed';

type Op = { table: string; kind: 'insert' | 'update' | 'delete' | 'select'; payload?: Record<string, unknown> };

/** Supabase falso: guarda a linha de `calls`, registra a ordem das operações. */
function fakeSupabase(opts: {
  insertError?: { message: string };
  updateError?: { message: string };
  /** Simula o webhook escrevendo na linha entre o insert e a releitura. */
  onRead?: (row: Record<string, unknown>) => void;
  log: string[];
  rows?: Map<string, Record<string, unknown>>;
}) {
  const ops: Op[] = [];
  const rows = opts.rows ?? new Map<string, Record<string, unknown>>();
  const client = {
    from: (table: string) => {
      let filterId: string | null = null;
      const chain: Record<string, unknown> = {
        insert: (payload: Record<string, unknown>) => {
          ops.push({ table, kind: 'insert', payload });
          opts.log.push(`insert:${table}`);
          if (table === 'calls' && !opts.insertError) rows.set(payload.id as string, { ...payload });
          const res = { data: opts.insertError ? null : { id: payload.id }, error: opts.insertError ?? null };
          const ins: Record<string, unknown> = {
            select: () => ins,
            single: () => Promise.resolve(res),
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          };
          return ins;
        },
        select: () => {
          ops.push({ table, kind: 'select' });
          opts.log.push(`select:${table}`);
          return chain;
        },
        eq: (_col: string, value: string) => {
          filterId = value;
          return chain;
        },
        maybeSingle: () => {
          const row = filterId ? rows.get(filterId) : undefined;
          if (row) opts.onRead?.(row);
          return Promise.resolve({ data: row ? { metadata: row.metadata } : null, error: null });
        },
        update: (payload: Record<string, unknown>) => {
          ops.push({ table, kind: 'update', payload });
          opts.log.push(`update:${table}`);
          const upd: Record<string, unknown> = {
            eq: (_c: string, id: string) => {
              if (!opts.updateError) {
                const row = rows.get(id);
                if (row) rows.set(id, { ...row, ...payload });
              }
              return Promise.resolve({ error: opts.updateError ?? null });
            },
          };
          return upd;
        },
        delete: () => {
          const filters: Record<string, string> = {};
          const op: Op = { table, kind: 'delete', payload: filters };
          ops.push(op);
          opts.log.push(`delete:${table}`);
          const chain = {
            eq: (column: string, value: string) => {
              filters[column] = value;
              return chain;
            },
            then: (resolve: (v: { error: null }) => unknown, reject?: (e: unknown) => unknown) => {
              const id = filters.id;
              if (id) rows.delete(id);
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return chain;
        },
      };
      return chain;
    },
  };
  return { client, ops, rows };
}

function setup(
  opts: {
    originate?: OriginateApi4ComDeps['originate'];
    insertError?: { message: string };
    updateError?: { message: string };
    onRead?: (row: Record<string, unknown>) => void;
  } = {},
) {
  const log: string[] = [];
  const db = fakeSupabase({ ...opts, log });
  const originate = vi.fn(
    opts.originate ??
      (async () => {
        log.push('originate');
        return { data: { id: 'prov-1', message: 'ok' }, ramal: '1001' };
      }),
  );
  const deps: OriginateApi4ComDeps = {
    supabase: db.client as unknown as OriginateApi4ComDeps['supabase'],
    orgId: 'org-1',
    userId: 'user-1',
    getCredentials: vi.fn().mockResolvedValue({ apiKey: 'k', baseUrl: 'https://x', ramal: '1001' }),
    originate,
    randomUUID: () => REF,
    isRamalLegFailure: (m) => /\(424\)/.test(m) && /has been failed/.test(m),
    describeOriginateError: (m) => (/\(424\)/.test(m) ? 'ramal ocupado' : `msg:${m}`),
  };
  return { deps, db, log, originate };
}

const input = { phone: '(11) 99999-9999', leadId: 'lead-1' };

describe('originateApi4ComCallWithRef', () => {
  it('insere a linha antes do POST e envia callRef = calls.id', async () => {
    const { deps, db, log, originate } = setup();

    const result = await originateApi4ComCallWithRef(deps, input);

    expect(result).toEqual({ success: true, data: { callId: REF, api4comId: 'prov-1' } });
    expect(log.indexOf('insert:calls')).toBeLessThan(log.indexOf('originate'));
    expect(originate).toHaveBeenCalledWith(
      'user-1',
      input.phone,
      { gateway: 'flux-org-1', callRef: REF },
      expect.objectContaining({ ramal: '1001' }),
    );

    const inserted = db.ops.find((o) => o.table === 'calls' && o.kind === 'insert')!.payload!;
    expect(inserted).toMatchObject({
      id: REF,
      origin: '1001',
      status: 'not_connected',
      duration_seconds: 0,
      type: 'outbound',
      metadata: { gateway: 'flux-org-1', callRef: REF },
    });
    expect(JSON.stringify(originate.mock.calls[0]![2])).not.toContain('9999');

    expect(db.rows.get(REF)!.metadata).toEqual({ gateway: 'flux-org-1', callRef: REF, api4com_call_id: 'prov-1' });
    const interaction = db.ops.find((o) => o.table === 'interactions')!.payload!;
    expect(interaction.metadata).toMatchObject({ callId: REF, api4com_id: 'prov-1', source: 'internal_api4com' });
  });

  it('424: apaga a linha, não cria interaction e devolve ramal_busy', async () => {
    const { deps, db } = setup({
      originate: async () => {
        throw new Error(RAMAL_424);
      },
    });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await originateApi4ComCallWithRef(deps, input);

    expect(result).toEqual({ success: false, error: 'ramal ocupado', code: 'ramal_busy' });
    // o erro cru traz o número; no log ele vai mascarado
    expect(JSON.stringify(spy.mock.calls)).not.toContain('5511999999999');
    expect(JSON.stringify(spy.mock.calls)).toContain('****9999');
    spy.mockRestore();
    expect(db.rows.has(REF)).toBe(false);
    expect(db.ops.some((o) => o.kind === 'delete' && o.table === 'calls')).toBe(true);
    expect(db.ops.some((o) => o.table === 'interactions')).toBe(false);
  });

  it('424 usa getDeleteClient (service role) e filtra por id, org e user', async () => {
    const { deps, db } = setup({
      originate: async () => {
        throw new Error(RAMAL_424);
      },
    });
    const admin = fakeSupabase({ log: [], rows: db.rows });
    deps.getDeleteClient = () => admin.client as unknown as OriginateApi4ComDeps['supabase'];

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await originateApi4ComCallWithRef(deps, input);
    spy.mockRestore();

    expect(result).toEqual({ success: false, error: 'ramal ocupado', code: 'ramal_busy' });
    expect(db.rows.has(REF)).toBe(false);
    expect(db.ops.some((o) => o.kind === 'delete')).toBe(false);
    const del = admin.ops.find((o) => o.kind === 'delete' && o.table === 'calls');
    expect(del?.payload).toEqual({ id: REF, org_id: 'org-1', user_id: 'user-1' });
  });

  it('timeout: a linha fica com callRef e sem api4com_call_id, e a interaction é registrada', async () => {
    const { deps, db } = setup({
      originate: async () => {
        throw new Error('Não foi possível conectar à API4COM (timeout)');
      },
    });

    const result = await originateApi4ComCallWithRef(deps, input);

    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty('code');
    const row = db.rows.get(REF)!;
    expect(row.metadata).toEqual({ gateway: 'flux-org-1', callRef: REF });
    expect(db.ops.some((o) => o.kind === 'delete')).toBe(false);
    const interaction = db.ops.find((o) => o.table === 'interactions')!.payload!;
    expect(interaction.metadata).toMatchObject({ callId: REF, api4com_id: null });
  });

  it('falha no insert: não chama o POST', async () => {
    const { deps, originate } = setup({ insertError: { message: 'boom' } });

    const result = await originateApi4ComCallWithRef(deps, input);

    expect(result).toEqual({ success: false, error: 'Erro ao registrar chamada' });
    expect(originate).not.toHaveBeenCalled();
  });

  it('sem credencial: não insere nem disca', async () => {
    const { deps, db, originate } = setup();
    deps.getCredentials = vi.fn().mockResolvedValue(null);

    const result = await originateApi4ComCallWithRef(deps, input);

    expect(result.success).toBe(false);
    expect(db.ops).toHaveLength(0);
    expect(originate).not.toHaveBeenCalled();
  });

  it('webhook chegou antes da resposta: o merge não apaga webhook_linked nem mexe em status/duração', async () => {
    const { deps, db } = setup({
      onRead: (row) => {
        row.metadata = { gateway: 'flux-org-1', callRef: REF, api4com_call_id: 'prov-1', webhook_linked: true };
        row.status = 'significant';
        row.duration_seconds = 120;
      },
    });

    await originateApi4ComCallWithRef(deps, input);

    const row = db.rows.get(REF)!;
    expect(row.metadata).toEqual({ gateway: 'flux-org-1', callRef: REF, api4com_call_id: 'prov-1', webhook_linked: true });
    expect(row.status).toBe('significant');
    expect(row.duration_seconds).toBe(120);
    for (const op of db.ops.filter((o) => o.kind === 'update' && o.table === 'calls')) {
      expect(Object.keys(op.payload!)).toEqual(['metadata']);
    }
  });

  it('webhook gravou outro id: o do POST vai para alt_api4com_ids', async () => {
    const { deps, db } = setup({
      onRead: (row) => {
        row.metadata = { gateway: 'flux-org-1', callRef: REF, api4com_call_id: 'chan-9', webhook_linked: true };
      },
    });

    await originateApi4ComCallWithRef(deps, input);

    expect(db.rows.get(REF)!.metadata).toEqual({
      gateway: 'flux-org-1',
      callRef: REF,
      api4com_call_id: 'chan-9',
      alt_api4com_ids: ['prov-1'],
      webhook_linked: true,
    });
  });

  it('falha no update do api4com_call_id ainda devolve sucesso', async () => {
    const { deps } = setup({ updateError: { message: 'db down' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await originateApi4ComCallWithRef(deps, input);

    expect(result).toEqual({ success: true, data: { callId: REF, api4comId: 'prov-1' } });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('99999');
    spy.mockRestore();
  });

  it('extraMetadata não sobrescreve callRef nem gateway', async () => {
    const { deps, originate } = setup();

    await originateApi4ComCallWithRef(deps, {
      ...input,
      extraMetadata: { callRef: 'outro', gateway: 'hack', dialer: 'power' },
    });

    expect(originate.mock.calls[0]![2]).toEqual({ gateway: 'flux-org-1', callRef: REF, dialer: 'power' });
  });
});
