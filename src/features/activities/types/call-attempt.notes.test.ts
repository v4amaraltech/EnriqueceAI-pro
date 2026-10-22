import { describe, expect, it } from 'vitest';

import { formatAggregatedNotes, hasWrittenNotes } from './call-attempt';

describe('hasWrittenNotes', () => {
  it('marcações automáticas sem texto do SDR → false', () => {
    expect(hasWrittenNotes(formatAggregatedNotes([{ attemptNumber: 1, phone: '5511999990000', status: '', notes: '', durationSeconds: 0 }]))).toBe(false);
    expect(
      hasWrittenNotes(
        formatAggregatedNotes([
          { attemptNumber: 1, phone: '+55 11 99999-0000', status: '', notes: '', durationSeconds: 0 },
          { attemptNumber: 2, phone: '+55 11 99999-0000', status: '', notes: '', durationSeconds: 0 },
        ]),
      ),
    ).toBe(false);
  });

  it('com texto do SDR → true', () => {
    expect(hasWrittenNotes(formatAggregatedNotes([{ attemptNumber: 1, phone: '5511999990000', status: '', notes: 'retornar amanhã', durationSeconds: 0 }]))).toBe(true);
  });
});
