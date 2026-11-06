import { describe, expect, it } from 'vitest';

import { cadenceResumeAfterReturn, formatResumeDate } from './callback-resume';

describe('cadenceResumeAfterReturn', () => {
  it('retoma às 9h BRT do dia útil seguinte ao retorno', () => {
    // ter 20/10 09:00 BRT → qua 21/10 09:00 BRT (caso Épou Store)
    expect(cadenceResumeAfterReturn('2026-10-20T12:00:00.000Z').toISOString()).toBe('2026-10-21T12:00:00.000Z');
  });

  it('retorno na sexta retoma na segunda', () => {
    expect(cadenceResumeAfterReturn('2026-10-23T17:00:00.000Z').toISOString()).toBe('2026-10-26T12:00:00.000Z');
  });

  it('usa o dia em BRT, não em UTC (sex 23h30 BRT já é sáb em UTC)', () => {
    expect(cadenceResumeAfterReturn('2026-10-24T02:30:00.000Z').toISOString()).toBe('2026-10-26T12:00:00.000Z');
  });

  it('retorno no fim de semana retoma na segunda', () => {
    expect(cadenceResumeAfterReturn('2026-10-24T13:00:00.000Z').toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(cadenceResumeAfterReturn('2026-10-25T13:00:00.000Z').toISOString()).toBe('2026-10-26T12:00:00.000Z');
  });

  it('aceita Date', () => {
    expect(cadenceResumeAfterReturn(new Date('2026-10-20T12:00:00.000Z')).toISOString()).toBe('2026-10-21T12:00:00.000Z');
  });
});

describe('formatResumeDate', () => {
  it('formata dd/mm em BRT', () => {
    expect(formatResumeDate('2026-10-21T12:00:00.000Z')).toBe('21/10');
  });
});
