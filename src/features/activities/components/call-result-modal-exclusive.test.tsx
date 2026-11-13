import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CallResultModal } from './CallResultModal';
import { resetCallResultModalExclusive, resultModalScore } from './call-result-modal-exclusive';

afterEach(() => {
  cleanup();
  resetCallResultModalExclusive();
});

function modal(
  testId: string,
  opts: { alreadyFilled?: boolean; connected?: boolean; duration?: number },
) {
  return (
    <CallResultModal
      open
      onClose={() => undefined}
      leadName="Mercante Net"
      phoneLabel="11954958486"
      durationSeconds={opts.duration ?? 0}
      connected={opts.connected ?? false}
      onConclude={() => undefined}
      suggestion={
        opts.alreadyFilled
          ? {
              outcome: 'no_answer',
              nextActivity: null,
              reason: null,
              source: 'auto_filled',
              alreadyFilled: true,
              alreadyFilledDisposition: 'no_answer',
              meetingPrefill: null,
            }
          : null
      }
    />
  );
}

describe('resultModalScore', () => {
  it('o desfecho já gravado no servidor ganha do sinal da perna do ramal', () => {
    expect(resultModalScore({ alreadyFilled: true })).toBeGreaterThan(
      resultModalScore({ leadAnswerKnown: false }),
    );
  });
});

describe('um único Resultado da Ligação', () => {
  it('no mesmo hangup, fica só o modal com o desfecho do sistema, não o de 00:06 atendida', async () => {
    render(
      <>
        {modal('sip', { connected: true, duration: 6 })}
        {modal('server', { alreadyFilled: true, connected: false, duration: 0 })}
      </>,
    );

    await waitFor(() => {
      expect(
        screen.getByText('O sistema já registrou: Não atendeu. Você pode alterar ou só continuar.'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Não atendida')).toBeInTheDocument();
    expect(screen.queryByText('Atendida · pode ser caixa postal')).not.toBeInTheDocument();
    expect(screen.getAllByText('Resultado da Ligação')).toHaveLength(1);
  });
});
