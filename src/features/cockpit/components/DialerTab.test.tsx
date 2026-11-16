import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCockpitAutoDial, type UseCockpitAutoDialResult } from '../hooks/use-cockpit-auto-dial';
import type { NextCallCardData } from '../types';
import { suggestApproach } from '../utils/call-approach';
import type { CockpitAutoDialState } from '../utils/cockpit-auto-dial-machine';

import { DialerTab } from './DialerTab';

const hook = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('../hooks/use-cockpit-auto-dial', () => ({ useCockpitAutoDial: vi.fn(() => hook.result) }));
vi.mock('@/features/integrations/webphone/webphone-client', () => ({ hangupCall: vi.fn(async () => undefined) }));
vi.mock('./use-lead-history', () => ({ useLeadHistory: () => ({ entries: [], status: 'ready' }) }));
vi.mock('@/features/leads/components/MarkLeadLostDialog', () => ({ MarkLeadLostDialog: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock('../actions/call-outcome', () => ({
  armCockpitCallOutcomeAction: vi.fn(),
  getCockpitCallOutcome: vi.fn(async () => ({ success: true, data: { status: 'ok', outcome: { state: 'waiting_call' } } })),
}));
vi.mock('../actions/verbal-consent', () => ({
  getVerbalConsentStateAction: vi.fn(async () => ({ success: true, data: { state: 'disabled' } })),
  recordVerbalConsentAction: vi.fn(),
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
const AUTO = { enabled: true, live: false };

function setEngine(state: CockpitAutoDialState, extra: Partial<UseCockpitAutoDialResult> = {}) {
  const result: UseCockpitAutoDialResult = {
    state,
    statusText: null,
    card: null,
    tier: null,
    simulated: true,
    callId: null,
    attemptNo: null,
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    confirmOutcome: vi.fn(async () => true),
    ...extra,
  };
  hook.result = result;
  return result;
}

describe('aba Discador', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('tela limpa: título, fila, barra do motor e estado curto; sem cartão cheio e sem "Ligar agora"', () => {
    setEngine({ phase: 'off' });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.getByRole('heading', { name: 'Discador' })).toBeTruthy();
    expect(screen.getByTestId('dialer-queue')).toBeTruthy();
    expect(screen.getByTestId('auto-dial-bar')).toBeTruthy();
    expect(screen.getByTestId('auto-dial-simulated')).toBeTruthy();
    expect(screen.getByTestId('auto-dial-clean-state').textContent).toContain('Motor desligado');
    expect(screen.queryByTestId('next-call-card')).toBeNull();
    expect(screen.queryByTestId('why-now')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ligar agora/ })).toBeNull();
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
  });

  it('o motor sempre começa desligado e só inicia no clique em Iniciar', () => {
    const e = setEngine({ phase: 'off' });
    render(<DialerTab autoDial={AUTO} />);
    expect(e.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('auto-dial-start'));
    expect(e.start).toHaveBeenCalledTimes(1);
  });

  it('a fila nasce Normal e é repassada ao hook; trocar para Recuperação muda o `queue`', () => {
    setEngine({ phase: 'off' });
    render(<DialerTab autoDial={AUTO} />);
    expect(vi.mocked(useCockpitAutoDial).mock.calls.at(-1)?.[0]).toMatchObject({ enabled: true, live: false, queue: 'normal' });
    expect(screen.getByTestId('dialer-queue').textContent).toContain('Normal');
    fireEvent.click(screen.getByTestId('dialer-queue'));
    fireEvent.click(screen.getByRole('option', { name: 'Recuperação de perdidos' }));
    expect(vi.mocked(useCockpitAutoDial).mock.calls.at(-1)?.[0]).toMatchObject({ queue: 'recovery' });
  });

  it.each<CockpitAutoDialState>([
    { phase: 'countdown', secondsLeft: 3 },
    { phase: 'in-call' },
    { phase: 'waiting', until: 1 },
    { phase: 'paused', reason: 'user', message: null },
  ])('com o motor ligado a fila fica desabilitada com a dica: %o', (state) => {
    setEngine(state);
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.getByTestId('dialer-queue').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('dialer-queue-hint').textContent).toBe('Pare o motor para trocar de fila.');
  });

  it('desligado: a fila está habilitada e sem a dica', () => {
    setEngine({ phase: 'off' });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.getByTestId('dialer-queue').hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTestId('dialer-queue-hint')).toBeNull();
  });

  it('o painel do lead abre sozinho ao ligar, sem botão de ligar, e a área principal continua limpa', () => {
    setEngine({ phase: 'in-call' }, { card, attemptNo: 1 });
    render(<DialerTab autoDial={AUTO} leadCardEnabled />);
    const panel = screen.getByTestId('motor-lead-panel');
    expect(within(panel).getAllByText('Acme Ltda').length).toBeGreaterThan(0);
    expect(within(panel).queryByRole('button', { name: /ligar|discar|desligar/i })).toBeNull();
    expect(screen.getByTestId('auto-dial-clean-state').textContent).toContain('Acme Ltda');
    expect(screen.queryByTestId('why-now')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ligar agora/ })).toBeNull();
  });

  it('atendeu: a confirmação aparece com o painel aberto', () => {
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.getByTestId('auto-dial-confirm')).toBeTruthy();
    expect(screen.getByTestId('motor-lead-panel')).toBeTruthy();
  });

  it('fecha o painel ao seguir para o próximo lead', () => {
    setEngine({ phase: 'in-call' }, { card });
    const { rerender } = render(<DialerTab autoDial={AUTO} />);
    expect(screen.getByTestId('motor-lead-panel')).toBeTruthy();
    setEngine({ phase: 'countdown', secondsLeft: 5 }, { card });
    rerender(<DialerTab autoDial={AUTO} />);
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
  });

  it('modo real: selo LIGAÇÃO REAL na barra', () => {
    setEngine({ phase: 'off' }, { simulated: false });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    expect(screen.getByTestId('auto-dial-live')).toBeTruthy();
  });
});
