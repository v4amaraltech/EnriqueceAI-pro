import { describe, expect, it } from 'vitest';

import { DISPOSITION_OPTIONS } from '@/features/calls/disposition';

import { dispositionForExternalConclusion } from './external-conclusion';

describe('dispositionForExternalConclusion', () => {
  it.each([
    ['scheduled', true, 'relevant_conversation'],
    ['lost', true, 'answered_no_progress'],
    ['scheduled', false, 'no_answer'],
    ['lost', false, 'no_answer'],
    ['callback', true, 'callback_requested'],
    ['callback', false, 'no_answer'],
  ] as const)('%s, atendida=%s → %s', (kind, answered, expected) => {
    expect(dispositionForExternalConclusion(kind, answered)).toBe(expected);
  });

  it('só usa desfechos que já existem (nenhuma disposição nova)', () => {
    const existing = new Set(DISPOSITION_OPTIONS.map((o) => o.value));
    for (const kind of ['scheduled', 'lost', 'callback'] as const) {
      for (const answered of [true, false]) expect(existing.has(dispositionForExternalConclusion(kind, answered))).toBe(true);
    }
  });
});
