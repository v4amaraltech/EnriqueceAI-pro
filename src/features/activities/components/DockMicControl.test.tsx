import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toggleMute = vi.hoisted(() => vi.fn());
vi.mock('@/features/integrations/webphone/webphone-client', () => ({
  toggleMute,
}));

import { DockMicControl } from './DockMicControl';

describe('DockMicControl', () => {
  beforeEach(() => {
    toggleMute.mockClear();
  });

  it('fora de chamada é só o indicador de prontidão e não chama o mute', () => {
    render(<DockMicControl webphoneReady sipCall={null} dockInCall={false} />);
    expect(screen.getByLabelText('Microfone pronto')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.click(screen.getByTestId('dock-mic-status'));
    expect(toggleMute).not.toHaveBeenCalled();
  });

  it('com o microfone da aba recusado mostra indisponível e continua sem ação', () => {
    render(<DockMicControl webphoneReady={false} sipCall={null} dockInCall={false} />);
    expect(screen.getByLabelText('Microfone indisponível')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('na sessão ativa silencia o áudio de saída e reflete o estado', () => {
    const { rerender } = render(
      <DockMicControl webphoneReady sipCall={{ phase: 'in-call', muted: false }} dockInCall />,
    );
    const open = screen.getByRole('button', { name: 'Silenciar microfone' });
    expect(open.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(open);
    expect(toggleMute).toHaveBeenCalledTimes(1);

    rerender(<DockMicControl webphoneReady sipCall={{ phase: 'in-call', muted: true }} dockInCall />);
    const muted = screen.getByRole('button', { name: 'Reativar microfone' });
    expect(muted.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(muted);
    expect(toggleMute).toHaveBeenCalledTimes(2);
  });

  it('com o dock ainda em chamada mas a sessão SIP já encerrada não finge mute', () => {
    render(
      <DockMicControl webphoneReady sipCall={{ phase: 'ended', muted: false }} dockInCall />,
    );
    const button = screen.getByRole('button', { name: 'Silenciar microfone indisponível' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(toggleMute).not.toHaveBeenCalled();
  });

  it('enquanto a sessão ainda está chamando o botão não manda mute', () => {
    render(
      <DockMicControl webphoneReady sipCall={{ phase: 'ringing', muted: false }} dockInCall />,
    );
    fireEvent.click(screen.getByTestId('dock-mic-unavailable'));
    expect(toggleMute).not.toHaveBeenCalled();
  });
});
