import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CallResultModal, type CallResultModalProps } from './CallResultModal';

// O modal de reunião abre um fluxo próprio (Google Calendar) irrelevante aqui.
vi.mock('@/features/integrations/components/ScheduleMeetingModal', () => ({
  ScheduleMeetingModal: () => null,
}));

function renderModal(overrides: Partial<CallResultModalProps> = {}) {
  const props: CallResultModalProps = {
    open: true,
    onClose: vi.fn(),
    leadName: 'Lead de Teste',
    leadId: '11111111-1111-1111-1111-111111111111',
    phoneLabel: '11954958486',
    durationSeconds: 0,
    connected: false,
    onConclude: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CallResultModal {...props} />) };
}

describe('CallResultModal', () => {
  describe('pré-seleção do desfecho pelo sinal técnico', () => {
    it('não atendida → pré-seleciona "Não atendeu"', () => {
      renderModal({ connected: false, durationSeconds: 0 });
      expect(screen.getByRole('radio', { checked: true })).toHaveAttribute('value', 'no_contact');
    });

    it('atendida → pré-seleciona "Conversa relevante"', () => {
      renderModal({ connected: true, durationSeconds: 257 });
      expect(screen.getByRole('radio', { checked: true })).toHaveAttribute('value', 'significant');
    });
  });

  describe('resumo com significado', () => {
    it('mostra "Não atendida" com a duração quando não conectou', () => {
      renderModal({ connected: false, durationSeconds: 0 });
      expect(screen.getByText('Não atendida')).toBeInTheDocument();
      expect(screen.getByText('00:00')).toBeInTheDocument();
    });

    it('mostra "Atendida" com a duração quando conectou', () => {
      renderModal({ connected: true, durationSeconds: 257 });
      expect(screen.getByText('Atendida')).toBeInTheDocument();
      expect(screen.getByText('04:17')).toBeInTheDocument();
    });
  });

  describe('bloco de retorno — só quando o lead pediu retorno', () => {
    it('NÃO aparece em "Não atendeu": ninguém falou com ninguém, a cadência segue', () => {
      renderModal({ connected: false }); // pré-seleciona no_contact
      expect(screen.queryByText('Quando ligar de novo')).not.toBeInTheDocument();
    });

    it('não aparece para desfecho que avança a cadência', () => {
      renderModal({ connected: true });
      expect(screen.queryByText('Quando ligar de novo')).not.toBeInTheDocument();
    });

    it('aparece ao escolher "Pediu para ligar depois"', async () => {
      const user = userEvent.setup();
      renderModal({ connected: true });
      expect(screen.queryByText('Quando ligar de novo')).not.toBeInTheDocument();

      await user.click(screen.getByRole('radio', { name: /Pediu para ligar depois/ }));
      expect(screen.getByText('Quando ligar de novo')).toBeInTheDocument();
    });
  });

  describe('conclusão', () => {
    it('permite concluir direto em "Não atendeu" — o caso mais comum é 1 clique', () => {
      renderModal({ connected: false });
      expect(screen.getByRole('button', { name: /Concluir atividade/ })).toBeEnabled();
      expect(screen.queryByText('Escolha a data para concluir.')).not.toBeInTheDocument();
    });

    it('bloqueia concluir sem data quando o lead pediu retorno', async () => {
      const user = userEvent.setup();
      renderModal({ connected: true });
      await user.click(screen.getByRole('radio', { name: /Pediu para ligar depois/ }));

      expect(screen.getByRole('button', { name: /Concluir atividade/ })).toBeDisabled();
      expect(screen.getByText('Escolha a data para concluir.')).toBeInTheDocument();
    });

    it('entrega o desfecho escolhido no onConclude', async () => {
      const user = userEvent.setup();
      const onConclude = vi.fn();
      renderModal({ connected: true, onConclude });

      await user.click(screen.getByRole('radio', { name: /Atendeu, sem avanço/ }));
      await user.click(screen.getByRole('button', { name: /Concluir atividade/ }));

      expect(onConclude).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'not_significant', returnSchedule: null }),
      );
    });
  });
});
