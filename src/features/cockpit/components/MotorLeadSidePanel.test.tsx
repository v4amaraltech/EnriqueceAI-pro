import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextCallCardData } from '../types';
import { suggestApproach } from '../utils/call-approach';

import { MotorLeadSidePanel } from './MotorLeadSidePanel';

const toastMessage = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { message: toastMessage, success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('./use-lead-history', () => ({ useLeadHistory: () => ({ entries: [], status: 'ready' }) }));
vi.mock('./CallMeetingDialogs', () => ({
  CallMeetingWeekDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="week-dialog" /> : null),
  CallMeetingConfirmDialog: () => null,
}));
vi.mock('./MotorCallbackDialog', () => ({
  MotorCallbackDialog: ({ open, scheduleCallback, attemptsToday, simulated }: { open: boolean; scheduleCallback?: unknown; attemptsToday: number; simulated: boolean }) =>
    open ? <div data-testid="motor-callback-dialog" data-has-fn={String(Boolean(scheduleCallback))} data-attempts={attemptsToday} data-simulated={String(simulated)} /> : null,
}));
vi.mock('@/features/leads/components/MarkLeadLostDialog', () => ({
  MarkLeadLostDialog: ({ open, onSuccess }: { open: boolean; onSuccess: () => void }) =>
    open ? (
      <button type="button" data-testid="lost-dialog" onClick={onSuccess}>
        confirmar perda
      </button>
    ) : null,
}));

const context: NextCallCardData['context'] = {
  leadId: 'lead-1',
  whyNow: { code: 'replied', label: 'Respondeu por email recentemente' },
  company: { name: 'Acme Ltda', cnpj: null, segmento: 'Telecom', porte: null, status: 'contacted' },
  decisionMaker: { name: 'Ana Souza', jobTitle: 'Diretora', email: null, phone: '11999990000', partners: [] },
  signals: [],
  interactions: [],
  interactionsPage: { page: 1, perPage: 5, total: 0, hasMore: false },
  calls: [],
  callsPage: { page: 1, perPage: 5, total: 0, hasMore: false },
  objections: null,
  scores: { fit: null, engagement: null },
  missing: [],
};
const card: NextCallCardData = { context, approach: suggestApproach(context), generatedAt: '2026-11-07T12:00:00Z' };

function renderPanel(over: Partial<React.ComponentProps<typeof MotorLeadSidePanel>> = {}) {
  const onLeadActed = vi.fn();
  render(
    <MotorLeadSidePanel
      card={card}
      attemptNo={1}
      leadCardEnabled={false}
      open
      onOpenChange={vi.fn()}
      statusLine="Em ligação"
      simulated={false}
      actionsDisabled={false}
      onLeadActed={onLeadActed}
      {...over}
    />,
  );
  return { onLeadActed };
}

beforeEach(() => vi.clearAllMocks());

describe('MotorLeadSidePanel: Agendar e Desqualificar', () => {
  it('simulado: Agendar e Desqualificar só avisam, sem abrir diálogo nem concluir o lead (D5)', () => {
    const { onLeadActed } = renderPanel({ simulated: true });
    fireEvent.click(screen.getByTestId('motor-schedule-meeting'));
    fireEvent.click(screen.getByTestId('motor-disqualify'));
    expect(toastMessage).toHaveBeenCalledTimes(2);
    expect(toastMessage).toHaveBeenCalledWith('Simulado: nada é registrado.');
    expect(screen.queryByTestId('week-dialog')).toBeNull();
    expect(screen.queryByTestId('lost-dialog')).toBeNull();
    expect(onLeadActed).not.toHaveBeenCalled();
  });

  it('real: Agendar abre a agenda e Desqualificar abre o diálogo; concluir avisa o motor (N1)', () => {
    const { onLeadActed } = renderPanel({ simulated: false });
    fireEvent.click(screen.getByTestId('motor-schedule-meeting'));
    expect(screen.getByTestId('week-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('motor-disqualify'));
    fireEvent.click(screen.getByTestId('lost-dialog'));
    expect(onLeadActed).toHaveBeenCalledWith('lost');
    expect(toastMessage).not.toHaveBeenCalled();
  });

  it('fixture /demo (previewOnly + simulado): Agendar segue abrindo a agenda de exemplo; Desqualificar só avisa', () => {
    renderPanel({ simulated: true, previewOnly: true });
    fireEvent.click(screen.getByTestId('motor-schedule-meeting'));
    expect(screen.getByTestId('week-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('motor-disqualify'));
    expect(toastMessage).toHaveBeenCalledWith('Fixture de teste: nada é registrado.');
    expect(screen.queryByTestId('lost-dialog')).toBeNull();
  });
});

describe('MotorLeadSidePanel: Ligar depois', () => {
  it('botão presente e desabilitado em fase ao vivo', () => {
    renderPanel({ actionsDisabled: true });
    expect((screen.getByTestId('motor-callback-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('habilitado em awaiting-sdr: abre o diálogo com scheduleCallback e tentativas do lead', () => {
    renderPanel({ scheduleCallback: vi.fn(), attemptsToday: 2 });
    const btn = screen.getByTestId('motor-callback-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    const dialog = screen.getByTestId('motor-callback-dialog');
    expect(dialog.getAttribute('data-has-fn')).toBe('true');
    expect(dialog.getAttribute('data-attempts')).toBe('2');
  });

  it('lead perdido: Desqualificar some, Ligar depois continua', () => {
    const lost: NextCallCardData = { ...card, context: { ...context, company: { ...context.company, status: 'unqualified' } } };
    renderPanel({ card: lost });
    expect(screen.queryByTestId('motor-disqualify')).toBeNull();
    expect(screen.getByTestId('motor-callback-button')).toBeTruthy();
  });

  it('simulado abre o diálogo normalmente (quem não grava é o motor)', () => {
    renderPanel({ simulated: true, scheduleCallback: vi.fn() });
    fireEvent.click(screen.getByTestId('motor-callback-button'));
    expect(screen.getByTestId('motor-callback-dialog').getAttribute('data-simulated')).toBe('true');
    expect(toastMessage).not.toHaveBeenCalled();
  });

  it('fixture previewOnly sem scheduleCallback: abre o diálogo sem erro', () => {
    renderPanel({ previewOnly: true, simulated: true });
    fireEvent.click(screen.getByTestId('motor-callback-button'));
    expect(screen.getByTestId('motor-callback-dialog').getAttribute('data-has-fn')).toBe('false');
  });
});
