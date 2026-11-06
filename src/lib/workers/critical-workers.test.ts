import { describe, expect, it } from 'vitest';

import { cadenceEngineExpectedAt, CRITICAL_WORKERS } from './critical-workers';

describe('cadenceEngineExpectedAt', () => {
  it.each([
    ['segunda 09:00 BRT (12:00 UTC)', '2026-10-05T12:00:00Z', true],
    ['sexta 18:00 BRT (21:00 UTC) — logo após a última rodada', '2026-10-09T21:00:00Z', true],
    ['segunda 08:00 BRT (11:00 UTC) — 1ª hora da janela', '2026-10-05T11:00:00Z', false],
    ['segunda 19:00 BRT (22:00 UTC)', '2026-10-05T22:00:00Z', false],
    ['sábado 12:00 BRT', '2026-10-03T15:00:00Z', false],
    ['domingo 12:00 BRT', '2026-10-04T15:00:00Z', false],
  ])('%s → %s', (_label, iso, expected) => {
    expect(cadenceEngineExpectedAt(new Date(iso))).toBe(expected);
  });
});

describe('CRITICAL_WORKERS', () => {
  it('vigia o motor de cadência, a detecção de respostas e a caixa do BDR além da API4COM', () => {
    expect(CRITICAL_WORKERS.map((w) => w.job_name)).toEqual([
      'reconcile-api4com-calls',
      'execute-cadence-steps',
      'check-email-replies',
      'ingest-email-inbox',
    ]);
  });
});
