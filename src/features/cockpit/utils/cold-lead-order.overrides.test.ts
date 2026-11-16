import { describe, expect, it } from 'vitest';

import { AUTO_DIAL_RPC_OVERRIDES, COLD_ORDER_DEFAULTS, buildCandidatesRpcArgs } from './cold-lead-order';

const viewer = { orgId: 'org-1', targetUserId: 'u1' };
const NOW = new Date('2026-11-13T15:00:00Z');

describe('buildCandidatesRpcArgs com overrides (motor automático)', () => {
  it('sem overrides: saída IDÊNTICA à do Cockpit manual do #641', () => {
    const plain = buildCandidatesRpcArgs(viewer, NOW, ['a']);
    expect(buildCandidatesRpcArgs(viewer, NOW, ['a'], {})).toEqual(plain);
    expect(buildCandidatesRpcArgs(viewer, NOW, ['a'], undefined)).toEqual(plain);
    expect(plain).toMatchObject({ p_daily_cap: COLD_ORDER_DEFAULTS.dailyCap, p_cold_limit: COLD_ORDER_DEFAULTS.coldLimit });
  });

  it('motor: teto 3 por lead e cold_limit 1000, o resto igual', () => {
    const auto = buildCandidatesRpcArgs(viewer, NOW, [], AUTO_DIAL_RPC_OVERRIDES);
    expect(auto).toMatchObject({ p_daily_cap: 3, p_cold_limit: 1000 });
    const { p_daily_cap: _a, p_cold_limit: _b, ...restAuto } = auto;
    const { p_daily_cap: _c, p_cold_limit: _d, ...restPlain } = buildCandidatesRpcArgs(viewer, NOW, []);
    expect(restAuto).toEqual(restPlain);
  });

  it('overrides parciais trocam só o que foi pedido', () => {
    expect(buildCandidatesRpcArgs(viewer, NOW, [], { maxAttempts: 9 })).toMatchObject({ p_max_attempts: 9, p_daily_cap: 2, p_cold_limit: 20 });
  });
});
