import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AutoDialAnsweredBlock, AutoDialUnknownResultBlock } from './AutoDialAnsweredActions';
import type { MotorLeadActions } from './use-motor-lead-actions';

const actions = { schedule: vi.fn(), callback: vi.fn(), refer: vi.fn(), disqualify: vi.fn(), callbackBusy: false, dialogs: null } as unknown as MotorLeadActions;

describe('botão "Ligar de novo"', () => {
  it.each([
    ['o lead conversou', AutoDialAnsweredBlock],
    ['resultado desconhecido', AutoDialUnknownResultBlock],
  ])('aparece no bloco "%s", chama a religação e mostra o aviso', (_name, Block) => {
    const onRedial = vi.fn();
    render(<Block isLost={false} actions={actions} onRedial={onRedial} redialMessage="A religação não foi atendida." />);
    fireEvent.click(screen.getByTestId('dialer-redial'));
    expect(onRedial).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dialer-redial-message').textContent).toBe('A religação não foi atendida.');
  });

  it('sem o motor oferecer a religação, não há botão', () => {
    render(<AutoDialAnsweredBlock isLost={false} actions={actions} />);
    expect(screen.queryByTestId('dialer-redial')).toBeNull();
  });
});
