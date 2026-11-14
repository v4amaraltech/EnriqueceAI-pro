import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLeadCard } from '@/features/cockpit/utils/lead-card';
import type { CallHistoryEntry } from '@/features/cockpit/utils/call-history';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';

const fetchCard = vi.hoisted(() => ({ fn: vi.fn() }));
const historyQuery = vi.hoisted(() => ({
  error: false,
}));

vi.mock('next/image', () => ({
  default: (props: { alt: string; src: string; height?: number }) => (
    <span role="presentation" data-src={props.src} data-height={props.height} />
  ),
}));

vi.mock('../actions/fetch-dialer-lead-card', () => ({
  fetchDialerLeadCard: fetchCard.fn,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/supabase/from', () => ({
  from: vi.fn(() => {
    const result = () =>
      historyQuery.error
        ? { data: null, error: { message: 'falha de rede' } }
        : { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return chain;
  }),
}));

import { DialerCallPanel } from './DialerCallPanel';

const LEAD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEAD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CARD_NOW = new Date('2026-11-11T15:00:00.000Z');

function item(over: Partial<DialerQueueItem> = {}): DialerQueueItem {
  return {
    enrollmentId: 'e-1',
    leadId: LEAD_A,
    leadName: 'Silva Ltda',
    firstName: 'Maria',
    lastName: 'Silva',
    companyName: 'Silva Comercio Ltda',
    phone: '(11) 99999-1234',
    phones: [{ formatted: '(11) 99999-1234', raw: '5511999991234', label: '(11) 99999-1234' }],
    cadenceName: 'Cadencia Teste',
    cadenceId: 'c1',
    stepId: 's1',
    stepOrder: 2,
    totalSteps: 5,
    nextStepDue: '2026-11-13T10:00:00Z',
    activityName: 'Ligar',
    callScript: 'Perguntar quem decide.',
    currentStepIsPhone: true,
    phoneAttempts: [],
    ...over,
  };
}

const history: CallHistoryEntry[] = [
  { id: 'h1', at: '2026-11-10T15:00:00.000Z', title: 'Respondeu · e-mail', detail: 'Podemos falar amanha' },
];

const richCard = buildLeadCard({
  firstName: 'Maria',
  lastName: 'Silva',
  nomeFantasia: 'Silva Ltda',
  razaoSocial: 'Silva Comercio Ltda',
  telefone: '11999991234',
  phones: null,
  jobTitle: 'Compradora',
  segmento: 'Varejo',
  cnpj: '12345678000190',
  email: 'maria@silva.com',
  leadSource: 'Inbound',
  canal: 'Site',
  lostAt: '2026-04-17T10:22:48.000Z',
  lossReasonName: 'Deixou de responder',
  lossNotes: null,
  enrollmentLossNotes: null,
  previousSdrName: null,
  stepOrder: 2,
  totalSteps: 5,
  lastInteractionAt: '2026-11-10T15:00:00.000Z',
  createdAt: '2025-01-10T12:00:00.000Z',
  callScript: 'Perguntar quem decide.',
  now: CARD_NOW,
});

const otherCard = buildLeadCard({
  firstName: 'Joao',
  lastName: 'Santos',
  nomeFantasia: 'Santos SA',
  razaoSocial: 'Santos SA',
  telefone: '21987654321',
  phones: null,
  jobTitle: null,
  segmento: null,
  cnpj: '00000000000000',
  email: null,
  leadSource: null,
  canal: null,
  lostAt: null,
  lossReasonName: null,
  lossNotes: null,
  enrollmentLossNotes: null,
  previousSdrName: null,
  stepOrder: 1,
  totalSteps: 3,
  now: CARD_NOW,
});

const emptyCard = buildLeadCard({
  firstName: null,
  lastName: null,
  nomeFantasia: null,
  razaoSocial: null,
  telefone: null,
  phones: null,
  jobTitle: null,
  segmento: null,
  cnpj: null,
  email: null,
  leadSource: null,
  canal: null,
  lostAt: null,
  lossReasonName: null,
  lossNotes: null,
  enrollmentLossNotes: null,
  previousSdrName: null,
  stepOrder: 1,
  totalSteps: 3,
  now: CARD_NOW,
});

function renderPanel(over: Parameters<typeof DialerCallPanel>[0] extends infer T ? Partial<T> : never = {}) {
  return render(
    <DialerCallPanel
      item={item()}
      isSending={false}
      callState="idle"
      onComplete={vi.fn()}
      onSkip={vi.fn()}
      onInitiateCall={vi.fn()}
      onHangup={vi.fn()}
      onRetry={vi.fn()}
      {...over}
    />,
  );
}

describe('DialerCallPanel lead card', () => {
  beforeEach(() => {
    fetchCard.fn.mockReset();
    historyQuery.error = false;
  });

  it('com a flag desligada mantém o painel de hoje e não busca o cartão', () => {
    renderPanel();
    expect(screen.queryByTestId('call-lead-card')).toBeNull();
    expect(screen.queryByTestId('call-history-collapse')).toBeNull();
    expect(screen.getByText('Cadencia Teste')).toBeTruthy();
    expect(screen.getByText('Perguntar quem decide.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pular' })).toBeTruthy();
    expect(fetchCard.fn).not.toHaveBeenCalled();
  });

  it('com a flag ligada mostra o cartão, a abertura e o histórico recolhido', () => {
    renderPanel({ leadCardEnabled: true, leadCard: richCard, history, cardNow: CARD_NOW });
    expect(screen.getByTestId('call-lead-card')).toBeTruthy();
    expect(screen.getByTestId('call-lead-opening').textContent).toContain('Seria um problema retomarmos em 2 minutos?');
    expect(screen.getByTestId('lead-card-temperatura').textContent).toContain('perdido há');
    expect(screen.getByTestId('lead-card-temperatura').textContent).not.toMatch(/quente|morno|frio/i);
    expect(screen.getByText('Perguntar quem decide.')).toBeTruthy();
    const historyBox = screen.getByTestId('call-history-collapse');
    expect(historyBox.textContent).toContain('Histórico');
    expect(historyBox.textContent).toContain('Respondeu · e-mail');
    expect(screen.getByRole('button', { name: 'Pular' })).toBeTruthy();
    expect(fetchCard.fn).not.toHaveBeenCalled();
  });

  it('troca o cartão quando o lead da vez muda', async () => {
    fetchCard.fn.mockImplementation(async (input: { leadId: string }) => ({
      success: true,
      data: input.leadId === LEAD_B ? otherCard : richCard,
    }));
    const view = renderPanel({ leadCardEnabled: true, history: [] });
    await waitFor(() => expect(screen.getByTestId('call-lead-opening').textContent).toContain('retomarmos em 2 minutos'));
    expect(fetchCard.fn).toHaveBeenCalledWith(expect.objectContaining({ leadId: LEAD_A }));

    view.rerender(
      <DialerCallPanel
        item={item({
          enrollmentId: 'e-2',
          leadId: LEAD_B,
          leadName: 'Santos SA',
          firstName: 'Joao',
          lastName: 'Santos',
          companyName: 'Santos SA',
          phone: '(21) 98765-4321',
          stepOrder: 1,
          totalSteps: 3,
          callScript: null,
        })}
        isSending={false}
        callState="idle"
        leadCardEnabled
        history={[]}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
        onInitiateCall={vi.fn()}
        onHangup={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('call-lead-card').textContent).toContain('Joao Santos'));
    expect(fetchCard.fn).toHaveBeenLastCalledWith(expect.objectContaining({ leadId: LEAD_B }));
    expect(screen.getByRole('button', { name: 'Pular' })).toBeTruthy();
  });

  it('com falha de rede no histórico mantém o cartão e avisa no histórico', async () => {
    historyQuery.error = true;
    renderPanel({ leadCardEnabled: true, leadCard: richCard, cardNow: CARD_NOW });
    expect(screen.getByTestId('call-lead-card')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('call-history-collapse').textContent).toContain('Não foi possível carregar o histórico.'),
    );
    expect(screen.getByRole('button', { name: 'Pular' })).toBeTruthy();
  });

  it('com campos ausentes o cartão continua preenchido com os fallbacks', () => {
    renderPanel({
      item: item({ firstName: null, lastName: null, leadName: 'Lead sem dados', companyName: 'Lead sem dados', phone: null, phones: [], callScript: null }),
      leadCardEnabled: true,
      leadCard: emptyCard,
      history: [],
      cardNow: CARD_NOW,
    });
    expect(screen.getByTestId('call-lead-card')).toBeTruthy();
    expect(screen.getByTestId('lead-card-cnpj').textContent).toContain('-');
    expect(screen.getByTestId('lead-card-temperatura').textContent).toContain('Sem dados');
    expect(screen.getByTestId('call-lead-opening').textContent.toLowerCase()).toContain('tentativa 1 de 3');
    expect(screen.getByRole('button', { name: 'Pular' })).toBeTruthy();
  });
});
