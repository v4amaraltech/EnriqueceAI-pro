import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoDialDayStats } from '../hooks/use-auto-dial-day-stats';
import { useCockpitAutoDial, type UseCockpitAutoDialResult } from '../hooks/use-cockpit-auto-dial';
import type { NextCallCardData } from '../types';
import { suggestApproach } from '../utils/call-approach';
import type { CockpitAutoDialState } from '../utils/cockpit-auto-dial-machine';

import { DialerTab } from './DialerTab';

// jsdom não tem ResizeObserver (usado pelo Checkbox do diálogo).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const hook = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('../hooks/use-cockpit-auto-dial', () => ({ useCockpitAutoDial: vi.fn(() => hook.result) }));
const dayStats = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../hooks/use-auto-dial-day-stats', () => ({ useAutoDialDayStats: vi.fn(() => dayStats.value) }));
vi.mock('@/features/integrations/webphone/webphone-client', () => ({ hangupCall: vi.fn(async () => undefined) }));
vi.mock('./use-lead-history', () => ({ useLeadHistory: () => ({ entries: [], status: 'ready' }) }));
vi.mock('@/features/leads/components/MarkLeadLostDialog', () => ({
  MarkLeadLostDialog: ({ open, onSuccess, title, description }: { open: boolean; onSuccess: () => void; title?: string; description?: string }) =>
    open ? <button type="button" data-testid="lost-dialog" data-title={title ?? ''} data-description={description ?? ''} onClick={onSuccess} /> : null,
}));
vi.mock('@/features/calls/actions/classify-webphone-call', () => ({ classifyWebphoneCall: vi.fn(async () => ({ success: true, data: { callId: 'call-1', notesApplied: true } })) }));
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
    dayStats.value = null;
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('resumo do dia: aparece quando há números e some sem eles', () => {
    setEngine({ phase: 'off' });
    const { unmount } = render(<DialerTab autoDial={AUTO} />);
    expect(screen.queryByTestId('dialer-day-summary')).toBeNull();
    unmount();

    dayStats.value = { callsToday: 12, answeredToday: 3, ratePct: 25, dailyCap: 400, remaining: 388 };
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.getByTestId('dialer-day-calls').textContent).toContain('12');
    expect(screen.getByTestId('dialer-day-remaining').textContent).toContain('388');
  });

  it('resumo do dia: simulado não consulta; ligação real consulta e relê no início e no fim da ligação', () => {
    setEngine({ phase: 'off' });
    const { unmount } = render(<DialerTab autoDial={AUTO} />);
    expect(vi.mocked(useAutoDialDayStats).mock.calls.at(-1)?.[0]).toMatchObject({ enabled: false });
    unmount();

    setEngine({ phase: 'off' }, { simulated: false });
    const { rerender } = render(<DialerTab autoDial={AUTO} />);
    const first = vi.mocked(useAutoDialDayStats).mock.calls.at(-1)?.[0];
    expect(first).toMatchObject({ enabled: true });

    setEngine({ phase: 'dialing', leadId: 'lead-1' } as CockpitAutoDialState, { simulated: false, callId: 'call-9', card });
    rerender(<DialerTab autoDial={AUTO} />);
    const during = vi.mocked(useAutoDialDayStats).mock.calls.at(-1)?.[0];
    expect(during?.refreshKey).not.toBe(first?.refreshKey);

    setEngine({ phase: 'waiting' } as CockpitAutoDialState, { simulated: false, callId: 'call-9' });
    rerender(<DialerTab autoDial={AUTO} />);
    expect(vi.mocked(useAutoDialDayStats).mock.calls.at(-1)?.[0].refreshKey).not.toBe(during?.refreshKey);
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

  it("awaiting-sdr com reason 'timeout': NÃO mostra 'O lead conversou', mostra o bloco neutro; 'Atendeu e conversou' abre as 3 ações", () => {
    const notConversation = vi.fn();
    setEngine({ phase: 'awaiting-sdr', reason: 'timeout' }, { card, notConversation } as Partial<UseCockpitAutoDialResult>);
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.queryByText(/O lead conversou/)).toBeNull();
    expect(screen.queryByTestId('dialer-answered')).toBeNull();
    expect(screen.getByText('Não recebemos o resultado da operadora. O lead atendeu?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('dialer-unknown-not-answered'));
    expect(notConversation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('dialer-unknown-answered'));
    expect(screen.getByTestId('dialer-answered')).toBeTruthy();
    expect(screen.getByTestId('dialer-answered-schedule')).toBeTruthy();
    expect(screen.getByTestId('dialer-answered-callback')).toBeTruthy();
  });

  it("awaiting-sdr com reason 'answered': igual a hoje (O lead conversou, sem bloco neutro)", () => {
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.getByText(/O lead conversou/)).toBeTruthy();
    expect(screen.queryByTestId('dialer-unknown-result')).toBeNull();
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
    expect(screen.getByTestId('dialer-answered-disqualify')).toHaveTextContent('Mudar motivo de perda');
    expect(screen.getByTestId('dialer-answered-schedule')).toBeTruthy();
  });

  it('modo real: selo LIGAÇÃO REAL na barra', () => {
    setEngine({ phase: 'off' }, { simulated: false });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    expect(screen.getByTestId('auto-dial-live')).toBeTruthy();
  });
});

describe('aba Discador: ações do lead sempre visíveis no painel', () => {
  const withStatus = (status: string): NextCallCardData => ({ ...card, context: { ...context, company: { ...context.company, status } } });
  const ids = ['schedule', 'callback', 'disqualify'].map((a) => `motor-action-${a}`);

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it.each<CockpitAutoDialState>([
    { phase: 'dialing' },
    { phase: 'awaiting-session' },
    { phase: 'in-call' },
    { phase: 'resolving' },
    { phase: 'auto-completing', outcome: 'no_answer' },
    { phase: 'awaiting-sdr', reason: 'answered' },
  ])('os 3 botões aparecem no painel na fase %o', (state) => {
    setEngine(state, { card, attemptNo: 1 });
    render(<DialerTab autoDial={AUTO} />);
    const panel = screen.getByTestId('motor-lead-panel');
    for (const id of ids) expect(within(panel).getByTestId(id)).toBeTruthy();
    expect(within(panel).queryByText(/Quem liga é a discagem automática/)).toBeNull();
  });

  it('lead perdido: "Mudar motivo de perda"; qualificado sem ela; ganho e arquivado: nenhum botão', () => {
    for (const [status, expected] of [
      ['unqualified', [true, true, true]],
      ['qualified', [true, true, false]],
      ['won', [false, false, false]],
      ['archived', [false, false, false]],
    ] as const) {
      setEngine({ phase: 'in-call' }, { card: withStatus(status) });
      const { unmount } = render(<DialerTab autoDial={AUTO} />);
      ids.forEach((id, i) => expect(screen.queryByTestId(id) !== null, `${status} ${id}`).toBe(expected[i]));
      unmount();
    }
  });

  it('lead perdido: o botão do painel diz "Mudar motivo de perda" e abre a mesma escolha de motivo; lead novo diz "Desqualificar"', () => {
    const concludeExternally = vi.fn();
    setEngine({ phase: 'in-call' }, { card: withStatus('unqualified'), simulated: false, concludeExternally });
    const { unmount } = render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    expect(screen.getByTestId('motor-action-disqualify')).toHaveTextContent('Mudar motivo de perda');
    fireEvent.click(screen.getByTestId('motor-action-disqualify'));
    expect(screen.getByTestId('lost-dialog').dataset.title).toBe('Mudar motivo de perda');
    expect(screen.getByTestId('lost-dialog').dataset.description).toBe('O lead já está perdido: escolha o novo motivo.');
    fireEvent.click(screen.getByTestId('lost-dialog'));
    expect(concludeExternally).toHaveBeenCalledWith('lead-1', 'lost');
    unmount();
    setEngine({ phase: 'in-call' }, { card: withStatus('contacted'), simulated: false });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    expect(screen.getByTestId('motor-action-disqualify')).toHaveTextContent('Desqualificar');
    fireEvent.click(screen.getByTestId('motor-action-disqualify'));
    expect(screen.getByTestId('lost-dialog').dataset.title).toBe(''); // sem props: o diálogo mantém o padrão
  });

  it('Desqualificar durante o toque (real): abre o motivo e, ao concluir, avisa o motor (concludeExternally)', () => {
    const concludeExternally = vi.fn();
    setEngine({ phase: 'in-call' }, { card, simulated: false, concludeExternally });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    fireEvent.click(screen.getByTestId('motor-action-disqualify'));
    fireEvent.click(screen.getByTestId('lost-dialog'));
    expect(concludeExternally).toHaveBeenCalledWith('lead-1', 'lost');
  });

  it('falha/cancelamento: sem sucesso do diálogo o motor não é avisado', () => {
    const concludeExternally = vi.fn();
    setEngine({ phase: 'dialing' }, { card, simulated: false, concludeExternally });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    fireEvent.click(screen.getByTestId('motor-action-disqualify'));
    expect(screen.getByTestId('lost-dialog')).toBeTruthy(); // diálogo aberto, nada confirmado
    expect(concludeExternally).not.toHaveBeenCalled();
  });

  it('simulado: Desqualificar e Agendar só avisam (nada gravado, motor intacto) e o painel deixa isso claro', async () => {
    const { toast } = await import('sonner');
    const concludeExternally = vi.fn();
    setEngine({ phase: 'in-call' }, { card, simulated: true, concludeExternally });
    render(<DialerTab autoDial={AUTO} />);
    expect(within(screen.getByTestId('motor-lead-actions')).getByText('Simulado: nada é registrado.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('motor-action-disqualify'));
    fireEvent.click(screen.getByTestId('motor-action-schedule'));
    expect(toast.message).toHaveBeenCalledWith('Simulado: nada é registrado.');
    expect(screen.queryByTestId('lost-dialog')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(concludeExternally).not.toHaveBeenCalled();
  });

  it('Ligar depois pelo painel usa o motor (scheduleCallback) e o diálogo é o mesmo', () => {
    const scheduleCallback = vi.fn(async () => ({ ok: true as const }));
    setEngine({ phase: 'in-call' }, { card, scheduleCallback });
    render(<DialerTab autoDial={AUTO} />);
    fireEvent.click(screen.getByTestId('motor-action-callback'));
    expect(screen.getByTestId('motor-callback-dialog')).toBeTruthy();
  });

  it('awaiting-sdr: painel e bloco principal convivem com UM só conjunto de diálogos (sem diálogo duplicado)', () => {
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card, simulated: false });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    expect(screen.getByTestId('dialer-answered')).toBeTruthy();
    expect(screen.getByTestId('motor-action-callback')).toBeTruthy();
    // clicar no do painel abre UM diálogo; o do bloco principal compartilha o mesmo estado
    fireEvent.click(screen.getByTestId('motor-action-callback'));
    expect(screen.getAllByTestId('motor-callback-dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByTestId('dialer-answered-callback'));
    expect(screen.getAllByTestId('motor-callback-dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByTestId('motor-action-disqualify'));
    expect(screen.getAllByTestId('lost-dialog')).toHaveLength(1);
  });

  it('awaiting-sdr, lead qualificado: o bloco principal também esconde Desqualificar (mesma regra)', () => {
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card: withStatus('qualified') });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.queryByTestId('dialer-answered-disqualify')).toBeNull();
    expect(screen.queryByTestId('motor-action-disqualify')).toBeNull();
  });

  it('Indicou outra pessoa: botão no painel e no bloco, com UM só diálogo; qualificado também tem', () => {
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card: withStatus('qualified'), simulated: false });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    expect(screen.getByTestId('dialer-answered-refer')).toBeTruthy();
    fireEvent.click(screen.getByTestId('motor-action-refer'));
    expect(screen.getAllByTestId('refer-dialog')).toHaveLength(1);
  });

  it('trocar de lead fecha diálogos do lead anterior', () => {
    setEngine({ phase: 'in-call' }, { card, simulated: false });
    const { rerender } = render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    fireEvent.click(screen.getByTestId('motor-action-disqualify'));
    expect(screen.getByTestId('lost-dialog')).toBeTruthy();
    setEngine({ phase: 'in-call' }, { card: { ...card, context: { ...context, leadId: 'lead-2' } }, simulated: false });
    rerender(<DialerTab autoDial={{ enabled: true, live: true }} />);
    expect(screen.queryByTestId('lost-dialog')).toBeNull();
  });
});

describe('aba Discador: etiqueta de Recuperação', () => {
  const lostCard: NextCallCardData = { ...card, context: { ...context, company: { ...context.company, status: 'unqualified' } } };
  const extras = { lossReasonName: 'Sem interesse' } as UseCockpitAutoDialResult['leadCardExtras'];

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('lead perdido: etiqueta no painel e no cabeçalho com o motivo', () => {
    setEngine({ phase: 'in-call' }, { card: lostCard, leadCardExtras: extras });
    render(<DialerTab autoDial={AUTO} />);
    const tags = screen.getAllByTestId('recovery-tag');
    expect(tags).toHaveLength(2); // cabeçalho da discagem + painel do lead
    for (const t of tags) expect(t.textContent).toBe('Recuperação · Perdido: Sem interesse');
    expect(within(screen.getByTestId('motor-lead-panel')).getByTestId('recovery-tag')).toBeTruthy();
  });

  it('sem motivo: só "Recuperação · Perdido"', () => {
    setEngine({ phase: 'in-call' }, { card: lostCard, leadCardExtras: null });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.getAllByTestId('recovery-tag')[0]?.textContent).toBe('Recuperação · Perdido');
  });

  it('lead normal na fila normal: nenhuma etiqueta', () => {
    setEngine({ phase: 'in-call' }, { card });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.queryByTestId('recovery-tag')).toBeNull();
  });

  it('fila Recuperação: etiqueta mesmo com o cartão ainda sem status de perdido', () => {
    setEngine({ phase: 'off' });
    const { rerender } = render(<DialerTab autoDial={AUTO} />);
    fireEvent.click(screen.getByTestId('dialer-queue'));
    fireEvent.click(screen.getByRole('option', { name: 'Recuperação de perdidos' }));
    setEngine({ phase: 'in-call' }, { card, leadCardExtras: extras });
    rerender(<DialerTab autoDial={AUTO} />);
    expect(screen.getAllByTestId('recovery-tag').length).toBe(2);
  });

  it('desligado ou sem ligação: nenhuma etiqueta', () => {
    setEngine({ phase: 'off' });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.queryByTestId('recovery-tag')).toBeNull();
  });
});

describe('aba Discador: pausa por sessão perdida mantém o painel do lead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('paused + callLostLeadId do lead atual: painel ABERTO com os 3 botões e o texto de pausa', () => {
    setEngine({ phase: 'paused', reason: 'blocked', message: 'sessão não entrou' }, { card, callLostLeadId: 'lead-1' });
    render(<DialerTab autoDial={AUTO} />);
    const panel = screen.getByTestId('motor-lead-panel');
    for (const a of ['schedule', 'callback', 'disqualify']) expect(within(panel).getByTestId(`motor-action-${a}`)).toBeTruthy();
    expect(screen.getByTestId('auto-dial-clean-state').textContent).toContain('Discagem pausada');
  });

  it('pausa comum (sem lead marcado) ou marcado para OUTRO lead: painel fechado', () => {
    setEngine({ phase: 'paused', reason: 'user', message: null }, { card, callLostLeadId: null });
    const { unmount } = render(<DialerTab autoDial={AUTO} />);
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
    unmount();
    setEngine({ phase: 'paused', reason: 'blocked', message: 'x' }, { card, callLostLeadId: 'lead-2' });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
  });

  it('o SDR pode fechar o painel na pausa e reabri-lo', () => {
    setEngine({ phase: 'paused', reason: 'blocked', message: 'x' }, { card, callLostLeadId: 'lead-1' });
    render(<DialerTab autoDial={AUTO} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel do lead' }));
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('motor-panel-reopen'));
    expect(screen.getByTestId('motor-lead-panel')).toBeTruthy();
  });
});

describe('aba Discador: anotação do painel grava na ligação', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    window.sessionStorage.clear();
  });

  it('real: digitar e sair do campo grava na ligação do motor e mostra "Guardada na ligação"', async () => {
    const { classifyWebphoneCall } = await import('@/features/calls/actions/classify-webphone-call');
    setEngine({ phase: 'in-call' }, { card, simulated: false, callId: 'call-1' });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    const field = screen.getByLabelText('Anotações');
    fireEvent.change(field, { target: { value: 'pediu proposta' } });
    expect(classifyWebphoneCall).not.toHaveBeenCalled();
    fireEvent.blur(field);
    await screen.findByText('Guardada na ligação');
    expect(classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', notes: 'pediu proposta' }));
  });

  it('antes de Desqualificar a anotação já foi mandada gravar', async () => {
    const { classifyWebphoneCall } = await import('@/features/calls/actions/classify-webphone-call');
    setEngine({ phase: 'in-call' }, { card, simulated: false, callId: 'call-1' });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    fireEvent.change(screen.getByLabelText('Anotações'), { target: { value: 'sem interesse' } });
    fireEvent.click(screen.getByTestId('motor-action-disqualify'));
    expect(classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', notes: 'sem interesse' }));
  });

  it('simulado: nada é gravado e o campo diz isso; texto padrão explica que esta é a anotação que vale', async () => {
    const { classifyWebphoneCall } = await import('@/features/calls/actions/classify-webphone-call');
    setEngine({ phase: 'in-call' }, { card, simulated: true, callId: 'call-1' });
    render(<DialerTab autoDial={AUTO} />);
    expect(screen.getByTestId('motor-note-status').textContent).toContain('é a que vale');
    const field = screen.getByLabelText('Anotações');
    fireEvent.change(field, { target: { value: 'obs' } });
    fireEvent.blur(field);
    expect(screen.getByTestId('motor-note-status').textContent).toContain('Simulado');
    expect(classifyWebphoneCall).not.toHaveBeenCalled();
  });

  it('erro mostra a mensagem e "Tentar de novo" regrava', async () => {
    const { classifyWebphoneCall } = await import('@/features/calls/actions/classify-webphone-call');
    vi.mocked(classifyWebphoneCall).mockResolvedValueOnce({ success: false, error: 'Falha de rede' });
    setEngine({ phase: 'in-call' }, { card, simulated: false, callId: 'call-1' });
    render(<DialerTab autoDial={{ enabled: true, live: true }} />);
    const field = screen.getByLabelText('Anotações');
    fireEvent.change(field, { target: { value: 'x' } });
    fireEvent.blur(field);
    await screen.findByText(/Não gravou: Falha de rede/);
    fireEvent.click(screen.getByTestId('motor-note-retry'));
    await screen.findByText('Guardada na ligação');
    expect((field as HTMLTextAreaElement).value).toBe('x');
  });
});
