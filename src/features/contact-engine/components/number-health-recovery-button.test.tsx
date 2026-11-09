import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NumberHealthRecoveryButton } from './number-health-recovery-button';

vi.mock('@/features/contact-engine/actions/authorize-number-recovery', () => ({
  authorizeNumberRecoveryAction: vi.fn(),
}));

describe('NumberHealthRecoveryButton', () => {
  it('mostra o motivo real da pausa e o efeito em warming', () => {
    render(
      <NumberHealthRecoveryButton
        instanceId="inst-1"
        instanceName="evo-1"
        healthState="paused"
        pauseReason="session_disconnected"
        connectionStatus="connected"
        flagEnabled
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar número' }));
    expect(screen.getByText('session_disconnected')).toBeTruthy();
    expect(screen.getByText(/volta o número para warming/i)).toBeTruthy();
    expect(screen.getByText(/Pausa manual da fila não é liberada/i)).toBeTruthy();
  });

  it('nao inventa motivo quando a instancia nao tem pause_reason', () => {
    render(
      <NumberHealthRecoveryButton
        instanceId="inst-1"
        instanceName="evo-1"
        healthState="review"
        pauseReason={null}
        connectionStatus="connected"
        flagEnabled
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar número' }));
    expect(screen.getByText('não registrado na instância')).toBeTruthy();
  });

  it('fica oculto sem flag, sem pausa ou desconectado', () => {
    const { rerender } = render(
      <NumberHealthRecoveryButton
        instanceId="inst-1"
        instanceName="evo-1"
        healthState="paused"
        pauseReason="session_disconnected"
        connectionStatus="connected"
        flagEnabled={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Recuperar número' })).toBeNull();
    rerender(
      <NumberHealthRecoveryButton
        instanceId="inst-1"
        instanceName="evo-1"
        healthState="healthy"
        pauseReason={null}
        connectionStatus="connected"
        flagEnabled
      />,
    );
    expect(screen.queryByRole('button', { name: 'Recuperar número' })).toBeNull();
  });
});