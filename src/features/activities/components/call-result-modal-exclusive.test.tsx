import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CallResultModal } from './CallResultModal';
import {
  isCallResultResolvedElsewhere,
  markCallResultResolved,
  resetCallResultModalExclusive,
  resultModalScore,
} from './call-result-modal-exclusive';

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
    expect(screen.queryByText('Provável caixa postal')).not.toBeInTheDocument();
    expect(screen.getAllByText('Resultado da Ligação')).toHaveLength(1);
  });
});

describe('um Resultado por ligação (callId)', () => {
  it('depois que um dono resolve a ligação, o outro não reabre e é liberado', () => {
    const dock = Symbol('dock');
    markCallResultResolved('call-1', dock);
    const onClose = vi.fn();
    render(
      <CallResultModal
        open
        callId="call-1"
        onClose={onClose}
        leadName="Mercante Net"
        phoneLabel="11954958486"
        durationSeconds={11}
        connected
        onConclude={() => undefined}
      />,
    );
    expect(screen.queryByText('Mercante Net')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('o mesmo modal que resolveu não se fecha sozinho; outra ligação abre normal', () => {
    const me = Symbol('me');
    markCallResultResolved('call-2', me);
    expect(isCallResultResolvedElsewhere('call-2', me)).toBe(false);
    expect(isCallResultResolvedElsewhere('call-2', Symbol('outro'))).toBe(true);
    expect(isCallResultResolvedElsewhere('call-3', Symbol('outro'))).toBe(false);
    expect(isCallResultResolvedElsewhere(null, Symbol('outro'))).toBe(false);
  });
});
