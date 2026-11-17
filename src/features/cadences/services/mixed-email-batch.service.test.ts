import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import type { MixedAutoEmailScope } from './mixed-auto-email.service';
import {
  IN_CHUNK_SIZE,
  MIXED_LIGHT_LIMIT,
  POSTGREST_MAX_ROWS,
  STEP_CHUNK,
  chunkList,
  loadMixedEmailBatch,
  loadStepsByCadence,
  pickMixedBatch,
} from './mixed-email-batch.service';

const V4 = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const OTHER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ALL: MixedAutoEmailScope = { kind: 'all' };
const ONLY_V4: MixedAutoEmailScope = { kind: 'orgs', orgIds: [V4] };

type Step = { cadence_id: string; step_order: number; channel: string };
interface Enr {
  id: string;
  cadence_id: string;
  current_step: number;
  next_step_due: string;
  lead: { org_id: string };
  cadence: { type: string; executor: string | null };
}

function enr(id: string, cadenceId: string, step: number, due: number, org = V4): Enr {
  return {
    id,
    cadence_id: cadenceId,
    current_step: step,
    next_step_due: new Date(1_700_000_000_000 + due * 60_000).toISOString(),
    lead: { org_id: org },
    cadence: { type: 'standard', executor: 'human' },
  };
}

/** Cadência C1: passo 1 = ligação, passo 2 = e-mail, passo 3 = WhatsApp. */
const STEPS: Step[] = [
  { cadence_id: 'C1', step_order: 1, channel: 'phone' },
  { cadence_id: 'C1', step_order: 2, channel: 'email' },
  { cadence_id: 'C1', step_order: 3, channel: 'whatsapp' },
];

interface Call {
  table: string;
  ops: Array<[string, unknown[]]>;
}

function fakeSupabase(data: { enrollments: Enr[]; steps: Step[]; stepsError?: boolean }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'neq', 'not', 'lte', 'order', 'limit', 'in']) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => {
        const inOp = call.ops.find(([op]) => op === 'in');
        const selectOp = call.ops.find(([op]) => op === 'select');
        const selectCols = String(selectOp?.[1][0] ?? '');
        const limitOp = call.ops.find(([op]) => op === 'limit');
        if (table === 'cadence_steps') {
          if (data.stepsError) return resolve({ data: null, error: { message: 'boom' } });
          const ids = (inOp?.[1][1] as string[]) ?? [];
          return resolve({ data: data.steps.filter((s) => ids.includes(s.cadence_id)), error: null });
        }
        if (table === 'cadence_enrollments' && inOp && inOp[1][0] === 'id') {
          const ids = inOp[1][1] as string[];
          // Devolve fora de ordem de propósito: o loader precisa reordenar.
          return resolve({ data: data.enrollments.filter((e) => ids.includes(e.id)).reverse(), error: null });
        }
        if (table === 'cadence_enrollments') {
          const orgFilter = inOp?.[1][0] === 'lead.org_id' ? (inOp[1][1] as string[]) : null;
          const rows = data.enrollments
            .filter((e) => !orgFilter || orgFilter.includes(e.lead.org_id))
            .sort((a, b) => a.next_step_due.localeCompare(b.next_step_due))
            .slice(0, Number(limitOp?.[1][0] ?? 1000))
            .map((e) => (selectCols.includes('lead:leads!inner(*)') ? e : e));
          return resolve({ data: rows, error: null });
        }
        return resolve({ data: [], error: null });
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const FULL = '*, lead:leads!inner(*), cadence:cadences!inner(status)';
const run = (
  data: Parameters<typeof fakeSupabase>[0],
  scope: MixedAutoEmailScope = ALL,
  batchSize = 25,
) => {
  const fake = fakeSupabase(data);
  return loadMixedEmailBatch<Enr>(fake.client, { scope, nowIso: 'now', batchSize, fullSelect: FULL }).then((r) => ({
    ...r,
    calls: fake.calls,
  }));
};

describe('loadMixedEmailBatch', () => {
  it('(1) 30 antigas de ligação não escondem 1 de e-mail mais nova', async () => {
    const phone = Array.from({ length: 30 }, (_, i) => enr(`p${i}`, 'C1', 1, i));
    const email = enr('mail', 'C1', 2, 500);
    const { rows, error } = await run({ enrollments: [...phone, email], steps: STEPS });
    expect(error).toBeNull();
    expect(rows.map((r) => r.id)).toEqual(['mail']);
  });

  it('(2) inscrição sem passo correspondente entra na seleção (para virar completed)', async () => {
    const orphan = enr('orfa', 'C1', 10, 1); // cadência de 3 passos, current_step=10
    const phone = enr('p', 'C1', 1, 2);
    const { rows } = await run({ enrollments: [orphan, phone], steps: STEPS });
    expect(rows.map((r) => r.id)).toEqual(['orfa']);
  });

  it('(4) org fora da flag não entra; flag desligada não consulta nada', async () => {
    const mine = enr('v4', 'C1', 2, 1, V4);
    const foreign = enr('outra', 'C1', 2, 2, OTHER);
    const scoped = await run({ enrollments: [mine, foreign], steps: STEPS }, ONLY_V4);
    expect(scoped.rows.map((r) => r.id)).toEqual(['v4']);
    expect(scoped.calls[0]?.ops).toContainEqual(['in', ['lead.org_id', [V4]]]);

    const off = await run({ enrollments: [mine], steps: STEPS }, { kind: 'none' });
    expect(off.rows).toEqual([]);
    expect(off.calls).toHaveLength(0);
  });

  it('(4b) cadência de outro tipo/executor continua de fora', async () => {
    const ia = { ...enr('ia', 'C1', 2, 1), cadence: { type: 'standard', executor: 'bdr_ai' } };
    const auto = { ...enr('auto', 'C1', 2, 2), cadence: { type: 'auto_email', executor: null } };
    const { rows } = await run({ enrollments: [ia, auto], steps: STEPS });
    expect(rows).toEqual([]);
  });

  it('(5) mais de 25 de e-mail vencidas: respeita BATCH_SIZE e a ordem (mais antigas primeiro)', async () => {
    const emails = Array.from({ length: 40 }, (_, i) => enr(`e${String(i).padStart(2, '0')}`, 'C1', 2, i));
    const { rows } = await run({ enrollments: [...emails].reverse(), steps: STEPS });
    expect(rows).toHaveLength(25);
    expect(rows.map((r) => r.id)).toEqual(emails.slice(0, 25).map((r) => r.id));
  });

  it('(6) lista grande de ids: consultas em blocos, nunca uma URL gigante', async () => {
    const cadenceSteps: Step[] = [];
    const enrollments: Enr[] = [];
    for (let i = 0; i < 350; i++) {
      cadenceSteps.push({ cadence_id: `C${i}`, step_order: 1, channel: 'email' });
      enrollments.push(enr(`e${i}`, `C${i}`, 1, i));
    }
    const { rows, calls } = await run({ enrollments, steps: cadenceSteps }, ALL, 300);
    expect(rows).toHaveLength(300);
    const inSizes = calls.flatMap((c) =>
      c.ops.filter(([op]) => op === 'in').map(([, args]) => (args[1] as string[]).length),
    );
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(IN_CHUNK_SIZE);
    expect(calls.filter((c) => c.table === 'cadence_steps')).toHaveLength(Math.ceil(350 / STEP_CHUNK));
    expect(calls.filter((c) => c.table === 'cadence_enrollments' && c.ops.some(([op, a]) => op === 'in' && a[0] === 'id'))).toHaveLength(3);
    // a busca leve respeita o teto
    expect(calls[0]?.ops).toContainEqual(['limit', [MIXED_LIGHT_LIMIT]]);
  });

  it('erro ao ler os passos: não escolhe nada (nunca conclui por engano)', async () => {
    const orphan = enr('orfa', 'C1', 10, 1);
    const r = await run({ enrollments: [orphan], steps: STEPS, stepsError: true });
    expect(r.rows).toEqual([]);
    expect(r.error).toBe('boom');
  });
});

describe('passos não se perdem no corte do PostgREST', () => {
  it('(b) 40 cadências com 28 passos cada: nenhum passo perdido (blocos <= 30 cadências)', async () => {
    const steps: Step[] = [];
    const enrollments: Enr[] = [];
    for (let c = 0; c < 40; c++) {
      for (let o = 1; o <= 28; o++) steps.push({ cadence_id: `C${c}`, step_order: o, channel: o === 28 ? 'email' : 'phone' });
      enrollments.push(enr(`e${c}`, `C${c}`, 28, c)); // passo 28 = e-mail, o último
    }
    const fake = fakeSupabase({ enrollments, steps });
    // o fake corta como o PostgREST: no máximo 1000 linhas por resposta
    const realFrom = fake.client.from.bind(fake.client);
    (fake.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = realFrom(t) as unknown as { then: (r: (v: { data: unknown[] | null }) => void) => void };
      const orig = b.then;
      b.then = (resolve) => orig((v) => resolve({ ...v, data: v.data ? v.data.slice(0, POSTGREST_MAX_ROWS) : v.data }));
      return b;
    };
    const r = await loadMixedEmailBatch<Enr>(fake.client, { scope: ALL, nowIso: 'now', batchSize: 25, fullSelect: FULL });
    expect(r.error).toBeNull();
    expect(r.rows).toHaveLength(25); // todas as 40 têm o passo 28 de e-mail: nenhuma virou "sem passo"
    expect(r.rows.every((x) => x.current_step === 28)).toBe(true);
  });

  it('bloco de passos exatamente no teto = possivelmente truncado: erro, nada escolhido', async () => {
    const steps: Step[] = Array.from({ length: POSTGREST_MAX_ROWS }, (_, i) => ({ cadence_id: 'C1', step_order: i + 1, channel: 'phone' }));
    const r = await run({ enrollments: [enr('x', 'C1', 2, 1)], steps });
    expect(r.rows).toEqual([]);
    expect(r.error).toMatch(/truncados/);
  });

  it('cadência sem NENHUM passo carregado não é concluída (leitura suspeita)', async () => {
    const r = await run({ enrollments: [enr('x', 'C9', 1, 1)], steps: STEPS });
    expect(r.rows).toEqual([]);
  });
});

describe('loadStepsByCadence (releitura de passos do execute-cadence)', () => {
  it('(a) falha na releitura: devolve erro e mapa vazio — o lote não pode seguir', async () => {
    const fake = fakeSupabase({ enrollments: [], steps: STEPS, stepsError: true });
    const r = await loadStepsByCadence(fake.client, ['C1']);
    expect(r.error).toBe('boom');
    expect(r.steps.size).toBe(0);
  });

  it('bloco no teto de linhas: erro (possível truncamento)', async () => {
    const many: Step[] = Array.from({ length: POSTGREST_MAX_ROWS }, (_, i) => ({ cadence_id: 'C1', step_order: i + 1, channel: 'phone' }));
    const r = await loadStepsByCadence(fakeSupabase({ enrollments: [], steps: many }).client, ['C1']);
    expect(r.error).toMatch(/truncados/);
  });

  it('caminho feliz: monta cadência -> passo, em blocos de STEP_CHUNK', async () => {
    const ids = Array.from({ length: 65 }, (_, i) => `K${i}`);
    const steps: Step[] = ids.map((id) => ({ cadence_id: id, step_order: 1, channel: 'email' }));
    const fake = fakeSupabase({ enrollments: [], steps });
    const r = await loadStepsByCadence<Step>(fake.client, ids);
    expect(r.error).toBeNull();
    expect(r.steps.size).toBe(65);
    expect(r.steps.get('K64')?.get(1)?.channel).toBe('email');
    expect(fake.calls).toHaveLength(Math.ceil(65 / STEP_CHUNK));
  });
});

describe('pickMixedBatch / chunkList', () => {
  it('usa o mesmo critério do passo de e-mail e mantém a ordem', () => {
    const orders = new Map([['C1', { all: new Set([1, 2, 3]), email: new Set([2]) }]]);
    const rows = [enr('a', 'C1', 1, 1), enr('b', 'C1', 2, 2), enr('c', 'C1', 9, 3), enr('d', 'C1', 2, 4)];
    expect(pickMixedBatch(rows, orders, ALL, 2).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('divide em blocos', () => {
    expect(chunkList([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
