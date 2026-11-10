import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloserCalendarCard } from './status';

const refresh = vi.fn();
const inviteCloserCalendar = vi.fn();
const revokeCloserCalendarInvite = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({
  inviteCloserCalendar: (...args: unknown[]) => inviteCloserCalendar(...args),
  revokeCloserCalendarInvite: (...args: unknown[]) => revokeCloserCalendarInvite(...args),
}));

import { toast } from 'sonner';

import { CloserCalendarControls } from './CloserCalendarControls';

const CLOSER = '11111111-1111-4111-8111-111111111111';

function card(overrides: Partial<CloserCalendarCard> = {}): CloserCalendarCard {
  return {
    status: 'none',
    label: 'Agenda não conectada',
    warning: null,
    calendarEmail: null,
    ...overrides,
  };
}

describe('CloserCalendarControls', () => {
  beforeEach(() => {
    refresh.mockReset();
    inviteCloserCalendar.mockReset();
    revokeCloserCalendarInvite.mockReset();
  });

  it('shows an amber badge and a bordered invite button when nothing is connected', () => {
    render(<CloserCalendarControls closerId={CLOSER} />);
    expect(screen.getByText('Agenda não conectada').className).toContain('text-amber-950');
    const button = screen.getByRole('button', { name: 'Convidar para conectar agenda' });
    expect(button.className).toContain('border-border');
    expect(button.className).toContain('text-foreground');
    expect(button.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revogar convite' })).toBeNull();
  });

  it('labels a pending invite as sent and offers resend plus revoke', () => {
    render(<CloserCalendarControls closerId={CLOSER} card={card({ status: 'pending', label: 'Convite pendente' })} />);
    expect(screen.getByText('Convite enviado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reenviar convite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revogar convite' }).className).toContain('dark:text-red-300');
  });

  it('shows a connected badge and the calendar email, without a disconnect action', () => {
    render(
      <CloserCalendarControls
        closerId={CLOSER}
        card={card({ status: 'connected', label: 'Conectado', calendarEmail: 'ana@example.com' })}
      />,
    );
    expect(screen.getByText('Agenda conectada').className).toContain('text-emerald-950');
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /convite|Desconectar/ })).toBeNull();
  });

  it('keeps the invite action when the connection dropped', () => {
    render(
      <CloserCalendarControls
        closerId={CLOSER}
        card={card({ status: 'error', label: 'Desconectado', warning: 'A conexão com o Google caiu. Reenvie o convite.' })}
      />,
    );
    expect(screen.getByText('Desconectado')).toBeInTheDocument();
    expect(screen.getByText(/A conexão com o Google caiu/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Convidar para conectar agenda' })).toBeInTheDocument();
  });

  it('shows a loading label and blocks a second click while the invite is sending', async () => {
    let finish: (value: { success: true; data: { sent: true } }) => void = () => {};
    inviteCloserCalendar.mockImplementation(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<CloserCalendarControls closerId={CLOSER} />);

    await user.click(screen.getByRole('button', { name: 'Convidar para conectar agenda' }));

    const sending = await screen.findByRole('button', { name: 'Enviando convite' });
    expect(sending).toBeDisabled();
    expect(sending).toHaveAttribute('aria-busy', 'true');

    finish({ success: true, data: { sent: true } });
    expect(await screen.findByRole('button', { name: 'Convidar para conectar agenda' })).toBeEnabled();
    expect(toast.success).toHaveBeenCalledWith('Convite enviado');
    expect(refresh).toHaveBeenCalled();
  });
});
