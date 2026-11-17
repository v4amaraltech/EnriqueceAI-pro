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
vi.mock('@/features/leads/components/MarkLeadLostDialog', () => ({
  MarkLeadLostDialog: ({ open, onSuccess }: { open: boolean; onSuccess: () => void }) =>
    open ? <button type="button" data-testid="lost-dialog" onClick={onSuccess} /> : null,
}));
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
    expect(screen.getByTestId('auto-dial-clean-state').textContent).toContain('Discagem desligada');
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
    expect(screen.getByTestId('dialer-queue-hint').textContent).toBe('Pare a discagem para trocar de fila.');
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
    expect(within(panel).queryByRole('button', { name: /^(?!ligar depois)(.*)(ligar|discar|desligar)/i })).toBeNull();
    expect(screen.getByTestId('auto-dial-clean-state').textContent).toContain('Acme Ltda');
    expect(screen.queryByTestId('why-now')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ligar agora/ })).toBeNull();
  });

  it('atendeu: as 3 ações aparecem (e não o select) com o painel aberto', () => {
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.getByTestId('dialer-answered')).toBeTruthy();
    expect(screen.queryByTestId('auto-dial-confirm')).toBeNull();
    expect(screen.queryByTestId('auto-dial-disposition')).toBeNull();
    expect(screen.queryByTestId('auto-dial-confirm-button')).toBeNull();
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

  it('awaiting-sdr: confirmação do desfecho e painel são colunas irmãs, sem Portal/overlay nem gaveta', () => {
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card });
    render(<DialerTab autoDial={AUTO} />);
    const tab = screen.getByTestId('dialer-tab');
    const main = screen.getByTestId('dialer-main-column');
    const panel = screen.getByTestId('motor-lead-panel');
    // Duas colunas em lg+ e o painel é filho direto do grid, ao lado da coluna principal.
    expect(tab.className).toContain('lg:grid-cols-');
    expect(panel.parentElement).toBe(tab);
    expect(main.parentElement).toBe(tab);
    expect(within(main).getByTestId('dialer-answered')).toBeTruthy();
    expect(within(panel).queryByTestId('dialer-answered')).toBeNull();
    // Sem gaveta: nada de posição fixa, diálogo Radix ou portal.
    expect(panel.className).not.toContain('fixed');
    expect(panel.className).toContain('lg:sticky');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(panel.closest('[data-radix-portal]')).toBeNull();
    expect(document.body.querySelector('[data-radix-popper-content-wrapper]')).toBeNull();
  });

  it('fechar o painel remove a coluna e mostra "Ver dados do lead"; reabrir devolve a coluna', () => {
    setEngine({ phase: 'in-call' }, { card });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.getByTestId('dialer-tab').getAttribute('data-panel-open')).toBe('true');
    expect(screen.queryByTestId('motor-panel-reopen')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel do lead' }));
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
    expect(screen.getByTestId('dialer-tab').getAttribute('data-panel-open')).toBe('false');
    expect(screen.getByTestId('dialer-tab').className).not.toContain('lg:grid-cols-');
    fireEvent.click(screen.getByTestId('motor-panel-reopen'));
    expect(screen.getByTestId('motor-lead-panel')).toBeTruthy();
    expect(screen.getByTestId('dialer-tab').getAttribute('data-panel-open')).toBe('true');
  });

  it('o bloco das 3 ações só existe em awaiting-sdr (nem título, nem botões, nem link nas outras fases)', () => {
    setEngine({ phase: 'in-call' }, { card });
    const { rerender } = render(<DialerTab autoDial={AUTO} />);
    for (const phase of ['dialing', 'in-call', 'resolving']) {
      setEngine({ phase } as CockpitAutoDialState, { card });
      rerender(<DialerTab autoDial={AUTO} />);
      expect(screen.queryByTestId('dialer-answered')).toBeNull();
      expect(screen.queryByText(/O lead conversou/)).toBeNull();
      expect(screen.queryByTestId('dialer-answered-not-conversation')).toBeNull();
    }
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card, notConversation: vi.fn() } as Partial<UseCockpitAutoDialResult>);
    rerender(<DialerTab autoDial={AUTO} />);
    for (const id of ['schedule', 'callback', 'disqualify', 'not-conversation']) {
      expect((screen.getByTestId(`dialer-answered-${id}`) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('N1: desqualificar pelo painel conclui o lead no motor (concludeExternally), que segue sem o Confirmar', () => {
    const concludeExternally = vi.fn();
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card, simulated: false, concludeExternally });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    fireEvent.click(screen.getByTestId('dialer-answered-disqualify'));
    fireEvent.click(screen.getByTestId('lost-dialog'));
    expect(concludeExternally).toHaveBeenCalledWith('lead-1', 'lost');
  });

  it('D5: no simulado, Desqualificar não abre o diálogo nem conclui o lead', () => {
    const concludeExternally = vi.fn();
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card, simulated: true, concludeExternally });
    render(<DialerTab autoDial={AUTO} />);
    fireEvent.click(screen.getByTestId('dialer-answered-disqualify'));
    expect(screen.queryByTestId('lost-dialog')).toBeNull();
    expect(concludeExternally).not.toHaveBeenCalled();
  });

  it('D5: no simulado, Agendar reunião só avisa (sem diálogo de agenda) e não conclui o lead', async () => {
    const { toast } = await import('sonner');
    const concludeExternally = vi.fn();
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card, simulated: true, concludeExternally });
    render(<DialerTab autoDial={AUTO} />);
    fireEvent.click(screen.getByTestId('dialer-answered-schedule'));
    expect(toast.message).toHaveBeenCalledWith('Simulado: nada é registrado.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(concludeExternally).not.toHaveBeenCalled();
  });

  it('fixture /demo (previewOnly): Desqualificar mostra o aviso de fixture, sem diálogo', async () => {
    const { toast } = await import('sonner');
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card, simulated: true });
    render(<DialerTab autoDial={AUTO} previewOnly />);
    fireEvent.click(screen.getByTestId('dialer-answered-disqualify'));
    expect(toast.message).toHaveBeenCalledWith('Fixture de teste: nada é registrado.');
    expect(screen.queryByTestId('lost-dialog')).toBeNull();
  });

  it('awaiting-sdr: Ligar depois e Não foi conversa ligados ao motor; lead perdido sem Desqualificar', () => {
    const notConversation = vi.fn();
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card, notConversation } as Partial<UseCockpitAutoDialResult>);
    const { unmount } = render(<DialerTab autoDial={AUTO} />);
    fireEvent.click(screen.getByTestId('dialer-answered-callback'));
    expect(screen.getByTestId('motor-callback-dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByTestId('dialer-answered-not-conversation'));
    expect(notConversation).toHaveBeenCalledTimes(1);
    unmount();
    const lost = { ...card, context: { ...context, company: { ...context.company, status: 'unqualified' } } };
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card: lost });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.queryByTestId('dialer-answered-disqualify')).toBeNull();
    expect(screen.getByTestId('dialer-answered-schedule')).toBeTruthy();
  });

  it('modo real: selo LIGAÇÃO REAL na barra', () => {
    setEngine({ phase: 'off' }, { simulated: false });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    expect(screen.getByTestId('auto-dial-live')).toBeTruthy();
  });
});
