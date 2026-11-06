import { describe, expect, it } from 'vitest';

import { computeEmailAdmission } from './admission';

describe('computeEmailAdmission — só cadências da própria org', () => {
  it('ignora cadence_ids de outra org (passos e inscrições só das próprias)', async () => {
    const calls: Array<{ table: string; filters: string[] }> = [];
    const chain = (table: string) => {
      const call = { table, filters: [] as string[] };
      calls.push(call);
      const c: Record<string, unknown> = {};
      const pass = (name: string) => (col: string, val?: unknown) => {
        call.filters.push(`${name}:${col}=${JSON.stringify(val)}`);
        return c;
      };
      for (const f of ['eq', 'in']) c[f] = pass(f);
      c.select = () => c;
      c.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(table === 'cadences' ? { data: [{ id: 'cad-minha' }] } : { data: [] }).then(resolve);
      return c;
    };

    await computeEmailAdmission({ from: (t: string) => chain(t) } as never, {
      orgId: 'org-1',
      cadenceIds: ['cad-minha', 'cad-de-outra-org'],
    });

    expect(calls.find((c) => c.table === 'cadences')?.filters).toContain('eq:org_id="org-1"');
    for (const t of ['cadence_steps', 'cadence_enrollments']) {
      expect(calls.find((c) => c.table === t)?.filters).toContain('in:cadence_id=["cad-minha"]');
    }
  });
});
