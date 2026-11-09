import { describe, expect, it } from 'vitest';

import { collectEligibleInstances, HEALTH_EVALUATION_WORK_LIMIT } from './batch';

describe('lote do cron de saude', () => {
  const row = (org: string, id: string) => ({ org_id: org, id });

  it('orgs desligadas nao ocupam as 100 vagas', () => {
    const off = Array.from({ length: 120 }, (_, i) => row('org-off', `off-${i}`));
    const on = [row('org-on', 'on-1'), row('org-on', 'on-2')];
    const flag = { enabled: false, allow_org_ids: ['org-on'], allow_user_ids: ['user-x'] };
    expect(collectEligibleInstances([...off, ...on], flag)).toEqual(on);
  });

  it('corta em 100 instancias elegiveis e preserva a ordem', () => {
    const rows = Array.from({ length: 150 }, (_, i) => row('org-on', `i-${i}`));
    const picked = collectEligibleInstances(rows, { enabled: true, allow_org_ids: [], allow_user_ids: [] });
    expect(picked).toHaveLength(HEALTH_EVALUATION_WORK_LIMIT);
    expect(picked[0]?.id).toBe('i-0');
    expect(picked[99]?.id).toBe('i-99');
  });

  it('flag global desligada e lista vazia nao escolhe ninguem', () => {
    const rows = [row('org-a', 'a'), row('org-b', 'b')];
    expect(collectEligibleInstances(rows, { enabled: false, allow_org_ids: [], allow_user_ids: [] })).toEqual([]);
  });
});