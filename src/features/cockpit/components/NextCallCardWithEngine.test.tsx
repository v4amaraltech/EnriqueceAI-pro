import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UseCockpitAutoDialResult } from '../hooks/use-cockpit-auto-dial';
import type { NextCallCardData } from '../types';
import { suggestApproach } from '../utils/call-approach';
import type { CockpitAutoDialState } from '../utils/cockpit-auto-dial-machine';

import { NextCallCard } from './NextCallCard';

const hook = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('../hooks/use-cockpit-auto-dial', () => ({ useCockpitAutoDial: vi.fn(() => hook.result) }));
vi.mock('@/features/integrations/webphone/webphone-client', () => ({ hangupCall: vi.fn(async () => undefined) }));
vi.mock('@/features/calls/actions/initiate-api4com-call', () => ({ initiateApi4ComCall: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../actions/call-outcome', () => ({
  armCockpitCallOutcomeAction: vi.fn(),
  getCockpitCallOutcome: vi.fn(async () => ({ success: true, data: { status: 'ok', outcome: { state: 'waiting_call' } } })),
}));
vi.mock('../actions/verbal-consent', () => ({
  getVerbalConsentStateAction: vi.fn(async () => ({ success: true, data: { state: 'disabled' } })),
  recordVerbalConsentAction: vi.fn(),
}));
vi.mock('./use-lead-history', () => ({ useLeadHistory: () => ({ entries: [], status: 'ready' }) }));
vi.mock('@/features/leads/components/MarkLeadLostDialog', () => ({ MarkLeadLostDialog: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/cockpit',
  useSearchParams: () => new URLSearchParams(),
}));

const context: NextCallCardData['context'] = {
  leadId: 'lead-1',
  whyNow: { code: 'replied', label: 'Respondeu por email recentemente' },
  company: { name: 'Acme Ltda', cnpj: '47301384000146', segmento: 'Telecom', porte: null, status: 'contacted' },
  decisionMaker: { name: 'Ana Souza', jobTitle: 'Diretora', email: 'ana@acme.com', phone: '11999990000', partners: [] },
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

function setEngine(state: CockpitAutoDialState, extra: Partial<UseCockpitAutoDialResult> = {}) {
  const result: UseCockpitAutoDialResult = {
    state,
    statusText: null,
    card,
    tier: 'hot',
    simulated: true,
    callId: 'call-1',
    attemptNo: 1,
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

const AUTO = { enabled: true, live: false };
const IN_CALL: CockpitAutoDialState = { phase: 'in-call' };

describe('NextCallCard com o motor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('sem autoDial ou com flag desligada: nenhuma barra e o hook nem roda', async () => {
    const { useCockpitAutoDial } = await import('../hooks/use-cockpit-auto-dial');
    setEngine({ phase: 'off' });
    const { unmount } = render(<NextCallCard card={card} dialerProvider="api4com" />);
    expect(screen.queryByTestId('auto-dial-bar')).toBeNull();
    unmount();
    render(<NextCallCard card={card} dialerProvider="api4com" autoDial={{ enabled: false, live: false }} />);
    expect(screen.queryByTestId('auto-dial-bar')).toBeNull();
    expect(screen.getByRole('button', { name: /Ligar agora/ })).toBeTruthy();
    expect(useCockpitAutoDial).not.toHaveBeenCalled();
  });

  it('motor desligado: cartão de sempre + barra com Iniciar, SIMULADO e "Ligar agora" intacto', () => {
    const e = setEngine({ phase: 'off' });
    render(<NextCallCard card={card} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.getByTestId('why-now')).toBeTruthy();
    expect(screen.getByTestId('auto-dial-simulated')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Ligar agora/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('auto-dial-start'));
    expect(e.start).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
  });

  it.each<CockpitAutoDialState>([
    { phase: 'paused', reason: 'user', message: null },
    { phase: 'blocked', reason: 'outside_hours' },
  ])('motor pausado ou bloqueado volta ao cartão de sempre: %o', (state) => {
    setEngine(state);
    render(<NextCallCard card={card} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.getByTestId('why-now')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Ligar agora/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sem lead e motor desligado: só a barra com Iniciar', () => {
    setEngine({ phase: 'off' }, { card: null });
    render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.getByTestId('auto-dial-start')).toBeTruthy();
    expect(screen.queryByTestId('why-now')).toBeNull();
  });

  it.each<CockpitAutoDialState>([
    { phase: 'countdown', secondsLeft: 4 },
    { phase: 'waiting', until: 1 },
    { phase: 'advancing' },
  ])('motor rodando sem ligação: TELA LIMPA, sem cartão cheio, sem Ligar agora e sem painel: %o', (state) => {
    setEngine(state);
    render(<NextCallCard card={card} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.getByTestId('auto-dial-bar')).toBeTruthy();
    expect(screen.getByTestId('auto-dial-clean-state').textContent).toBe('Aguardando o próximo lead');
    expect(screen.queryByTestId('why-now')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ligar agora/ })).toBeNull();
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
  });

  it('o motor começa a ligar: o painel abre sozinho com os dados do lead certo e o selo TENTATIVA n/3', () => {
    setEngine(IN_CALL, { attemptNo: 2 });
    render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} leadCardEnabled />);
    const panel = screen.getByTestId('motor-lead-panel');
    expect(within(panel).getAllByText('Acme Ltda').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/11999990000/).length).toBeGreaterThan(0);
    expect(within(panel).getByTestId('call-lead-attempt').textContent).toBe('TENTATIVA 2/3');
    expect(within(panel).getByTestId('lead-card-cargo').textContent).toContain('Diretora');
    expect(within(panel).getByTestId('lead-card-segmento').textContent).toContain('Telecom');
    expect(within(panel).getByTestId('lead-card-cnpj').textContent).toContain('47.301.384/0001-46');
    expect(within(panel).getByTestId('call-lead-opening')).toBeTruthy();
    expect(within(panel).getByTestId('motor-lead-status-line').textContent).toBe('Em ligação · tentativa 2/3');
    expect(within(panel).getByText('SIMULADO')).toBeTruthy();
    // a área principal continua limpa
    expect(screen.getByTestId('auto-dial-clean-state').textContent).toContain('Acme Ltda');
    expect(screen.queryByTestId('why-now')).toBeNull();
  });

  it('o painel NÃO tem botão de ligar, discar nem desligar (só o motor liga)', () => {
    setEngine(IN_CALL, { simulated: false });
    render(<NextCallCard card={null} dialerProvider="api4com" autoDial={{ enabled: true, live: true }} leadCardEnabled />);
    const panel = screen.getByTestId('motor-lead-panel');
    expect(within(panel).queryByRole('button', { name: /^(?!ligar depois)(.*)(ligar|discar|desligar|chamar)/i })).toBeNull();
    // o Desligar fica só na barra do motor, fora do painel
    expect(screen.getByTestId('auto-dial-hangup')).toBeTruthy();
    expect(panel.contains(screen.getByTestId('auto-dial-hangup'))).toBe(false);
  });

  it('flag do cartão desligada: versão simples (lista de fatos + abertura), sem o cartão vermelho', () => {
    setEngine(IN_CALL);
    render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} leadCardEnabled={false} />);
    const panel = screen.getByTestId('motor-lead-panel');
    expect(within(panel).getByTestId('motor-lead-facts').textContent).toContain('Telecom');
    expect(within(panel).getByTestId('motor-lead-opening')).toBeTruthy();
    expect(within(panel).queryByTestId('call-lead-card')).toBeNull();
  });

  it('o SDR pode fechar e reabrir; o painel volta a abrir sozinho no próximo lead', () => {
    setEngine(IN_CALL);
    const { rerender } = render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel do lead' }));
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('motor-panel-reopen'));
    expect(screen.getByTestId('motor-lead-panel')).toBeTruthy();

    // fecha à mão, a ligação termina e o motor segue: dispensa zera
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel do lead' }));
    setEngine({ phase: 'countdown', secondsLeft: 5 });
    rerender(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    setEngine(IN_CALL);
    rerender(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.getByTestId('motor-lead-panel')).toBeTruthy();
  });

  it('fecha sozinho ao seguir para o próximo lead e ao parar', () => {
    setEngine(IN_CALL);
    const { rerender } = render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.getByTestId('motor-lead-panel')).toBeTruthy();
    setEngine({ phase: 'countdown', secondsLeft: 5 });
    rerender(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
    setEngine(IN_CALL);
    rerender(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    setEngine({ phase: 'off' });
    rerender(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.queryByTestId('motor-lead-panel')).toBeNull();
  });

  it('o bloco das 3 ações só existe em awaiting-sdr; lá os botões ficam habilitados', () => {
    setEngine(IN_CALL);
    const { rerender } = render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    for (const phase of ['dialing', 'in-call', 'resolving']) {
      setEngine({ phase } as CockpitAutoDialState);
      rerender(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
      expect(screen.queryByTestId('dialer-answered')).toBeNull();
      expect(screen.queryByText(/O lead conversou/)).toBeNull();
    }
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' });
    rerender(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    expect((screen.getByTestId('dialer-answered-schedule') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('dialer-answered-disqualify') as HTMLButtonElement).disabled).toBe(false);
  });

  it('atendeu: as 3 ações aparecem com o painel aberto, sem select de desfecho nem Confirmar', () => {
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' });
    render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.getByTestId('auto-dial-status').textContent).toBe('Aguardando o desfecho');
    expect(screen.getByTestId('motor-lead-panel')).toBeTruthy();
    expect(screen.getByTestId('dialer-answered-schedule')).toBeTruthy();
    expect(screen.getByTestId('dialer-answered-callback')).toBeTruthy();
    expect(screen.getByTestId('dialer-answered-disqualify')).toBeTruthy();
    expect(screen.queryByTestId('auto-dial-disposition')).toBeNull();
    expect(screen.queryByTestId('auto-dial-confirm-button')).toBeNull();
    expect(screen.queryByLabelText('Observação do desfecho')).toBeNull();
  });

  it('ligação real: LIGAÇÃO REAL na barra e no painel; sem resumo da IA nem sugestão de desfecho', () => {
    setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { simulated: false });
    render(<NextCallCard card={null} dialerProvider="api4com" autoDial={{ enabled: true, live: true }} />);
    expect(screen.getAllByText('LIGAÇÃO REAL').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('call-outcome')).toBeNull();
    expect(screen.queryByTestId('next-lead-button')).toBeNull();
  });

  describe('extras do lead (F5)', () => {
    const NOW_CARD = { ...card, generatedAt: '2026-11-15T15:00:00Z' };
    const extras = {
      leadSource: 'Outbound',
      canal: 'Indicação',
      createdAt: '2026-07-01T12:00:00Z',
      lostAt: '2026-09-15T12:00:00Z',
      lossReasonName: 'Sem interesse',
      lossNotes: 'Disse que já tem agência.',
      previousSdr: { userId: 'u9', name: 'Carla Dias' },
    };

    it('mostra origem, "cadastrado há X", SDR antigo, bloco da perda e abertura pelo motivo; nunca "undefined"', () => {
      setEngine(IN_CALL, { card: NOW_CARD, leadCardExtras: extras });
      render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} leadCardEnabled />);
      const panel = screen.getByTestId('motor-lead-panel');
      expect(within(panel).getByTestId('lead-card-origem').textContent).toContain('Outbound / Indicação');
      expect(within(panel).getByTestId('lead-card-temperatura').textContent).toMatch(/cadastrado há 4[,.]5? ?meses|cadastrado há 4,\d meses/);
      expect(within(panel).getByTestId('lead-card-sdr').textContent).toContain('Carla Dias');
      // motivo e notas ficam no bloco próprio, não na grade
      expect(within(panel).queryByTestId('lead-card-motivo')).toBeNull();
      expect(within(panel).queryByTestId('lead-card-notas')).toBeNull();
      const loss = within(panel).getByTestId('motor-lead-loss');
      expect(loss.textContent).toContain('Sem interesse');
      expect(loss.textContent).toContain('perdido há');
      expect(loss.textContent).toContain('Disse que já tem agência.');
      expect(within(panel).getByTestId('call-lead-opening').textContent).toContain('da última vez não era o momento');
      expect(panel.textContent).not.toContain('undefined');
      expect(panel.textContent).not.toContain('null');
    });

    it('extras nulos ou ausentes: sem campos extras, sem bloco da perda e sem "undefined"', () => {
      setEngine(IN_CALL, { leadCardExtras: null });
      render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} leadCardEnabled />);
      const panel = screen.getByTestId('motor-lead-panel');
      expect(within(panel).queryByTestId('lead-card-origem')).toBeNull();
      expect(within(panel).queryByTestId('lead-card-sdr')).toBeNull();
      expect(within(panel).queryByTestId('motor-lead-loss')).toBeNull();
      expect(panel.textContent).not.toContain('undefined');
    });

    it('lead PERDIDO (unqualified): sem "Desqualificar"; "Agendar reunião" continua', () => {
      const lost = { ...card, context: { ...context, company: { ...context.company, status: 'unqualified' } } };
      setEngine({ phase: 'awaiting-sdr', reason: 'answered' }, { card: lost, leadCardExtras: extras });
      render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} leadCardEnabled />);
      expect(screen.queryByTestId('dialer-answered-disqualify')).toBeNull();
      expect(screen.getByTestId('dialer-answered-schedule')).toBeTruthy();
    });

    it('lead ativo: o botão "Desqualificar" aparece', () => {
      setEngine({ phase: 'awaiting-sdr', reason: 'answered' });
      render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
      expect(screen.getByTestId('dialer-answered-disqualify')).toBeTruthy();
    });
  });

  it('leads pulados por número inválido aparecem como contador "N pulados" na barra', () => {
    setEngine({ phase: 'countdown', secondsLeft: 3 }, { skippedLeads: [{ leadId: 'a', reason: 'número inválido' }, { leadId: 'b', reason: 'número inválido' }] });
    render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.getByTestId('auto-dial-skipped').textContent).toBe('2 pulados');
  });

  it('sem pulados, o contador não aparece', () => {
    setEngine({ phase: 'countdown', secondsLeft: 3 }, { skippedLeads: [] });
    render(<NextCallCard card={null} dialerProvider="api4com" autoDial={AUTO} />);
    expect(screen.queryByTestId('auto-dial-skipped')).toBeNull();
  });
});
