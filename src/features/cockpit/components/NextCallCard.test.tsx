import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initiateApi4ComCall } from '@/features/calls/actions/initiate-api4com-call';

import { armCockpitCallOutcomeAction, getCockpitCallOutcome } from '../actions/call-outcome';
import type { CockpitViewer, NextCallCardData } from '../types';
import { suggestApproach } from '../utils/call-approach';

import { CockpitShell } from './CockpitShell';
import { NextCallCard } from './NextCallCard';

vi.mock('@/features/calls/actions/initiate-api4com-call', () => ({ initiateApi4ComCall: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('../actions/call-outcome', () => ({ armCockpitCallOutcomeAction: vi.fn(), getCockpitCallOutcome: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => '/cockpit',
  useSearchParams: () => new URLSearchParams(),
}));

const context: NextCallCardData['context'] = {
  leadId: 'lead-1',
  whyNow: { code: 'replied', label: 'Respondeu por email recentemente' },
  company: { name: 'Acme Ltda', cnpj: null, segmento: 'Software', porte: null, status: 'contacted' },
  decisionMaker: { name: 'Ana Souza', jobTitle: 'Diretora', email: null, phone: '11999990000', partners: [] },
  signals: [{ kind: 'replied', source: 'email', at: '2026-11-06T12:00:00Z' }],
  interactions: [],
  interactionsPage: { page: 1, perPage: 5, total: 0, hasMore: false },
  calls: [],
  callsPage: { page: 1, perPage: 5, total: 0, hasMore: false },
  objections: null,
  scores: { fit: null, engagement: null },
  missing: ['objections', 'calls'],
};
const card: NextCallCardData = { context, approach: suggestApproach(context), generatedAt: '2026-11-07T12:00:00Z' };

const viewer: CockpitViewer = { viewerId: 'u1', orgId: 'o1', isManager: false, targetUserId: 'u1', targetName: 'Bia Lima', sdrOptions: [] };

describe('NextCallCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mostra motivo, empresa, decisor, sinal com fonte e tempo, e "sem dados"', () => {
    render(<NextCallCard card={card} dialerProvider="api4com" />);
    expect(screen.getByText('Acme Ltda')).toBeTruthy();
    expect(screen.getByTestId('why-now').textContent).toContain('Respondeu por email recentemente');
    expect(screen.getByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText(/Respondeu por e-mail, há 1 dia/)).toBeTruthy();
    // Objeções null e resumo ausente
    expect(screen.getAllByText('sem dados').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('approach').textContent).toContain('Retomar a conversa iniciada pelo lead');
  });

  it('sem prioridade v2: título v0 e nenhuma linha de fonte', () => {
    render(<NextCallCard card={card} dialerProvider="api4com" />);
    expect(screen.getByTestId('approach').textContent).toContain('v0, por regras');
    expect(screen.queryByTestId('priority-source')).toBeNull();
  });

  it('com prioridade v2: mostra fonte, versão e pontuação da sugestão', () => {
    const priority = { version: 'call_priority_v2.0', score: 410, sourceLabel: 'resposta explícita', reasons: ['Respondeu por email'], humanCorrected: false };
    render(<NextCallCard card={{ ...card, approach: { ...card.approach, version: 'v2' }, priority }} dialerProvider="api4com" />);
    const line = screen.getByTestId('priority-source').textContent ?? '';
    expect(line).toContain('call_priority_v2.0');
    expect(line).toContain('resposta explícita');
    expect(line).toContain('410');
    expect(screen.getByTestId('approach').textContent).toContain('v2, por regras');
  });

  it('botão chama a action existente da API4Com uma única vez, mesmo com clique duplo', async () => {
    let release: (v: unknown) => void = () => {};
    vi.mocked(initiateApi4ComCall).mockImplementation(
      () => new Promise((resolve) => (release = resolve as (v: unknown) => void)) as never,
    );
    render(<NextCallCard card={card} dialerProvider="api4com" />);
    const btn = screen.getByRole('button', { name: /Ligar agora/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(initiateApi4ComCall).toHaveBeenCalledTimes(1);
    expect(initiateApi4ComCall).toHaveBeenCalledWith({ phone: '11999990000', leadId: 'lead-1' });
    release({ success: true, data: { callId: 'c', api4comId: 'a' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Ligar agora/ })).toBeTruthy());
  });

  it('nunca disca sozinho ao renderizar', () => {
    render(<NextCallCard card={card} dialerProvider="api4com" />);
    expect(initiateApi4ComCall).not.toHaveBeenCalled();
  });

  it('sem API4Com conectada o botão fica desabilitado', () => {
    render(<NextCallCard card={card} dialerProvider={null} />);
    expect((screen.getByRole('button', { name: /Ligar agora/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('CockpitShell com a flag desligada', () => {
  it('sem callCard renderiza só o legado', () => {
    render(
      <CockpitShell viewer={viewer} tab="leads">
        <div>conteudo legado</div>
      </CockpitShell>,
    );
    expect(screen.getByText('conteudo legado')).toBeTruthy();
    expect(screen.queryByTestId('next-call-card')).toBeNull();
    expect(screen.getByText('Meus Leads')).toBeTruthy();
  });

  it('com callCard renderiza o cartão acima do conteúdo', () => {
    render(
      <CockpitShell viewer={viewer} tab="leads" callCard={<NextCallCard card={card} dialerProvider="api4com" />}>
        <div>conteudo legado</div>
      </CockpitShell>,
    );
    expect(screen.getByTestId('next-call-card')).toBeTruthy();
    expect(screen.getByText('conteudo legado')).toBeTruthy();
  });
});

describe('NextCallCard e resultado pós-ligação (call_cockpit_outcomes)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(initiateApi4ComCall).mockResolvedValue({ success: true, data: { callId: 'call-9', api4comId: 'a' } } as never);
    vi.mocked(armCockpitCallOutcomeAction).mockResolvedValue({ success: true, data: { armed: true } });
  });

  it('flag desligada: ligar não arma nem mostra resultado (igual a hoje)', async () => {
    render(<NextCallCard card={card} dialerProvider="api4com" />);
    fireEvent.click(screen.getByRole('button', { name: /Ligar agora/ }));
    await waitFor(() => expect(initiateApi4ComCall).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Ligar agora/ })).toBeTruthy());
    expect(armCockpitCallOutcomeAction).not.toHaveBeenCalled();
    expect(getCockpitCallOutcome).not.toHaveBeenCalled();
    expect(screen.queryByTestId('call-outcome')).toBeNull();
  });

  it('flag ligada: arma a ligação uma vez e mostra o painel sem discar outra', async () => {
    render(<NextCallCard card={card} dialerProvider="api4com" outcomesEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ligar agora/ }));
    await waitFor(() => expect(screen.getByTestId('call-outcome')).toBeTruthy());
    expect(armCockpitCallOutcomeAction).toHaveBeenCalledTimes(1);
    expect(armCockpitCallOutcomeAction).toHaveBeenCalledWith({ callId: 'call-9' });
    expect(initiateApi4ComCall).toHaveBeenCalledTimes(1);
  });

  it('transcrição pendente não trava: "Próxima ligação" segue habilitado e leva ao próximo lead', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getCockpitCallOutcome).mockResolvedValue({
      success: true,
      data: { status: 'ok', outcome: { state: 'pending', stage: 'transcription' } },
    });
    render(<NextCallCard card={card} dialerProvider="api4com" outcomesEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ligar agora/ }));
    await waitFor(() => expect(screen.getByTestId('call-outcome')).toBeTruthy());
    await vi.advanceTimersByTimeAsync(3_100);
    await waitFor(() => expect(screen.getByTestId('outcome-pending')).toBeTruthy());

    const next = screen.getByTestId('next-lead-button') as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(nav.push).toHaveBeenCalledWith('/cockpit?skip=lead-1');
    vi.useRealTimers();
  });

  it('baixa confiança aparece como exceção revisável, sem resultado aplicado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getCockpitCallOutcome).mockResolvedValue({
      success: true,
      data: {
        status: 'ok',
        outcome: { state: 'exception', reason: 'low_confidence', suggestedDisposition: 'relevant_conversation', confidence: 0.4, summary: 'Talvez queira proposta' },
      },
    });
    render(<NextCallCard card={card} dialerProvider="api4com" outcomesEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ligar agora/ }));
    await waitFor(() => expect(screen.getByTestId('call-outcome')).toBeTruthy());
    await vi.advanceTimersByTimeAsync(3_100);
    await waitFor(() => expect(screen.getByTestId('outcome-exception')).toBeTruthy());
    expect(screen.getByTestId('outcome-exception').textContent).toContain('Nada foi aplicado');
    expect(screen.queryByTestId('outcome-confirmed')).toBeNull();
    vi.useRealTimers();
  });

  it('resultado confirmado aparece com resumo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getCockpitCallOutcome).mockResolvedValue({
      success: true,
      data: {
        status: 'ok',
        outcome: { state: 'confirmed', source: 'ai', disposition: 'voicemail', summary: 'Caixa postal.', callbackAt: null, callbackScheduled: false },
      },
    });
    render(<NextCallCard card={card} dialerProvider="api4com" outcomesEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ligar agora/ }));
    await waitFor(() => expect(screen.getByTestId('call-outcome')).toBeTruthy());
    await vi.advanceTimersByTimeAsync(3_100);
    await waitFor(() => expect(screen.getByTestId('outcome-confirmed').textContent).toContain('Caixa postal'));
    vi.useRealTimers();
  });
});
