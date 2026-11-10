import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DISPOSITION_OPTIONS } from '../disposition';
import { CallOutcomeSelector } from './CallOutcomeSelector';

describe('CallOutcomeSelector', () => {
  it('renderiza as 6 opções de desfecho', () => {
    render(<CallOutcomeSelector value="relevant_conversation" onChange={vi.fn()} />);
    const values = screen.getAllByRole('radio').map((r) => r.getAttribute('value'));
    expect(values).toEqual(DISPOSITION_OPTIONS.map((o) => o.value));
    expect(screen.getByRole('radio', { name: /Caixa postal/ })).toHaveAttribute('value', 'voicemail');
    expect(screen.getByRole('radio', { name: /^Não atendeu/ })).toHaveAttribute('value', 'no_answer');
  });

  it('mostra a consequência (hint) de cada desfecho — o SDR precisa ver antes de escolher', () => {
    render(<CallOutcomeSelector value="relevant_conversation" onChange={vi.fn()} />);
    expect(screen.getAllByText('Avança a cadência')).toHaveLength(2);
    expect(screen.getByText('Agenda o retorno combinado')).toBeInTheDocument();
    // "Segue a cadência" agora aparece em dois desfechos: caixa postal e "não atendeu".
    expect(screen.getAllByText('Segue a cadência')).toHaveLength(2);
    expect(screen.getByText('Volta para a fila')).toBeInTheDocument();
  });

  it('marca como selecionado o desfecho recebido em `value`', () => {
    render(<CallOutcomeSelector value="no_answer" onChange={vi.fn()} />);
    const selected = screen.getByRole('radio', { checked: true });
    expect(selected).toHaveAttribute('value', 'no_answer');
  });

  it('expõe os desfechos como radios num grupo rotulado (acessibilidade)', () => {
    render(<CallOutcomeSelector value="relevant_conversation" onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Desfecho da ligação' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(DISPOSITION_OPTIONS.length);
  });

  it('desabilita todos os radios quando disabled', () => {
    render(<CallOutcomeSelector value="relevant_conversation" onChange={vi.fn()} disabled />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });
});
