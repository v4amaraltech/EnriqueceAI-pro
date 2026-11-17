import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NextCallCardData } from '../types';
import { suggestApproach } from '../utils/call-approach';

import { MotorLeadSidePanel } from './MotorLeadSidePanel';

vi.mock('./use-lead-history', () => ({ useLeadHistory: () => ({ entries: [], status: 'ready' }) }));
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
  render(
    <MotorLeadSidePanel
      card={card}
      attemptNo={1}
      leadCardEnabled={false}
      open
      onOpenChange={vi.fn()}
      statusLine="Em ligação"
      simulated={false}
      {...over}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('MotorLeadSidePanel: só dados e Anotações', () => {
  it('sem instância de ações (só leitura), o painel não desenha os botões', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: /agendar reunião|ligar depois|desqualificar/i })).toBeNull();
    expect(screen.queryByTestId('dialer-answered')).toBeNull();
  });

  it('mantém as Anotações com rascunho guardado', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Anotações'), { target: { value: 'pediu proposta' } });
    expect((screen.getByLabelText('Anotações') as HTMLTextAreaElement).value).toBe('pediu proposta');
  });
});
