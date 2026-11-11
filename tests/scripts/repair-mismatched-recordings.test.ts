import { describe, expect, it } from 'vitest';

import { resolveRepairSinceIso } from '@/features/calls/services/recording-repair.service';

import { parseArgs } from '../../scripts/repair-mismatched-recordings';

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
