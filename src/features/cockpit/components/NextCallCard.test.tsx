import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initiateApi4ComCall } from '@/features/calls/actions/initiate-api4com-call';

import type { CockpitViewer, NextCallCardData } from '../types';
import { suggestApproach } from '../utils/call-approach';

import { CockpitShell } from './CockpitShell';
import { NextCallCard } from './NextCallCard';

vi.mock('@/features/calls/actions/initiate-api4com-call', () => ({ initiateApi4ComCall: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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
