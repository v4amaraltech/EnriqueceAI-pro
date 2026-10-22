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
    it('não atendida → esconde o desfecho; "Registrar outro desfecho" revela pré-selecionado em "Não atendeu"', async () => {
      const user = userEvent.setup();
      renderModal({ connected: false, durationSeconds: 0 });
      // Fluxo enxuto: sem seletor de cara (o SDR só quer re-discar).
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      // O desfecho continua no_answer por baixo — revelável sob demanda.
      await user.click(screen.getByRole('button', { name: /Registrar outro desfecho/ }));
      expect(screen.getByRole('radio', { checked: true })).toHaveAttribute('value', 'no_answer');
    });

    it('não atendida com onRetry → "Ligar de novo" é a ação primária', () => {
      renderModal({ connected: false, onRetry: vi.fn() });
      expect(screen.getByRole('button', { name: /Ligar de novo/ })).toBeInTheDocument();
    });

    it('atendida → NÃO pré-seleciona: o SDR deve escolher o desfecho', () => {
      renderModal({ connected: true, durationSeconds: 257 });
      expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    });
  });

  describe('trava por telemetria — o formulário não contradiz o que o sistema já sabe', () => {
    it('atendida: não oferece o no_answer real, mas oferece "Não atendeu" via caixa postal (voicemail)', () => {
      renderModal({ connected: true, durationSeconds: 120 });
      expect(screen.getByRole('radio', { name: /Conversa relevante/ })).toBeInTheDocument();
      const values = screen.getAllByRole('radio').map((r) => r.getAttribute('value'));
      // Guard: numa ligação atendida o SDR não pode marcar o "não atendeu" cru
      // (contradiz a telemetria)...
      expect(values).not.toContain('no_answer');
      // ...mas há um "Não atendeu" rotulado assim que grava `voicemail` (a linha
      // atendeu, mas era caixa postal/secretária — não um humano).
      expect(values).toContain('voicemail');
    });

    it('não atendida: "Registrar outro desfecho" revela só "Não atendeu" e "Falha técnica"', async () => {
      const user = userEvent.setup();
      renderModal({ connected: false, durationSeconds: 0 });
      await user.click(screen.getByRole('button', { name: /Registrar outro desfecho/ }));
      expect(screen.getByRole('radio', { name: /^Não atendeu/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Falha técnica/ })).toBeInTheDocument();
      for (const forbidden of [/Conversa relevante/, /Atendeu, sem avanço/, /Pediu para ligar depois/]) {
        expect(screen.queryByRole('radio', { name: forbidden })).not.toBeInTheDocument();
      }
    });
  });

  describe('obrigatoriedade do desfecho (atendida)', () => {
    it('atendida: "Concluir" fica desabilitado até o SDR escolher o desfecho', async () => {
      const user = userEvent.setup();
      renderModal({ connected: true, durationSeconds: 90 });
      expect(screen.getByRole('button', { name: /Concluir atividade/ })).toBeDisabled();
      expect(screen.getByText(/Selecione o desfecho para concluir/)).toBeInTheDocument();

      await user.click(screen.getByRole('radio', { name: /Conversa relevante/ }));
      expect(screen.getByRole('button', { name: /Concluir atividade/ })).toBeEnabled();
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
      renderModal({ connected: false }); // pré-seleciona no_answer
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
        expect.objectContaining({ outcome: 'answered_no_progress', returnSchedule: null }),
      );
    });
  });
});

describe('dismissible={false} — fechamento só pelo Concluir ou pelo ×', () => {
  it('Esc não fecha', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ connected: true, dismissible: false });
    await user.keyboard('{Escape}');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('o × do cabeçalho continua fechando', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ connected: true, dismissible: false });
    await user.click(screen.getByRole('button', { name: /Close/ }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('padrão (dismissible) → Esc fecha', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ connected: true });
    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('sinal de atendimento chega com o modal aberto (webhook da API4COM)', () => {
  it('atendida → não atendida: esconde o desfecho, pré-seleciona "Não atendeu" e "Ligar de novo" vira principal', async () => {
    const user = userEvent.setup();
    const onConclude = vi.fn();
    const base: CallResultModalProps = {
      open: true,
      onClose: vi.fn(),
      leadName: 'Lead de Teste',
      phoneLabel: '16982501819',
      durationSeconds: 7,
      connected: true,
      onRetry: vi.fn(),
      onConclude,
    };
    const { rerender } = render(<CallResultModal {...base} />);
    expect(screen.getByText('Atendida')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();

    rerender(<CallResultModal {...base} connected={false} durationSeconds={0} />);

    expect(screen.getByText('Não atendida')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Concluir atividade/ }));
    expect(onConclude).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'no_answer' }));
  });

  it('escolha que deixou de valer volta ao padrão "Não atendeu"', async () => {
    const user = userEvent.setup();
    const base: CallResultModalProps = {
      open: true,
      onClose: vi.fn(),
      leadName: 'Lead de Teste',
      phoneLabel: '16982501819',
      durationSeconds: 7,
      connected: true,
      onConclude: vi.fn(),
    };
    const { rerender } = render(<CallResultModal {...base} />);
    await user.click(screen.getByRole('radio', { name: /Conversa relevante/ }));

    rerender(<CallResultModal {...base} connected={false} durationSeconds={0} />);

    expect(screen.queryByRole('radio', { name: /Conversa relevante/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Registrar outro desfecho/ }));
    expect(screen.getByRole('radio', { checked: true })).toHaveAttribute('value', 'no_answer');
  });

  it('mantém a escolha do SDR que continua válida quando o sinal muda', async () => {
    const user = userEvent.setup();
    const base: CallResultModalProps = {
      open: true,
      onClose: vi.fn(),
      leadName: 'Lead de Teste',
      phoneLabel: '16982501819',
      durationSeconds: 0,
      connected: false,
      onConclude: vi.fn(),
    };
    const { rerender } = render(<CallResultModal {...base} />);
    await user.click(screen.getByRole('button', { name: /Registrar outro desfecho/ }));
    await user.click(screen.getByRole('radio', { name: /Falha técnica/ }));

    // O webhook chega dizendo que atendeu: "Falha técnica" vale nos dois casos.
    rerender(<CallResultModal {...base} connected durationSeconds={12} />);
    expect(screen.getByRole('radio', { name: /Falha técnica/ })).toBeChecked();
  });
});
