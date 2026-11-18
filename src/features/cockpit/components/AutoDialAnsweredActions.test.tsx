import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoDialAnsweredActions } from './AutoDialAnsweredActions';

const toastMessage = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { message: toastMessage, success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('./CallMeetingDialogs', () => ({
  CallMeetingWeekDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="week-dialog" /> : null),
  CallMeetingConfirmDialog: () => null,
}));
vi.mock('./MotorCallbackDialog', () => ({
  MotorCallbackDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="callback-dialog" /> : null),
}));
vi.mock('@/features/leads/components/MarkLeadLostDialog', () => ({
  MarkLeadLostDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="lost-dialog" /> : null),
}));

function renderIt(over: Partial<React.ComponentProps<typeof AutoDialAnsweredActions>> = {}) {
  return render(
    <AutoDialAnsweredActions
      leadId="lead-1"
      leadName="Acme"
      leadEmail={null}
      isLost={false}
      simulated={false}
      disabled={false}
      onNotConversation={vi.fn()}
      {...over}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AutoDialAnsweredActions', () => {
  it('mostra as 3 ações com apoio e o link discreto; sem select de desfecho', () => {
    renderIt();
    expect(screen.getByTestId('dialer-answered-schedule')).toHaveTextContent('Agendar reunião');
    expect(screen.getByTestId('dialer-answered-callback')).toHaveTextContent('Ligar depois');
    expect(screen.getByTestId('dialer-answered-disqualify')).toHaveTextContent('Desqualificar lead');
    expect(screen.getByText('Abre a agenda do closer.')).toBeInTheDocument();
    expect(screen.getByText('Marca o próximo contato e pausa a cadência até o retorno.')).toBeInTheDocument();
    expect(screen.getByText('Pede o motivo e marca o lead como perdido.')).toBeInTheDocument();
    expect(screen.getByTestId('dialer-answered-not-conversation')).toHaveTextContent('Não foi conversa');
    expect(screen.queryByTestId('auto-dial-disposition')).toBeNull();
    expect(screen.queryByTestId('auto-dial-confirm-button')).toBeNull();
  });

  it('em fase ao vivo (disabled) tudo fica desabilitado', () => {
    renderIt({ disabled: true });
    for (const id of ['schedule', 'callback', 'disqualify', 'not-conversation']) {
      expect((screen.getByTestId(`dialer-answered-${id}`) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('com status unqualified: o botão vira "Mudar motivo de perda"; qualified: some', () => {
    const { unmount } = renderIt({ status: 'unqualified', isLost: true });
    expect(screen.getByTestId('dialer-answered-disqualify')).toHaveTextContent('Mudar motivo de perda');
    expect(screen.getByText('O lead já está perdido: escolha o novo motivo.')).toBeInTheDocument();
    unmount();
    renderIt({ status: 'qualified' });
    expect(screen.queryByTestId('dialer-answered-disqualify')).toBeNull();
  });

  it('lead perdido: Desqualificar some; Agendar e Ligar depois continuam', () => {
    renderIt({ isLost: true });
    expect(screen.queryByTestId('dialer-answered-disqualify')).toBeNull();
    expect(screen.getByTestId('dialer-answered-schedule')).toBeInTheDocument();
    expect(screen.getByTestId('dialer-answered-callback')).toBeInTheDocument();
  });

  it('cada clique abre o diálogo certo', () => {
    renderIt();
    fireEvent.click(screen.getByTestId('dialer-answered-schedule'));
    expect(screen.getByTestId('week-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('dialer-answered-callback'));
    expect(screen.getByTestId('callback-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('dialer-answered-disqualify'));
    expect(screen.getByTestId('lost-dialog')).toBeInTheDocument();
  });

  it('simulado não grava: Agendar e Desqualificar só avisam', () => {
    renderIt({ simulated: true });
    fireEvent.click(screen.getByTestId('dialer-answered-schedule'));
    fireEvent.click(screen.getByTestId('dialer-answered-disqualify'));
    expect(toastMessage).toHaveBeenCalledWith('Simulado: nada é registrado.');
    expect(screen.queryByTestId('week-dialog')).toBeNull();
    expect(screen.queryByTestId('lost-dialog')).toBeNull();
  });

  it('"Não foi conversa" chama o gancho; sem gancho o link não aparece', () => {
    const onNotConversation = vi.fn();
    const { unmount } = renderIt({ onNotConversation });
    fireEvent.click(screen.getByTestId('dialer-answered-not-conversation'));
    expect(onNotConversation).toHaveBeenCalledTimes(1);
    unmount();
    renderIt({ onNotConversation: undefined });
    expect(screen.queryByTestId('dialer-answered-not-conversation')).toBeNull();
  });
});
