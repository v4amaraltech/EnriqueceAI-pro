import { describe, expect, it } from 'vitest';

import { resolveRepairSinceIso } from '@/features/calls/services/recording-repair.service';

import { type RepairState, loadState, parseArgs } from '../../scripts/repair-mismatched-recordings';

describe('parseArgs do script de reparo', () => {
  it('dry-run por padrão, days 90 e sem since', () => {
    const args = parseArgs(['--org', 'o']);
    expect(args).toMatchObject({
      org: 'o',
      apply: false,
      days: 90,
      since: null,
      limit: 25,
      cursor: null,
    });
  });

  it('lê --days, --since, --apply, --limit e --from-cursor', () => {
    const args = parseArgs([
      '--org',
      'o',
      '--apply',
      '--days',
      '30',
      '--since',
      '2026-10-12',
      '--limit',
      '10',
      '--from-cursor',
      'c',
    ]);
    expect(args).toMatchObject({
      apply: true,
      days: 30,
      since: '2026-10-12',
      limit: 10,
      cursor: 'c',
    });
  });

  it('--rate: padrão null (usa env ou 15), aceita 1 a 15', () => {
    expect(parseArgs(['--org', 'o']).rate).toBeNull();
    expect(parseArgs(['--org', 'o', '--rate', '10']).rate).toBe(10);
    expect(() => parseArgs(['--org', 'o', '--rate', '16'])).toThrow(/--rate/);
    expect(() => parseArgs(['--org', 'o', '--rate', '0'])).toThrow(/--rate/);
    expect(() => parseArgs(['--org', 'o', '--rate', 'x'])).toThrow(/--rate/);
  });

  it('lê --state', () => {
    expect(parseArgs(['--org', 'o']).state).toBeNull();
    expect(parseArgs(['--org', 'o', '--state', 'run.json']).state).toBe('run.json');
  });

  it('rejeita --execute', () => {
    expect(() => parseArgs(['--org', 'o', '--execute'])).toThrow(/--apply/);
  });

  it('rejeita --since inválido', () => {
    expect(() => parseArgs(['--org', 'o', '--since', 'ontem'])).toThrow(/--since/);
  });
});

describe('resolveRepairSinceIso', () => {
  const now = Date.parse('2026-11-11T00:00:00Z');

  it('--since prevalece sobre --days', () => {
    expect(resolveRepairSinceIso({ since: '2026-10-12', days: 5 }, now)).toBe(
      '2026-10-12T00:00:00.000Z',
    );
  });

  it('sem since usa days', () => {
    expect(resolveRepairSinceIso({ days: 10 }, now)).toBe('2026-11-01T00:00:00.000Z');
  });

  it('since inválido devolve null', () => {
    expect(resolveRepairSinceIso({ since: 'x' }, now)).toBeNull();
  });
});

describe('loadState (retomada pelo arquivo de estado)', () => {
  const state: RepairState = {
    org: 'o',
    apply: false,
    cursor: 'c-9',
    totals: { would_repair: 2 },
    sources: { recording_url: 1, api4com: 1 },
    updatedAt: '2026-11-11T00:00:00Z',
  };
  const reader = (value: unknown) => () => (value === null ? null : JSON.stringify(value));

  it('sem arquivo: null (começa do início)', () => {
    expect(loadState('x.json', { org: 'o', apply: false }, reader(null))).toBeNull();
  });

  it('retoma cursor e totais', () => {
    expect(loadState('x.json', { org: 'o', apply: false }, reader(state))).toMatchObject({
      cursor: 'c-9',
      totals: { would_repair: 2 },
    });
  });

  it('recusa estado de outra org ou de outro modo (dry-run x apply)', () => {
    expect(() => loadState('x.json', { org: 'p', apply: false }, reader(state))).toThrow(
      /outra rodada/,
    );
    expect(() => loadState('x.json', { org: 'o', apply: true }, reader(state))).toThrow(
      /outra rodada/,
    );
  });

  it('recusa rodada já concluída', () => {
    expect(() =>
      loadState('x.json', { org: 'o', apply: false }, reader({ ...state, finished: true })),
    ).toThrow(/concluída/);
  });
});
