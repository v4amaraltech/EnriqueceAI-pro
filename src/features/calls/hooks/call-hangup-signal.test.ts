import { describe, expect, it } from 'vitest';

import { hangupFromCallRow } from './call-hangup-signal';

const CALL_ID = '7fe4ba31-280e-4fd1-ae07-a7de46f1675b';

describe('hangupFromCallRow', () => {
  it('NUMBER_CHANGED com status not_connected encerra e usa duração 0', () => {
    expect(
      hangupFromCallRow({
        id: CALL_ID,
        status: 'not_connected',
        hangup_cause: 'NUMBER_CHANGED',
        duration_seconds: 0,
      }),
    ).toEqual({ durationSeconds: 0 });
  });

  it('channel-answer (sem causa, status ainda not_connected) não encerra', () => {
    expect(
      hangupFromCallRow({
        id: CALL_ID,
        status: 'not_connected',
        hangup_cause: null,
        duration_seconds: 0,
      }),
    ).toBeNull();
  });

  it('ligação atendida encerra com a duração gravada', () => {
    expect(
      hangupFromCallRow({
        id: CALL_ID,
        status: 'not_significant',
        hangup_cause: 'NORMAL_CLEARING',
        duration_seconds: 24,
      }),
    ).toEqual({ durationSeconds: 24 });
  });

  it('não usa o id do provedor: a causa na linha já basta', () => {
    expect(
      hangupFromCallRow({
        id: CALL_ID,
        status: 'not_connected',
        hangup_cause: 'NO_ANSWER',
        duration_seconds: 0,
      }),
    ).toEqual({ durationSeconds: 0 });
  });

  it('linha vazia ou causa em branco não encerra', () => {
    expect(hangupFromCallRow(null)).toBeNull();
    expect(hangupFromCallRow({ status: 'not_connected', hangup_cause: '   ' })).toBeNull();
  });
});
